import { Handler } from 'aws-lambda';
import { googleCalendarService, dynamoDBService } from '@symentic/core';

interface CheckAvailabilityEvent {
  engineers?: {
    Payload?: Array<{
      userId: string;
      name: string;
    }>;
  } | Array<{
    userId: string;
    name: string;
  }>;
  urgency?: string;
  bugReport?: {
    Payload?: {
      severity?: string;
    };
    severity?: string;
  };
}

interface AvailabilityResult {
  slots: Array<{
    start: string;
    end: string;
    availableEngineers: string[];
  }>;
  suggestedTime?: string;
  engineersWithoutCalendar?: string[];
  calendarAuthUrl?: string;
}

export const handler: Handler<CheckAvailabilityEvent, AvailabilityResult> = async (event) => {
  console.log('Checking calendar availability:', JSON.stringify(event, null, 2));
  
  // Handle Step Functions nested payload structure
  const engineersPayload = event.engineers as { Payload?: Array<{ userId: string; name: string }> } | undefined;
  const engineers = engineersPayload?.Payload || event.engineers || [];
  
  // Extract severity from bug report
  const bugReportPayload = event.bugReport as { Payload?: { severity?: string }; severity?: string } | undefined;
  const severity = bugReportPayload?.Payload?.severity || bugReportPayload?.severity || 'medium';
  
  try {
    // Determine urgency based on severity
    const urgency = severity === 'critical' || severity === 'high' ? 'high' : 'medium';
    const daysAhead = urgency === 'high' ? 1 : 3; // Critical/high = next 24h, others = next 3 days
    
    // Get engineer user IDs
    const engineerUserIds = (engineers as Array<{ userId: string; name: string }>).map(e => e.userId);
    
    // For each engineer, check if they have calendar tokens
    const engineersWithCalendar: string[] = [];
    const engineersWithoutCalendar: string[] = [];
    
    for (const userId of engineerUserIds) {
      try {
        const hasToken = await dynamoDBService.getCalendarToken(userId);
        if (hasToken) {
          engineersWithCalendar.push(userId);
        } else {
          engineersWithoutCalendar.push(userId);
        }
      } catch (error) {
        console.log(`No calendar token for user ${userId}`);
        engineersWithoutCalendar.push(userId);
      }
    }
    
    console.log('Engineers with calendar:', engineersWithCalendar);
    console.log('Engineers without calendar:', engineersWithoutCalendar);
    
    // If no engineers have calendar connected, return default slots with auth URL
    if (engineersWithCalendar.length === 0) {
      const result = getDefaultSlots(engineerUserIds, urgency);
      
      // Generate auth URL for calendar connection
      const authUrl = await googleCalendarService.getAuthUrl(engineerUserIds[0]);
      
      return {
        ...result,
        engineersWithoutCalendar: engineersWithoutCalendar,
        calendarAuthUrl: authUrl
      };
    }
    
    // Get free/busy time for engineers with calendar
    const freeSlots = await googleCalendarService.findFreeBusyTime(
      engineersWithCalendar,
      daysAhead
    );
    
    console.log(`Found ${freeSlots.length} potential free slots`);
    
    // Convert to our format and find best slots
    const availableSlots: SlotWithEngineers[] = freeSlots.map(slot => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      availableEngineers: engineersWithCalendar // All calendar-connected engineers are available
    }));
    
    // For engineers without calendar, assume they're available for all slots
    if (engineersWithoutCalendar.length > 0) {
      availableSlots.forEach(slot => {
        slot.availableEngineers.push(...engineersWithoutCalendar);
      });
    }
    
    // Sort slots by completeness (slots where all engineers are available first)
    availableSlots.sort((a, b) => {
      const aComplete = a.availableEngineers.length === engineerUserIds.length;
      const bComplete = b.availableEngineers.length === engineerUserIds.length;
      if (aComplete && !bComplete) return -1;
      if (!aComplete && bComplete) return 1;
      // Then sort by time (earliest first)
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });
    
    // Take top 5 slots
    const topSlots = availableSlots.slice(0, 5);
    
    return {
      slots: topSlots,
      suggestedTime: topSlots[0]?.start,
      engineersWithoutCalendar: engineersWithoutCalendar.length > 0 ? engineersWithoutCalendar : undefined
    };
  } catch (error) {
    console.error('Error checking availability:', error);
    return getDefaultSlots((engineers as Array<{ userId: string; name: string }>).map(e => e.userId), event.urgency || 'medium');
  }
};

// Generate default slots when calendar is not available
function getDefaultSlots(engineerUserIds: string[], urgency: string): AvailabilityResult {
  const now = new Date();
  const slots: SlotWithEngineers[] = [];
  
  // Start from next business hour
  const startTime = new Date(now);
  if (startTime.getHours() >= 17) {
    // After 5 PM, start from next day 9 AM
    startTime.setDate(startTime.getDate() + 1);
    startTime.setHours(9, 0, 0, 0);
  } else if (startTime.getHours() < 9) {
    // Before 9 AM, start from 9 AM
    startTime.setHours(9, 0, 0, 0);
  } else {
    // Round to next 30-minute slot
    startTime.setMinutes(Math.ceil(startTime.getMinutes() / 30) * 30, 0, 0);
  }
  
  // Skip weekends
  while (startTime.getDay() === 0 || startTime.getDay() === 6) {
    startTime.setDate(startTime.getDate() + 1);
  }
  
  // Generate slots based on urgency
  const slotsToGenerate = urgency === 'high' ? 3 : 5;
  const slotDuration = 30; // minutes
  
  let currentTime = new Date(startTime);
  while (slots.length < slotsToGenerate) {
    // Skip weekends
    if (currentTime.getDay() === 0 || currentTime.getDay() === 6) {
      currentTime.setDate(currentTime.getDate() + 1);
      currentTime.setHours(9, 0, 0, 0);
      continue;
    }
    
    // Skip non-business hours
    if (currentTime.getHours() >= 17) {
      currentTime.setDate(currentTime.getDate() + 1);
      currentTime.setHours(9, 0, 0, 0);
      continue;
    }
    
    const endTime = new Date(currentTime);
    endTime.setMinutes(endTime.getMinutes() + slotDuration);
    
    slots.push({
      start: currentTime.toISOString(),
      end: endTime.toISOString(),
      availableEngineers: engineerUserIds // Assume all are available
    });
    
    // Move to next slot
    currentTime = new Date(endTime);
    currentTime.setMinutes(currentTime.getMinutes() + 30); // 30-minute gaps
  }
  
  return {
    slots,
    suggestedTime: slots[0]?.start
  };
}

interface TimeSlot {
  start: string;
  end: string;
}

interface EngineerAvailability {
  userId: string;
  freeSlots: TimeSlot[];
}

interface SlotWithEngineers extends TimeSlot {
  availableEngineers: string[];
}

function findCommonSlots(engineerAvailability: EngineerAvailability[]): SlotWithEngineers[] {
  if (engineerAvailability.length === 0) return [];
  
  // Start with first engineer's slots
  let commonSlots = engineerAvailability[0].freeSlots;
  
  // Find intersection with other engineers
  for (let i = 1; i < engineerAvailability.length; i++) {
    const engineerSlots = engineerAvailability[i].freeSlots;
    commonSlots = commonSlots.filter((slot: TimeSlot) => 
      engineerSlots.some((eSlot: TimeSlot) => 
        eSlot.start === slot.start && eSlot.end === slot.end
      )
    );
  }
  
  // Add available engineers to each slot
  return commonSlots.map((slot: TimeSlot) => ({
    ...slot,
    availableEngineers: engineerAvailability
      .filter(e => e.freeSlots.some((s: TimeSlot) => s.start === slot.start))
      .map(e => e.userId)
  }));
}