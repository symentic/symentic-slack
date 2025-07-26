import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { googleCalendarService } from '@symentic/core';
import { WebClient } from '@slack/web-api';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('OAuth callback received:', JSON.stringify(event, null, 2));
  
  try {
    // Extract code and state from query parameters
    const code = event.queryStringParameters?.code;
    const state = event.queryStringParameters?.state; // state contains userId
    
    if (!code || !state) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'text/html'
        },
        body: `
          <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1>❌ Error</h1>
              <p>Missing authorization code or state parameter.</p>
              <p>Please try connecting your calendar again from Slack.</p>
            </body>
          </html>
        `
      };
    }
    
    // Exchange code for tokens and save
    await googleCalendarService.handleAuthCallback(code, state);
    
    // Send success message to user in Slack
    try {
      const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
      await slack.chat.postMessage({
        channel: state, // userId
        text: '✅ Your Google Calendar has been successfully connected!',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '✅ *Your Google Calendar has been successfully connected!*'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'I can now:\n• Check your availability for bug triage meetings\n• Schedule meetings directly on your calendar\n• Send you calendar invitations'
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'Your calendar connection will remain active until you revoke access. Use `/disconnect-calendar` to disconnect.'
              }
            ]
          }
        ]
      });
    } catch (slackError) {
      console.error('Error sending Slack notification:', slackError);
    }
    
    // Return success page
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html'
      },
      body: `
        <html>
          <head>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                text-align: center;
                padding: 50px;
                background-color: #f5f5f5;
              }
              .container {
                max-width: 500px;
                margin: 0 auto;
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              h1 {
                color: #4CAF50;
                font-size: 24px;
                margin-bottom: 20px;
              }
              p {
                color: #666;
                line-height: 1.5;
              }
              .slack-button {
                display: inline-block;
                margin-top: 20px;
                padding: 12px 24px;
                background-color: #4A154B;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                font-weight: 500;
              }
              .slack-button:hover {
                background-color: #611f69;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✅ Calendar Connected Successfully!</h1>
              <p>Your Google Calendar has been connected to Symentic.</p>
              <p>You can now close this window and return to Slack.</p>
              <a href="slack://open" class="slack-button">Return to Slack</a>
            </div>
          </body>
        </html>
      `
    };
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'text/html'
      },
      body: `
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1>❌ Connection Failed</h1>
            <p>There was an error connecting your calendar.</p>
            <p>Error: ${error instanceof Error ? error.message : 'Unknown error'}</p>
            <p>Please try again or contact support.</p>
          </body>
        </html>
      `
    };
  }
};