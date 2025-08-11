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
      reportedBy?: string;
    };
    severity?: string;
    reportedBy?: string;
  };
  reporterId?: string;
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
  
  // Extract severity and reportedBy from bug report
  const bugReportPayload = event.bugReport as { Payload?: { severity?: string; reportedBy?: string }; severity?: string; reportedBy?: string } | undefined;
  const severity = bugReportPayload?.Payload?.severity || bugReportPayload?.severity || 'medium';
  const reportedBy = event.reporterId || bugReportPayload?.Payload?.reportedBy || bugReportPayload?.reportedBy;
  
  try {
    // Determine urgency based on severity
    const urgency = severity === 'critical' || severity === 'high' ? 'high' : 'medium';
    const daysAhead = urgency === 'high' ? 1 : 3; // Critical/high = next 24h, others = next 3 days
    
    // Get all user IDs including engineers and reporter
    const engineerUserIds = (engineers as Array<{ userId: string; name: string }>).map(e => e.userId);
    const allUserIds = reportedBy && !engineerUserIds.includes(reportedBy) 
      ? [...engineerUserIds, reportedBy] 
      : engineerUserIds;
    
    console.log('Checking availability for users:', allUserIds);
    
    // For each user (engineers + reporter), check if they have calendar tokens
    const engineersWithCalendar: string[] = [];
    const engineersWithoutCalendar: string[] = [];
    
    for (const userId of allUserIds) {
      try {
        // Try to get calendar token for this user
        const hasToken = await dynamoDBService.getCalendarToken(userId);
        
        if (hasToken) {
          // Check if token has refresh_token
          if (!hasToken.refresh_token) {
            console.log(`User ${userId} has token but no refresh_token - treating as disconnected`);
            engineersWithoutCalendar.push(userId);
          } else {
            engineersWithCalendar.push(userId);
          }
        } else {
          // Try to find a user ID mapping
          const mapping = await dynamoDBService.getUserIdMapping(userId);
          if (mapping && mapping.alternateUserId) {
            console.log(`No token for ${userId}, trying alternate ID ${mapping.alternateUserId}`);
            const altToken = await dynamoDBService.getCalendarToken(mapping.alternateUserId);
            if (altToken && altToken.refresh_token) {
              engineersWithCalendar.push(mapping.alternateUserId);
            } else {
              engineersWithoutCalendar.push(userId);
            }
          } else {
            engineersWithoutCalendar.push(userId);
          }
        }
      } catch (error) {
        console.log(`Error checking calendar token for user ${userId}:`, error);
        engineersWithoutCalendar.push(userId);
      }
    }
    
    console.log('Engineers with calendar:', engineersWithCalendar);
    console.log('Engineers without calendar:', engineersWithoutCalendar);
    
    // Debug: Show calendar tokens status
    for (const userId of allUserIds) {
      try {
        const token = await dynamoDBService.getCalendarToken(userId);
        console.log(`User ${userId} calendar token exists:`, !!token);
        if (token) {
          console.log(`Token expires at:`, token.expiry_date);
        }
      } catch (e) {
        console.log(`User ${userId} - error checking token:`, e);
      }
    }
    
    // If no users have calendar connected, return default slots with auth URL
    if (engineersWithCalendar.length === 0) {
      const result = getDefaultSlots(allUserIds, urgency);
      
      // Generate auth URL for calendar connection
      const authUrl = await googleCalendarService.getAuthUrl(allUserIds[0]);
      
      return {
        ...result,
        engineersWithoutCalendar: engineersWithoutCalendar,
        calendarAuthUrl: authUrl
      };
    }
    
    // Get free/busy time for all users with calendar
    console.log(`Calling findFreeBusyTime with users: ${engineersWithCalendar.join(', ')}`);
    const freeSlots = await googleCalendarService.findFreeBusyTime(
      engineersWithCalendar,
      daysAhead
    );
    
    console.log(`Found ${freeSlots.length} potential free slots`);
    // Log first few slots for debugging
    freeSlots.slice(0, 5).forEach((slot, i) => {
      console.log(`  Slot ${i + 1}: ${slot.start.toISOString()} - ${slot.end.toISOString()}`);
    });
    
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
    
    // Sort slots by completeness (slots where all users are available first)
    availableSlots.sort((a, b) => {
      const aComplete = a.availableEngineers.length === allUserIds.length;
      const bComplete = b.availableEngineers.length === allUserIds.length;
      if (aComplete && !bComplete) return -1;
      if (!aComplete && bComplete) return 1;
      // Then sort by time (earliest first)
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });
    
    // Take top 5 slots
    const topSlots = availableSlots.slice(0, 5);
    
    // If no slots found from calendar, fall back to default slots
    if (topSlots.length === 0) {
      console.log('No calendar slots found, using default slots');
      console.log('WARNING: Calendar integration returned no free slots. This usually means:');
      console.log('  1. All time slots are busy (unlikely for a full day)');
      console.log('  2. Calendar permissions may be limited');
      console.log('  3. Calendar events are not being properly fetched');
      
      // If we have calendar-connected users but got no data, add a warning
      if (engineersWithCalendar.length > 0) {
        console.log(`ALERT: ${engineersWithCalendar.length} users have calendars connected but no busy times were found.`);
        console.log('This suggests a potential issue with calendar permissions or API access.');
      }
      
      const defaultResult = getDefaultSlots(allUserIds, urgency === 'high' ? 'high' : 'medium');
      return {
        ...defaultResult,
        engineersWithoutCalendar: engineersWithoutCalendar.length > 0 ? engineersWithoutCalendar : undefined,
        calendarDataWarning: engineersWithCalendar.length > 0 ? 'No available time slots found in calendars - showing default business hours' : undefined
      };
    }
    
    return {
      slots: topSlots,
      suggestedTime: topSlots[0]?.start,
      engineersWithoutCalendar: engineersWithoutCalendar.length > 0 ? engineersWithoutCalendar : undefined
    };
  } catch (error) {
    console.error('Error checking availability:', error);
    // Get all user IDs for default slots
    const engineerUserIds = (engineers as Array<{ userId: string; name: string }>).map(e => e.userId);
    const defaultUserIds = reportedBy && !engineerUserIds.includes(reportedBy) 
      ? [...engineerUserIds, reportedBy] 
      : engineerUserIds;
    return getDefaultSlots(defaultUserIds, event.urgency || 'medium');
  }
};

// Generate default slots when calendar is not available
function getDefaultSlots(engineerUserIds: string[], urgency: string): AvailabilityResult {
  console.log('Generating default slots for urgency:', urgency);
  const slots: SlotWithEngineers[] = [];
  
  // Get current time
  const now = new Date();
  console.log('Current UTC time:', now.toISOString());
  
  // Convert to EST/EDT for hour checking
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false
  });
  const currentHourEST = parseInt(formatter.format(now));
  console.log('Current hour in EST:', currentHourEST);
  
  // Create start time - we need to work in UTC but think in EST
  const startTime = new Date(now);
  
  // Calculate hours to add to get to next business hour in EST
  if (currentHourEST >= 17) {
    // After 5 PM EST, start from next day 8 AM EST
    const hoursUntilNextDay8AM = (24 - currentHourEST) + 8;
    startTime.setHours(startTime.getHours() + hoursUntilNextDay8AM, 0, 0, 0);
  } else if (currentHourEST < 8) {
    // Before 8 AM EST, start from 8 AM EST today
    const hoursUntil8AM = 8 - currentHourEST;
    startTime.setHours(startTime.getHours() + hoursUntil8AM, 0, 0, 0);
  } else {
    // During business hours, round to next 30-minute slot
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
    
    const endTime = new Date(currentTime);
    endTime.setMinutes(endTime.getMinutes() + slotDuration);
    
    // Skip non-business hours (must be between 8 AM - 5 PM EST)
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false
    });
    const currentTimeHourEST = parseInt(hourFormatter.format(currentTime));
    const endTimeHourEST = parseInt(hourFormatter.format(endTime));
    
    if (currentTimeHourEST >= 17 || currentTimeHourEST < 8 || endTimeHourEST > 17) {
      // Move to next day 8 AM EST
      currentTime.setDate(currentTime.getDate() + 1);
      // Set to 8 AM in the user's local time, adjusted for EST
      const tomorrow8AMEST = new Date(currentTime);
      tomorrow8AMEST.setHours(8, 0, 0, 0);
      // Get the UTC offset difference
      const tomorrowFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        hour12: false
      });
      const tomorrow8AMESTHour = parseInt(tomorrowFormatter.format(tomorrow8AMEST));
      const hourDiff = 8 - tomorrow8AMESTHour;
      currentTime.setHours(currentTime.getHours() + hourDiff, 0, 0, 0);
      continue;
    }
    
    slots.push({
      start: currentTime.toISOString(),
      end: endTime.toISOString(),
      availableEngineers: engineerUserIds // Assume all are available
    });
    
    // Move to next slot
    currentTime = new Date(endTime);
    currentTime.setMinutes(currentTime.getMinutes() + 30); // 30-minute gaps
  }
  
  console.log(`Generated ${slots.length} default slots`);
  if (slots.length > 0) {
    console.log('First slot:', slots[0]);
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