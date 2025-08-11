import { BaseAgent, AgentConfig } from './base/BaseAgent';
import { WebClient } from '@slack/web-api';
import { googleCalendarService } from '../services/googleCalendar';
import { dynamoDBService } from '../services/dynamodb';
import { SlackSayFunction, SlackBlock } from '../types/slack';
import { ConversationContext, AgentResponse } from '../types/domain';

const CALENDAR_AGENT_CONFIG: AgentConfig = {
  name: 'CalendarAgent',
  description: 'Handles meeting scheduling, calendar queries, and availability checks',
  intents: [
    'calendar.schedule',
    'calendar.check',
    'calendar.cancel',
    'calendar.reschedule',
    'meeting.create',
    'meeting.find',
    'availability.check'
  ],
  priority: 1,
  requiredServices: ['googleCalendar', 'dynamodb'],
  modelPreference: 'gpt-4o-mini' // Use GPT-4o-mini for better accuracy with 10M free tokens daily
};

export class CalendarAgent extends BaseAgent {
  constructor(client: WebClient) {
    super(client, CALENDAR_AGENT_CONFIG);
  }

  async handle(
    context: ConversationContext,
    say: SlackSayFunction
  ): Promise<AgentResponse> {
    const { intent, threadTs } = context;

    try {
      // Validate we have necessary entities
      const validation = await this.validateContext(context);
      if (!validation.isValid) {
        return await this.askForMissingInfo(validation.missingData!, say, threadTs);
      }

      // Handle different calendar intents
      switch (intent.intent) {
        case 'calendar.schedule':
        case 'meeting.create':
          return await this.scheduleMeeting(context, say);
        
        case 'calendar.check':
        case 'availability.check':
          return await this.checkAvailability(context, say);
        
        case 'calendar.cancel':
          return await this.cancelMeeting(context, say);
        
        case 'calendar.reschedule':
          return await this.rescheduleMeeting(context, say);
        
        default:
          return {
            text: "I can help you with scheduling meetings, checking calendars, and managing availability. What would you like to do?",
            threadTs
          };
      }
    } catch (error) {
      console.error(`[CalendarAgent] Error handling request:`, error);
      return {
        text: "I encountered an error while processing your calendar request. Please try again.",
        threadTs
      };
    }
  }

  async validateContext(context: ConversationContext): Promise<{
    isValid: boolean;
    missingData?: string[];
  }> {
    const missingData: string[] = [];
    const { entities } = context.intent;

    // Check required entities based on intent
    if (context.intent.intent.includes('schedule') || context.intent.intent.includes('create')) {
      if (!entities.time && !entities.date) {
        missingData.push('meeting time');
      }
      if (!entities.participants || (entities.participants as string[]).length === 0) {
        missingData.push('participants');
      }
    }

    return {
      isValid: missingData.length === 0,
      missingData
    };
  }

  private async askForMissingInfo(
    missingData: string[],
    say: SlackSayFunction,
    threadTs: string
  ): Promise<AgentResponse> {
    const missingText = missingData.join(' and ');
    await say({
      text: `To schedule this meeting, I need the ${missingText}. Can you provide these details?`,
      thread_ts: threadTs
    });

    return {
      text: `Waiting for ${missingText}...`,
      shouldStore: true,
      metadata: { 
        waitingFor: missingData,
        agentState: 'collecting_info'
      }
    };
  }

  private async scheduleMeeting(
    context: ConversationContext,
    say: SlackSayFunction
  ): Promise<AgentResponse> {
    const { entities } = context.intent;
    const { userId, threadTs } = context;

    // Extract meeting details
    const meetingTime = (entities.time || entities.date) as string;
    const participants = (entities.participants as string[]) || [];
    const duration = (entities.duration as number) || 60; // Default 1 hour
    const title = (entities.title as string) || `Meeting with ${participants.join(', ')}`;

    // Get participant Slack IDs and emails
    const participantDetails = await this.resolveParticipants(participants);
    
    // Check availability for all participants
    const availability = await googleCalendarService.checkAvailability(
      participantDetails.map(p => p.email),
      meetingTime as string,
      duration as number
    );

    if (!availability.allAvailable) {
      // Suggest alternative times
      const alternatives = await googleCalendarService.findAlternativeTimes(
        participantDetails.map(p => p.email),
        meetingTime as string,
        duration as number
      );

      await say({
        text: `Some participants are not available at ${meetingTime as string}. Here are some alternative times:`,
        thread_ts: threadTs,
        blocks: this.formatAlternativeTimes(alternatives)
      });

      return {
        text: "Please choose an alternative time or specify a different time.",
        shouldStore: true,
        metadata: { 
          proposedAlternatives: alternatives,
          originalRequest: entities
        }
      };
    }

    // Create the meeting
    const startTime = new Date(meetingTime);
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + duration);
    
    const meeting = await googleCalendarService.createMeeting(
      userId,
      participantDetails.map(p => p.email),
      title as string,
      `Meeting scheduled via Slack by <@${userId}>`,
      startTime,
      endTime
    );

    // Store meeting record
    await dynamoDBService.saveMeeting({
      organizerId: userId,
      participants: participantDetails,
      scheduledAt: startTime.toISOString(),
      createdAt: new Date().toISOString(),
      title: title as string
    });

    // Send confirmation
    await say({
      text: `✅ Meeting scheduled successfully!`,
      thread_ts: threadTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Meeting Scheduled*\n*Title:* ${title}\n*Time:* ${startTime.toLocaleString()}\n*Duration:* ${duration} minutes\n*Participants:* ${participants.map(p => `<@${p}>`).join(', ')}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📅 <${meeting.eventLink}|View in Google Calendar>`
          }
        }
      ]
    });

    return {
      text: `Meeting "${title}" scheduled for ${startTime.toLocaleString()}`,
      shouldStore: true,
      metadata: { meetingId: meeting.eventId }
    };
  }

  private async checkAvailability(
    context: ConversationContext,
    say: SlackSayFunction
  ): Promise<AgentResponse> {
    const { entities } = context.intent;
    const { threadTs } = context;

    const targetUser = (entities.user as string) || context.userId;
    const date = (entities.date as string) || 'today';
    
    // Get user's calendar
    const userEmail = await this.getUserEmail(targetUser as string);
    const events = await googleCalendarService.getEvents(userEmail, date as string);

    if (events.length === 0) {
      return {
        text: `<@${targetUser}> has no meetings scheduled for ${date}.`,
        threadTs
      };
    }

    // Format calendar
    const blocks = this.formatCalendarEvents(events, targetUser as string);
    
    await say({
      text: `Here's <@${targetUser}>'s schedule for ${date}:`,
      thread_ts: threadTs,
      blocks
    });

    return {
      text: `Displayed ${events.length} events for ${date}`,
      shouldStore: false
    };
  }

  private async cancelMeeting(
    context: ConversationContext,
    _say: SlackSayFunction
  ): Promise<AgentResponse> {
    // Implementation for canceling meetings
    return {
      text: "Meeting cancellation is not yet implemented.",
      threadTs: context.threadTs
    };
  }

  private async rescheduleMeeting(
    context: ConversationContext,
    _say: SlackSayFunction
  ): Promise<AgentResponse> {
    // Implementation for rescheduling meetings
    return {
      text: "Meeting rescheduling is not yet implemented.",
      threadTs: context.threadTs
    };
  }

  // Helper methods
  private async resolveParticipants(participants: string[]): Promise<Array<{
    slackId: string;
    email: string;
    name: string;
  }>> {
    const resolved = [];
    
    for (const participant of participants) {
      // Remove @ symbol if present
      const cleanId = participant.replace(/^@/, '');
      
      try {
        const userInfo = await this.client.users.info({ user: cleanId });
        if (userInfo.user) {
          resolved.push({
            slackId: cleanId,
            email: userInfo.user.profile?.email || '',
            name: userInfo.user.real_name || userInfo.user.name || ''
          });
        }
      } catch (error) {
        console.error(`Failed to resolve participant ${participant}:`, error);
      }
    }
    
    return resolved;
  }

  private async getUserEmail(userId: string): Promise<string> {
    const userInfo = await this.client.users.info({ user: userId });
    return userInfo.user?.profile?.email || '';
  }

  private formatAlternativeTimes(times: Array<{formatted: string; timestamp: string; available: boolean}>): SlackBlock[] {
    return times.map(time => ({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `• ${time.formatted}`
      },
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: "Choose"
        },
        value: time.timestamp,
        action_id: `choose_time_${time.timestamp}`
      }
    }));
  }

  private formatCalendarEvents(events: Array<{time: string; title: string; attendees?: string}>, _userId: string): SlackBlock[] {
    return events.map(event => ({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${event.time}* - ${event.title}\n${event.attendees ? `With: ${event.attendees}` : ''}`
      }
    }));
  }
}

// Factory function for creating the agent
export function calendarAgent(client: WebClient): CalendarAgent {
  return new CalendarAgent(client);
}