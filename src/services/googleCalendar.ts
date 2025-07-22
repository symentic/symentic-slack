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

  async getAuthUrl(userId: string): Promise<string> {
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: userId, // Pass userId in state for later retrieval
    });
  }

  async handleAuthCallback(code: string, userId: string): Promise<void> {
    const { tokens } = await this.oauth2Client.getToken(code);
    await dynamoDBService.saveCalendarToken(userId, tokens as Record<string, unknown>);
  }

  async getCalendarClient(userId: string) {
    const tokens = await dynamoDBService.getCalendarToken(userId);
    if (!tokens) {
      throw new Error('No calendar tokens found for user');
    }

    this.oauth2Client.setCredentials(tokens as Credentials);
    
    // Refresh token if needed
    if (tokens.expiry_date && (tokens.expiry_date as number) <= Date.now()) {
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
    timeMax.setDate(timeMax.getDate() + daysAhead);

    // Skip weekends
    const isWeekday = (date: Date) => {
      const day = date.getDay();
      return day !== 0 && day !== 6;
    };

    const allBusyTimes: { start: Date; end: Date }[] = [];

    // Get busy times for each user
    for (const userId of userIds) {
      try {
        const calendar = await this.getCalendarClient(userId);
        const response = await calendar.freebusy.query({
          requestBody: {
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            items: [{ id: 'primary' }],
          },
        });

        const busy = response.data.calendars?.primary?.busy || [];
        busy.forEach((slot) => {
          allBusyTimes.push({
            start: new Date(slot.start!),
            end: new Date(slot.end!),
          });
        });
      } catch (error) {
        console.error(`Failed to get calendar for user ${userId}:`, error);
      }
    }

    // Find free slots
    const freeSlots: { start: Date; end: Date }[] = [];
    const slotDuration = 30; // 30 minutes
    const workStart = 9; // 9 AM
    const workEnd = 17; // 5 PM

    const currentTime = new Date(timeMin);
    currentTime.setHours(workStart, 0, 0, 0);

    while (currentTime < timeMax) {
      if (!isWeekday(currentTime)) {
        currentTime.setDate(currentTime.getDate() + 1);
        currentTime.setHours(workStart, 0, 0, 0);
        continue;
      }

      const slotEnd = new Date(currentTime);
      slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);

      // Check if slot is within work hours
      if (slotEnd.getHours() > workEnd || 
          (slotEnd.getHours() === workEnd && slotEnd.getMinutes() > 0)) {
        currentTime.setDate(currentTime.getDate() + 1);
        currentTime.setHours(workStart, 0, 0, 0);
        continue;
      }

      // Check if slot conflicts with any busy time
      const hasConflict = allBusyTimes.some(busy => 
        (currentTime >= busy.start && currentTime < busy.end) ||
        (slotEnd > busy.start && slotEnd <= busy.end) ||
        (currentTime <= busy.start && slotEnd >= busy.end)
      );

      if (!hasConflict) {
        freeSlots.push({
          start: new Date(currentTime),
          end: new Date(slotEnd),
        });
      }

      currentTime.setMinutes(currentTime.getMinutes() + 15); // Check every 15 minutes
    }

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