import { google } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import { dynamoDBService } from './dynamodb';

export class GoogleCalendarService {
  private oauth2Client: OAuth2Client;

  constructor() {
    this.oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
  }

  async getAuthUrl(userId: string, forceNewToken: boolean = false): Promise<string> {
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ];

    // Check if user already has a valid refresh token
    if (!forceNewToken) {
      try {
        const existingTokens = await dynamoDBService.getCalendarToken(userId);
        if (existingTokens && existingTokens.refresh_token) {
          console.log(`User ${userId} already has a refresh token. Consider using existing connection.`);
        }
      } catch (error) {
        console.log('Error checking existing tokens:', error);
      }
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: userId, // Pass userId in state for later retrieval
      prompt: 'consent', // Force re-consent to ensure refresh token is returned
      // Note: Google may still not return a refresh token if the user has already authorized the app
      // To force a new refresh token, the user must revoke access at https://myaccount.google.com/permissions
    });
  }

  async handleAuthCallback(code: string, userId: string): Promise<void> {
    console.log(`Handling OAuth callback for user ${userId}`);
    const { tokens } = await this.oauth2Client.getToken(code);
    console.log('Tokens received from Google:', JSON.stringify(tokens, null, 2));
    
    // Check if we already have a refresh token stored
    let finalTokens = { ...tokens };
    if (!tokens.refresh_token) {
      console.warn(`WARNING: No refresh_token received for user ${userId}.`);
      
      // Try to get existing refresh token
      try {
        const existingTokens = await dynamoDBService.getCalendarToken(userId);
        if (existingTokens && existingTokens.refresh_token) {
          console.log(`Using existing refresh_token for user ${userId}`);
          finalTokens.refresh_token = existingTokens.refresh_token as string;
        } else {
          console.error(`No refresh token available for user ${userId}. User must revoke access at https://myaccount.google.com/permissions and re-authorize.`);
          throw new Error('No refresh token received. Please revoke app access in your Google Account settings and try connecting again.');
        }
      } catch (error) {
        console.error('Error retrieving existing tokens:', error);
        throw new Error('No refresh token received. Please revoke app access at https://myaccount.google.com/permissions and reconnect.');
      }
    }
    
    await dynamoDBService.saveCalendarToken(userId, finalTokens as Record<string, unknown>);
    console.log(`Calendar tokens saved for user ${userId} (refresh_token: ${finalTokens.refresh_token ? 'present' : 'missing'})`);
  }

  async getCalendarClient(userId: string) {
    let tokens = await dynamoDBService.getCalendarToken(userId);
    
    // If no tokens or no refresh_token, check for user ID mapping
    if (!tokens || !tokens.refresh_token) {
      console.log(`No valid tokens for ${userId}, checking for user ID mapping...`);
      const mapping = await dynamoDBService.getUserIdMapping(userId);
      if (mapping) {
        const alternateId = mapping.primaryUserId === userId ? mapping.alternateUserId : mapping.primaryUserId;
        console.log(`Found mapping: ${userId} -> ${alternateId}`);
        const altTokens = await dynamoDBService.getCalendarToken(alternateId);
        if (altTokens && altTokens.refresh_token) {
          console.log(`Using tokens from alternate ID ${alternateId}`);
          tokens = altTokens;
        }
      }
    }
    
    if (!tokens) {
      throw new Error('No calendar tokens found for user');
    }

    this.oauth2Client.setCredentials(tokens as Credentials);
    
    // Refresh token if needed
    if (tokens.expiry_date && (tokens.expiry_date as number) <= Date.now()) {
      console.log(`Token expired for user ${userId}, attempting refresh...`);
      if (!tokens.refresh_token) {
        console.error(`No refresh token available for user ${userId}. User needs to re-authenticate.`);
        throw new Error('Calendar token expired and no refresh token available. Please reconnect your calendar.');
      }
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      await dynamoDBService.saveCalendarToken(userId, credentials as Record<string, unknown>);
      this.oauth2Client.setCredentials(credentials);
    }

    return google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  async findFreeBusyTime(
    userIds: string[], 
    daysAhead: number = 3
  ): Promise<{ start: Date; end: Date }[]> {
    const timeMin = new Date();
    const timeMax = new Date();
    // Extend search window if looking for slots
    const extendedDays = Math.max(daysAhead, 3); // At least 3 days to find slots
    timeMax.setDate(timeMax.getDate() + extendedDays);
    
    console.log(`Finding free/busy time for ${userIds.length} users from ${timeMin.toISOString()} to ${timeMax.toISOString()}`);
    console.log('User IDs:', userIds);

    // Skip weekends
    const isWeekday = (date: Date) => {
      const day = date.getDay();
      return day !== 0 && day !== 6;
    };

    const allBusyTimes: { start: Date; end: Date }[] = [];

    // Get busy times for each user
    for (const userId of userIds) {
      try {
        // First try the given user ID
        const calendar = await this.getCalendarClient(userId);
        console.log(`Querying calendar for user ${userId}`);
        console.log(`  Time range: ${timeMin.toISOString()} to ${timeMax.toISOString()}`);
        console.log(`  In EDT: ${timeMin.toLocaleString('en-US', {timeZone: 'America/New_York'})} to ${timeMax.toLocaleString('en-US', {timeZone: 'America/New_York'})}`);
        
        // First try to get events to verify calendar access
        try {
          const eventsResponse = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 10
          });
          console.log(`Calendar events.list found ${eventsResponse.data.items?.length || 0} events for ${userId}`);
          if (eventsResponse.data.items && eventsResponse.data.items.length > 0) {
            console.log('First few events:', eventsResponse.data.items.slice(0, 3).map(e => ({
              summary: e.summary,
              start: e.start?.dateTime || e.start?.date,
              end: e.end?.dateTime || e.end?.date
            })));
          }
        } catch (eventError) {
          console.log(`Could not fetch events for ${userId}:`, eventError);
        }
        
                // Skip freebusy entirely - use events.list directly like calendar-status  
        console.log(`FORCED REBUILD: Using events.list approach directly for ${userId} (same as calendar-status)`);
        
        let busy: { start: string; end: string }[] = [];
        
        try {
          // Use EXACT same parameters as calendar-status
          const now = new Date();
          const nextWeek = new Date();
          nextWeek.setDate(nextWeek.getDate() + 7);
          
          console.log(`Fetching events for ${userId} from ${now.toISOString()} to ${nextWeek.toISOString()}`);
          
          // EXACT same call as calendar-status
          const eventsResponse = await calendar.events.list({
            calendarId: 'primary',
            timeMin: now.toISOString(),
            timeMax: nextWeek.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 5  // Same as calendar-status
          });
          
          const events = eventsResponse.data.items || [];
          console.log(`Found ${events.length} events for ${userId} using events.list directly`);
          
          // Log the raw events like calendar-status does
          events.forEach((event, index) => {
            console.log(`  Event ${index + 1}: ${event.summary || 'No title'}, start: ${event.start?.dateTime || event.start?.date}, end: ${event.end?.dateTime || event.end?.date}`);
          });
          
          // Convert events to busy time slots - ANY event with dateTime becomes busy
          const busyFromEvents = events
            .filter(event => {
              // Same logic as calendar-status - accept both dateTime and date
              return (event.start?.dateTime || event.start?.date) && 
                     (event.end?.dateTime || event.end?.date);
            })
            .map(event => ({
              start: event.start?.dateTime || event.start?.date || '',
              end: event.end?.dateTime || event.end?.date || ''
            }));
            
          console.log(`Converted ${busyFromEvents.length} events to busy slots for ${userId}`);
          busyFromEvents.forEach((slot, index) => {
            console.log(`  Busy slot ${index + 1}: ${slot.start} - ${slot.end}`);
          });
          
          busy = busyFromEvents;
        } catch (eventsError) {
          console.log(`Could not fetch events for ${userId}:`, eventsError);
        }
        
        // If no busy slots found, check for user ID mapping and try alternate ID using events.list
        if (busy.length === 0) {
          console.log(`No busy slots for ${userId}, checking for user ID mapping...`);
          const mapping = await dynamoDBService.getUserIdMapping(userId);
          if (mapping) {
            const alternateId = mapping.primaryUserId === userId ? mapping.alternateUserId : mapping.primaryUserId;
            console.log(`Found mapping: ${userId} -> ${alternateId}, checking alternate calendar with events.list`);
            
            try {
              const altCalendar = await this.getCalendarClient(alternateId);
              // Use events.list for alternate ID too (no more freebusy)
              const altNow = new Date();
              const altNextWeek = new Date();
              altNextWeek.setDate(altNextWeek.getDate() + 7);
              
              const altEventsResponse = await altCalendar.events.list({
                calendarId: 'primary',
                timeMin: altNow.toISOString(),
                timeMax: altNextWeek.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
                maxResults: 5
              });
              
              const altEvents = altEventsResponse.data.items || [];
              console.log(`Found ${altEvents.length} events for alternate ID ${alternateId}`);
              
              const altBusyFromEvents = altEvents
                .filter(event => {
                  return (event.start?.dateTime || event.start?.date) && 
                         (event.end?.dateTime || event.end?.date);
                })
                .map(event => ({
                  start: event.start?.dateTime || event.start?.date || '',
                  end: event.end?.dateTime || event.end?.date || ''
                }));
                
              if (altBusyFromEvents.length > 0) {
                console.log(`Using ${altBusyFromEvents.length} busy slots from alternate ID ${alternateId}`);
                busy = altBusyFromEvents;
              }
            } catch (altError) {
              console.log(`Could not check alternate ID ${alternateId}:`, altError);
            }
          }
        }
        
        console.log(`User ${userId} has ${busy.length} busy slots`);
        busy.forEach((slot, index) => {
          const busyStart = new Date(slot.start);
          const busyEnd = new Date(slot.end);
          console.log(`  Busy slot ${index + 1}: ${slot.start} - ${slot.end}`);
          console.log(`    Parsed as: ${busyStart.toISOString()} - ${busyEnd.toISOString()}`);
          console.log(`    In EDT: ${busyStart.toLocaleString('en-US', {timeZone: 'America/New_York'})} - ${busyEnd.toLocaleString('en-US', {timeZone: 'America/New_York'})}`);
          console.log(`    Timestamp range: ${busyStart.getTime()} - ${busyEnd.getTime()}`);
          allBusyTimes.push({
            start: busyStart,
            end: busyEnd,
          });
        });
      } catch (error) {
        console.error(`Failed to get calendar for user ${userId}:`, error);
        console.error('Full error details:', JSON.stringify(error, null, 2));
      }
    }

    // Find free slots
    const freeSlots: { start: Date; end: Date }[] = [];
    const slotDuration = 30; // 30 minutes
    const workStart = 8; // 8 AM EST
    const workEnd = 17; // 5 PM EST

    // Start from current time but ensure it's within business hours
    let currentTime = new Date(timeMin);
    
    // Check if we're on a weekend first
    while (!isWeekday(currentTime)) {
      currentTime.setDate(currentTime.getDate() + 1);
      currentTime.setHours(8, 0, 0, 0); // Set to 8 AM on the next weekday
    }
    
    // Convert to EST/EDT for business hours check
    const estTime = new Date(currentTime.toLocaleString("en-US", {timeZone: "America/New_York"}));
    const currentHourEST = estTime.getHours();
    
    // Round to next 15-minute slot for more flexibility
    const minutes = currentTime.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    if (roundedMinutes === 60) {
      currentTime.setHours(currentTime.getHours() + 1, 0, 0, 0);
    } else {
      currentTime.setMinutes(roundedMinutes, 0, 0);
    }
    
    // Adjust start time based on EST business hours
    if (currentHourEST >= workEnd) {
      // After 5 PM EST, start from next day 8 AM
      currentTime.setDate(currentTime.getDate() + 1);
      currentTime.setHours(8, 0, 0, 0);
      // Skip weekend if next day is weekend
      while (!isWeekday(currentTime)) {
        currentTime.setDate(currentTime.getDate() + 1);
      }
      // Adjust to 8 AM ET
      const nextDayEST = new Date(currentTime.toLocaleString("en-US", {timeZone: "America/New_York"}));
      const hourDiff = 8 - nextDayEST.getHours();
      if (hourDiff !== 0) {
        currentTime.setHours(currentTime.getHours() + hourDiff);
      }
    } else if (currentHourEST < workStart) {
      // Before 8 AM EST, start from 8 AM same day (not next day)
      currentTime.setHours(8, 0, 0, 0);
      // Adjust to 8 AM ET
      const todayEST = new Date(currentTime.toLocaleString("en-US", {timeZone: "America/New_York"}));
      const hourDiff = 8 - todayEST.getHours();
      if (hourDiff !== 0) {
        currentTime.setHours(currentTime.getHours() + hourDiff);
      }
    }

    console.log(`Starting slot search from: ${currentTime.toISOString()} (${currentTime.toLocaleString('en-US', {timeZone: 'America/New_York'})})`);
    console.log(`Total busy times to check against: ${allBusyTimes.length}`);
    allBusyTimes.forEach((busy, index) => {
      console.log(`  Busy time ${index + 1}: ${busy.start.toISOString()} - ${busy.end.toISOString()}`);
      console.log(`    In EDT: ${busy.start.toLocaleString('en-US', {timeZone: 'America/New_York'})} - ${busy.end.toLocaleString('en-US', {timeZone: 'America/New_York'})}`);
    });
    
    // Sort busy times by start time for easier debugging
    allBusyTimes.sort((a, b) => a.start.getTime() - b.start.getTime());
    
    // Debug: Check specific morning slots
    const debugDate = new Date(currentTime);
    debugDate.setHours(13, 0, 0, 0); // 8 AM EDT = 13:00 UTC (during EDT)
    console.log(`DEBUG: Checking if 8:00 AM EDT slot would conflict...`);
    console.log(`  8 AM EDT as UTC: ${debugDate.toISOString()}`);
    const wouldConflict8AM = allBusyTimes.some(busy => {
      const busyStart = busy.start.getTime();
      const busyEnd = busy.end.getTime();
      const slot8AM = debugDate.getTime();
      const slot8AMEnd = slot8AM + (30 * 60 * 1000);
      return (slot8AM < busyEnd && slot8AMEnd > busyStart);
    });
    console.log(`  Would 8 AM EDT conflict? ${wouldConflict8AM}`);
    
    while (currentTime < timeMax) {
      if (!isWeekday(currentTime)) {
        currentTime.setDate(currentTime.getDate() + 1);
        currentTime.setHours(workStart, 0, 0, 0);
        continue;
      }

      const slotEnd = new Date(currentTime);
      slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);

      // Check if slot is within work hours (8 AM - 5 PM EST)
      const slotStartEST = new Date(currentTime.toLocaleString("en-US", {timeZone: "America/New_York"}));
      const slotEndEST = new Date(slotEnd.toLocaleString("en-US", {timeZone: "America/New_York"}));
      
      if (slotEndEST.getHours() > workEnd || 
          (slotEndEST.getHours() === workEnd && slotEndEST.getMinutes() > 0) ||
          slotStartEST.getHours() < workStart) {
        // Move to next day 8 AM
        currentTime.setDate(currentTime.getDate() + 1);
        currentTime.setHours(8, 0, 0, 0);
        // Adjust to 8 AM ET
        const nextDayEST = new Date(currentTime.toLocaleString("en-US", {timeZone: "America/New_York"}));
        const hourDiff = 8 - nextDayEST.getHours();
        if (hourDiff !== 0) {
          currentTime.setHours(currentTime.getHours() + hourDiff);
        }
        continue;
      }

      // Check if slot conflicts with any busy time
      const slotStartTime = currentTime.getTime();
      const slotEndTime = slotEnd.getTime();
      
      const hasConflict = allBusyTimes.some(busy => {
        const busyStartTime = busy.start.getTime();
        const busyEndTime = busy.end.getTime();
        
        // Check for any overlap between the proposed slot and busy time
        return (slotStartTime < busyEndTime && slotEndTime > busyStartTime);
      });
      
      if (hasConflict) {
        console.log(`Slot ${currentTime.toISOString()} - ${slotEnd.toISOString()} has conflict`);
        console.log(`  In EDT: ${currentTime.toLocaleString('en-US', {timeZone: 'America/New_York'})} - ${slotEnd.toLocaleString('en-US', {timeZone: 'America/New_York'})}`);
        // Find which busy time it conflicts with
        const conflictingBusy = allBusyTimes.find(busy => {
          const busyStartTime = busy.start.getTime();
          const busyEndTime = busy.end.getTime();
          return (slotStartTime < busyEndTime && slotEndTime > busyStartTime);
        });
        if (conflictingBusy) {
          console.log(`  Conflicts with busy time: ${conflictingBusy.start.toISOString()} - ${conflictingBusy.end.toISOString()}`);
          console.log(`    In EDT: ${conflictingBusy.start.toLocaleString('en-US', {timeZone: 'America/New_York'})} - ${conflictingBusy.end.toLocaleString('en-US', {timeZone: 'America/New_York'})}`);
          
          // Jump to the end of the conflicting busy period instead of incrementing by 15 minutes
          // This helps find slots between meetings (e.g., 2:15-3:00 PM)
          const busyEndTime = conflictingBusy.end.getTime();
          const currentTimeMs = currentTime.getTime();
          if (busyEndTime > currentTimeMs) {
            console.log(`  Jumping to end of busy period: ${conflictingBusy.end.toISOString()}`);
            currentTime = new Date(conflictingBusy.end);
            continue; // Skip the normal increment
          }
        }
      }

      if (!hasConflict) {
        const slotTimeEDT = currentTime.toLocaleString('en-US', {timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false});
        console.log(`Slot ${currentTime.toISOString()} - ${slotEnd.toISOString()} is FREE`);
        console.log(`  In EDT: ${currentTime.toLocaleString('en-US', {timeZone: 'America/New_York'})} - ${slotEnd.toLocaleString('en-US', {timeZone: 'America/New_York'})}`);
        
        // Special logging for morning slots
        if (slotTimeEDT.startsWith('08:') || slotTimeEDT.startsWith('09:') || slotTimeEDT.startsWith('10:')) {
          console.log(`  ⚠️ MORNING SLOT MARKED AS FREE: ${slotTimeEDT}`);
          console.log(`  This slot was checked against ${allBusyTimes.length} busy times`);
          // Check if any busy times overlap with this specific slot
          const overlappingBusy = allBusyTimes.filter(busy => {
            const busyStart = busy.start.getTime();
            const busyEnd = busy.end.getTime();
            return (slotStartTime < busyEnd && slotEndTime > busyStart);
          });
          console.log(`  Overlapping busy times: ${overlappingBusy.length}`);
          overlappingBusy.forEach(busy => {
            console.log(`    Busy: ${busy.start.toISOString()} - ${busy.end.toISOString()}`);
          });
        }
        
        freeSlots.push({
          start: new Date(currentTime),
          end: new Date(slotEnd),
        });
        
        // Limit free slots to prevent too many options
        if (freeSlots.length >= 20) {
          console.log('Reached 20 free slots, stopping search');
          break;
        }
      }

      currentTime.setMinutes(currentTime.getMinutes() + 30); // Check every 30 minutes to avoid too many small increments
    }

    console.log(`Found ${freeSlots.length} free slots after checking ${allBusyTimes.length} busy times`);
    return freeSlots;
  }

  async createMeeting(
    organizerId: string,
    attendeeEmails: string[],
    summary: string,
    description: string,
    startTime: Date,
    endTime: Date
  ): Promise<{ eventId: string; eventLink: string }> {
    const calendar = await this.getCalendarClient(organizerId);

    const event = {
      summary,
      description,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'America/New_York',
      },
      attendees: attendeeEmails.map(email => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: `symentic-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      conferenceDataVersion: 1,
    });

    const eventId = response.data.id!;
    const eventLink = response.data.htmlLink!;

    return { eventId, eventLink };
  }

  async updateMeeting(
    userId: string,
    eventId: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    const calendar = await this.getCalendarClient(userId);

    await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: updates,
    });
  }

  async deleteMeeting(
    userId: string,
    eventId: string
  ): Promise<void> {
    const calendar = await this.getCalendarClient(userId);

    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
    });
  }

  // Check availability for multiple participants
  async checkAvailability(
    participantEmails: string[],
    proposedTime: string,
    duration: number = 60
  ): Promise<{
    allAvailable: boolean;
    conflicts: Array<{ email: string; conflict: string }>;
  }> {
    const startTime = new Date(proposedTime);
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + duration);

    const conflicts: Array<{ email: string; conflict: string }> = [];

    for (const email of participantEmails) {
      try {
        // Note: In production, you'd need to map emails to userIds
        // For now, we'll use email as userId placeholder
        const calendar = await this.getCalendarClient(email);
        
        const response = await calendar.freebusy.query({
          requestBody: {
            timeMin: startTime.toISOString(),
            timeMax: endTime.toISOString(),
            items: [{ id: 'primary' }],
          },
        });

        const busy = response.data.calendars?.primary?.busy || [];
        if (busy.length > 0) {
          conflicts.push({
            email,
            conflict: `Busy from ${busy[0].start} to ${busy[0].end}`
          });
        }
      } catch (error) {
        console.error(`Failed to check availability for ${email}:`, error);
        // Assume unavailable if we can't check
        conflicts.push({
          email,
          conflict: 'Unable to check availability'
        });
      }
    }

    return {
      allAvailable: conflicts.length === 0,
      conflicts
    };
  }

  // Find alternative meeting times
  async findAlternativeTimes(
    participantEmails: string[],
    originalTime: string,
    duration: number = 60,
    alternatives: number = 3
  ): Promise<Array<{
    timestamp: string;
    formatted: string;
    available: boolean;
  }>> {
    const suggestions: Array<{
      timestamp: string;
      formatted: string;
      available: boolean;
    }> = [];

    const baseTime = new Date(originalTime);
    const timeSlotsToCheck = [
      // Same day alternatives
      new Date(baseTime.getTime() + 60 * 60 * 1000), // +1 hour
      new Date(baseTime.getTime() + 2 * 60 * 60 * 1000), // +2 hours
      new Date(baseTime.getTime() - 60 * 60 * 1000), // -1 hour
      // Next day same time
      new Date(baseTime.getTime() + 24 * 60 * 60 * 1000),
      // Next day +1 hour
      new Date(baseTime.getTime() + 25 * 60 * 60 * 1000),
    ];

    for (const slot of timeSlotsToCheck) {
      if (suggestions.length >= alternatives) break;

      // Skip if outside business hours (9 AM - 5 PM)
      const hours = slot.getHours();
      if (hours < 9 || hours >= 17) continue;

      // Skip weekends
      const day = slot.getDay();
      if (day === 0 || day === 6) continue;

      const availability = await this.checkAvailability(
        participantEmails,
        slot.toISOString(),
        duration
      );

      suggestions.push({
        timestamp: slot.toISOString(),
        formatted: slot.toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'America/New_York'
        }),
        available: availability.allAvailable
      });
    }

    // Sort by availability (available times first)
    return suggestions.sort((a, b) => {
      if (a.available && !b.available) return -1;
      if (!a.available && b.available) return 1;
      return 0;
    }).slice(0, alternatives);
  }

  // Get events for a specific date
  async getEvents(
    userEmail: string,
    date: string = 'today'
  ): Promise<Array<{
    time: string;
    title: string;
    attendees?: string;
  }>> {
    try {
      const calendar = await this.getCalendarClient(userEmail);
      
      // Parse date
      let startDate: Date;
      let endDate: Date;
      
      if (date === 'today') {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
      } else {
        startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);
      }

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      
      return events.map(event => ({
        time: event.start?.dateTime 
          ? new Date(event.start.dateTime).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit'
            })
          : 'All day',
        title: event.summary || 'No title',
        attendees: event.attendees
          ?.map(a => a.email)
          .filter(e => e !== userEmail)
          .join(', ')
      }));
    } catch (error) {
      console.error(`Failed to get events for ${userEmail}:`, error);
      return [];
    }
  }
}

// Singleton instance
export const googleCalendarService = new GoogleCalendarService();