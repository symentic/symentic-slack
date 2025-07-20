import { WebClient } from '@slack/web-api';
import { redisService } from '../services/redis';
import { dynamoDBService } from '../services/dynamodb';
import { openAIService } from '../services/openai';
import { googleCalendarService } from '../services/googleCalendar';
import { slackService } from '../services/slack';

interface BugTriageState {
  step: 'initial' | 'awaiting_steps' | 'awaiting_severity' | 'complete';
  description: string;
  reproductionSteps?: string;
  severity?: 'low' | 'medium' | 'high';
  userId: string;
  channelId: string;
  threadTs: string;
  timestamp: string;
}

export class BugTriageAgent {
  private client: WebClient;

  constructor(client: WebClient) {
    this.client = client;
  }

  async handleBugReport(
    message: any,
    say: any,
    bugDescription: string
  ): Promise<void> {
    const userId = message.user;
    const channelId = message.channel;
    const threadTs = message.thread_ts || message.ts;

    // Initialize bug triage state
    const initialState: BugTriageState = {
      step: 'initial',
      description: bugDescription,
      userId,
      channelId,
      threadTs,
      timestamp: new Date().toISOString(),
    };

    await redisService.setBugTriageState(userId, threadTs, initialState);

    // Start triage conversation in thread
    await say({
      text: "🐛 I've detected a bug report. Let me help you triage this issue.",
      thread_ts: threadTs,
    });

    // Ask for reproduction steps
    await say({
      text: "Can you describe the steps to reproduce this bug?",
      thread_ts: threadTs,
    });

    // Update state
    initialState.step = 'awaiting_steps';
    await redisService.setBugTriageState(userId, threadTs, initialState);
  }

  async handleTriageResponse(
    message: any,
    say: any,
    state: BugTriageState
  ): Promise<void> {
    const response = message.text;
    const threadTs = message.thread_ts || message.ts;

    switch (state.step) {
      case 'awaiting_steps':
        // Save reproduction steps
        state.reproductionSteps = response;
        state.step = 'awaiting_severity';
        await redisService.setBugTriageState(state.userId, threadTs, state);

        // Ask for severity
        await say({
          text: "Thank you! What's the severity of this issue? (low/medium/high)",
          thread_ts: threadTs,
        });
        break;

      case 'awaiting_severity': {
        // Parse and validate severity
        const severity = response.toLowerCase().trim();
        if (!['low', 'medium', 'high'].includes(severity)) {
          await say({
            text: "Please specify the severity as: low, medium, or high",
            thread_ts: threadTs,
          });
          return;
        }

        state.severity = severity as 'low' | 'medium' | 'high';
        state.step = 'complete';
        await redisService.setBugTriageState(state.userId, threadTs, state);

        // Save bug report to DynamoDB
        const bugId = await dynamoDBService.saveBugReport({
          userId: state.userId,
          channelId: state.channelId,
          threadTs: state.threadTs,
          description: state.description,
          reproductionSteps: state.reproductionSteps,
          severity: state.severity,
          status: 'triaged',
        });

        await say({
          text: `✅ Thanks! Your bug has been logged (ID: ${bugId})`,
          thread_ts: threadTs,
        });

        // Track area expertise
        const experts = await openAIService.findRelevantExperts(
          state.description,
          { reproductionSteps: state.reproductionSteps, severity: state.severity }
        );

        // Create triage channel and schedule meeting
        await this.createTriageChannelAndScheduleMeeting(
          bugId,
          state,
          experts
        );
        break;
      }
    }
  }

  private async createTriageChannelAndScheduleMeeting(
    bugId: string,
    bugState: BugTriageState,
    expertUserIds: string[]
  ): Promise<void> {
    try {
      // Get user info for all participants - removed unused variables

      // Create private channel
      const channelName = `triage-${bugId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const createResult = await this.client.conversations.create({
        name: channelName,
        is_private: true,
      });

      const triageChannelId = createResult.channel!.id!;

      // Invite all participants
      const allUserIds = [bugState.userId, ...expertUserIds];
      await this.client.conversations.invite({
        channel: triageChannelId,
        users: allUserIds.join(','),
      });

      // Post bug summary
      const summary = `🐛 *Bug Triage Session*
*Bug ID:* ${bugId}
*Reporter:* <@${bugState.userId}>
*Severity:* ${bugState.severity}
*Description:* ${bugState.description}
*Steps to Reproduce:* ${bugState.reproductionSteps}

*Invited Experts:* ${expertUserIds.map(id => `<@${id}>`).join(', ')}`;

      await this.client.chat.postMessage({
        channel: triageChannelId,
        text: summary,
      });

      // Schedule meeting
      await this.scheduleBugTriageMeeting(
        bugId,
        bugState,
        allUserIds,
        triageChannelId
      );

    } catch (error) {
      console.error('Failed to create triage channel:', error);
      
      // Fallback: continue in thread
      await this.client.chat.postMessage({
        channel: bugState.channelId,
        thread_ts: bugState.threadTs,
        text: `I couldn't create a private channel, but I've notified the relevant experts: ${expertUserIds.map(id => `<@${id}>`).join(', ')}`,
      });
    }
  }

  private async scheduleBugTriageMeeting(
    bugId: string,
    bugState: BugTriageState,
    participantIds: string[],
    triageChannelId: string
  ): Promise<void> {
    try {
      // Find available time slot
      const freeSlots = await googleCalendarService.findFreeBusyTime(participantIds, 3);
      
      if (freeSlots.length === 0) {
        await this.client.chat.postMessage({
          channel: triageChannelId,
          text: "⚠️ I couldn't find a common available time slot in the next 3 business days. Please coordinate manually.",
        });
        return;
      }

      // Use the first available slot
      const selectedSlot = freeSlots[0];

      // Get participant emails
      const participantEmails = await Promise.all(
        participantIds.map(async (id) => {
          const user = await slackService.getUserInfo(id);
          return user.profile?.email || '';
        })
      );

      // Generate meeting details
      const meetingSummary = await openAIService.generateMeetingSummary(
        {
          bugId,
          description: bugState.description,
          severity: bugState.severity,
          reproductionSteps: bugState.reproductionSteps,
        },
        participantIds
      );

      // Create calendar event
      const { eventId, eventLink } = await googleCalendarService.createMeeting(
        participantIds[0], // Use first participant as organizer
        participantEmails.filter(email => email),
        `Bug Triage: ${bugId}`,
        meetingSummary,
        selectedSlot.start,
        selectedSlot.end
      );

      // Save meeting info
      await dynamoDBService.saveMeeting({
        bugId,
        eventId,
        eventLink,
        participants: participantIds,
        scheduledTime: selectedSlot.start.toISOString(),
        triageChannelId,
      });

      // Post meeting details
      const meetingTime = selectedSlot.start.toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        timeZone: 'America/New_York',
      });

      await this.client.chat.postMessage({
        channel: triageChannelId,
        text: `📅 *Meeting Scheduled*
*Time:* ${meetingTime} ET
*Duration:* 30 minutes
*Calendar Link:* ${eventLink}

I've sent calendar invites to all participants. See you there!`,
      });

    } catch (error) {
      console.error('Failed to schedule meeting:', error);
      
      await this.client.chat.postMessage({
        channel: triageChannelId,
        text: "⚠️ I couldn't automatically schedule a meeting. Please use this channel to coordinate a time that works for everyone.",
      });
    }
  }

  async handleFollowUp(
    message: any,
    say: any,
    bugId: string
  ): Promise<void> {
    const question = message.text;
    const bugReport = await dynamoDBService.getBugReport(bugId);

    if (!bugReport) {
      await say({
        text: "I couldn't find the bug report. Please check the bug ID.",
        thread_ts: message.thread_ts || message.ts,
      });
      return;
    }

    // Process follow-up with OpenAI
    const result = await openAIService.processFollowUpQuestion(question, {
      bugReport,
      currentChannel: message.channel,
    });

    // Send response
    await say({
      text: result.response,
      thread_ts: message.thread_ts || message.ts,
    });

    // Handle additional stakeholders if identified
    if (result.additionalStakeholders && result.additionalStakeholders.length > 0) {
      await this.inviteAdditionalStakeholders(
        message.channel,
        result.additionalStakeholders
      );
    }
  }

  private async inviteAdditionalStakeholders(
    channelId: string,
    userIds: string[]
  ): Promise<void> {
    try {
      await this.client.conversations.invite({
        channel: channelId,
        users: userIds.join(','),
      });

      await this.client.chat.postMessage({
        channel: channelId,
        text: `I've invited additional stakeholders: ${userIds.map(id => `<@${id}>`).join(', ')}`,
      });
    } catch (error) {
      console.error('Failed to invite stakeholders:', error);
    }
  }
}

// Export singleton instance
export const bugTriageAgent = (client: WebClient) => new BugTriageAgent(client);