import { Handler } from 'aws-lambda';
import { googleCalendarService } from '@symentic/core';

interface CheckAvailabilityEvent {
  participants: Array<{
    userId: string;
    name: string;
    email?: string;
  }>;
  dateTime?: string;
  duration: number;
  meetingType: string;
}

interface CheckAvailabilityResult {
  suggestedSlots: Array<{
    start: string;
    end: string;
    available: boolean;
    availableParticipants: string[];
  }>;
  hasConflicts: boolean;
  conflicts: Array<{
    userId: string;
    conflict: string;
  }>;
}

export const handler: Handler<CheckAvailabilityEvent, CheckAvailabilityResult> = async (event) => {
  console.log('Check availability event:', JSON.stringify(event, null, 2));
  
  const { participants, dateTime, duration } = event;
  
  try {
    // Get user IDs for calendar checking
    const userIds = participants.map(p => p.userId).filter(id => id.startsWith('U'));
    
    if (userIds.length === 0) {
      console.log('No valid user IDs for calendar checking');
      return {
        suggestedSlots: [],
        hasConflicts: false,
        conflicts: []
      };
    }
    
    // If a specific time was requested, check that first
    if (dateTime) {
      const requestedStart = new Date(dateTime);
      const requestedEnd = new Date(requestedStart);
      requestedEnd.setMinutes(requestedEnd.getMinutes() + duration);
      
      // Check availability for the requested time
      const availability = await googleCalendarService.checkAvailability(
        userIds,
        requestedStart.toISOString(),
        duration
      );
      
      const suggestedSlots = [{
        start: requestedStart.toISOString(),
        end: requestedEnd.toISOString(),
        available: availability.allAvailable,
        availableParticipants: availability.allAvailable 
          ? userIds 
          : userIds.filter(id => !availability.conflicts.some(c => c.email === id))
      }];
      
      // If requested time has conflicts, find alternatives
      if (!availability.allAvailable) {
        const alternatives = await googleCalendarService.findAlternativeTimes(
          userIds,
          requestedStart.toISOString(),
          duration,
          4 // Get 4 more alternatives
        );
        
        for (const alt of alternatives) {
          suggestedSlots.push({
            start: alt.timestamp,
            end: new Date(new Date(alt.timestamp).getTime() + duration * 60000).toISOString(),
            available: alt.available,
            availableParticipants: alt.available ? userIds : []
          });
        }
      }
      
      return {
        suggestedSlots,
        hasConflicts: !availability.allAvailable,
        conflicts: availability.conflicts.map(c => ({
          userId: c.email,
          conflict: c.conflict
        }))
      };
    } else {
      // No specific time requested, find free slots
      const freeSlots = await googleCalendarService.findFreeBusyTime(userIds, 7); // Next 7 days
      
      // Convert to suggested slots format
      const suggestedSlots = freeSlots.slice(0, 5).map(slot => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        available: true,
        availableParticipants: userIds
      }));
      
      return {
        suggestedSlots,
        hasConflicts: false,
        conflicts: []
      };
    }
  } catch (error) {
    console.error('Failed to check availability:', error);
    
    // Return empty availability on error
    return {
      suggestedSlots: [],
      hasConflicts: false,
      conflicts: [{
        userId: 'system',
        conflict: 'Unable to check calendar availability'
      }]
    };
  }
};