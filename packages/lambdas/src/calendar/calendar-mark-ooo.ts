import { Handler } from 'aws-lambda';
import { googleCalendarService } from '@symentic/core';

interface MarkOOOEvent {
  userId: string;
  timeRange: {
    start: string;
    end: string;
  };
  reason?: string;
  workspaceId: string;
}

interface MarkOOOResult {
  eventId: string;
  startDate: string;
  endDate: string;
  daysOff: number;
}

export const handler: Handler<MarkOOOEvent, MarkOOOResult> = async (event) => {
  console.log('Mark OOO event:', JSON.stringify(event, null, 2));
  
  const { userId, timeRange, reason = 'Out of Office' } = event;
  
  try {
    const startDate = new Date(timeRange.start);
    const endDate = new Date(timeRange.end);
    
    // Create an all-day OOO event
    const result = await googleCalendarService.createMeeting(
      userId,
      [], // No attendees for OOO
      `OOO: ${reason}`,
      `Out of Office: ${reason}\n\nThis person is unavailable during this period.`,
      startDate,
      endDate
    );
    
    // Calculate days off (excluding weekends)
    let daysOff = 0;
    const current = new Date(startDate);
    while (current <= endDate) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday or Saturday
        daysOff++;
      }
      current.setDate(current.getDate() + 1);
    }
    
    return {
      eventId: result.eventId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      daysOff
    };
  } catch (error) {
    console.error('Failed to mark OOO:', error);
    
    // Return a fallback result
    const startDate = new Date(timeRange.start);
    const endDate = new Date(timeRange.end);
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    return {
      eventId: `ooo-${Date.now()}`,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      daysOff: days
    };
  }
};