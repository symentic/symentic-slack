import { Handler } from 'aws-lambda';
import { WebClient } from '@slack/web-api';
import { SlackBlock } from '../types/slack';

interface NotifyEvent {
  intentType: string;
  channelId: string;
  threadTs?: string;
  userId: string;
  confirmed?: boolean;
  eventDetails?: {
    eventId: string;
    eventLink: string;
    startTime: string;
    endTime: string;
    attendees: string[];
  };
  oooDetails?: {
    eventId: string;
    startDate: string;
    endDate: string;
    daysOff: number;
  };
  error?: string;
}

interface NotifyResult {
  notified: boolean;
  messageTs?: string;
}

export const handler: Handler<NotifyEvent, NotifyResult> = async (event) => {
  console.log('Calendar notify event:', JSON.stringify(event, null, 2));
  
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  const { intentType, channelId, threadTs, userId, confirmed, eventDetails, oooDetails, error } = event;
  
  try {
    let blocks: SlackBlock[] = [];
    let text = '';
    
    if (error) {
      // Error notification
      blocks = [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `❌ Sorry, I encountered an error: ${error}`
        }
      }];
      text = 'Calendar action failed';
    } else if (!confirmed) {
      // Cancelled notification
      blocks = [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '🚫 Calendar action cancelled.'
        }
      }];
      text = 'Calendar action cancelled';
    } else if (intentType === 'schedule' && eventDetails) {
      // Meeting scheduled notification
      const meetingTime = new Date(eventDetails.startTime).toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York'
      });
      
      const attendeesList = eventDetails.attendees.map(id => `<@${id}>`).join(', ');
      
      blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '✅ Meeting Scheduled'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Your meeting has been scheduled for *${meetingTime}*`
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Attendees:*\n${attendeesList}`
            }
          ]
        }
      ];
      
      if (eventDetails.eventLink) {
        blocks.push({
          type: 'actions',
          elements: [{
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View in Calendar'
            },
            url: eventDetails.eventLink,
            action_id: 'view_calendar'
          }]
        });
      }
      
      text = `Meeting scheduled for ${meetingTime}`;
    } else if (intentType === 'ooo' && oooDetails) {
      // OOO marked notification
      const startDate = new Date(oooDetails.startDate).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'long',
        day: 'numeric'
      });
      const endDate = new Date(oooDetails.endDate).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'long',
        day: 'numeric'
      });
      
      blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🏖️ Out of Office Set'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `You've been marked as out of office from *${startDate}* to *${endDate}* (${oooDetails.daysOff} business days).`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '_Your calendar has been updated and your team has been notified._'
          }
        }
      ];
      
      text = `OOO set from ${startDate} to ${endDate}`;
    } else if (intentType === 'check') {
      // Availability check results would go here
      blocks = [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Calendar check completed.'
        }
      }];
      text = 'Calendar check completed';
    }
    
    // Send notification
    const response = await slack.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks,
      text
    });
    
    return {
      notified: true,
      messageTs: response.ts
    };
  } catch (error) {
    console.error('Failed to send notification:', error);
    
    return {
      notified: false
    };
  }
};