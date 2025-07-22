import { App, AwsLambdaReceiver } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import express from 'express';
import { config } from 'dotenv';
import { messageHandler } from './handlers/messageHandler';
import { setupInternalAPI } from './api/internalAPI';
import { initializeServices } from './services/serviceInitializer';
import { redisService } from './services/redis';
import { createAgentRegistry } from './services/agentRegistry';
import { SlackMessage, SlackAction, SlackSayFunction } from './types/slack';
import { EnhancedBugTriageState } from './types/domain';

// Load environment variables
config();

// Initialize AWS Lambda receiver
const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
});

// Initialize Slack App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  receiver: awsLambdaReceiver,
  processBeforeResponse: false, // Process after responding to avoid timeouts
});

// Initialize services
let servicesInitialized = false;

async function ensureServicesInitialized() {
  if (!servicesInitialized) {
    await initializeServices();
    servicesInitialized = true;
  }
}

// Register message handler for all messages (no slash commands)
app.message(async ({ message, say, client }) => {
  const msg = message as SlackMessage; // Use proper type
  
  console.log('Message received:', JSON.stringify({
    user: msg.user,
    bot_id: msg.bot_id,
    subtype: msg.subtype,
    text: msg.text?.substring(0, 50)
  }, null, 2));
  
  // Skip bot messages
  if (msg.subtype === 'bot_message' || msg.bot_id) {
    console.log('Skipping bot message');
    return;
  }
  
  console.log('Processing user message');
  await ensureServicesInitialized();
  await messageHandler({ 
    message: msg, 
    say: say as unknown as SlackSayFunction, 
    client: client as unknown as WebClient
  });
});

// Handle button interactions (for bug severity selection, etc.)
app.action(/severity_.+/, async ({ action, ack, say, client }) => {
  await ack();
  
  const buttonAction = action as SlackAction;
  const severity = buttonAction.value as 'low' | 'medium' | 'high';
  const userId = buttonAction.user.id;
  const threadTs = buttonAction.message.thread_ts || buttonAction.message.ts;
  
  // Get bug triage state
  const bugTriageState = await redisService.getBugTriageState(userId, threadTs) as EnhancedBugTriageState | null;
  if (!bugTriageState) {
    await say!({
      text: "I couldn't find the bug report. Please start over.",
      thread_ts: threadTs
    });
    return;
  }
  
  // Update severity and finalize
  bugTriageState.severity = severity;
  bugTriageState.step = 'finalizing';
  await redisService.setBugTriageState(userId, threadTs, bugTriageState);
  
  // Trigger the bug triage agent to finalize
  const agentRegistry = createAgentRegistry(client as unknown as WebClient);
  const registeredAgents = agentRegistry.getRegisteredAgents();
  const hasBugAgent = registeredAgents.some(a => a.name === 'BugTriageAgent');
    
  if (hasBugAgent) {
    const context = {
      userId,
      channelId: buttonAction.channel.id,
      threadTs,
      messageTs: buttonAction.message.ts,
      originalText: `Severity selected: ${severity}`,
      intent: { 
        intent: 'bug.finalize', 
        confidence: 1, 
        entities: { severity },
        modelUsed: 'gpt-3.5-turbo' as const,
        requiresFollowUp: []
      },
      memory: { shortTerm: {}, longTerm: {} }
    };
    
    await agentRegistry.routeToAgent(context, say as unknown as SlackSayFunction);
  }
});

// Handle alternative time selection for meetings
app.action(/choose_time_.+/, async ({ action, ack, say }) => {
  await ack();
  
  const buttonAction = action as SlackAction;
  const timestamp = buttonAction.value || '';
  
  await say!({
    text: `Great! I'll schedule the meeting for ${new Date(timestamp).toLocaleString()}.`,
    thread_ts: buttonAction.message.thread_ts
  });
});

// Create Express app for internal REST API
const expressApp = express();
expressApp.use(express.json());

// Setup internal API routes
setupInternalAPI(expressApp, app);

// Lambda handler for Slack events
export const slackHandler = async (
  event: APIGatewayProxyEvent,
  context: Context,
  callback: (error: string | Error | null | undefined, result?: APIGatewayProxyResult) => void
): Promise<APIGatewayProxyResult> => {
  console.log('Lambda invoked with event:', JSON.stringify(event, null, 2));
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  
  // Handle Slack URL verification challenge
  if (event.body) {
    try {
      const body = JSON.parse(event.body);
      console.log('Parsed body:', JSON.stringify(body, null, 2));
      
      if (body.type === 'url_verification' && body.challenge) {
        console.log('Handling URL verification challenge');
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'text/plain' },
          body: body.challenge,
        };
      }
    } catch (e) {
      console.error('Error parsing body:', e);
    }
  }

  // Handle Slack events
  if (event.headers && (event.headers['x-slack-signature'] || event.headers['X-Slack-Signature'])) {
    console.log('Processing Slack event with signature');
    
    // If this is a retry, skip processing but still return 200
    if (event.headers['X-Slack-Retry-Num'] || event.headers['x-slack-retry-num']) {
      console.log('Skipping Slack retry');
      return {
        statusCode: 200,
        body: 'OK',
      };
    }
    
    // Parse body to check if it's a bot message BEFORE invoking Bolt
    if (event.body) {
      try {
        const body = JSON.parse(event.body);
        if (body.type === 'event_callback' && body.event) {
          const eventData = body.event;
          
          // Skip bot messages at Lambda level to avoid unnecessary processing
          if (eventData.bot_id || eventData.subtype === 'bot_message') {
            console.log('Skipping bot message at Lambda level - returning 200 immediately');
            return {
              statusCode: 200,
              body: 'OK',
            };
          }
          
          // Check for duplicate events using event_id
          const eventId = body.event_id;
          if (eventId) {
            const eventKey = `event:${eventId}`;
            const alreadyProcessed = await redisService.getShortTermMemory(eventKey);
            if (alreadyProcessed) {
              console.log(`Skipping duplicate event: ${eventId}`);
              return {
                statusCode: 200,
                body: 'OK',
              };
            }
            // Mark event as processed (with 5 minute TTL)
            await redisService.setShortTermMemory(eventKey, true, 300);
          }
        }
      } catch (e) {
        console.error('Error pre-parsing Slack event:', e);
      }
    }
    
    // Let Bolt handle the event
    const handler = await awsLambdaReceiver.start();
    return handler(event, context, callback);
  }
  
  console.log('Not a Slack event, checking internal API routes');
  
  // Handle internal API requests directly
  const path = event.path;
  const method = event.httpMethod;
  const headers = event.headers || {};
  const apiKey = headers['x-api-key'] || headers['X-API-Key'];
  
  // Simple health check endpoint (no auth required)
  if (path === '/health' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'semantic-slack-bot'
      })
    };
  }
  
  // All other endpoints require API key
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }
  
  // Route to appropriate handler
  try {
    // For now, just return a placeholder response
    // TODO: Properly handle all the internal API routes
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Internal API endpoint',
        path,
        method
      })
    };
  } catch (error) {
    console.error('Error handling internal API request:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

// Export handler for AWS Lambda
export const handler = slackHandler;