import { Handler } from 'aws-lambda';
import { googleCalendarService } from '@symentic/core';
import { dynamoDBService } from '@symentic/core';

interface CalendarQueryEvent {
  action: string;
  userId: string;
  query: string;
  entities?: any;
  userTimezone?: string; // User's timezone from Slack
}

interface CalendarQueryResponse {
  message: string;
  blocks?: any[];
  error?: string;
  requiresAuth?: boolean;
  authUrl?: string;
}

export const handler: Handler<CalendarQueryEvent, CalendarQueryResponse> = async (event) => {
  console.log('Calendar query Lambda invoked:', JSON.stringify(event, null, 2));
  
  const { userId, query, entities, userTimezone } = event;
  
  try {
    // Check if user has calendar tokens
    console.log('Checking for calendar tokens for user:', userId);
    const hasTokens = await dynamoDBService.getCalendarToken(userId);
    console.log('Has tokens:', !!hasTokens);
    
    if (!hasTokens) {
      // User needs to authenticate first
      const authUrl = await googleCalendarService.getAuthUrl(userId);
      
      return {
        message: 'I need access to your Google Calendar to show your schedule.',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🔐 *Calendar Authorization Required*\n\nTo view your calendar, I need you to authorize access to your Google Calendar.'
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Connect Google Calendar'
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
                text: '_You\'ll be redirected to Google to grant permission. This is a one-time setup._'
              }
            ]
          }
        ],
        requiresAuth: true,
        authUrl
      };
    }
    
    // User has tokens, fetch real calendar data
    try {
      console.log('Fetching calendar events for today with timezone:', userTimezone);
      // Use the Slack userId to get calendar client
      // The googleCalendarService.getCalendarClient uses userId to retrieve tokens
      const events = await googleCalendarService.getEvents(userId, 'today', userTimezone);
      console.log('Events returned:', JSON.stringify(events, null, 2));
      
      // Build response blocks for nice formatting
      const todayDate = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: userTimezone
      });
      
      const blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Your Schedule for Today* 📅\n${todayDate}`
          }
        },
        {
          type: 'divider'
        }
      ];
      
      if (events.length === 0) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '_No events scheduled for today! Your calendar is clear._ ✨'
          }
        });
      } else {
        // Add each event as a block
        events.forEach(event => {
          const eventText = event.attendees 
            ? `*${event.time}*\n${event.title}\n_With: ${event.attendees}_`
            : `*${event.time}*\n${event.title}`;
            
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: eventText
            }
          });
        });
      }
      
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '💡 _Tip: Say "schedule a meeting with John at 2pm" to add events_'
          }
        ]
      } as any);
      
      return {
        message: 'Here\'s your schedule:',
        blocks
      };
      
    } catch (calendarError) {
      console.error('Error fetching calendar:', calendarError);
      
      // Check if it's a token/authorization issue
      if (calendarError instanceof Error && 
          (calendarError.message.includes('token') || 
           calendarError.message.includes('authorization') ||
           calendarError.message.includes('expired'))) {
        // Tokens might be expired or invalid
        const authUrl = await googleCalendarService.getAuthUrl(userId);
        
        return {
          message: 'Your calendar authorization needs to be refreshed.',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '🔄 *Re-authorization Required*\n\nYour Google Calendar connection needs to be refreshed. This can happen when:\n• Your authorization has expired\n• The app needs additional permissions\n• Your previous authorization was incomplete'
              }
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: 'Re-connect Google Calendar'
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
                  text: '_You\'ll be asked to grant permissions again to ensure proper access._'
                }
              ]
            }
          ],
          requiresAuth: true,
          authUrl
        };
      }
      
      throw calendarError;
    }
    
  } catch (error) {
    console.error('Error in calendar query:', error);
    return {
      error: 'Failed to retrieve calendar information',
      message: '❌ Sorry, I couldn\'t fetch your calendar. Please try again.'
    };
  }
};