import { Handler } from 'aws-lambda';
import { profileEngramService } from '@symentic/core';

interface SaveEngramsEvent {
  intentType: string;
  userId: string;
  workspaceId: string;
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
    reason?: string;
  };
  participants?: Array<{
    userId: string;
    name: string;
  }>;
}

interface SaveEngramsResult {
  saved: boolean;
  enrichmentIds: string[];
}

export const handler: Handler<SaveEngramsEvent, SaveEngramsResult> = async (event) => {
  console.log('Save calendar engrams event:', JSON.stringify(event, null, 2));
  
  const { intentType, userId, workspaceId, eventDetails, oooDetails, participants } = event;
  const enrichmentIds: string[] = [];
  
  try {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
    if (intentType === 'schedule' && eventDetails) {
      // Save meeting scheduled enrichment for organizer
      const meetingTime = new Date(eventDetails.startTime).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York'
      });
      
      const participantNames = participants?.map(p => p.name).join(', ') || 'team';
      
      await profileEngramService.addEnrichment(
        workspaceId,
        userId,
        {
          agent: 'calendar agent',
          date: date,
          detail: `Scheduled meeting with ${participantNames} for ${meetingTime}`,
          metadata: {
            meetingId: eventDetails.eventId,
            bugId: eventDetails.eventLink,
            workflowId: eventDetails.attendees.join(',')
          }
        }
      );
      
      enrichmentIds.push(`meeting-${eventDetails.eventId}`);
      
      // Also save for attendees
      for (const attendeeId of eventDetails.attendees) {
        if (attendeeId !== userId) {
          await profileEngramService.addEnrichment(
            workspaceId,
            attendeeId,
            {
              agent: 'calendar agent',
              date: date,
              detail: `Meeting scheduled for ${meetingTime}`,
              metadata: {
                meetingId: eventDetails.eventId,
                workflowId: userId
              }
            }
          );
          
          enrichmentIds.push(`attendee-${attendeeId}-${eventDetails.eventId}`);
        }
      }
    } else if (intentType === 'ooo' && oooDetails) {
      // Save OOO enrichment
      const startDate = new Date(oooDetails.startDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
      const endDate = new Date(oooDetails.endDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
      
      await profileEngramService.addEnrichment(
        workspaceId,
        userId,
        {
          agent: 'calendar agent',
          date: date,
          detail: `Marked as OOO from ${startDate} to ${endDate} (${oooDetails.daysOff} days)`,
          metadata: {
            meetingId: oooDetails.eventId,
            workflowId: `ooo-${oooDetails.daysOff}days`
          }
        }
      );
      
      enrichmentIds.push(`ooo-${oooDetails.eventId}`);
    }
    
    return {
      saved: enrichmentIds.length > 0,
      enrichmentIds
    };
  } catch (error) {
    console.error('Failed to save calendar engrams:', error);
    
    return {
      saved: false,
      enrichmentIds: []
    };
  }
};