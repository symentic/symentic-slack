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
  async detectBugSeverity(bugInfo: {
    description: string;
    impact?: string;
    errorMessages?: string;
  }): Promise<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    isEmergency: boolean;
    category?: string;
  }> {
    const systemPrompt = `You are a bug severity detector. Quickly determine the severity and emergency status of a bug report.

Severity levels:
- "critical": Platform down, all users affected, data loss, security breach
- "high": Major feature broken, many users affected, payment/login issues
- "medium": Feature partially working, some users affected
- "low": Minor issue, cosmetic bug

Emergency indicators:
- Words like: down, broken, can't access, all users, emergency, urgent, critical
- Payment/checkout failures
- Login/authentication failures
- Data loss or corruption

Respond with JSON: {"severity": "high", "isEmergency": false, "category": "Backend"}`;

    const userPrompt = `Bug: ${bugInfo.description}
${bugInfo.impact ? `Impact: ${bugInfo.impact}` : ''}
${bugInfo.errorMessages ? `Errors: ${bugInfo.errorMessages}` : ''}`;

    try {
      const response = await this.classifyWithModel(systemPrompt, userPrompt, 'gpt-4o-mini');
      return JSON.parse(response);
    } catch (error) {
      console.error('Severity detection failed:', error);
      // Default to medium severity
      return {
        severity: 'medium',
        isEmergency: false,
        category: 'General'
      };
    }
  }

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
    const systemPrompt = `You are an expert bug triage specialist analyzing a bug report to determine if enough information has been gathered.

CRITICAL: Be VERY strict about completeness scoring. We want detailed, comprehensive bug reports.

Analyze the provided bug report and:
1. Rate completeness from 0-100 based on:
   - 0-30: Minimal info (just a vague description like "payment bug" or "error 400")
   - 31-50: Basic info but missing critical details
   - 51-70: Has some details but still needs more for engineers to work with
   - 71-90: Good amount of detail but could use a bit more
   - 91-100: Comprehensive report with everything needed to start fixing

2. Rate quality from 1-10 (10 = crystal clear, actionable)
3. List specific missing information
4. Generate 2-3 contextual follow-up questions - IMPORTANT: Address the user directly using "you/your"
5. Categorize the bug type if possible
6. Rate your confidence in understanding the issue (0-1)
7. Determine severity level based on impact and urgency
8. Identify if this is an emergency requiring immediate attention

SCORING GUIDELINES:
- A bug report with just "payment system bug" should score ~10-15
- Adding "error 400" should only increase to ~20-25
- Need detailed reproduction steps, environment, impact to reach 70+
- Should have ALL of the following to reach 95+:
  * Detailed description (what exactly happens)
  * Step-by-step reproduction (exactly how to trigger)
  * Environment details (browser, OS, device, versions)
  * Error messages or console logs
  * User impact (how it affects their work)
  * Frequency/timing (when it started, how often)
  * What they expected vs what happened

Example scoring:
- "payment bug" = 10 points
- "payment bug, error 400" = 20 points
- "payment bug, error 400, happens on checkout" = 30 points
- "payment bug, error 400, happens on checkout with Visa cards" = 40 points
- Full details with steps, environment, logs, impact = 95+ points

Severity guidelines:
- "critical": Platform down, all users affected, data loss, security breach
- "high": Major feature broken, many users affected
- "medium": Feature partially working, some users affected
- "low": Minor issue, cosmetic bug

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

    // Use gpt-4o for all bug analysis for better quality
    const model = 'gpt-4o';
    
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
    acknowledgment?: string;
    questions: string[];
    priority: 'high' | 'medium' | 'low';
    reasoning: string;
  }> {
    const systemPrompt = `You are a friendly support engineer helping a user who is experiencing a bug. They ARE the person experiencing the issue, not someone reporting on behalf of others.

ABSOLUTELY FORBIDDEN - NEVER USE THESE:
- "Oh no!" (BANNED - DO NOT USE)
- "It sounds incredibly frustrating" (BANNED - TOO REPETITIVE)
- "must be incredibly frustrating" (BANNED - TOO REPETITIVE)

CONVERSATION FLOW:
1. ALWAYS acknowledge what the user just told you before asking a question
2. Show empathy and understanding about their frustration
3. Make your acknowledgment flow naturally into your question - they should feel connected
4. Ask ONLY ONE question at a time - this is a conversation, not a form
5. If they give brief answers (like "yes" or "sometimes"), ask for specifics
6. Stop asking questions when you have enough detail to help engineers fix the issue

ACKNOWLEDGMENT + QUESTION EXAMPLES (notice the natural flow and VARIETY):
- User: "payment bug" → "Payment issues can be really disruptive when you're trying to complete a purchase. What error message do you see when the payment fails?"
- User: "just completely fails" → "That's definitely not the experience we want you to have. Do you see any error message when this happens?"
- User: "error 400" → "Error 400 - that's a server error. When did you first notice this happening?"
- User: "yes, every time" → "Thanks for confirming it's consistent. Which payment method were you trying to use?"
- User: "just now" → "So this just started today - that helps narrow it down. What payment method are you using?"

CONVERSATION STYLE:
- Be conversational and empathetic about THEIR personal experience as a user
- CRITICAL: VARY your acknowledgments - NEVER start multiple responses with the same phrase!
- BANNED PHRASES (DO NOT USE repeatedly): "Oh no!", "It sounds frustrating", "must be incredibly frustrating"
- GOOD VARIETY: "That's frustrating", "I see", "Thanks for that information", "Error 400 indicates a server issue", "That helps narrow it down", "I understand", "Got it"
- Ask about what happens to THEM specifically when they try to use the product
- Never ask about "other users" or "your users" - they ARE the user
- Keep questions short and natural
- CRITICAL: Check conversation history - NEVER ask a question that was already answered!
- If user said "every time", don't ask about frequency again!
- If user said "Chrome on Windows", don't ask about browser again!
- NEVER mention business impacts like "lost sales", "customer trust", "revenue", etc. - they're a user, not a business owner!

GOOD QUESTIONS:
- "What error message do you see when this happens?"
- "Which payment method were you trying to use?"
- "Does this happen every time you try to pay?"
- "When did you first notice this issue?"

BAD QUESTIONS (DON'T ASK):
- "Are other users experiencing this?" (wrong - they can't know this)
- "How is this affecting your users?" (wrong - they ARE the user)
- "Do you know if this occurs for all users?" (wrong - irrelevant to them)

BAD ACKNOWLEDGMENTS (DON'T SAY):
- "This could lead to lost sales" (wrong - they're not a business owner)
- "This affects customer trust" (wrong - they ARE the customer)
- "This impacts revenue" (wrong - business perspective, not user perspective)

Previous Q&A pairs and current bug info will be provided. Generate appropriate follow-up questions or indicate if we have enough information.

CRITICAL REQUIREMENT: The "acknowledgment" field is MANDATORY and must ALWAYS contain an empathetic response.

For FIRST questions (when you see "No previous questions asked yet"):
- You MUST acknowledge the specific bug they reported with empathy
- Talk about THEIR frustration as a user trying to use the product
- Never mention business impacts (lost sales, revenue, customer trust)
- Focus on their personal experience

For FOLLOW-UP questions:
- You MUST acknowledge EACH piece of information they gave you
- Show you understood their answer before asking more
- Ask deeper, more specific follow-up questions based on what they said
- Continue the conversation naturally - don't stop just because they answered one question
- Keep gathering details until you have a COMPREHENSIVE bug report

Examples:
- Bug: "payment system bug" → "Payment issues are really frustrating when you're trying to make a purchase."
- Response: "error 400" → "Error 400 - that's a server error. Does this happen every time you try to pay, or just sometimes?"
- Response: "every time" → "That's really frustrating that it happens consistently! When did this first start happening?"
- Response: "just now" → "So this just started - that's helpful to know. What payment method are you using?"

IMPORTANT: Gather ONLY the ESSENTIAL details (aim for 3-4 of these):
1. Error message or behavior
2. When/where it happens
3. Frequency (always/sometimes)
4. Environment (browser/device)
5. What they tried

STOP after you have 3-4 key pieces of information. DO NOT keep asking for all 8 details!
Users get frustrated with too many questions. Quality over quantity!

WHEN TO STOP ASKING QUESTIONS:
You MUST ask EXACTLY 3 questions, then STOP.

CRITICAL RULES:
- If conversation count < 3: KEEP ASKING (regardless of information gathered)
- If conversation count = 3: STOP NOW! Return EMPTY questions array []
- NEVER ask more than 3 questions
- After the 3rd question is answered, immediately return empty questions array to create bug report

JSON Response (ALL fields required):
{
  "acknowledgment": "Your empathetic response (can be standalone if no more questions)",
  "questions": ["ONE QUESTION if needed, or EMPTY ARRAY [] if you have enough info"],
  "priority": "high|medium|low",
  "reasoning": "why this question or why stopping - BE SPECIFIC about what info you have"
}

CRITICAL: The acknowledgment and question should read as ONE continuous thought, not two separate statements!`;

    const conversationPairs = bugContext.previousQuestions.map((q, i) => ({
      question: q,
      response: bugContext.userResponses[i] || ''
    }));
    
    let userPrompt = `Initial Bug Report: ${bugContext.description}

Current Information Gathered:
${JSON.stringify(bugContext.currentInfo, null, 2)}

Conversation So Far:
${conversationPairs.length > 0 ? conversationPairs.map((pair, i) => 
  `Q${i+1}: ${pair.question}\nA${i+1}: ${pair.response}`
).join('\n\n') : 'No previous questions asked yet'}

${bugContext.userResponses.length > 0 ? `Latest User Response: "${bugContext.userResponses[bugContext.userResponses.length - 1]}"` : ''}

CRITICAL REMINDERS:
1. DO NOT ask about information already provided in the conversation above
2. DO NOT repeat questions that have been answered
3. DO NOT use "Oh no!" or similar dramatic phrases repeatedly
4. VARY your acknowledgments - each response should start differently

BEFORE RESPONDING, CHECK:
- How many questions have I asked? (Count: ${conversationPairs.length})
- If count < 3: MUST ASK ANOTHER QUESTION!
- If count = 3: MUST STOP! Return empty questions array []
- NEVER ask more than 3 questions!

CRITICAL: Ask EXACTLY 3 questions, no more, no less!

QUESTIONS ALREADY ANSWERED (DO NOT ASK AGAIN):
${conversationPairs.map((pair, i) => `Q${i+1}: "${pair.question}"\nA${i+1}: "${pair.response}"`).join('\n')}

INFORMATION ALREADY COLLECTED FROM CONVERSATION:
${Object.entries(bugContext.currentInfo).filter(([_, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

ESSENTIAL INFO COUNT CHECK:
${(() => {
  let count = 0;
  const info = bugContext.currentInfo;
  if (info.errorMessages || bugContext.description.includes('error')) count++;
  if (info.environment || conversationPairs.some(p => p.response.toLowerCase().includes('chrome') || p.response.toLowerCase().includes('windows'))) count++;
  if (info.frequency || conversationPairs.some(p => p.response.toLowerCase().includes('every time') || p.response.toLowerCase().includes('always'))) count++;
  if (info.reproductionSteps || conversationPairs.some(p => p.response.toLowerCase().includes('after') || p.response.toLowerCase().includes('when'))) count++;
  if (conversationPairs.some(p => p.response.toLowerCase().includes('tried'))) count++;
  return `You have ${count}/5 essential pieces of information. ${count >= 3 ? 'STOP NOW - You have enough!' : ''}`;
})()}

CONVERSATION LENGTH: ${conversationPairs.length} exchanges
${conversationPairs.length === 3 ? 'STOP NOW! You have asked 3 questions. Return empty questions array []!' : ''}
${conversationPairs.length < 3 ? `KEEP ASKING! You need exactly 3 questions. ${3 - conversationPairs.length} more to go!` : ''}`;

    // Add explicit check for repeated patterns
    if (conversationPairs.length > 0) {
      const lastAcknowledgments = conversationPairs.slice(-3).map((pair, i) => 
        `Previous response ${i+1} started with: "${pair?.question?.substring(0, 20) || ''}..."`
      ).join('\n');
      
      userPrompt += `\n\nDO NOT START YOUR RESPONSE LIKE ANY OF THESE:\n${lastAcknowledgments}`;
    }

    // Use gpt-4o for all bug triage for better quality
    const model = 'gpt-4o';
    
    try {
      const response = await this.classifyWithModel(systemPrompt, userPrompt, model);
      const result = JSON.parse(response);
      
      // Log for debugging
      console.log('OpenAI generateContextualFollowUps response:', JSON.stringify(result, null, 2));
      
      return {
        acknowledgment: result.acknowledgment,
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
    const systemPrompt = `Generate follow-up questions for bug triage. The person reporting IS the user experiencing the issue.

IMPORTANT:
- Ask about THEIR personal experience with the bug
- Never ask about "other users" or "all users"
- Keep questions conversational and direct

Examples of good questions:
- "What error message do you see?"
- "Which payment method were you using?"
- "Does this happen every time you try?"

BAD questions (don't generate):
- "Do other users experience this?"
- "Is this affecting all users?"

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
        'What steps did you take before this happened?',
        'What error message did you see?',
        'Does this happen every time you try?',
      ];
    } catch (error) {
      console.error('Failed to generate triage questions:', error);
      return [
        'What steps did you take before this happened?',
        'What error message did you see?',
        'Does this happen every time you try?',
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