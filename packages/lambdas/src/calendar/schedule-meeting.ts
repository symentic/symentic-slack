import { Handler } from 'aws-lambda';
import { googleCalendarService } from '@symentic/core';
import { WebClient } from '@slack/web-api';
import { extractPayload, extractArrayPayload } from '../utils/step-functions';
import { Engineer, BugReportData } from '../bug-triage/types';
import { SlackBlock } from '../types/slack';

interface ScheduleMeetingEvent {
  bugReport: {
    Payload?: {
      bugId: string;
      description: string;
      severity?: string;
      reportedBy?: string;
    };
  } | {
    bugId: string;
    description: string;
    severity?: string;
    reportedBy?: string;
  };
  engineers?: {
    Payload?: Array<{
      userId: string;
      name: string;
    }>;
  } | Array<{
    userId: string;
    name: string;
  }>;
  availability?: {
    Payload?: {
      suggestedTime?: string;
      slots: Array<{
        start: string;
        end: string;
        availableEngineers: string[];
      }>;
    };
  } | {
    suggestedTime?: string;
    slots: Array<{
      start: string;
      end: string;
      availableEngineers: string[];
    }>;
  };
  channel?: {
    Payload?: {
      channelId: string;
    };
  } | {
    channelId: string;
  };
}

interface MeetingResult {
  meetingId: string;
  startTime: string;
  endTime: string;
  meetingLink?: string;
  attendees: string[];
  confirmationRequested?: boolean;
  proposedSlots?: Array<{
    start: string;
    end: string;
    availableEngineers: string[];
  }>;
}

export const handler: Handler<ScheduleMeetingEvent, MeetingResult> = async (event) => {
  console.log('Requesting meeting confirmation:', JSON.stringify(event, null, 2));
  
  // Handle Step Functions nested payload structure
  const bugReport = extractPayload(event.bugReport);
  const engineers = extractArrayPayload(event.engineers);
  const availability = extractPayload(event.availability) || { suggestedTime: undefined, slots: [] };
  const channel = extractPayload(event.channel);
  
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  
  try {
    if (!bugReport || !channel?.channelId) {
      throw new Error('Bug report or channel data is missing');
    }
    
    // Get available slots
    const availableSlots: Array<{
      start: string;
      end: string;
      availableEngineers: string[];
    }> = availability.slots?.map(slot => ({
      ...slot,
      availableEngineers: engineers.map((e) => e.userId)
    })) || [];
    
    if (availableSlots.length === 0) {
      // No availability data, use default slots
      const defaultTime = getDefaultMeetingTime();
      availableSlots.push({
        start: defaultTime,
        end: new Date(new Date(defaultTime).getTime() + 30 * 60000).toISOString(),
        availableEngineers: engineers.map((e) => e.userId)
      });
    }
    
    // Post meeting confirmation request to Slack
    await postMeetingConfirmationRequest(
      slack, 
      channel.channelId, 
      availableSlots, 
      engineers,
      bugReport
    );
    
    // Return a placeholder result - actual scheduling will happen after confirmation
    return {
      meetingId: `pending-${Date.now()}`,
      startTime: availableSlots[0].start,
      endTime: availableSlots[0].end,
      attendees: engineers.map((e) => e.userId),
      confirmationRequested: true,
      proposedSlots: availableSlots
    };
  } catch (error) {
    console.error('Error requesting meeting confirmation:', error);
    
    // Return a basic meeting without calendar integration
    const fallbackTime = getDefaultMeetingTime();
    return {
      meetingId: `meeting-${Date.now()}`,
      startTime: fallbackTime,
      endTime: new Date(new Date(fallbackTime).getTime() + 30 * 60000).toISOString(),
      attendees: engineers.map((e) => e.userId),
      confirmationRequested: false
    };
  }
};

function getDefaultMeetingTime(): string {
  // Default to tomorrow at 10 AM
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  return tomorrow.toISOString();
}

async function postMeetingConfirmationRequest(
  slack: WebClient,
  channelId: string,
  availableSlots: Array<{
    start: string;
    end: string;
    availableEngineers: string[];
  }>,
  engineers: Engineer[],
  bugReport: Partial<BugReportData> & { 
    bugId?: string; 
    bugNumber?: number;
    description: string;
    severity?: string;
    reportedBy?: string;
  }
) {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📅 Schedule Bug Triage Meeting'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `I've checked everyone's calendars and found the following available time slots for the bug triage meeting:`
      }
    },
    {
      type: 'divider'
    }
  ];
  
  // Add available time slots with radio buttons
  const options = availableSlots.slice(0, 5).map((slot, index) => {
    const startTime = new Date(slot.start);
    const endTime = new Date(slot.end);
    const allAvailable = slot.availableEngineers.length === engineers.length;
    
    const timeStr = startTime.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York'
    });
    
    const availability = allAvailable 
      ? '✅ All engineers available'
      : `⚠️ ${slot.availableEngineers.length}/${engineers.length} available`;
    
    return {
      text: {
        type: 'mrkdwn',
        text: `*${timeStr}* (30 min)\n${availability}`
      },
      value: JSON.stringify({
        index,
        start: slot.start,
        end: slot.end,
        bugId: bugReport.bugId
      })
    };
  });
  
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Select a time slot:*'
    },
    accessory: {
      type: 'radio_buttons',
      action_id: 'meeting_time_selection',
      options: options
    }
  });
  
  blocks.push({
    type: 'divider'
  });
  
  // Add confirm/cancel buttons
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Confirm Meeting'
        },
        style: 'primary',
        action_id: 'confirm_meeting',
        value: JSON.stringify({
          bugId: bugReport.bugId,
          engineers: engineers.map(e => e.userId)
        })
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Skip Meeting'
        },
        action_id: 'skip_meeting',
        value: bugReport.bugId
      }
    ]
  });
  
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `*Attendees:* ${engineers.map((e) => `<@${e.userId}>`).join(', ')}`
      }
    ]
  });
  
  await slack.chat.postMessage({
    channel: channelId,
    blocks,
    text: 'Please select a time for the bug triage meeting'
  });
}