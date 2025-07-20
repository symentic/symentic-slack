import OpenAI from 'openai';

export class OpenAIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });
  }

  async processMessage(
    message: string,
    _userId: string,
    _context: {
      channelId: string;
      threadTs: string;
      recentMessages: any[];
    }
  ): Promise<{
    intent: string;
    entities: any;
    shouldTriggerAgent: string | null;
    response: string;
  }> {
    const systemPrompt = `You are a helpful AI assistant for a software development team. 
Analyze the user's message and determine:
- The user's intent
- Any entities (bug descriptions, severity levels, etc.)
- Whether to trigger a specialized agent
- An appropriate response

IMPORTANT: If the message is casual conversation, a general question not related to work, or doesn't require any action from you, set response to empty string "".

Examples of when NOT to respond (response should be ""):
- "how many bugs are on the ceiling?"
- "you respond to everything?"
- General chatter between team members
- Questions not directed at you

Examples of when TO respond:
- Bug reports (any mention of bugs with actual context)
- Requests for help
- Meeting scheduling
- Direct questions about work tasks

SPECIAL HANDLING FOR BUGS:
- If someone mentions "bug" but it's clearly not a bug report (e.g., "how many bugs are on the ceiling?"), don't trigger bug triage
- If someone mentions "bug" with actual technical context (e.g., "there is a bug with the login"), trigger bug triage

Respond in JSON format with the following structure:
{
  "intent": "the identified intent",
  "entities": { "any": "extracted entities" },
  "shouldTriggerAgent": "agent-name or null",
  "response": "your response to the user OR empty string if no response needed"
}`;
  
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    try {
      const result = JSON.parse(completion.choices[0].message.content || '{}');
      return {
        intent: result.intent || 'unknown',
        entities: result.entities || {},
        shouldTriggerAgent: result.shouldTriggerAgent || null,
        response: result.response || 'I can help you with that. Can you provide more details?',
      };
    } catch (error) {
      console.error('Failed to parse OpenAI response:', error);
      return {
        intent: 'unknown',
        entities: {},
        shouldTriggerAgent: null,
        response: 'I can help you with that. Can you provide more details?',
      };
    }
  }

  async classifyBugReport(description: string, _context: any): Promise<{
    severity: 'low' | 'medium' | 'high' | 'critical';
    category: string;
    suggestedActions: string[];
  }> {
    const systemPrompt = `Classify this bug report and provide structured analysis.
Analyze the severity, category, and suggest next steps.

Respond in JSON format with:
{
  "severity": "low|medium|high|critical",
  "category": "string",
  "suggestedActions": ["action1", "action2"]
}`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: description },
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    try {
      const result = JSON.parse(completion.choices[0].message.content || '{}');
      return {
        severity: result.severity || 'medium',
        category: result.category || 'general',
        suggestedActions: result.suggestedActions || ['Investigate the issue', 'Gather more information'],
      };
    } catch (error) {
      console.error('Failed to parse bug classification:', error);
      return {
        severity: 'medium',
        category: 'general',
        suggestedActions: ['Investigate the issue', 'Gather more information'],
      };
    }
  }

  async generateBugTriageQuestions(bugData: any): Promise<string[]> {
    const systemPrompt = `Generate follow-up questions for bug triage based on the provided bug data.
Focus on gathering information needed to reproduce and fix the issue.

Respond in JSON format:
{
  "questions": ["question1", "question2", "question3"]
}`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(bugData) },
      ],
      temperature: 0.5,
      max_tokens: 200,
      response_format: { type: 'json_object' },
    });

    try {
      const result = JSON.parse(completion.choices[0].message.content || '{}');
      return result.questions || [
        'What steps did you take before encountering this issue?',
        'What was the expected behavior?',
        'Can you reproduce this consistently?',
      ];
    } catch (error) {
      console.error('Failed to generate triage questions:', error);
      return [
        'What steps did you take before encountering this issue?',
        'What was the expected behavior?',
        'Can you reproduce this consistently?',
      ];
    }
  }

  async analyzeUserResponse(response: string, bugContext: any): Promise<{
    response: string;
    additionalStakeholders: string[];
    action: string | null;
  }> {
    const systemPrompt = `Analyze this user response in the context of bug triage.
Determine:
1. An appropriate response
2. Any additional stakeholders who should be involved
3. Any actions to take (like spawning a notifier agent)

Respond in JSON format with this structure:
{
  "response": "your response text",
  "additionalStakeholders": ["list", "of", "usernames"],
  "action": "action to take or null"
}`;
  
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Response: ${response}\nContext: ${JSON.stringify(bugContext)}` },
      ],
      temperature: 0.5,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    try {
      const result = JSON.parse(completion.choices[0].message.content || '{}');
      return {
        response: result.response || 'Thank you for the additional information.',
        additionalStakeholders: result.additionalStakeholders || [],
        action: result.action || null,
      };
    } catch (error) {
      console.error('Failed to analyze user response:', error);
      return {
        response: 'Thank you for the additional information.',
        additionalStakeholders: [],
        action: null,
      };
    }
  }
}

// Singleton instance
export const openAIService = new OpenAIService();