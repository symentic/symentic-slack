import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { App, AwsLambdaReceiver } from '@slack/bolt';
import { StepFunctions } from 'aws-sdk';
import { intentClassifier } from '../../services/intentClassifier';
import { SlackMessage } from '../../types/slack';
import { handleThreadResponse, storeWorkflowReference } from './thread-response-handler';

const stepFunctions = new StepFunctions();

// Initialize AWS Lambda receiver
const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
});

// Initialize Slack App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  receiver: awsLambdaReceiver,
  processBeforeResponse: true, // Process before responding for quick ack
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
app.message(async ({ message, say, client }) => {
  const msg = message as SlackMessage;
  
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
      // Start bug triage workflow
      await startBugTriageWorkflow(msg, intent, client);
      
      // Send immediate acknowledgment
      await say({
        text: '🐛 I\'ve detected a bug report. Starting the triage process...',
        thread_ts: msg.thread_ts || msg.ts
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
  intent: any,
  client: any // WebClient from @slack/bolt
) {
  // Construct Step Function ARN dynamically
  const region = process.env.AWS_REGION || 'us-east-1';
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
    
    const params = {
      stateMachineArn: stateMachine.stateMachineArn,
      name: `bug-triage-${message.user}-${Date.now()}`,
      input: JSON.stringify({
      bugId: `bug-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
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
      threadTs: message.thread_ts || message.ts,
      attemptCount: 0
    })
  };
  
    const result = await stepFunctions.startExecution(params).promise();
    console.log('Started bug triage workflow:', result.executionArn);
    
    // Store workflow reference for thread response routing
    await storeWorkflowReference(
      message.user!,
      message.thread_ts || message.ts,
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
  context: any,
  callback: any
): Promise<APIGatewayProxyResult> => {
  console.log('Router Lambda invoked:', JSON.stringify(event.headers, null, 2));
  
  // Handle URL verification
  if (event.body) {
    try {
      const body = JSON.parse(event.body);
      if (body.type === 'url_verification') {
        return {
          statusCode: 200,
          body: body.challenge
        };
      }
    } catch (e) {
      // Not JSON, continue
    }
  }
  
  // Handle Slack events
  const slackHandler = await awsLambdaReceiver.start();
  return slackHandler(event, context, callback);
};