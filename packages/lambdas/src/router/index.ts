import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { App, AwsLambdaReceiver } from '@slack/bolt';
import { StepFunctions } from 'aws-sdk';
import { intentClassifier } from '@symentic/core';
import { SlackMessage } from '@symentic/core';
import { handleThreadResponse, storeWorkflowReference } from './thread-response-handler';
import { executionTracker } from '@symentic/core';
import { redisService } from '@symentic/core';

const stepFunctions = new StepFunctions();

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
    if (intent.intent.startsWith('bug.') && intent.intent !== 'bug.response') {
      // Send immediate acknowledgment first (to meet Slack's 3s timeout)
      await say({
        text: '🐛 I\'ve detected a bug report. Starting the triage process...',
        thread_ts: msg.thread_ts || msg.ts
      });
      
      // Start bug triage workflow after acknowledgment
      // This prevents timeout issues
      startBugTriageWorkflow(msg, intent, client).catch(error => {
        console.error('Failed to start workflow:', error);
        // Optionally notify user of failure
        say({
          text: '❌ Sorry, I encountered an error starting the bug triage process.',
          thread_ts: msg.thread_ts || msg.ts
        });
      });
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
  // Construct Step Function ARN dynamically
  const _region = process.env.AWS_REGION || 'us-east-1';
  const stage = process.env.STAGE || 'prod';
  
  // First try to list state machines to find the correct ARN
  try {
    const listResult = await stepFunctions.listStateMachines({
      maxResults: 100
    }).promise();
    
    const stateMachine = listResult.stateMachines?.find(sm => 
      sm.name === `BugTriageStateMachine-${stage}`
    );
    
    if (!stateMachine?.stateMachineArn) {
      throw new Error(`State machine BugTriageStateMachine-${stage} not found`);
    }
    
    const bugId = `bug-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const threadTs = message.thread_ts || message.ts;
    
    // Create execution record in our tracking table
    const execution = await executionTracker.createExecution({
      threadId: threadTs,
      userId: message.user!,
      channelId: message.channel!,
      teamId: message.team!,
      agentType: 'bug_triage',
      originalMessage: message.text || ''
    });
    
    const params = {
      stateMachineArn: stateMachine.stateMachineArn,
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
  
    const result = await stepFunctions.startExecution(params).promise();
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
  } catch (error) {
    console.error('Failed to start bug triage workflow:', error);
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