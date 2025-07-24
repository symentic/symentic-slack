import { Handler } from 'aws-lambda';
// TODO: Re-enable when implementing actual calendar integration
// import { googleCalendarService } from '../../services/googleCalendar';

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
}

export const handler: Handler<CheckAvailabilityEvent, AvailabilityResult> = async (event) => {
  console.log('Checking calendar availability:', JSON.stringify(event, null, 2));
  
  // Handle Step Functions nested payload structure
  const engineersPayload = event.engineers as { Payload?: Array<{ userId: string; name: string }> } | undefined;
  const engineers = engineersPayload?.Payload || event.engineers || [];
  
  try {
    // Determine time window based on urgency
    // TODO: Use time window for actual availability checking
    // const timeWindow = getTimeWindow(urgency);
    
    // For now, we'll use simplified availability checking
    // In production, you'd need to map Slack user IDs to email addresses
    // const engineerEmails = event.engineers.map(e => `${e.userId}@company.com`);
    
    // Check free/busy time for all engineers
    // TODO: Implement actual free/busy checking
    // const freeBusyData = await googleCalendarService.findFreeBusyTime(
    //   engineerEmails,
    //   3 // Check next 3 days
    // );
    
    // Convert to our format
    const engineerAvailability: EngineerAvailability[] = (engineers as Array<{ userId: string; name: string }>).map((engineer) => {
      // TODO: Use busy slots from freeBusyData to calculate free slots
      // const emailKey = engineerEmails[index];
      // const busySlots = freeBusyData[emailKey as keyof typeof freeBusyData] || [];
      // TODO: Calculate free slots from busy slots
      return {
        userId: engineer.userId,
        freeSlots: [] as TimeSlot[] // Simplified for now
      };
    });
    
    // Find common slots
    const commonSlots = findCommonSlots(engineerAvailability);
    
    // Format result
    const result: AvailabilityResult = {
      slots: commonSlots.slice(0, 5), // Top 5 slots
      suggestedTime: commonSlots[0]?.start
    };
    
    // If no common slots, just return individual availability
    if (commonSlots.length === 0 && engineerAvailability.length > 0) {
      result.slots = engineerAvailability
        .flatMap(e => e.freeSlots.map((slot: TimeSlot) => ({
          start: slot.start,
          end: slot.end,
          availableEngineers: [e.userId]
        })))
        .slice(0, 5);
    }
    
    return result;
  } catch (error) {
    console.error('Error checking availability:', error);
    
    // Return default slots as fallback
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    
    return {
      slots: [{
        start: tomorrow.toISOString(),
        end: new Date(tomorrow.getTime() + 30 * 60000).toISOString(),
        availableEngineers: []
      }],
      suggestedTime: tomorrow.toISOString()
    };
  }
};

// TODO: Implement time window based on urgency
// function getTimeWindow(urgency: string): { start: Date; end: Date } {
//   const now = new Date();
//   const start = new Date(now);
//   const end = new Date(now);
//   
//   switch (urgency) {
//     case 'high':
//     case 'critical':
//       // Next 24 hours
//       end.setDate(end.getDate() + 1);
//       break;
//     case 'medium':
//       // Next 3 days
//       end.setDate(end.getDate() + 3);
//       break;
//     default:
//       // Next week
//       end.setDate(end.getDate() + 7);
//   }
//   
//   return { start, end };
// }

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