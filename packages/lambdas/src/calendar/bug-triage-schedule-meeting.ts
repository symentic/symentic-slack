import { Handler } from 'aws-lambda';
import { WebClient } from '@slack/web-api';
import { extractPayload, extractArrayPayload } from '../utils/step-functions';

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
      engineersWithoutCalendar?: string[];
      calendarAuthUrl?: string;
      calendarDataWarning?: string;
    };
  } | {
    suggestedTime?: string;
    slots: Array<{
      start: string;
      end: string;
      availableEngineers: string[];
    }>;
    engineersWithoutCalendar?: string[];
    calendarAuthUrl?: string;
    calendarDataWarning?: string;
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
    
    // Get available slots - use the actual availability data, don't override
    const availableSlots: Array<{
      start: string;
      end: string;
      availableEngineers: string[];
    }> = availability.slots || [];
    
    if (availableSlots.length === 0) {
      // No availability data, use default slots
      const defaultTime = getDefaultMeetingTime();
      availableSlots.push({
        start: defaultTime,
        end: new Date(new Date(defaultTime).getTime() + 30 * 60000).toISOString(),
        availableEngineers: engineers.map(e => e.userId)
      });
    }
    
    // Post meeting confirmation request to Slack
    await postMeetingConfirmationRequest(
      slack, 
      channel.channelId, 
      availableSlots, 
      engineers,
      bugReport,
      availability.engineersWithoutCalendar,
      availability.calendarAuthUrl,
      availability.calendarDataWarning
    );
    
    // Return a placeholder result - actual scheduling will happen after confirmation
    return {
      meetingId: `pending-${Date.now()}`,
      startTime: availableSlots[0].start,
      endTime: availableSlots[0].end,
      attendees: engineers.map(e => e.userId),
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
      attendees: engineers.map(e => e.userId),
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
  engineers: Array<{ userId: string; name: string }>,
  bugReport: { bugId: string; description: string; severity?: string; reportedBy?: string },
  engineersWithoutCalendar?: string[],
  calendarAuthUrl?: string,
  calendarDataWarning?: string
) {
  const blocks: Array<{ type: string; text?: { type: string; text: string }; accessory?: unknown; elements?: unknown[] }> = [
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
  
  // Add calendar connection notice if some engineers don't have calendar connected
  if (engineersWithoutCalendar && engineersWithoutCalendar.length > 0) {
    const engineerMentions = engineersWithoutCalendar.map(userId => `<@${userId}>`).join(', ');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ **Calendar Not Connected**: ${engineerMentions}\n\nTo enable automatic availability checking, please connect your Google Calendar.`
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Connect Calendar'
        },
        url: calendarAuthUrl || 'https://x9tw492kl2.execute-api.us-east-1.amazonaws.com/prod/auth/google',
        action_id: 'connect_calendar'
      }
    });
    
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '_Without calendar access, we assume you\'re available during business hours. Connect your calendar for accurate scheduling._'
        }
      ]
    });
    
    blocks.push({
      type: 'divider'
    });
  }
  
  // Include reporter in total attendees count
  const totalAttendees = [...engineers.map(e => e.userId)];
  if (bugReport.reportedBy && !totalAttendees.includes(bugReport.reportedBy)) {
    totalAttendees.push(bugReport.reportedBy);
  }
  const totalAttendeeCount = totalAttendees.length;
  
  // Filter slots to only show ones where everyone is available
  const fullyAvailableSlots = availableSlots.filter(slot => 
    slot.availableEngineers.length === totalAttendeeCount
  );
  
  // If no slots where everyone is available, show the best partial availability
  const slotsToShow = fullyAvailableSlots.length > 0 
    ? fullyAvailableSlots 
    : availableSlots.sort((a, b) => b.availableEngineers.length - a.availableEngineers.length);
  
  // Check if we have a calendar data warning
  const hasCalendarWarning = calendarDataWarning;
  
  // Add available time slots with radio buttons
  const options = slotsToShow.slice(0, 5).map((slot, index) => {
    const startTime = new Date(slot.start);
    const allAvailable = slot.availableEngineers.length === totalAttendeeCount;
    
    const timeStr = startTime.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
      timeZoneName: 'short'
    });
    
    let availability = allAvailable 
      ? '✅ All attendees available'
      : `⚠️ ${slot.availableEngineers.length}/${totalAttendeeCount} available`;
    
    // Add warning if calendar data might be incomplete
    if (hasCalendarWarning) {
      availability = '❓ _Suggested time - please verify availability_';
    }
    
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
  
  // Add warning if calendar data might be incomplete
  if (hasCalendarWarning) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '⚠️ *Limited Availability*: Could not find mutually available time slots in your calendars. The times below are standard business hours that may conflict with your existing meetings. Please verify availability before confirming.'
      }
    });
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '_To fix this, try reconnecting your Google Calendar or check calendar permissions._'
        }
      ]
    });
  }
  
  // Add message if no slots have full availability
  if (fullyAvailableSlots.length === 0 && slotsToShow.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '⚠️ *No time slots found where all attendees are available.* Showing slots with the best availability:'
      }
    });
  }
  
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
  
  // Include reporter in attendees list
  const allAttendees = [...engineers.map(e => e.userId)];
  if (bugReport.reportedBy && !allAttendees.includes(bugReport.reportedBy)) {
    allAttendees.push(bugReport.reportedBy);
  }
  
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `*Attendees:* ${allAttendees.map(userId => `<@${userId}>`).join(', ')}`
      }
    ]
  });
  
  await slack.chat.postMessage({
    channel: channelId,
    blocks,
    text: 'Please select a time for the bug triage meeting'
  });
}