import { Handler } from 'aws-lambda';
import { googleCalendarService } from '@symentic/core';
import { WebClient } from '@slack/web-api';

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
      }>;
    };
  } | {
    suggestedTime?: string;
    slots: Array<{
      start: string;
      end: string;
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
}

export const handler: Handler<ScheduleMeetingEvent, MeetingResult> = async (event) => {
  console.log('Scheduling meeting:', JSON.stringify(event, null, 2));
  
  // Handle Step Functions nested payload structure
  const bugReport = 'Payload' in event.bugReport ? event.bugReport.Payload : event.bugReport;
  const engineers = (event.engineers && 'Payload' in event.engineers ? event.engineers.Payload : event.engineers) || [];
  const availability = (event.availability && 'Payload' in event.availability ? event.availability.Payload : event.availability) || {};
  const channel = event.channel && 'Payload' in event.channel ? event.channel.Payload : event.channel;
  
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  
  try {
    // Use suggested time or first available slot
    const meetingTime = availability.suggestedTime || 
                       availability.slots?.[0]?.start ||
                       getDefaultMeetingTime();
    
    const startTime = new Date(meetingTime);
    const endTime = new Date(startTime.getTime() + 30 * 60000); // 30 minutes
    
    // Create meeting details
    const meetingDetails = {
      summary: `Bug Triage: ${bugReport.bugId}`,
      description: `Bug Triage Meeting\n\nBug ID: ${bugReport.bugId}\nSeverity: ${bugReport.severity || 'Medium'}\n\nDescription:\n${bugReport.description}`,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      attendees: engineers.map((e) => e.userId)
    };
    
    // Try to create calendar event for the bug reporter (meeting organizer)
    let calendarEvent;
    try {
      if (bugReport.reportedBy) {
        try {
          const attendeeEmails = meetingDetails.attendees.map((userId: string) => `${userId}@company.com`);
          calendarEvent = await googleCalendarService.createMeeting(
            bugReport.reportedBy,
            attendeeEmails,
            meetingDetails.summary,
            meetingDetails.description,
            new Date(meetingDetails.startTime),
            new Date(meetingDetails.endTime)
          );
        } catch (err) {
          console.log('Calendar event creation failed, continuing without calendar integration');
        }
      }
    } catch (error) {
      console.error('Error creating calendar event:', error);
    }
    
    // Generate meeting result
    const meetingResult: MeetingResult = {
      meetingId: calendarEvent?.eventId || `meeting-${Date.now()}`,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      meetingLink: calendarEvent?.eventLink,
      attendees: engineers.map((e) => e.userId)
    };
    
    // Post meeting details to Slack channel
    if (channel?.channelId) {
      await postMeetingToSlack(slack, channel.channelId, meetingResult, bugReport);
    }
    
    return meetingResult;
  } catch (error) {
    console.error('Error scheduling meeting:', error);
    
    // Return a basic meeting without calendar integration
    const fallbackTime = getDefaultMeetingTime();
    return {
      meetingId: `meeting-${Date.now()}`,
      startTime: fallbackTime,
      endTime: new Date(new Date(fallbackTime).getTime() + 30 * 60000).toISOString(),
      attendees: engineers.map((e) => e.userId)
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

async function postMeetingToSlack(
  slack: WebClient,
  channelId: string,
  meeting: MeetingResult,
  _bugReport: unknown
) {
  const meetingTime = new Date(meeting.startTime);
  
  const blocks = [
    {
      type: 'header' as const,
      text: {
        type: 'plain_text' as const,
        text: '📅 Triage Meeting Scheduled'
      }
    },
    {
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text: `*Time:* ${meetingTime.toLocaleString()}\n*Duration:* 30 minutes\n*Attendees:* ${meeting.attendees.map(id => `<@${id}>`).join(', ')}`
      }
    }
  ];
  
  if (meeting.meetingLink) {
    blocks.push({
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text: `*Meeting Link:* ${meeting.meetingLink}`
      }
    });
  }
  
  blocks.push({
    type: 'section' as const,
    text: {
      type: 'mrkdwn' as const,
      text: '_Please review the bug details above before the meeting._'
    }
  });
  
  await slack.chat.postMessage({
    channel: channelId,
    blocks
  });
}