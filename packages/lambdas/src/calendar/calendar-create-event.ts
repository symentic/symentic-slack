import { Handler } from 'aws-lambda';
import { googleCalendarService } from '@symentic/core';

interface CreateEventEvent {
  participants: Array<{
    userId: string;
    name: string;
    email?: string;
  }>;
  selectedSlot: {
    start: string;
    end: string;
  };
  meetingType: string;
  userId: string;
  channelId: string;
  workspaceId: string;
}

interface CreateEventResult {
  eventId: string;
  eventLink: string;
  startTime: string;
  endTime: string;
  attendees: string[];
}

export const handler: Handler<CreateEventEvent, CreateEventResult> = async (event) => {
  console.log('Create calendar event:', JSON.stringify(event, null, 2));
  
  const { participants, selectedSlot, meetingType, userId } = event;
  
  try {
    // Get organizer email
    const organizer = participants.find(p => p.userId === userId);
    if (!organizer) {
      throw new Error('Organizer not found in participants');
    }
    
    // Get attendee emails (excluding organizer)
    const attendeeEmails = participants
      .filter(p => p.email && p.userId !== userId)
      .map(p => p.email!);
    
    // Create the meeting
    const result = await googleCalendarService.createMeeting(
      userId, // Organizer ID
      attendeeEmails,
      meetingType,
      `${meetingType} - Scheduled via Symentic`,
      new Date(selectedSlot.start),
      new Date(selectedSlot.end)
    );
    
    return {
      eventId: result.eventId,
      eventLink: result.eventLink,
      startTime: selectedSlot.start,
      endTime: selectedSlot.end,
      attendees: participants.map(p => p.userId)
    };
  } catch (error) {
    console.error('Failed to create calendar event:', error);
    
    // Return a fallback result
    return {
      eventId: `symentic-${Date.now()}`,
      eventLink: '',
      startTime: selectedSlot.start,
      endTime: selectedSlot.end,
      attendees: participants.map(p => p.userId)
    };
  }
};