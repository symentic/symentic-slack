import { Handler } from 'aws-lambda';
import { googleCalendarService } from '@symentic/core';
import { WebClient } from '@slack/web-api';

interface ScheduleMeetingEvent {
  bugReport: {
    bugId: string;
    description: string;
    severity?: string;
    reportedBy?: string;
  };
  engineers: Array<{
    userId: string;
    name: string;
  }>;
  availability: {
    suggestedTime?: string;
    slots: Array<{
      start: string;
      end: string;
    }>;
  };
  channel?: {
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
  
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  
  try {
    // Use suggested time or first available slot
    const meetingTime = event.availability.suggestedTime || 
                       event.availability.slots[0]?.start ||
                       getDefaultMeetingTime();
    
    const startTime = new Date(meetingTime);
    const endTime = new Date(startTime.getTime() + 30 * 60000); // 30 minutes
    
    // Create meeting details
    const meetingDetails = {
      summary: `Bug Triage: ${event.bugReport.bugId}`,
      description: `Bug Triage Meeting\n\nBug ID: ${event.bugReport.bugId}\nSeverity: ${event.bugReport.severity || 'Medium'}\n\nDescription:\n${event.bugReport.description}`,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      attendees: event.engineers.map(e => e.userId)
    };
    
    // Try to create calendar event for the bug reporter (meeting organizer)
    let calendarEvent;
    try {
      if (event.bugReport.reportedBy) {
        try {
          const attendeeEmails = meetingDetails.attendees.map((userId: string) => `${userId}@company.com`);
          calendarEvent = await googleCalendarService.createMeeting(
            event.bugReport.reportedBy,
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
      attendees: event.engineers.map(e => e.userId)
    };
    
    // Post meeting details to Slack channel
    if (event.channel?.channelId) {
      await postMeetingToSlack(slack, event.channel.channelId, meetingResult, event.bugReport);
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
      attendees: event.engineers.map(e => e.userId)
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