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
    
    // Quick filter disabled for demo - let ChatGPT handle all classification
    // const insectPatterns = [
    //   /\b(bug|bugs|insect|insects?)\s+(on|in)\s+(the|my)\s+(ceiling|wall|floor|room|house|office)/i,
    //   /\b(spider|ant|fly|flies|mosquito|roach|cockroach|beetle)s?\b/i,
    //   /\b(pest|infestation|exterminator)\b/i,
    //   /\b(crawling|flying)\s+(bug|insect)s?\b/i
    // ];
    // 
    // if (insectPatterns.some(pattern => pattern.test(message))) {
    //   return {
    //     intent: 'general.chatter',
    //     confidence: 0.9,
    //     entities: {},
    //     modelUsed: 'pattern-match',
    //     requiresFollowUp: []
    //   };
    // }
    
    const model = this.selectModel(message);

    const systemPrompt = `You are an intent classifier for a Slack bot that helps with software development tasks. Analyze the message and extract:
1. Primary intent (use dot notation like "calendar.schedule", "bug.report", "task.create")
2. Confidence level (0-1)
3. Entities (participants, dates, priorities, etc.)
4. Any missing required information

Available intents:
- calendar.schedule, calendar.check, calendar.cancel, calendar.reschedule
- bug.report, bug.status, bug.update, bug.response, bug.cancel (SOFTWARE/CODE BUGS ONLY)
- task.create, task.assign, task.status, task.complete
- reminder.set, reminder.list
- general.help, general.status, general.greeting, general.chatter, general.cancel
- query.search, query.ask

IMPORTANT: "bug.report" is ONLY for software bugs, coding errors, system issues, or technical problems.
DO NOT classify as "bug.report" for:
- Physical insects or pests (spiders, ants, flies, etc.)
- Physical defects in buildings or objects
- Non-technical issues

Context clues for software bugs:
- Error messages, crashes, unexpected behavior
- Feature not working, system down, payment failed
- Code, API, database, server issues
- Performance problems, UI glitches

Special handling:
- If in a thread with active bug triage, classify follow-ups as "bug.response"
- Greetings (hi, hello, hey) should be "general.greeting"
- Questions about capabilities should be "general.help"
- Casual conversation or off-topic messages should be "general.chatter"
- "Cancel" or "stop" should map to appropriate cancel intent
- Physical bugs/insects should be "general.chatter"

Intent classification rules:
- Only classify as bug.report for clear software/technical issues
- Only use general.greeting if the bot is specifically mentioned (e.g., "@symentic hi", "hello symentic")
- Only use general.help when explicitly asking what the bot can do
- For greetings without bot mention (just "hi", "hello"), use general.chatter
- When unsure or message is ambiguous, use general.chatter
- Set confidence < 0.5 for unclear intents

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