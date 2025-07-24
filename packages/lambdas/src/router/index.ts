import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { App, AwsLambdaReceiver } from '@slack/bolt';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { intentClassifier } from '@symentic/core';
import { SlackMessage } from '@symentic/core';
import { handleThreadResponse, storeWorkflowReference } from './thread-response-handler';
import { executionTracker } from '@symentic/core';
import { redisService } from '@symentic/core';

// Initialize Step Functions client with explicit configuration
const stepFunctions = new SFNClient({
  region: process.env.AWS_REGION || 'us-east-1',
  requestHandler: {
    requestTimeout: 5000,
    httpsAgent: {
      connectTimeout: 3000
    }
  }
});

console.log('Step Functions client initialized with region:', process.env.AWS_REGION || 'us-east-1');

// Initialize AWS Lambda receiver
const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
});

// Initialize Slack App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  receiver: awsLambdaReceiver,
  processBeforeResponse: true, // Process events before responding
});

// Simple message filter
function shouldProcessMessage(message: SlackMessage): boolean {
  // Skip bot messages
  if (message.bot_id || message.subtype === 'bot_message') return false;
  
  // Process all DMs
  if (message.channel_type === 'im') return true;
  
  // Process if bot is mentioned
  const botMention = /<@U\w+>/.exec(message.text || '');
  if (botMention) return true;
  
  // Process if contains trigger keywords
  const text = (message.text || '').toLowerCase();
  const triggers = ['bug', 'issue', 'error', 'problem', 'schedule', 'meeting', 'help'];
  return triggers.some(trigger => text.includes(trigger));
}

// Handle all messages
app.message(async ({ message, say, client, body }) => {
  const msg = message as SlackMessage;
  console.log(`Processing message: "${msg.text?.substring(0, 100)}" from user: ${msg.user}`);
  
  // Event deduplication using Redis
  const eventId = (body as { event_id?: string }).event_id;
  if (eventId) {
    try {
      const dedupKey = `slack:event:${eventId}`;
      const processed = await redisService.getShortTermMemory(dedupKey);
      if (processed) {
        console.log(`Duplicate event detected: ${eventId}`);
        return; // Already processed
      }
      // Mark as processed with 5 minute TTL
      await redisService.setShortTermMemory(dedupKey, true, 300);
    } catch (error) {
      console.error('Redis deduplication error:', error);
      // Continue processing even if Redis fails
    }
  }
  
  // Check if this is a thread response first
  if (msg.thread_ts && msg.thread_ts !== msg.ts) {
    const handled = await handleThreadResponse(msg, client);
    if (handled) {
      console.log('Thread response handled by workflow');
      return;
    }
  }
  
  if (!shouldProcessMessage(msg)) {
    console.log('Message filtered out:', msg.text?.substring(0, 50));
    return;
  }
  
  try {
    // Classify intent
    const intent = await intentClassifier.classifyIntent({
      message: msg.text || '',
      userId: msg.user || '',
      channelId: msg.channel || '',
      recentContext: []
    });
    
    console.log(`Intent classified: ${intent.intent} (${intent.confidence})`);
    
    // Route based on intent
    console.log('Checking bug condition:', {
      startsWith: intent.intent.startsWith('bug.'),
      notResponse: intent.intent !== 'bug.response',
      intentValue: intent.intent
    });
    if (intent.intent.startsWith('bug.') && intent.intent !== 'bug.response') {
      console.log('Bug report condition met, sending acknowledgment...');
      // Send immediate acknowledgment first (to meet Slack's 3s timeout)
      await say({
        text: '🐛 I\'ve detected a bug report. Starting the triage process...',
        thread_ts: msg.thread_ts || msg.ts
      });
      
      // Start the workflow - we'll await it to ensure it runs
      try {
        console.log('Starting bug triage workflow...');
        await startBugTriageWorkflow(msg, intent, client);
        console.log('Bug triage workflow started successfully');
      } catch (error) {
        console.error('Failed to start workflow:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        console.error('Error details:', JSON.stringify(error, null, 2));
        // Notify user of failure
        try {
          await say({
            text: '❌ Sorry, I encountered an error starting the bug triage process. Please try again.',
            thread_ts: msg.thread_ts || msg.ts
          });
        } catch (sayError) {
          console.error('Failed to send error message:', sayError);
        }
      }
    } else if (intent.intent.startsWith('calendar.')) {
      // Start calendar workflow
      await say({
        text: '📅 I\'ll help you with calendar management. This feature is being migrated to our new architecture.',
        thread_ts: msg.thread_ts || msg.ts
      });
    } else if (intent.confidence < 0.6) {
      // Low confidence - don't respond
      console.log('Low confidence intent, not responding');
    } else {
      console.log('No specific handler for intent:', intent.intent);
      // General response
      await say({
        text: 'I can help you with bug reports, scheduling meetings, and managing tasks. What would you like to do?',
        thread_ts: msg.thread_ts || msg.ts
      });
    }
  } catch (error) {
    console.error('Error processing message:', error);
    await say({
      text: 'Sorry, I encountered an error processing your request.',
      thread_ts: msg.thread_ts || msg.ts
    });
  }
});

// Start bug triage Step Function
async function startBugTriageWorkflow(
  message: SlackMessage,
  intent: { intent: string; entities?: { severity?: string }; confidence: number },
  client: { token?: string } // WebClient from @slack/bolt
) {
  console.log('=== startBugTriageWorkflow STARTED ===');
  console.log('Message:', {
    text: message.text,
    user: message.user,
    channel: message.channel,
    ts: message.ts
  });
  
  try {
    // Construct Step Function ARN dynamically
    const region = process.env.AWS_REGION || 'us-east-1';
    const stage = process.env.STAGE || 'prod';
    const accountId = '842733143746'; // Your AWS account ID
    
    console.log('Environment:', { region, stage, accountId });
    
    // Use the known ARN directly to avoid the listStateMachines call
    const stateMachineArn = `arn:aws:states:${region}:${accountId}:stateMachine:BugTriageStateMachine-${stage}`;
    console.log('Using state machine ARN:', stateMachineArn);
    
    const bugId = `bug-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const threadTs = message.thread_ts || message.ts;
    
    console.log('Creating execution record...');
    // Create execution record in our tracking table
    const execution = await executionTracker.createExecution({
      threadId: threadTs,
      userId: message.user!,
      channelId: message.channel!,
      teamId: message.team!,
      agentType: 'bug_triage',
      originalMessage: message.text || ''
    });
    console.log('Created execution:', execution.executionId);
    
    const params = {
      stateMachineArn: stateMachineArn,
      name: `bug-triage-${message.user}-${Date.now()}`,
      input: JSON.stringify({
        bugId,
        bugReport: {
          description: message.text || '',
          reportedBy: message.user,
          channel: message.channel,
          timestamp: new Date().toISOString(),
          severity: intent.entities?.severity || 'medium'
        },
        context: {
          userId: message.user,
          channelId: message.channel,
          teamId: message.team,
          slackClient: client.token
        },
        threadTs,
        attemptCount: 0,
        executionId: execution.executionId
      })
    };
    
    console.log('Starting Step Functions execution with params:', JSON.stringify(params, null, 2));
    const command = new StartExecutionCommand(params);
    const result = await stepFunctions.send(command);
    console.log('Started bug triage workflow:', result.executionArn);
    
    // Update execution with Step Function ARN
    await executionTracker.updateExecution(execution.executionId, {
      executionArn: result.executionArn,
      metadata: {
        ...execution.metadata,
        bugId
      }
    });
    
    // Store workflow reference for thread response routing
    await storeWorkflowReference(
      message.user!,
      threadTs,
      'bug_triage',
      result.executionArn
    );
    
    console.log('=== startBugTriageWorkflow COMPLETED ===');
  } catch (error) {
    console.error('=== startBugTriageWorkflow FAILED ===');
    console.error('Error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Error details:', JSON.stringify(error, null, 2));
    throw error;
  }
}

// Lambda handler
export const handler = async (
  event: APIGatewayProxyEvent,
  context: { requestId: string },
  callback: (error?: Error | null, result?: APIGatewayProxyResult) => void
): Promise<APIGatewayProxyResult> => {
  console.log('Router Lambda invoked:', JSON.stringify({
    requestId: context.requestId,
    headers: event.headers,
    timestamp: new Date().toISOString()
  }, null, 2));
  
  // Handle URL verification
  if (event.body) {
    try {
      const body = JSON.parse(event.body);
      console.log('Request body type:', body.type, 'Event ID:', body.event_id);
      if (body.type === 'url_verification') {
        return {
          statusCode: 200,
          body: body.challenge
        };
      }
    } catch (e) {
      // Not JSON, continue
      console.log('Body parsing error:', e);
    }
  }
  
  // Handle Slack events
  const slackHandler = await awsLambdaReceiver.start();
  const result = await slackHandler(event, context, callback);
  console.log('Handler completed with result:', result?.statusCode);
  return result;
};