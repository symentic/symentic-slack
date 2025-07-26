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


    // Use GPT-4o-mini for simple, clear commands
    if (simplePatterns.some(pattern => pattern.test(message))) {
      return 'gpt-4o-mini';
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

    // For complex but non-emergency messages, use gpt-4o-mini
    // The specific agents (like bug triage) will use their own model preferences

    // Default to GPT-4o-mini (10 million free tokens per day)
    return 'gpt-4o-mini';
  }

  async classifyIntent(options: ClassificationOptions & { threadContext?: { hasBugTriage?: boolean } }): Promise<IntentResult> {
    const { message, userId, channelId, recentContext, threadContext } = options;
    
    // Pattern-based bug detection for common bug report phrases
    const bugPatterns = [
      /\b(error|errors)\s+(with|in)\s+\w+/i,
      /\b(payment|login|system|feature|api|server)\s+(error|issue|problem|bug)/i,
      /\b(error|issue|problem|bug)\s+(with|in)\s+(payment|login|system|feature|api|server)/i,
      /\b(not\s+working|broken|crashed|down|failed|failing)\b/i,
      /\b(bug:|issue:|error:|problem:)/i,
      /\bcannot\s+(login|pay|access|connect)/i,
      /\bunable\s+to\s+(login|pay|access|connect)/i,
      // More flexible patterns for typos and variations
      /\berror\s+with.{0,10}(payment|system|login|api)/i,
      /\b(there\s+is|there's)\s+(an?\s+)?(error|issue|problem|bug)/i,
      /\b(payment|system|login|api).{0,10}(error|issue|problem|not\s+work)/i,
      // Ultra-flexible patterns for common typos
      /error.*payment/i,
      /payment.*error/i,
      /error.*system/i,
      /system.*error/i
    ];
    
    const lowerMessage = message.toLowerCase();
    const isBugReport = bugPatterns.some(pattern => pattern.test(lowerMessage));
    
    if (isBugReport) {
      console.log('Pattern match detected for bug report!');
    }
    
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
- Feature not working, system down, payment failed, payment errors
- Code, API, database, server issues
- Performance problems, UI glitches
- Messages containing "error" with system names (payment system, login system, etc.)
- Messages about something not working or being broken

Special handling:
- If in a thread with active bug triage, classify follow-ups as "bug.response"
- Greetings (hi, hello, hey) should be "general.greeting"
- Questions about capabilities should be "general.help"
- Casual conversation or off-topic messages should be "general.chatter"
- "Cancel" or "stop" should map to appropriate cancel intent
- Physical bugs/insects should be "general.chatter"

Intent classification rules:
- Classify as bug.report when message contains: "error", "bug", "issue", "problem", "broken", "not working", "failed", "crash", "down" in technical context
- Phrases like "error with [system]", "[system] error", "[feature] not working" are strong bug indicators
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
${threadContext?.hasBugTriage ? 'IMPORTANT: This message is part of an active bug triage conversation. Classify as "bug.response" unless it\'s clearly "bug.cancel" (cancel, stop, nevermind, etc.)' : ''}
${isBugReport ? 'CRITICAL: This message matches bug report patterns. You MUST classify as "bug.report" with confidence >= 0.8 unless it explicitly mentions physical insects.' : ''}`;

    try {
      const response = await openAIService.classifyWithModel(
        systemPrompt,
        userPrompt,
        model
      );

      const classification = JSON.parse(response);
      
      console.log(`AI Classification: ${classification.intent} (${classification.confidence}), Pattern match: ${isBugReport}`);
      
      // Override classification if pattern strongly matches bug report but AI misclassified
      if (isBugReport && classification.intent !== 'bug.report') {
        console.log(`Pattern override: Forcing bug.report classification (was ${classification.intent})`);
        return {
          intent: 'bug.report',
          confidence: Math.max(0.8, classification.confidence),
          entities: classification.entities || {},
          modelUsed: model,
          requiresFollowUp: classification.missingInfo || []
        };
      }
      
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
    const simpleMessages = messages.filter(m => this.selectModel(m.message) === 'gpt-4o-mini');
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