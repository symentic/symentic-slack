import { App, AwsLambdaReceiver } from '@slack/bolt';
import { APIGatewayProxyHandler } from 'aws-lambda';
import express from 'express';
import { config } from 'dotenv';
import { messageHandler } from './handlers/messageHandler';
import { setupInternalAPI } from './api/internalAPI';
import { initializeServices } from './services/serviceInitializer';
import { redisService } from './services/redis';

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
  const msg = message as any; // Cast to any to handle various message types
  
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
  await messageHandler({ message, say, client: client as any });
});

// Create Express app for internal REST API
const expressApp = express();
expressApp.use(express.json());

// Setup internal API routes
setupInternalAPI(expressApp, app);

// Lambda handler for Slack events
export const slackHandler: APIGatewayProxyHandler = async (event, context, callback) => {
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
    return handler(event as any, context as any, callback as any) as any;
  }
  
  console.log('Not a Slack event, checking internal API routes');
  
  // Handle internal API requests
  return new Promise((resolve) => {
    const mockReq = {
      method: event.httpMethod,
      url: event.path,
      headers: event.headers,
      body: event.body ? JSON.parse(event.body) : {},
      query: event.queryStringParameters || {},
    } as any;

    const mockRes = {
      statusCode: 200,
      headers: {},
      body: '',
      status: function(code: number) {
        this.statusCode = code;
        return this;
      },
      json: function(data: any) {
        this.headers['Content-Type'] = 'application/json';
        this.body = JSON.stringify(data);
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: this.body,
        });
      },
      send: function(data: string) {
        this.body = data;
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: this.body,
        });
      },
    } as any;

    // Route to appropriate handler
    const route = event.path;
    if (route.startsWith('/messages')) {
      expressApp._router.handle(mockReq, mockRes);
    } else if (route.startsWith('/users')) {
      expressApp._router.handle(mockReq, mockRes);
    } else if (route.startsWith('/memory')) {
      expressApp._router.handle(mockReq, mockRes);
    } else if (route.startsWith('/message')) {
      expressApp._router.handle(mockReq, mockRes);
    } else if (route.startsWith('/create-bot')) {
      expressApp._router.handle(mockReq, mockRes);
    } else if (route.startsWith('/bugs')) {
      expressApp._router.handle(mockReq, mockRes);
    } else if (route.startsWith('/health')) {
      expressApp._router.handle(mockReq, mockRes);
    } else if (route.startsWith('/auth/google')) {
      expressApp._router.handle(mockReq, mockRes);
    } else {
      console.log('No matching route for:', route);
      resolve({
        statusCode: 404,
        body: JSON.stringify({ error: 'Not found' }),
      });
    }
  });
};

// Export handler for AWS Lambda
export const handler = slackHandler;