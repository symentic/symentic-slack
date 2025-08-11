import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { App, AwsLambdaReceiver } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { intentClassifier } from '@symentic/core';
import { SlackMessage } from '@symentic/core';
import { handleThreadResponse, storeWorkflowReference } from './thread-response-handler';
import { executionTracker } from '@symentic/core';
import { redisService } from '@symentic/core';
import { profileEngramService } from '@symentic/core';
import { ProfileInteraction, SlackUserData } from '@symentic/core';
import { googleCalendarService } from '@symentic/core';
import { CalendarToken, CalendarEvent, BusySlot, SlackBlock } from './types';

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

// Handle app installation event
app.event('app_installed', async ({ event, client }) => {
  console.log('App installed event received:', event);
  
  try {
    const businessId = (event as any).team_id;
    
    // Invoke the sync Lambda directly
    const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const invokeCommand = new InvokeCommand({
      FunctionName: `symentic-slack-bot-${process.env.STAGE}-profileSyncWorkspace`,
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify({
        businessId,
        triggerType: 'app_installed'
      })
    });
    
    try {
      await lambdaClient.send(invokeCommand);
      console.log('Profile sync Lambda invoked for business:', businessId);
    } catch (invokeError) {
      console.error('Failed to invoke sync Lambda:', invokeError);
    }
    
    // Send welcome message
    const channels = await client.conversations.list({
      types: 'public_channel',
      limit: 1
    });
    
    if (channels.channels && channels.channels.length > 0) {
      await client.chat.postMessage({
        channel: channels.channels[0].id!,
        text: "👋 Hello! I'm Symentic, your AI-powered workspace assistant. I'm now syncing team profiles to better assist you. This may take a few minutes."
      });
    }
  } catch (error) {
    console.error('Error handling app installation:', error);
  }
});

// Handle team join events (new users)
app.event('team_join', async ({ event }) => {
  console.log('New user joined:', (event as any).user);
  
  try {
    const userEvent = event as any;
    const businessId = userEvent.user?.team_id || userEvent.team || '';
    if (!businessId) {
      console.error('No team ID found in team_join event');
      return;
    }
    
    // Create profile for new user
    const slackUser = userEvent.user as SlackUserData;
    await profileEngramService.createProfile({
      businessId,
      userId: slackUser.id,
      userType: 'internal',
      name: slackUser.real_name || slackUser.name || 'New User',
      email: slackUser.profile?.email,
      source: 'slack',
      role: slackUser.profile?.title || 'Team Member',
      slackData: slackUser,
      consent: {
        given: true,
        method: 'terms_acceptance',
        timestamp: new Date().toISOString()
      }
    });
    
    console.log(`Profile created for new user: ${slackUser.id}`);
  } catch (error) {
    console.error('Error creating profile for new user:', error);
  }
});

// Handle user profile changes
app.event('user_change', async ({ event }) => {
  const userEvent = event as any;
  console.log('User profile changed:', userEvent.user?.id);
  
  try {
    const slackUser = userEvent.user as SlackUserData;
    const businessId = userEvent.user?.team_id || userEvent.team || '';
    
    if (!businessId) {
      console.error('No team ID found in user_change event');
      return;
    }
    
    // Update existing profile
    const existingProfile = await profileEngramService.getProfile(businessId, slackUser.id);
    
    if (existingProfile) {
      await profileEngramService.updateProfile({
        businessId,
        userId: slackUser.id,
        updates: {
          name: slackUser.real_name || slackUser.name || existingProfile.name,
          email: slackUser.profile?.email || existingProfile.email,
          role: slackUser.profile?.title || existingProfile.role,
          slackProfile: {
            slackUserId: slackUser.id,
            realName: slackUser.real_name || slackUser.name,
            displayName: slackUser.profile?.display_name || slackUser.name,
            title: slackUser.profile?.title,
            profilePictureUrl: slackUser.profile?.image_512 || slackUser.profile?.image_192,
            timezone: slackUser.tz,
            statusText: slackUser.profile?.status_text,
            isOwner: slackUser.is_owner || false,
            isAdmin: slackUser.is_admin || false
          }
        }
      });
      
      console.log(`Profile updated for user: ${slackUser.id}`);
    }
  } catch (error) {
    console.error('Error updating user profile:', error);
  }
});

// Patterns to detect external users
const EXTERNAL_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  userMention: /<@([A-Z0-9]+)>/g,
  customer: /\b(customer|client|user|buyer|vendor|partner|supplier)\b/i
};

// Extract external users from message text
async function extractExternalUsers(text: string): Promise<Array<{ email?: string; id?: string; name?: string }>> {
  const externalUsers: Array<{ email?: string; id?: string; name?: string }> = [];
  
  // Extract emails
  const emails = text.match(EXTERNAL_PATTERNS.email) || [];
  emails.forEach(email => {
    // Skip common internal domains (customize this for each business)
    if (!email.includes('@slack.com') && !email.includes('@anthropic.com')) {
      externalUsers.push({ email, name: email.split('@')[0] });
    }
  });
  
  // Look for customer mentions
  if (EXTERNAL_PATTERNS.customer.test(text)) {
    // Extract context around customer mention for name
    const customerMatch = text.match(/(?:customer|client|user)\s+([A-Za-z]+)/i);
    if (customerMatch && customerMatch[1]) {
      externalUsers.push({ name: customerMatch[1], id: `external_${customerMatch[1].toLowerCase()}` });
    }
  }
  
  return externalUsers;
}

// Capture interaction for profile engram
async function captureInteractionForEngram(
  message: SlackMessage,
  intent: { intent: string; confidence: number; entities?: Record<string, unknown> },
  businessId: string
) {
  // Skip bot messages
  if (message.bot_id) return;
  
  const interaction: ProfileInteraction = {
    businessId,
    userId: message.user!,
    timestamp: new Date().toISOString(),
    type: 'message',
    channel: message.channel,
    details: {
      intent: intent.intent,
      confidence: intent.confidence,
      entities: intent.entities,
      message: message.text?.substring(0, 100) // First 100 chars for privacy
    }
  };
  
  try {
    // Update internal user profile
    await profileEngramService.recordInteraction(interaction);
    
    // Check for external user mentions or interactions
    const externalUsers = await extractExternalUsers(message.text || '');
    for (const external of externalUsers) {
      await profileEngramService.createOrUpdateExternalProfile(
        businessId,
        external.email || external.id || '',
        {
          name: external.name,
          email: external.email,
          firstContactChannel: message.channel,
          interactedWith: message.user
        }
      );
    }
  } catch (error) {
    console.error('Error capturing interaction for engram:', error);
    // Don't fail the main process if engram capture fails
  }
}

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

// Handle slash commands
app.command('/connect-calendar', async ({ command, ack, say }) => {
  // Acknowledge command request
  await ack();
  
  const userId = command.user_id;
  
  try {
    // Import dynamoDBService
    const { dynamoDBService } = await import('@symentic/core');
    
    // Check if user already has tokens
    const existingTokens = await dynamoDBService.getCalendarToken(userId);
    const hasRefreshToken = existingTokens && existingTokens.refresh_token;
    
    // Generate auth URL for the user
    const authUrl = await googleCalendarService.getAuthUrl(userId);
    
    // Customize message based on existing connection
    let headerText = '*Connect your Google Calendar for automatic meeting scheduling*';
    let contextText = '_Your calendar data will be used only for scheduling bug triage meetings. You can disconnect at any time._';
    
    if (existingTokens && !hasRefreshToken) {
      headerText = '*⚠️ Your calendar connection needs to be refreshed*\n\nYour previous connection is missing a refresh token. To fix this:\n\n1. Go to https://myaccount.google.com/permissions\n2. Find "Symentic" and click "Remove Access"\n3. Click the button below to reconnect';
      contextText = '_This will ensure your calendar stays connected and can refresh automatically._';
    } else if (hasRefreshToken) {
      headerText = '*Your calendar appears to be already connected*\n\nIf you\'re experiencing issues, you can reconnect. First:\n\n1. Go to https://myaccount.google.com/permissions\n2. Find "Symentic" and click "Remove Access"\n3. Click the button below to reconnect';
    }
    
    await say({
      text: '📅 Connect Your Google Calendar',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: headerText + '\n\nOnce connected, I can:\n• Check your availability for bug triage meetings\n• Schedule meetings directly on your calendar\n• Find common time slots with your team\n• Send you meeting invitations'
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: hasRefreshToken ? 'Reconnect Google Calendar' : 'Connect Google Calendar'
              },
              url: authUrl,
              style: 'primary'
            }
          ]
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: contextText
            }
          ]
        }
      ]
    });
  } catch (error) {
    console.error('Error generating calendar auth URL:', error);
    await say('❌ Unable to generate calendar connection link. Please try again later.');
  }
});

app.command('/disconnect-calendar', async ({ command, ack, say }) => {
  // Acknowledge command request
  await ack();
  
  const userId = command.user_id;
  
  try {
    // Import dynamoDBService
    const { dynamoDBService } = await import('@symentic/core');
    
    // Delete calendar tokens
    await dynamoDBService.deleteCalendarToken(userId);
    
    await say({
      text: '✅ Calendar Disconnected',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '✅ *Your Google Calendar has been disconnected*'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Your calendar data has been removed from Symentic. You can reconnect at any time using `/connect-calendar`.'
          }
        }
      ]
    });
  } catch (error) {
    console.error('Error disconnecting calendar:', error);
    await say('❌ Unable to disconnect calendar. Please try again later.');
  }
});

app.command('/refresh-profile', async ({ command, ack, say, client }) => {
  // Acknowledge command request
  await ack();
  
  const userId = command.user_id;
  const businessId = command.team_id;
  
  console.log(`Profile refresh requested by ${userId} in business ${businessId}`);
  
  try {
    // Check rate limit
    const rateLimitKey = `profile_refresh:${businessId}:${userId}`;
    const lastRefresh = await redisService.getShortTermMemory(rateLimitKey);
    
    if (lastRefresh) {
      const lastRefreshTime = parseInt(lastRefresh as string);
      const timeSinceRefresh = Date.now() - lastRefreshTime;
      const hoursRemaining = Math.ceil((24 * 60 * 60 * 1000 - timeSinceRefresh) / (60 * 60 * 1000));
      
      await say({
        text: `⏳ Your profile was recently refreshed. Please wait ${hoursRemaining} hours before refreshing again.`,
        thread_ts: command.ts
      });
      return;
    }
    
    // Set rate limit (24 hours)
    await redisService.setShortTermMemory(rateLimitKey, Date.now().toString(), 24 * 60 * 60);
    
    // Get user's Slack profile
    const userInfo = await client.users.info({ user: userId });
    
    if (!userInfo.user) {
      await say('❌ Unable to fetch your profile information.');
      return;
    }
    
    const slackUser = userInfo.user as SlackUserData;
    
    // Update profile
    const existingProfile = await profileEngramService.getProfile(businessId, userId);
    
    if (existingProfile) {
      // Update existing profile
      await profileEngramService.updateProfile({
        businessId,
        userId,
        updates: {
          name: slackUser.real_name || slackUser.name || existingProfile.name,
          email: slackUser.profile?.email || existingProfile.email,
          role: slackUser.profile?.title || existingProfile.role,
          slackProfile: {
            slackUserId: slackUser.id,
            realName: slackUser.real_name || slackUser.name,
            displayName: slackUser.profile?.display_name || slackUser.name,
            title: slackUser.profile?.title,
            profilePictureUrl: slackUser.profile?.image_512 || slackUser.profile?.image_192,
            timezone: slackUser.tz,
            statusText: slackUser.profile?.status_text,
            isOwner: slackUser.is_owner || false,
            isAdmin: slackUser.is_admin || false
          },
          lastUpdated: new Date().toISOString()
        }
      });
      
      await say('✅ Your profile has been successfully refreshed!');
    } else {
      // Create new profile
      await profileEngramService.createProfile({
        businessId,
        userId,
        userType: 'internal',
        name: slackUser.real_name || slackUser.name || 'Unknown User',
        email: slackUser.profile?.email,
        source: 'slack',
        role: slackUser.profile?.title || 'Team Member',
        slackData: slackUser,
        consent: {
          given: true,
          method: 'explicit',
          timestamp: new Date().toISOString()
        }
      });
      
      await say('✅ Your profile has been created successfully!');
    }
    
    // Add enrichment about the refresh
    await profileEngramService.addEnrichment(businessId, userId, {
      title: 'Profile Manually Refreshed',
      content: 'User requested a manual profile refresh via /refresh-profile command',
      source: 'manual'
    });
    
  } catch (error) {
    console.error('Error refreshing profile:', error);
    await say('❌ An error occurred while refreshing your profile. Please try again later.');
  }
});

// Handle /calendar-status command
app.command('/calendar-status', async ({ command, ack, say }) => {
  await ack();
  
  const userId = command.user_id;
  const businessId = command.team_id;
  
  try {
    // Get user's timezone from their profile
    let userTimezone = 'America/New_York'; // Default fallback
    try {
      const userProfile = await profileEngramService.getProfile(businessId, userId);
      if (userProfile?.slackProfile?.timezone) {
        userTimezone = userProfile.slackProfile.timezone;
        console.log(`Using user's timezone: ${userTimezone} for user: ${userId}`);
      } else {
        console.log(`No timezone found for user ${userId}, using default: ${userTimezone}`);
      }
    } catch (error) {
      console.error('Error retrieving user profile for timezone:', error);
      // Continue with default timezone
    }
    
    // Check if user has calendar token
    const dynamoDBService = (await import('@symentic/core')).dynamoDBService;
    let token: CalendarToken | null = null;
    let hasToken = false;
    let hasRefreshToken = false;
    
    try {
      token = await dynamoDBService.getCalendarToken(userId);
      hasToken = true;
      hasRefreshToken = !!token?.refresh_token;
    } catch (error) {
      console.log('No calendar token found for user:', userId);
    }
    
    if (!hasToken) {
      await say({
        text: '📅 Calendar Status',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Calendar Status:* Not Connected ❌'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'To connect your Google Calendar, I\'ll need to send you an authorization link.'
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'Use the bug triage workflow to get a calendar connection link, or ask me to "connect my calendar".'
              }
            ]
          }
        ]
      });
      return;
    }
    
    // Check token status
    let isExpired = token?.expiry_date ? (token.expiry_date as number) < Date.now() : false;
    let expiryDate = token?.expiry_date ? new Date(token.expiry_date as number) : null;
    
    // Try to fetch calendar events
    let events: CalendarEvent[] = [];
    let busySlots: BusySlot[] = [];
    let calendarError = null;
    let tokenRefreshed = false;
    
    if (hasRefreshToken) {
      try {
        const calendar = await googleCalendarService.getCalendarClient(userId);
        
        // Re-check token status after potential refresh
        const updatedToken = await dynamoDBService.getCalendarToken(userId);
        if (updatedToken?.expiry_date && updatedToken.expiry_date !== token?.expiry_date) {
          tokenRefreshed = true;
          token = updatedToken;
          isExpired = (token.expiry_date as number) < Date.now();
          expiryDate = new Date(token.expiry_date as number);
        }
        
        // Get events for next 7 days
        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        
        // Fetch calendar events
        const eventsResponse = await calendar.events.list({
          calendarId: 'primary',
          timeMin: now.toISOString(),
          timeMax: nextWeek.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 5
        });
        
        events = eventsResponse.data.items?.map(event => ({
          summary: event.summary || 'No title',
          start: event.start?.dateTime || event.start?.date || 'Unknown',
          end: event.end?.dateTime || event.end?.date || 'Unknown'
        })) || [];
        
        // Get busy times
        const freeBusyResponse = await calendar.freebusy.query({
          requestBody: {
            timeMin: now.toISOString(),
            timeMax: nextWeek.toISOString(),
            items: [{ id: 'primary' }]
          }
        });
        
        busySlots = freeBusyResponse.data.calendars?.primary?.busy || [];
        
      } catch (error) {
        console.error('Error accessing calendar:', error);
        calendarError = error instanceof Error ? error.message : 'Unknown error';
      }
    }
    
    // Build status message
    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Calendar Status:* ${hasRefreshToken ? 'Connected ✅' : 'Partially Connected ⚠️'}`
        }
      }
    ];
    
    // Add token info
    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Has Token:* ${hasToken ? 'Yes' : 'No'}`
        },
        {
          type: 'mrkdwn',
          text: `*Has Refresh Token:* ${hasRefreshToken ? 'Yes' : 'No'}`
        },
        {
          type: 'mrkdwn',
          text: `*Token Status:* ${isExpired ? 'Expired ❌' : 'Valid ✅'}`
        },
        {
          type: 'mrkdwn',
          text: `*Expires:* ${expiryDate ? expiryDate.toLocaleString('en-US', {
            timeZone: userTimezone,
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short'
          }) : 'Unknown'}`
        }
      ]
    });
    
    if (!hasRefreshToken) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '⚠️ *Missing refresh token* - You need to reconnect your calendar to enable automatic token refresh.'
        }
      });
    }
    
    if (tokenRefreshed) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '🔄 *Token automatically refreshed* - Your calendar connection has been renewed.'
        }
      });
    }
    
    if (calendarError) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*API Error:* ${calendarError}`
        }
      });
    }
    
    // Add upcoming events if we got them
    if (events.length > 0) {
      blocks.push({
        type: 'divider'
      });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📅 Upcoming Events (Next 7 Days):*'
        }
      });
      
      events.forEach(event => {
        const startDate = new Date(event.start);
        const endDate = new Date(event.end);
        
        // Format times in user's timezone
        const formattedStart = startDate.toLocaleString('en-US', {
          timeZone: userTimezone,
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short'
        });
        
        const formattedEnd = endDate.toLocaleString('en-US', {
          timeZone: userTimezone,
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short'
        });
        
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `• *${event.summary}*\n  ${formattedStart} - ${formattedEnd}`
          }
        });
      });
    }
    
    // Add busy slots count
    if (busySlots.length > 0) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_Found ${busySlots.length} busy time slots in the next 7 days_`
          }
        ]
      });
    }
    
    await say({
      text: '📅 Calendar Status',
      blocks
    });
    
  } catch (error) {
    console.error('Error checking calendar status:', error);
    await say({
      text: '❌ An error occurred while checking your calendar status.',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        }
      ]
    });
  }
});

// Handle /sync-workspace command (admin only)
app.command('/sync-workspace', async ({ command, ack, say, client }) => {
  await ack();
  
  const userId = command.user_id;
  const businessId = command.team_id;
  
  try {
    // Check if user is admin
    const userInfo = await client.users.info({ user: userId });
    const isAdmin = (userInfo.user as SlackUserData)?.is_admin;
    
    if (!isAdmin) {
      await say({
        text: '❌ This command is only available to workspace administrators.',
        thread_ts: command.ts
      });
      return;
    }
    
    // Check rate limit for workspace sync (once per day)
    const rateLimitKey = `workspace_sync:${businessId}`;
    const lastSync = await redisService.getShortTermMemory(rateLimitKey);
    
    // Temporary bypass for testing - remove this after testing
    const bypassRateLimit = command.text && command.text.includes('--force');
    
    if (lastSync && !bypassRateLimit) {
      const lastSyncTime = parseInt(lastSync as string);
      const timeSinceSync = Date.now() - lastSyncTime;
      const hoursRemaining = Math.ceil((24 * 60 * 60 * 1000 - timeSinceSync) / (60 * 60 * 1000));
      
      await say({
        text: `⏳ Workspace was recently synced. Please wait ${hoursRemaining} hours before syncing again.`,
        thread_ts: command.ts
      });
      return;
    }
    
    // Set rate limit
    await redisService.setShortTermMemory(rateLimitKey, Date.now().toString(), 24 * 60 * 60);
    
    await say({
      text: '🔄 Starting workspace profile sync. This may take a few minutes for large workspaces...',
      thread_ts: command.ts
    });
    
    // Invoke the sync Lambda directly
    const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const invokeCommand = new InvokeCommand({
      FunctionName: `symentic-slack-bot-${process.env.STAGE}-profileSyncWorkspace`,
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify({
        businessId,
        triggerType: 'manual_sync'
      })
    });
    
    try {
      await lambdaClient.send(invokeCommand);
      console.log('Profile sync Lambda invoked for business:', businessId);
      
      // Check status after a delay
      setTimeout(async () => {
        await say({
          text: '✅ Workspace profile sync has been initiated. You will be notified when complete.',
          thread_ts: command.ts
        });
      }, 2000);
    } catch (invokeError) {
      console.error('Failed to invoke sync Lambda:', invokeError);
      await say({
        text: '❌ Failed to start workspace sync. Please try again later.',
        thread_ts: command.ts
      });
    }
    
  } catch (error) {
    console.error('Error syncing workspace:', error);
    await say('❌ An error occurred while syncing the workspace. Please try again later.');
  }
});

// Handle /link-bugs command
app.command('/link-bugs', async ({ command, ack, say }) => {
  await ack();
  
  try {
    const userId = command.user_id;
    const args = command.text.trim().split(/\s+/);
    
    if (args.length < 2) {
      await say({
        text: '❌ Please provide two bug numbers to link. Usage: `/link-bugs 123 456`'
      });
      return;
    }
    
    const bug1 = args[0];
    const bug2 = args[1];
    
    // Validate bug numbers
    if (!/^\d+$/.test(bug1) || !/^\d+$/.test(bug2)) {
      await say({
        text: '❌ Invalid bug numbers. Please use numeric bug IDs like: `/link-bugs 123 456`'
      });
      return;
    }
    
    // Import bugSimilarityService
    const { bugSimilarityService } = await import('@symentic/core');
    
    // Link the bugs
    await bugSimilarityService.linkBugs(`bug-${bug1}`, `bug-${bug2}`);
    
    await say({
      text: `✅ Successfully linked bug #${bug1} and bug #${bug2}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *Bugs Linked Successfully*\n\nBug #${bug1} and Bug #${bug2} are now marked as related.`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Linked by <@${userId}> • <!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} at {time}|${new Date().toISOString()}>`
            }
          ]
        }
      ]
    });
    
  } catch (error) {
    console.error('Error linking bugs:', error);
    await say({
      text: '❌ Failed to link bugs. Please make sure both bug numbers exist and try again.'
    });
  }
});

// Function to detect and create user ID mappings
async function detectAndCreateUserIdMapping(messageUserId: string, client: WebClient): Promise<void> {
  try {
    // Import dynamoDBService
    const { dynamoDBService } = await import('@symentic/core');
    
    // Check if we already have a mapping for this user
    const existingMapping = await dynamoDBService.getUserIdMapping(messageUserId);
    if (existingMapping) {
      return; // Mapping already exists
    }

    // Get user info to find their email
    const userInfo = await client.users.info({ user: messageUserId });
    const email = userInfo.user?.profile?.email;
    
    if (email) {
      // Check if any calendar tokens exist for users with this email
      // This is a heuristic - we're looking for calendar tokens that might belong to this user
      console.log(`Checking for calendar tokens that might belong to user ${messageUserId} with email ${email}`);
      
      // TODO: In the future, we could scan calendar tokens table for matching emails
      // For now, we'll just log this for manual mapping creation
      console.log(`User ID mapping candidate: messageUserId=${messageUserId}, email=${email}`);
    }
  } catch (error) {
    console.error('Error detecting user ID mapping:', error);
  }
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
  
  // Pre-filter disabled for demo - processing all messages through ChatGPT
  // if (!shouldProcessMessage(msg)) {
  //   console.log('Message filtered out:', msg.text?.substring(0, 50));
  //   return;
  // }
  
  try {
    // Classify intent
    const intent = await intentClassifier.classifyIntent({
      message: msg.text || '',
      userId: msg.user || '',
      channelId: msg.channel || '',
      recentContext: []
    });
    
    console.log(`Intent classified: ${intent.intent} (${intent.confidence})`);
    
    // Capture interaction for profile engram (non-blocking)
    const businessId = msg.team || '';
    if (businessId) {
      captureInteractionForEngram(msg, intent, businessId).catch(err => 
        console.error('Profile engram capture error:', err)
      );
    }
    
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
        text: '🐛 Thanks for reporting this! Let me check my memory for relevant context...',
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
    } else if (intent.intent.startsWith('task.') || intent.intent.startsWith('reminder.')) {
      // Task and reminder intents
      await say({
        text: 'I can help with task management! This feature is being developed. For now, I can help you report bugs or schedule meetings.',
        thread_ts: msg.thread_ts || msg.ts
      });
    } else if (intent.intent === 'query.search' || intent.intent === 'query.ask') {
      // Search/query intents
      await say({
        text: 'I can help you find information! This feature is being developed. For now, try reporting a bug or scheduling a meeting.',
        thread_ts: msg.thread_ts || msg.ts
      });
    } else {
      // No clear intent or low confidence - don't respond
      console.log(`Not responding - Intent: ${intent.intent}, Confidence: ${intent.confidence}`);
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
  client: WebClient // WebClient from @slack/bolt
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
    
    // Detect and create user ID mapping if needed
    await detectAndCreateUserIdMapping(message.user!, client);
    
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
          severity: undefined // Let analyze lambda determine severity
        },
        context: {
          userId: message.user,
          channelId: message.channel,
          teamId: message.team,
          slackClient: client.token
        },
        threadTs,
        attemptCount: 0,
        conversationHistory: [],
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
      result.executionArn!
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

// Handle interactive button clicks for meeting confirmation
app.action('meeting_time_selection', async ({ ack }) => {
  await ack();
  // Radio button selection is stored, no immediate action needed
});

app.action('confirm_meeting', async ({ body, ack, client }) => {
  await ack();
  
  try {
    const payload = body as any;
    const buttonValue = JSON.parse(payload.actions[0].value);
    const selectedTimeValue = payload.state?.values?.[Object.keys(payload.state.values)[0]]?.meeting_time_selection?.selected_option?.value;
    
    if (!selectedTimeValue) {
      await client.chat.postEphemeral({
        channel: payload.channel.id,
        user: payload.user.id,
        text: '⚠️ Please select a time slot before confirming the meeting.'
      });
      return;
    }
    
    const selectedTime = JSON.parse(selectedTimeValue);
    const meetingStart = new Date(selectedTime.start);
    
    // Get user's timezone from their profile
    let userTimezone = 'America/New_York'; // Default fallback
    try {
      const businessId = payload?.team?.id;
      if (businessId) {
        const userProfile = await profileEngramService.getProfile(businessId, payload.user.id);
        if (userProfile?.slackProfile?.timezone) {
          userTimezone = userProfile.slackProfile.timezone;
        }
      }
    } catch (error) {
      console.error('Error retrieving user profile for timezone in meeting confirmation:', error);
      // Continue with default timezone
    }
    
    // Create the actual calendar event
    try {
      const { googleCalendarService } = await import('@symentic/core');
      
      // Create meeting for the user who clicked confirm
      const { getUserEmail } = await import('@symentic/core');
      const attendeeEmails = buttonValue.engineers.map((userId: string) => getUserEmail(userId));
      const calendarEvent = await googleCalendarService.createMeeting(
        payload.user.id,
        attendeeEmails,
        `Bug Triage: ${selectedTime.bugId}`,
        `Bug triage meeting for ${selectedTime.bugId}`,
        meetingStart,
        new Date(selectedTime.end)
      );
      
      // Update the message to show confirmation
      await client.chat.update({
        channel: payload.channel.id,
        ts: payload.message.ts,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '✅ Meeting Scheduled!'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Time:* ${meetingStart.toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: userTimezone,
                timeZoneName: 'short'
              })}\n*Duration:* 30 minutes\n*Meeting Link:* ${calendarEvent.eventLink || 'Check your calendar'}`
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Scheduled by <@${payload.user.id}> • Calendar invites sent to all attendees`
              }
            ]
          }
        ],
        text: 'Meeting scheduled successfully!'
      });
    } catch (calendarError) {
      console.error('Failed to create calendar event:', calendarError);
      
      // Fallback - just show the scheduled time without calendar integration
      await client.chat.update({
        channel: payload.channel.id,
        ts: payload.message.ts,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '📅 Meeting Time Selected'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Time:* ${meetingStart.toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: userTimezone,
                timeZoneName: 'short'
              })}\n*Duration:* 30 minutes\n\n_Please add this to your calendar manually._`
            }
          }
        ],
        text: 'Meeting time selected'
      });
    }
  } catch (error) {
    console.error('Error confirming meeting:', error);
    await client.chat.postEphemeral({
      channel: (body as any).channel.id,
      user: (body as any).user.id,
      text: '❌ Sorry, there was an error scheduling the meeting. Please try again.'
    });
  }
});

app.action('skip_meeting', async ({ body, ack, client }) => {
  await ack();
  
  const payload = body as any;
  
  // Update the message to show meeting was skipped
  await client.chat.update({
    channel: payload.channel.id,
    ts: payload.message.ts,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '⏭️ Meeting scheduling skipped. The bug triage will continue asynchronously in this channel.'
        }
      }
    ],
    text: 'Meeting skipped'
  });
});

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
  
  // Handle OAuth callback
  if (event.path === '/auth/google/callback' && event.httpMethod === 'GET') {
    console.log('OAuth callback received');
    const code = event.queryStringParameters?.code;
    const state = event.queryStringParameters?.state;
    
    if (!code || !state) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/html' },
        body: '<html><body><h1>Error</h1><p>Missing authorization code or state.</p></body></html>'
      };
    }
    
    try {
      // The state parameter contains the user ID from the command
      const commandUserId = state;
      await googleCalendarService.handleAuthCallback(code, commandUserId);
      
      // Import dynamoDBService
      const { dynamoDBService } = await import('@symentic/core');
      
      // Check if we have a user ID mapping for this user
      const mapping = await dynamoDBService.getUserIdMapping(commandUserId);
      if (mapping && mapping.alternateUserId && mapping.alternateUserId !== commandUserId) {
        console.log(`Also storing calendar token for alternate user ID: ${mapping.alternateUserId}`);
        // Get the tokens we just saved
        const tokens = await dynamoDBService.getCalendarToken(commandUserId);
        if (tokens) {
          // Save the same tokens under the alternate ID
          await dynamoDBService.saveCalendarToken(mapping.alternateUserId, tokens);
        }
      }
      
      // Send success message to Slack
      const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
      await slack.chat.postMessage({
        channel: commandUserId,
        text: '✅ Your Google Calendar has been successfully connected!'
      });
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `<html><body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>✅ Success!</h1>
          <p>Your Google Calendar has been connected.</p>
          <p>You can close this window and return to Slack.</p>
        </body></html>`
      };
    } catch (error) {
      console.error('OAuth callback error:', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'text/html' },
        body: `<html><body><h1>Error</h1><p>${error}</p></body></html>`
      };
    }
  }
  
  // Handle URL verification (only try JSON parse for actual JSON content)
  if (event.body && event.headers['Content-Type']?.includes('application/json')) {
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