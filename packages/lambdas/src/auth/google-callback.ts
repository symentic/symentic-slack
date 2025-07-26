import { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda';
import { googleCalendarService } from '@symentic/core';

export const handler: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event) => {
  console.log('Google OAuth callback invoked:', JSON.stringify({
    queryParams: event.queryStringParameters,
    headers: event.headers
  }, null, 2));

  try {
    const code = event.queryStringParameters?.code;
    const state = event.queryStringParameters?.state; // This contains userId
    const error = event.queryStringParameters?.error;

    // Check for OAuth errors
    if (error) {
      console.error('OAuth error:', error);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html',
        },
        body: `
          <html>
            <head>
              <title>Calendar Authorization Failed</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                       display: flex; align-items: center; justify-content: center; 
                       height: 100vh; margin: 0; background: #f5f5f5; }
                .container { text-align: center; padding: 40px; background: white; 
                            border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                h1 { color: #e74c3c; }
                p { color: #666; margin: 20px 0; }
                .button { display: inline-block; padding: 12px 24px; 
                         background: #4A154B; color: white; text-decoration: none; 
                         border-radius: 4px; margin-top: 20px; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>❌ Authorization Failed</h1>
                <p>There was an error connecting your Google Calendar.</p>
                <p>Error: ${error}</p>
                <a href="slack://open" class="button">Return to Slack</a>
              </div>
            </body>
          </html>
        `
      };
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing required parameters:', { code: !!code, state: !!state });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required parameters' })
      };
    }

    // Exchange code for tokens
    await googleCalendarService.handleAuthCallback(code, state);
    
    console.log(`Successfully saved calendar tokens for user: ${state}`);

    // Return success page with redirect to Slack
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
      },
      body: `
        <html>
          <head>
            <title>Calendar Connected!</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                     display: flex; align-items: center; justify-content: center; 
                     height: 100vh; margin: 0; background: #f5f5f5; }
              .container { text-align: center; padding: 40px; background: white; 
                          border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              h1 { color: #27ae60; }
              p { color: #666; margin: 20px 0; }
              .button { display: inline-block; padding: 12px 24px; 
                       background: #4A154B; color: white; text-decoration: none; 
                       border-radius: 4px; margin-top: 20px; }
              .emoji { font-size: 48px; margin-bottom: 20px; }
            </style>
            <script>
              // Auto-redirect to Slack after 3 seconds
              setTimeout(() => {
                window.location.href = 'slack://open';
              }, 3000);
            </script>
          </head>
          <body>
            <div class="container">
              <div class="emoji">🎉</div>
              <h1>Calendar Connected Successfully!</h1>
              <p>Your Google Calendar has been connected to the Symentic bot.</p>
              <p>You can now ask me about your schedule or to create meetings!</p>
              <a href="slack://open" class="button">Return to Slack</a>
              <p style="font-size: 14px; color: #999; margin-top: 30px;">
                Redirecting to Slack in 3 seconds...
              </p>
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
        'Content-Type': 'text/html',
      },
      body: `
        <html>
          <head>
            <title>Connection Error</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                     display: flex; align-items: center; justify-content: center; 
                     height: 100vh; margin: 0; background: #f5f5f5; }
              .container { text-align: center; padding: 40px; background: white; 
                          border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              h1 { color: #e74c3c; }
              p { color: #666; margin: 20px 0; }
              .button { display: inline-block; padding: 12px 24px; 
                       background: #4A154B; color: white; text-decoration: none; 
                       border-radius: 4px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>⚠️ Connection Error</h1>
              <p>There was an error connecting your calendar. Please try again.</p>
              <a href="slack://open" class="button">Return to Slack</a>
            </div>
          </body>
        </html>
      `
    };
  }
};