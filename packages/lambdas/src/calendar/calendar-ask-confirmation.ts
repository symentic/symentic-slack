import { Handler } from 'aws-lambda';
import { WebClient } from '@slack/web-api';
import { v4 as uuidv4 } from 'uuid';
import { dynamoDBService } from '@symentic/core';
import { SlackBlock } from '../types/slack';

interface AskConfirmationEvent {
  intentType: string;
  participants?: Array<{
    userId: string;
    name: string;
    email?: string;
  }>;
  suggestedSlots?: Array<{
    start: string;
    end: string;
    available: boolean;
    availableParticipants: string[];
  }>;
  dateTime?: string;
  duration?: number;
  meetingType?: string;
  reason?: string;
  timeRange?: {
    start: string;
    end: string;
  };
  userId: string;
  channelId: string;
  threadTs?: string;
  workspaceId: string;
  taskToken?: string;
}

interface AskConfirmationResult {
  confirmationId: string;
  messageTs: string;
  waitingForResponse: boolean;
}

export const handler: Handler<AskConfirmationEvent, AskConfirmationResult> = async (event) => {
  console.log('Ask confirmation event:', JSON.stringify(event, null, 2));
  
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  const confirmationId = uuidv4();
  
  try {
    let blocks: SlackBlock[] = [];
    let text = '';
    
    if (event.intentType === 'schedule' && event.suggestedSlots) {
      // Meeting scheduling confirmation
      blocks = buildMeetingConfirmationBlocks(event, confirmationId);
      text = 'Please confirm your meeting details';
    } else if (event.intentType === 'ooo') {
      // OOO confirmation
      blocks = buildOOOConfirmationBlocks(event, confirmationId);
      text = 'Please confirm your out of office status';
    } else {
      // Generic confirmation
      blocks = [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Please confirm this action'
        }
      }];
      text = 'Please confirm';
    }
    
    // Store workflow reference for response handling
    // TODO: Implement proper task token storage for Step Function callback
    // The task token should be passed to the button actions for proper callback
    
    // Send confirmation message
    const response = await slack.chat.postMessage({
      channel: event.channelId,
      thread_ts: event.threadTs,
      blocks,
      text
    });
    
    return {
      confirmationId,
      messageTs: response.ts!,
      waitingForResponse: true
    };
  } catch (error) {
    console.error('Failed to ask confirmation:', error);
    throw error;
  }
};

function buildMeetingConfirmationBlocks(event: AskConfirmationEvent, confirmationId: string): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📅 Confirm Meeting Details'
      }
    }
  ];
  
  // Add participants
  if (event.participants && event.participants.length > 0) {
    const participantNames = event.participants.map(p => `<@${p.userId}>`).join(', ');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Participants:* ${participantNames}`
      }
    });
  }
  
  // Add meeting type
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Meeting Type:* ${event.meetingType || 'General Meeting'}`
    }
  });
  
  blocks.push({
    type: 'divider'
  });
  
  // Add time slots
  if (event.suggestedSlots && event.suggestedSlots.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Available time slots:*'
      }
    });
    
    const options = event.suggestedSlots.slice(0, 5).map((slot, index) => {
      const startTime = new Date(slot.start);
      const timeStr = startTime.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York'
      });
      
      const availability = slot.available
        ? '✅ All available'
        : `⚠️ ${slot.availableParticipants.length}/${event.participants?.length || 0} available`;
      
      return {
        text: {
          type: 'mrkdwn' as const,
          text: `*${timeStr}*\n${availability}`
        },
        value: JSON.stringify({
          index,
          start: slot.start,
          end: slot.end
        })
      };
    });
    
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Select a time:'
      },
      accessory: {
        type: 'radio_buttons',
        action_id: 'calendar_time_selection',
        options
      }
    });
  }
  
  // Add action buttons
  blocks.push({
    type: 'divider'
  });
  
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Confirm'
        },
        style: 'primary',
        action_id: 'calendar_confirm',
        value: confirmationId
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Cancel'
        },
        action_id: 'calendar_cancel',
        value: confirmationId
      }
    ]
  });
  
  return blocks;
}

function buildOOOConfirmationBlocks(event: AskConfirmationEvent, confirmationId: string): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🏖️ Confirm Out of Office'
      }
    }
  ];
  
  // Add time range
  if (event.timeRange) {
    const startDate = new Date(event.timeRange.start).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    const endDate = new Date(event.timeRange.end).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Period:* ${startDate} - ${endDate}`
      }
    });
  }
  
  // Add reason if provided
  if (event.reason) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reason:* ${event.reason}`
      }
    });
  }
  
  blocks.push({
    type: 'divider'
  });
  
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '_This will update your calendar and notify your team._'
    }
  });
  
  // Add action buttons
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Confirm OOO'
        },
        style: 'primary',
        action_id: 'ooo_confirm',
        value: confirmationId
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Cancel'
        },
        action_id: 'ooo_cancel',
        value: confirmationId
      }
    ]
  });
  
  return blocks;
}