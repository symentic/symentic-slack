import { openAIService } from './openai';
import { IntentResult } from '../types/domain';

interface ClassificationOptions {
  message: string;
  userId: string;
  channelId: string;
  recentContext?: string[];
}

export class IntentClassifier {
  // Decide which model to use based on message complexity
  private selectModel(message: string): 'gpt-3.5-turbo' | 'gpt-4o-mini' | 'gpt-4o' {
    const simplePatterns = [
      /^schedule .+ meeting/i,
      /^bug:/i,
      /^remind me/i,
      /^check calendar/i,
      /^create task/i,
      /^what's my schedule/i,
      /^cancel meeting/i
    ];


    // Use GPT-3.5 for simple, clear commands
    if (simplePatterns.some(pattern => pattern.test(message))) {
      return 'gpt-3.5-turbo';
    }

    // Check for emergency/critical indicators
    const emergencyIndicators = [
      /\b(emergency|critical|urgent|down|outage|broken)\b/i,
      /\b(production|prod)\s+(issue|bug|error|down)/i,
      /\b(all|everyone|entire)\s+(team|company|users?)\s+(affected|impacted|blocked)/i
    ];

    // Use GPT-4o only for emergency/critical situations
    if (emergencyIndicators.some(pattern => pattern.test(message))) {
      return 'gpt-4o';
    }

    // For complex but non-emergency messages, still use gpt-3.5-turbo for cost efficiency
    // The specific agents (like bug triage) will use their own model preferences

    // Default to GPT-3.5 for cost efficiency
    return 'gpt-3.5-turbo';
  }

  async classifyIntent(options: ClassificationOptions & { threadContext?: { hasBugTriage?: boolean } }): Promise<IntentResult> {
    const { message, userId, channelId, recentContext, threadContext } = options;
    const model = this.selectModel(message);

    const systemPrompt = `You are an intent classifier for a Slack bot. Analyze the message and extract:
1. Primary intent (use dot notation like "calendar.schedule", "bug.report", "task.create")
2. Confidence level (0-1)
3. Entities (participants, dates, priorities, etc.)
4. Any missing required information
5. shouldRespond: boolean - whether the bot should respond to this message

Available intents:
- calendar.schedule, calendar.check, calendar.cancel, calendar.reschedule, calendar.query
- bug.report, bug.status, bug.update, bug.response, bug.cancel
- task.create, task.assign, task.status, task.complete
- reminder.set, reminder.list
- general.help, general.status, general.greeting, general.chatter, general.cancel
- query.search, query.ask

For calendar intents:
- "what's my schedule", "show my calendar", "what meetings do I have" → calendar.check
- "am I free at", "do I have time" → calendar.query
- "schedule a meeting", "book time with" → calendar.schedule

IMPORTANT: Set shouldRespond to true ONLY when:
- The message is clearly asking for bot assistance (calendar, scheduling, bug reports, tasks)
- The message contains explicit requests like "show my calendar", "schedule a meeting", "bug:"
- The user is directly addressing the bot's capabilities

Set shouldRespond to false when:
- General conversation between humans (e.g., "hello", "thanks", "sounds good")
- Ambiguous messages that aren't clearly requests for bot help
- Messages that don't relate to the bot's capabilities
- Simple acknowledgments or casual chat

Special handling:
- If in a thread with active bug triage, classify follow-ups as "bug.response" and set shouldRespond=true
- Casual conversation or off-topic messages should be "general.chatter" with shouldRespond=false
- "Cancel" or "stop" should map to appropriate cancel intent

Respond in JSON format only.`;

    const userPrompt = `Message: "${message}"
User: ${userId}
Channel: ${channelId}
${recentContext ? `Recent context: ${recentContext.join(' | ')}` : ''}
${threadContext?.hasBugTriage ? 'IMPORTANT: This message is part of an active bug triage conversation. Classify as "bug.response" unless it\'s clearly "bug.cancel" (cancel, stop, nevermind, etc.)' : ''}`;

    try {
      const response = await openAIService.classifyWithModel(
        systemPrompt,
        userPrompt,
        model
      );

      const classification = JSON.parse(response);
      
      // Ensure all required fields
      return {
        intent: classification.intent || 'general.help',
        confidence: classification.confidence || 0.5,
        entities: classification.entities || {},
        modelUsed: model,
        requiresFollowUp: classification.missingInfo || [],
        shouldRespond: classification.shouldRespond ?? false
      };
    } catch (error) {
      console.error('Intent classification failed:', error);
      
      // Fallback classification
      return {
        intent: 'general.help',
        confidence: 0.1,
        entities: { originalMessage: message },
        modelUsed: model,
        requiresFollowUp: [],
        shouldRespond: false
      };
    }
  }

  // Batch classify multiple messages for efficiency
  async batchClassify(messages: ClassificationOptions[]): Promise<IntentResult[]> {
    // For simple messages, batch them to GPT-3.5
    // For complex ones, process individually with GPT-4
    const simpleMessages = messages.filter(m => this.selectModel(m.message) === 'gpt-3.5-turbo');
    const complexMessages = messages.filter(m => ['gpt-4o-mini', 'gpt-4o'].includes(this.selectModel(m.message)));

    const results: IntentResult[] = [];

    // Batch process simple messages
    if (simpleMessages.length > 0) {
      // Implementation for batch processing
      // This would combine multiple messages into one API call
    }

    // Process complex messages individually
    for (const msg of complexMessages) {
      const result = await this.classifyIntent(msg);
      results.push(result);
    }

    return results;
  }
}

// Singleton instance
export const intentClassifier = new IntentClassifier();