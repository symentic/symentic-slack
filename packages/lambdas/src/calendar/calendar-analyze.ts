import { Handler } from 'aws-lambda';
import { openAIService } from '@symentic/core';

interface CalendarAnalyzeEvent {
  message: string;
  userId: string;
  channelId: string;
  threadTs?: string;
  workspaceId: string;
}

interface CalendarAnalyzeResult {
  intentType: 'schedule' | 'check' | 'ooo' | 'cancel' | 'reschedule';
  participants?: string[];
  dateTime?: string;
  duration?: number;
  meetingType?: string;
  reason?: string;
  timeRange?: {
    start: string;
    end: string;
  };
  rawData: Record<string, unknown>;
}

export const handler: Handler<CalendarAnalyzeEvent, CalendarAnalyzeResult> = async (event) => {
  console.log('Calendar analyze event:', JSON.stringify(event, null, 2));
  
  const { message, userId, channelId, workspaceId } = event;
  
  try {
    const systemPrompt = `You are analyzing a calendar-related request from a Slack user.
    
Determine the specific calendar intent and extract relevant information.

Intent types:
- "schedule": User wants to schedule a meeting (e.g., "set up a meeting with Leo and Richard")
- "check": User wants to check availability or calendar status (e.g., "when is Leo free?", "what's on my calendar today?")
- "ooo": User wants to mark themselves or someone as out of office (e.g., "I'm OOO tomorrow", "Mark me as out of office next week")
- "cancel": User wants to cancel a meeting
- "reschedule": User wants to reschedule an existing meeting

Extract:
1. Intent type (MUST be one of the above)
2. Participants (Slack user IDs or names mentioned)
3. Date/time information
4. Duration (default to 30 minutes if not specified)
5. Meeting type or purpose
6. For OOO: reason and time range

IMPORTANT:
- Extract actual Slack user mentions (like <@U123456>) as participants
- Parse natural language dates like "tomorrow", "next Tuesday", "in 2 hours"
- Default to 30-minute meetings unless specified
- For OOO requests, extract the full date range

Respond with JSON in this exact format:
{
  "intentType": "schedule",
  "participants": ["U123456", "Leo", "Richard"],
  "dateTime": "2024-01-15T14:00:00Z",
  "duration": 30,
  "meetingType": "discussion",
  "reason": "vacation",
  "timeRange": {
    "start": "2024-01-15",
    "end": "2024-01-17"
  },
  "rawData": {
    "originalMessage": "the original message",
    "parsedDate": "human readable date"
  }
}`;

    const userPrompt = `Message: "${message}"
User: ${userId}
Channel: ${channelId}
Workspace: ${workspaceId}
Current time: ${new Date().toISOString()}`;

    const response = await openAIService.classifyWithModel(
      systemPrompt,
      userPrompt,
      'gpt-4o-mini'
    );

    const result = JSON.parse(response);
    
    // Ensure we have a valid intent type
    const validIntents = ['schedule', 'check', 'ooo', 'cancel', 'reschedule'];
    if (!validIntents.includes(result.intentType)) {
      result.intentType = 'check'; // Default to check if unclear
    }
    
    // Store original message in rawData
    if (!result.rawData) {
      result.rawData = {};
    }
    result.rawData.originalMessage = message;
    
    console.log('Calendar analysis result:', JSON.stringify(result, null, 2));
    
    return result;
  } catch (error) {
    console.error('Calendar analysis failed:', error);
    
    // Return a default check intent on error
    return {
      intentType: 'check',
      rawData: {
        originalMessage: message,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
};