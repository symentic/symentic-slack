import { openAIService } from './openai';
import { IntentResult } from '../agents/base/BaseAgent';

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

Available intents:
- calendar.schedule, calendar.check, calendar.cancel, calendar.reschedule
- bug.report, bug.status, bug.update, bug.response, bug.cancel
- task.create, task.assign, task.status, task.complete
- reminder.set, reminder.list
- general.help, general.status, general.greeting, general.chatter, general.cancel
- query.search, query.ask

Special handling:
- If in a thread with active bug triage, classify follow-ups as "bug.response"
- Casual conversation or off-topic messages should be "general.chatter"
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
        requiresFollowUp: classification.missingInfo || []
      };
    } catch (error) {
      console.error('Intent classification failed:', error);
      
      // Fallback classification
      return {
        intent: 'general.help',
        confidence: 0.1,
        entities: { originalMessage: message },
        modelUsed: model,
        requiresFollowUp: []
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