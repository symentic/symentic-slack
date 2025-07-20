import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
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
    await dynamoDBService.saveCalendarToken(userId, tokens);
  }

  async getCalendarClient(userId: string) {
    const tokens = await dynamoDBService.getCalendarToken(userId);
    if (!tokens) {
      throw new Error('No calendar tokens found for user');
    }

    this.oauth2Client.setCredentials(tokens);
    
    // Refresh token if needed
    if (tokens.expiry_date && tokens.expiry_date <= Date.now()) {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      await dynamoDBService.saveCalendarToken(userId, credentials);
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
        busy.forEach((slot: any) => {
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
    updates: any
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
}

// Singleton instance
export const googleCalendarService = new GoogleCalendarService();