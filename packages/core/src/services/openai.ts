import OpenAI from 'openai';

export class OpenAIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });
  }

  // New method for intent classification with model selection
  async classifyWithModel(
    systemPrompt: string,
    userPrompt: string,
    model: 'gpt-3.5-turbo' | 'gpt-4o-mini' | 'gpt-4o' = 'gpt-4o-mini'
  ): Promise<string> {
    try {
      const completion = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3, // Lower temperature for more consistent classification
        max_tokens: 500,
        response_format: { type: "json_object" } // Ensure JSON response
      });

      return completion.choices[0]?.message?.content || '{}';
    } catch (error) {
      console.error(`Error with ${model}:`, error);
      throw error;
    }
  }

  // Helper to detect if this is an emergency/critical bug
  private isEmergencyBug(bugInfo: {
    description: string;
    impact?: string;
  }): boolean {
    const emergencyPatterns = [
      /\b(emergency|critical|urgent|severity.*high|sev\s*[01])\b/i,
      /\b(production|prod)\s+(down|outage|broken|failing)/i,
      /\b(all|entire|every)\s+(users?|customers?|team)\s+(affected|impacted|blocked)/i,
      /\b(data\s+loss|security\s+breach|payment\s+fail|revenue\s+impact)/i,
      /\b(cannot|can't|unable\s+to)\s+(login|access|use|work)/i,
      /\b(platform|system|site|everything|whole\s+platform)\s+(breaking|broken|down|not\s+loading|crashing)/i,
      /\b(not\s+loading|all\s+blank|nothing\s+works|completely\s+down)/i,
      /\b(huge\s+error|major\s+outage|catastrophic|total\s+failure)/i
    ];

    const fullText = `${bugInfo.description} ${bugInfo.impact || ''}`.toLowerCase();
    return emergencyPatterns.some(pattern => pattern.test(fullText));
  }

  // Analyze bug report quality and generate follow-up questions
  async analyzeBugReportQuality(bugInfo: {
    description: string;
    reproductionSteps?: string;
    environment?: string;
    impact?: string;
    errorMessages?: string;
    frequency?: string;
  }): Promise<{
    completenessScore: number; // 0-100
    qualityRating: number; // 1-10
    missingInformation: string[];
    followUpQuestions: string[];
    confidence: number; // 0-1
    category?: string; // UI, Performance, Security, etc.
    severity?: 'critical' | 'high' | 'medium' | 'low';
    isEmergency?: boolean;
  }> {
    const systemPrompt = `You are an expert bug triage specialist. Analyze the provided bug report and:
1. Rate completeness from 0-100 (100 = has all necessary info to start fixing)
2. Rate quality from 1-10 (10 = crystal clear, actionable)
3. List specific missing information
4. Generate 2-3 contextual follow-up questions (not generic) - IMPORTANT: Address the user directly using "you/your"
5. Categorize the bug type if possible
6. Rate your confidence in understanding the issue (0-1)
7. Determine severity level based on impact and urgency
8. Identify if this is an emergency requiring immediate attention

Consider these factors:
- Clear description of the problem
- Reproducible steps
- Environment details (browser, OS, versions)
- User impact and frequency
- Error messages or logs
- Expected vs actual behavior

Severity guidelines:
- "critical": Platform/system/site down or not loading, everything broken, whole platform issues, all users affected, production outage, data loss, security breach, revenue impact, customers cannot use the product
- "high": Major feature broken, many users affected, significant business impact, core functionality failing
- "medium": Feature partially working, some users affected, workaround available
- "low": Minor issue, cosmetic bug, minimal impact

IMPORTANT: If the user mentions "platform breaking", "not loading", "everything down", "whole platform", "all blank", or similar catastrophic failures, this is CRITICAL severity.

IMPORTANT: Respond with valid JSON in this exact format:
{
  "completenessScore": <number 0-100>,
  "qualityRating": <number 1-10>,
  "missingInformation": ["item1", "item2"],
  "followUpQuestions": ["question1 addressing user directly", "question2 using you/your"],
  "confidence": <number 0-1>,
  "category": "UI|Backend|Performance|Security|Other",
  "severity": "critical|high|medium|low",
  "isEmergency": <boolean>
}`;

    const userPrompt = `Bug Report:
Description: ${bugInfo.description}
${bugInfo.reproductionSteps ? `Reproduction Steps: ${bugInfo.reproductionSteps}` : 'Reproduction Steps: Not provided'}
${bugInfo.environment ? `Environment: ${bugInfo.environment}` : 'Environment: Not provided'}
${bugInfo.impact ? `Impact: ${bugInfo.impact}` : 'Impact: Not provided'}`;

    // Use gpt-4o for emergency/critical bugs, gpt-4o-mini for others
    const model = this.isEmergencyBug(bugInfo) ? 'gpt-4o' : 'gpt-4o-mini';
    
    try {
      const response = await this.classifyWithModel(systemPrompt, userPrompt, model);
      const analysis = JSON.parse(response);
      
      // Validate and ensure numeric values
      const completenessScore = typeof analysis.completenessScore === 'number' 
        ? Math.min(100, Math.max(0, analysis.completenessScore)) 
        : 0;
      
      const qualityRating = typeof analysis.qualityRating === 'number'
        ? Math.min(10, Math.max(1, analysis.qualityRating))
        : 1;
        
      const confidence = typeof analysis.confidence === 'number'
        ? Math.min(1, Math.max(0, analysis.confidence))
        : 0;
      
      // Force critical severity if emergency patterns are detected
      let severity = analysis.severity || 'medium';
      let isEmergency = analysis.isEmergency || false;
      
      if (this.isEmergencyBug(bugInfo)) {
        severity = 'critical';
        isEmergency = true;
      }
      
      return {
        completenessScore,
        qualityRating,
        missingInformation: Array.isArray(analysis.missingInformation) ? analysis.missingInformation : [],
        followUpQuestions: Array.isArray(analysis.followUpQuestions) ? analysis.followUpQuestions : [],
        confidence,
        category: analysis.category || 'general',
        severity,
        isEmergency
      };
    } catch (error) {
      console.error('Bug quality analysis failed:', error);
      
      // Check if this is an emergency bug even in fallback
      let fallbackSeverity: 'critical' | 'high' | 'medium' | 'low' = 'medium';
      let fallbackIsEmergency = false;
      
      if (this.isEmergencyBug(bugInfo)) {
        fallbackSeverity = 'critical';
        fallbackIsEmergency = true;
      }
      
      // Fallback response - but don't hardcode a low completeness score
      return {
        completenessScore: 0, // Let the caller calculate this
        qualityRating: 3,
        missingInformation: ['reproduction steps', 'environment details', 'impact'],
        followUpQuestions: [
          'Can you provide step-by-step instructions to reproduce this issue?',
          'What browser and operating system are you using?',
          'How often does this occur and how many users are affected?'
        ],
        confidence: 0.3,
        severity: fallbackSeverity,
        isEmergency: fallbackIsEmergency
      };
    }
  }

  async enhanceBugDescription(bugData: {
    description: string;
    reproductionSteps?: string;
    environment?: string;
    impact?: string;
    errorMessages?: string;
    severity?: string;
    category?: string;
  }): Promise<{
    enhancedDescription: string;
    enhancedSteps?: string;
    enhancedEnvironment?: string;
    enhancedImpact?: string;
  }> {
    const systemPrompt = `You are a technical writer helping to create clear, comprehensive bug reports.
Given the raw bug information (which may be very brief), expand it into proper sentences with technical context.

IMPORTANT: Transform brief phrases into complete, informative sentences. For example:
- Input: "Just broke entirely" → Output: "The user attempted to use the feature and encountered a complete failure with no fallback or error handling."
- Input: "During checkout" → Output: "The issue occurred in the checkout flow, likely when processing payment or order submission."
- Input: "Payment not processed" → Output: "Users are unable to complete transactions, resulting in failed payment processing and potential revenue loss."

Guidelines:
1. Convert ALL brief inputs into complete, professional sentences
2. Add technical context and likely scenarios based on the description
3. For reproduction steps: Create a numbered list with detailed steps, inferring logical flow
4. For environment: Include likely browser, OS, and relevant technical details
5. For impact: Describe specific business/user effects, quantify if possible
6. If input is already detailed, enhance it further with technical insights
7. Maintain the original meaning but make it much more comprehensive

Example enhancement:
- Description input: "error with payment system"
- Enhanced: "Users are experiencing errors when attempting to process payments through the system. The payment gateway appears to be failing or returning unexpected responses during transaction processing."

Respond in JSON format:
{
  "enhancedDescription": "Complete sentences describing the issue...",
  "enhancedSteps": "1. User navigates to...\n2. User attempts to...\n3. System fails with...",
  "enhancedEnvironment": "Issue observed during checkout process on production environment. Likely affecting multiple browsers and payment methods...",
  "enhancedImpact": "Critical business impact: Users cannot complete purchases, leading to immediate revenue loss and customer frustration..."
}`;

    const userPrompt = `Bug Information:
Description: ${bugData.description}
Reproduction Steps: ${bugData.reproductionSteps || 'Not provided'}
Environment: ${bugData.environment || 'Not specified'}
Impact: ${bugData.impact || 'Not specified'}
Error Messages: ${bugData.errorMessages || 'None provided'}
Severity: ${bugData.severity || 'Unknown'}
Category: ${bugData.category || 'General'}`;

    try {
      const response = await this.classifyWithModel(systemPrompt, userPrompt, 'gpt-4o-mini');
      const result = JSON.parse(response);
      
      return {
        enhancedDescription: result.enhancedDescription || bugData.description,
        enhancedSteps: result.enhancedSteps || bugData.reproductionSteps,
        enhancedEnvironment: result.enhancedEnvironment || bugData.environment,
        enhancedImpact: result.enhancedImpact || bugData.impact
      };
    } catch (error) {
      console.error('Bug enhancement failed:', error);
      // Return original data if enhancement fails
      return {
        enhancedDescription: bugData.description,
        enhancedSteps: bugData.reproductionSteps,
        enhancedEnvironment: bugData.environment,
        enhancedImpact: bugData.impact
      };
    }
  }

  // Generate contextual follow-up questions based on partial information
  async generateContextualFollowUps(bugContext: {
    description: string;
    currentInfo: Record<string, unknown>;
    previousQuestions: string[];
    userResponses: string[];
  }): Promise<{
    questions: string[];
    priority: 'high' | 'medium' | 'low';
    reasoning: string;
  }> {
    const systemPrompt = `You are helping gather complete bug report information. Based on the context:
1. Generate 2-3 specific follow-up questions to gather missing critical information
2. Avoid repeating previous questions
3. Make questions specific to the bug type and context
4. Prioritize questions that will most help developers fix the issue
5. Consider the user's technical level based on their responses
6. IMPORTANT: Address the user directly using "you" and "your" (e.g., "What error messages do you see?" not "What error messages do users see?")
7. Write questions as if speaking directly to the person reporting the bug

Respond in JSON format with questions array, priority, and reasoning.`;

    const userPrompt = `Bug: ${bugContext.description}
Current Information: ${JSON.stringify(bugContext.currentInfo, null, 2)}
Previous Questions Asked: ${bugContext.previousQuestions.join('; ')}
User Responses: ${bugContext.userResponses.join('; ')}`;

    // Use gpt-4o for emergency/critical bugs
    const model = this.isEmergencyBug({ 
      description: bugContext.description, 
      impact: bugContext.currentInfo.impact as string 
    }) ? 'gpt-4o' : 'gpt-4o-mini';
    
    try {
      const response = await this.classifyWithModel(systemPrompt, userPrompt, model);
      const result = JSON.parse(response);
      
      return {
        questions: result.questions || [],
        priority: result.priority || 'medium',
        reasoning: result.reasoning || ''
      };
    } catch (error) {
      console.error('Follow-up generation failed:', error);
      return {
        questions: ['Can you provide more details about when this issue occurs?'],
        priority: 'medium',
        reasoning: 'Unable to generate contextual questions'
      };
    }
  }

  async processMessage(
    message: string,
    _userId: string,
    _context: {
      channelId: string;
      threadTs: string;
      recentMessages: Array<{
        userId: string;
        text: string;
        ts: string;
        threadTs?: string;
      }>;
    }
  ): Promise<{
    intent: string;
    entities: Record<string, unknown>;
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
      model: 'gpt-4o-mini',
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

  async classifyBugReport(description: string, _context: Record<string, unknown>): Promise<{
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
      model: 'gpt-4o-mini',
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

  async generateBugTriageQuestions(bugData: {
    description: string;
    reproductionSteps?: string;
    severity?: string;
    environment?: string;
  }): Promise<string[]> {
    const systemPrompt = `Generate follow-up questions for bug triage based on the provided bug data.
Focus on gathering information needed to reproduce and fix the issue.

Respond in JSON format:
{
  "questions": ["question1", "question2", "question3"]
}`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
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

  async analyzeUserResponse(response: string, bugContext: {
    description: string;
    currentStep: string;
    previousResponses: string[];
  }): Promise<{
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
      model: 'gpt-4o-mini',
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