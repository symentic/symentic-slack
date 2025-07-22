import { BaseAgent, ConversationContext, AgentResponse, AgentConfig } from './base/BaseAgent';
import { WebClient } from '@slack/web-api';
import { redisService } from '../services/redis';
import { dynamoDBService } from '../services/dynamodb';
import { openAIService } from '../services/openai';
import { googleCalendarService } from '../services/googleCalendar';
import { SlackSayFunction } from '../types/slack';
import { BugReport, Engineer } from '../types/domain';

const BUG_TRIAGE_CONFIG: AgentConfig = {
  name: 'BugTriageAgent',
  description: 'Intelligent bug triage agent that gathers comprehensive bug information',
  intents: [
    'bug.report',
    'bug.triage',
    'bug.finalize',
    'issue.report',
    'problem.report',
    'error.report'
  ],
  priority: 2,
  requiredServices: ['openai', 'redis', 'dynamodb', 'slack'],
  modelPreference: 'gpt-4o-mini' // Cost-effective model for bug triage intelligence
};

interface EnhancedBugTriageState {
  step: 'initial' | 'gathering_details' | 'analyzing_quality' | 'requesting_more_info' | 'finalizing' | 'complete';
  description: string;
  reproductionSteps?: string;
  environment?: string;
  impact?: string;
  severity?: 'low' | 'medium' | 'high';
  completenessScore: number;
  qualityRating: number;
  missingInformation: string[];
  previousQuestions: string[];
  userResponses: string[];
  attemptCount: number;
  category?: string;
  confidence: number;
  userId: string;
  channelId: string;
  threadTs: string;
  timestamp: string;
  lastUpdated: string;
}

export class BugTriageAgent extends BaseAgent {
  constructor(client: WebClient) {
    super(client, BUG_TRIAGE_CONFIG);
  }

  async handle(
    context: ConversationContext,
    say: SlackSayFunction
  ): Promise<AgentResponse> {
    const { userId, threadTs, intent } = context;

    // Check if this is a severity selection from button
    if (intent.intent === 'bug.finalize' && intent.entities?.severity) {
      const existingState = await redisService.getBugTriageState(userId, threadTs) as EnhancedBugTriageState | null;
      if (existingState) {
        existingState.severity = intent.entities.severity as 'low' | 'medium' | 'high';
        return await this.finalizeBugReport(existingState, say);
      }
    }

    // Check if this is a continuation of an existing bug triage
    const existingState = await redisService.getBugTriageState(userId, threadTs) as EnhancedBugTriageState | null;
    if (existingState && existingState.step !== 'complete') {
      return await this.handleTriageResponse(context, say, existingState);
    }

    // Start new bug triage
    return await this.initiateBugTriage(context, say);
  }

  private async initiateBugTriage(
    context: ConversationContext,
    say: SlackSayFunction
  ): Promise<AgentResponse> {
    const { userId, channelId, threadTs, originalText } = context;

    // Extract initial bug description from the message
    const bugDescription = this.extractBugDescription(originalText);

    // Analyze initial quality
    const initialAnalysis = await openAIService.analyzeBugReportQuality({
      description: bugDescription
    });

    // Initialize state
    const initialState: EnhancedBugTriageState = {
      step: 'gathering_details',
      description: bugDescription,
      completenessScore: initialAnalysis.completenessScore,
      qualityRating: initialAnalysis.qualityRating,
      missingInformation: initialAnalysis.missingInformation,
      previousQuestions: [],
      userResponses: [],
      attemptCount: 0,
      category: initialAnalysis.category,
      confidence: initialAnalysis.confidence,
      userId,
      channelId,
      threadTs,
      timestamp: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };

    await redisService.setBugTriageState(userId, threadTs, initialState);

    // Send initial response with quality-based approach
    if (initialAnalysis.completenessScore >= 80) {
      // High quality initial report - just confirm and finalize
      await say({
        text: `🐛 Thank you for the detailed bug report! I've analyzed your submission:`,
        thread_ts: threadTs,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Bug Report Quality: ${initialAnalysis.qualityRating}/10* ✨\n*Completeness: ${initialAnalysis.completenessScore}%*\n*Category:* ${initialAnalysis.category || 'General'}`
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Your report is comprehensive! Let me just confirm the severity level to finalize the triage."
            }
          }
        ]
      });

      return {
        text: "High quality bug report received",
        threadTs,
        shouldStore: true,
        metadata: { state: 'high_quality_initial' }
      };
    }

    // Need more information - ask intelligent follow-ups
    const followUpQuestions = initialAnalysis.followUpQuestions.slice(0, 2);
    
    await say({
      text: `🐛 I've detected a bug report. Let me help you provide the information our developers need.`,
      thread_ts: threadTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Initial Analysis:*\n• Quality: ${initialAnalysis.qualityRating}/10\n• Completeness: ${initialAnalysis.completenessScore}%\n• Missing: ${initialAnalysis.missingInformation.join(', ')}`
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*To help our team fix this quickly, I need a bit more information:*"
          }
        },
        ...followUpQuestions.map((question, index) => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${index + 1}. ${question}`
          }
        }))
      ]
    });

    // Update state with questions asked
    await redisService.updateBugTriageState(userId, threadTs, {
      previousQuestions: followUpQuestions
    });

    return {
      text: "Bug triage initiated with intelligent follow-ups",
      threadTs,
      shouldStore: true,
      metadata: { 
        state: 'gathering_information',
        questionsAsked: followUpQuestions.length
      }
    };
  }

  private async handleTriageResponse(
    context: ConversationContext,
    say: SlackSayFunction,
    state: EnhancedBugTriageState
  ): Promise<AgentResponse> {
    const { userId, threadTs, originalText } = context;
    const userResponse = originalText.trim();

    // Add response to history
    state.userResponses.push(userResponse);
    state.attemptCount++;

    // Check if user is trying to exit
    if (this.isExitAttempt(userResponse)) {
      return await this.handleExitAttempt(state, say);
    }

    // Analyze the response quality
    const responseAnalysis = await this.analyzeUserResponse(state, userResponse);

    // Update state with new information
    if (responseAnalysis.extractedInfo) {
      state = {
        ...state,
        ...responseAnalysis.extractedInfo,
        completenessScore: responseAnalysis.newCompletenessScore,
        lastUpdated: new Date().toISOString()
      };
    }

    // Check if we have enough information (80% threshold)
    if (state.completenessScore >= 80) {
      return await this.finalizeBugReport(state, say);
    }

    // Check attempt limit (max 5 attempts)
    if (state.attemptCount >= 5) {
      return await this.handleMaxAttempts(state, say);
    }

    // Generate new contextual follow-ups
    const followUpResult = await openAIService.generateContextualFollowUps({
      description: state.description,
      currentInfo: {
        reproductionSteps: state.reproductionSteps,
        environment: state.environment,
        impact: state.impact
      },
      previousQuestions: state.previousQuestions,
      userResponses: state.userResponses
    });

    // Ask follow-up questions
    await say({
      text: "Thanks for that information! I need a bit more detail:",
      thread_ts: threadTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Current completeness: ${state.completenessScore}%* (Need 80% to proceed)\n*Still missing:* ${state.missingInformation.join(', ')}`
          }
        },
        {
          type: "divider"
        },
        ...followUpResult.questions.map((question, index) => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${index + 1}. ${question}`
          }
        }))
      ]
    });

    // Update state
    state.previousQuestions.push(...followUpResult.questions);
    state.step = 'gathering_details';
    await redisService.setBugTriageState(userId, threadTs, state);

    return {
      text: "Gathering more bug details",
      threadTs,
      shouldStore: true,
      metadata: {
        completeness: state.completenessScore,
        attemptCount: state.attemptCount
      }
    };
  }

  private async analyzeUserResponse(
    state: EnhancedBugTriageState,
    response: string
  ): Promise<{
    extractedInfo: Partial<EnhancedBugTriageState>;
    newCompletenessScore: number;
    confidence: number;
  }> {
    // Use GPT-4 to extract structured information from the response
    const systemPrompt = `Analyze this bug triage response and extract any relevant information.
Current bug description: ${state.description}
Questions asked: ${state.previousQuestions.join('; ')}

Extract and structure any information about:
- Reproduction steps
- Environment details (browser, OS, versions)
- Impact description
- Error messages
- Frequency

Also calculate new completeness score (0-100) based on all information gathered.
Respond in JSON format.`;

    try {
      const analysis = await openAIService.classifyWithModel(
        systemPrompt,
        `User response: ${response}`,
        'gpt-4o-mini'
      );
      
      const result = JSON.parse(analysis);
      
      // Merge extracted info with existing state
      const extractedInfo: Partial<EnhancedBugTriageState> = {};
      if (result.reproductionSteps && !state.reproductionSteps) {
        extractedInfo.reproductionSteps = result.reproductionSteps;
      }
      if (result.environment) {
        extractedInfo.environment = state.environment 
          ? `${state.environment}\n${result.environment}`
          : result.environment;
      }
      if (result.impact) {
        extractedInfo.impact = result.impact;
      }

      // Recalculate completeness with all current info
      const fullInfo = {
        description: state.description,
        reproductionSteps: extractedInfo.reproductionSteps || state.reproductionSteps,
        environment: extractedInfo.environment || state.environment,
        impact: extractedInfo.impact || state.impact
      };

      const qualityCheck = await openAIService.analyzeBugReportQuality(fullInfo);

      return {
        extractedInfo,
        newCompletenessScore: qualityCheck.completenessScore,
        confidence: result.confidence || 0.7
      };
    } catch (error) {
      console.error('Failed to analyze response:', error);
      return {
        extractedInfo: {},
        newCompletenessScore: state.completenessScore + 5, // Small increment
        confidence: 0.3
      };
    }
  }

  private async finalizeBugReport(
    state: EnhancedBugTriageState,
    say: SlackSayFunction
  ): Promise<AgentResponse> {
    // Ask for severity if not provided
    if (!state.severity) {
      await say({
        text: "Great! I have enough information. Just one more thing:",
        thread_ts: state.threadTs,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*How would you rate the severity of this bug?*"
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "🟢 Low" },
                value: "low",
                action_id: "severity_low"
              },
              {
                type: "button",
                text: { type: "plain_text", text: "🟡 Medium" },
                value: "medium", 
                action_id: "severity_medium"
              },
              {
                type: "button",
                text: { type: "plain_text", text: "🔴 High" },
                value: "high",
                action_id: "severity_high"
              }
            ]
          }
        ]
      });

      state.step = 'finalizing';
      await redisService.setBugTriageState(state.userId, state.threadTs, state);

      return {
        text: "Awaiting severity selection",
        threadTs: state.threadTs,
        shouldStore: true
      };
    }

    // Create comprehensive bug report
    const bugReport = await this.createBugReport(state);

    // Find relevant engineers
    const engineers = await this.findRelevantEngineers(state);

    // Create triage channel if high severity
    if (state.severity === 'high' && engineers.length > 0) {
      await this.createTriageChannel(bugReport, engineers, say);
    }

    // Send confirmation
    await say({
      text: "✅ Bug report created successfully!",
      thread_ts: state.threadTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Bug Report #${bugReport.bugId}*\n*Category:* ${state.category || 'General'}\n*Severity:* ${state.severity}\n*Completeness:* ${state.completenessScore}%`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Description:* ${state.description}\n*Impact:* ${state.impact || 'Not specified'}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: engineers.length > 0 
              ? `*Assigned to:* ${engineers.map(e => `<@${e.userId}>`).join(', ')}`
              : "*Status:* Added to backlog for triage"
          }
        }
      ]
    });

    // Mark as complete
    state.step = 'complete';
    await redisService.setBugTriageState(state.userId, state.threadTs, state);

    return {
      text: `Bug report ${bugReport.bugId} created`,
      threadTs: state.threadTs,
      shouldStore: true,
      metadata: {
        bugId: bugReport.bugId,
        completeness: state.completenessScore
      }
    };
  }

  private async createBugReport(state: EnhancedBugTriageState): Promise<BugReport> {
    const bugId = `BUG-${Date.now()}`;
    
    const bugReport = {
      bugId,
      userId: state.userId,
      channelId: state.channelId,
      threadTs: state.threadTs,
      description: state.description,
      reproductionSteps: state.reproductionSteps || 'Not provided',
      environment: state.environment || 'Not specified',
      impact: state.impact || 'Not specified',
      severity: state.severity || 'medium',
      category: state.category,
      completenessScore: state.completenessScore,
      qualityRating: state.qualityRating,
      confidence: state.confidence,
      status: 'open' as const,
      createdAt: new Date().toISOString(),
      conversations: {
        questions: state.previousQuestions,
        responses: state.userResponses
      }
    };

    await dynamoDBService.saveBugReport(bugReport);
    return bugReport;
  }

  private async findRelevantEngineers(state: EnhancedBugTriageState): Promise<Engineer[]> {
    // Extract keywords from bug description and category
    const keywords: string[] = [];
    
    // Add category as keyword
    if (state.category) {
      keywords.push(state.category.toLowerCase());
    }
    
    // Extract technical keywords from description
    const techKeywords = this.extractTechKeywords(state.description);
    keywords.push(...techKeywords);
    
    // Find engineers with matching expertise
    const engineers = await dynamoDBService.findEngineersForArea(
      state.category || 'general',
      keywords
    );
    
    // Map to Engineer type with proper level type
    return engineers.map(e => ({
      userId: e.userId,
      level: e.level as 'expert' | 'intermediate' | 'beginner',
      matchScore: e.matchScore
    }));
  }

  private extractTechKeywords(text: string): string[] {
    // Common technical keywords to look for
    const techPatterns = [
      /\b(api|frontend|backend|database|ui|ux|performance|security|auth|login|payment|integration)\b/gi,
      /\b(react|vue|angular|node|python|java|typescript|javascript|sql|graphql|rest)\b/gi,
      /\b(aws|azure|gcp|docker|kubernetes|ci\/cd|deployment|infrastructure)\b/gi
    ];
    
    const keywords = new Set<string>();
    
    techPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => keywords.add(match.toLowerCase()));
      }
    });
    
    return Array.from(keywords);
  }

  private async createTriageChannel(
    bugReport: BugReport, 
    engineers: Engineer[], 
    say: SlackSayFunction
  ): Promise<void> {
    try {
      // Create channel name
      const channelName = `triage-${bugReport.bugId.toLowerCase()}`;
      
      // Create private channel
      const channelResult = await this.client.conversations.create({
        name: channelName,
        is_private: true
      });
      
      if (!channelResult.channel) {
        throw new Error('Failed to create channel');
      }
      
      const channelId = channelResult.channel.id!;
      
      // Invite engineers to channel
      const userIds = [bugReport.userId, ...engineers.map(e => e.userId)];
      await this.client.conversations.invite({
        channel: channelId,
        users: userIds.join(',')
      });
      
      // Post initial message with bug details
      await this.client.chat.postMessage({
        channel: channelId,
        text: 'Bug Triage Channel Created',
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `🐛 Bug Triage: ${bugReport.bugId}`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Reporter:* <@${bugReport.userId}>\n*Severity:* ${bugReport.severity}\n*Category:* ${bugReport.category || 'General'}\n*Completeness:* ${bugReport.completenessScore}%`
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Description:*\n${bugReport.description}`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Reproduction Steps:*\n${bugReport.reproductionSteps || 'Not provided'}`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Environment:*\n${bugReport.environment || 'Not specified'}`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Impact:*\n${bugReport.impact || 'Not specified'}`
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Selected Engineers:*\n${engineers.map(e => `• <@${e.userId}> (${e.level}, score: ${e.matchScore})`).join('\n')}`
            }
          }
        ]
      });
      
      // Schedule meeting if high severity
      if (bugReport.severity === 'high' && engineers.length > 0) {
        // Get emails for participants
        const participantEmails: string[] = [];
        for (const userId of userIds) {
          try {
            const userInfo = await this.client.users.info({ user: userId });
            if (userInfo.user?.profile?.email) {
              participantEmails.push(userInfo.user.profile.email);
            }
          } catch (error) {
            console.error(`Failed to get email for user ${userId}:`, error);
          }
        }
        
        if (participantEmails.length > 0) {
          // Find available time in next 2 days
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(10, 0, 0, 0);
          
          const availability = await googleCalendarService.checkAvailability(
            participantEmails,
            tomorrow.toISOString(),
            30 // 30 minute meeting
          );
          
          if (availability.allAvailable) {
            // Schedule the meeting
            const endTime = new Date(tomorrow);
            endTime.setMinutes(endTime.getMinutes() + 30);
            
            const meeting = await googleCalendarService.createMeeting(
              bugReport.userId,
              participantEmails.filter(e => e !== participantEmails[0]), // Exclude organizer
              `Bug Triage: ${bugReport.bugId}`,
              `Triage meeting for bug: ${bugReport.description}\n\nSeverity: ${bugReport.severity}\nChannel: ${channelName}`,
              tomorrow,
              endTime
            );
            
            // Post meeting details
            await this.client.chat.postMessage({
              channel: channelId,
              text: `📅 Meeting scheduled for ${tomorrow.toLocaleString()}`,
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `📅 *Triage Meeting Scheduled*\n*Time:* ${tomorrow.toLocaleString()}\n*Duration:* 30 minutes\n<${meeting.eventLink}|Join Google Meet>`
                  }
                }
              ]
            });
          } else {
            // Post about conflicts
            await this.client.chat.postMessage({
              channel: channelId,
              text: 'Unable to find common meeting time. Please coordinate directly.'
            });
          }
        }
      }
      
      // Notify in original thread
      await say({
        text: `Created private triage channel: <#${channelId}>`,
        thread_ts: bugReport.threadTs
      });
      
    } catch (error) {
      console.error('Failed to create triage channel:', error);
      await say({
        text: 'Failed to create triage channel. Please create one manually.',
        thread_ts: bugReport.threadTs
      });
    }
  }

  private extractBugDescription(text: string): string {
    // Extract bug description from various formats
    const patterns = [
      /bug:\s*(.+)/i,
      /there is a bug(?:\s+with)?\s*(.+)/i,
      /found a bug(?:\s+in)?\s*(.+)/i,
      /issue:\s*(.+)/i,
      /problem:\s*(.+)/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return text; // Use full text as description
  }

  private isExitAttempt(response: string): boolean {
    const exitPhrases = ['cancel', 'stop', 'never mind', 'forget it', 'exit'];
    return exitPhrases.some(phrase => response.toLowerCase().includes(phrase));
  }

  private async handleExitAttempt(state: EnhancedBugTriageState, say: SlackSayFunction): Promise<AgentResponse> {
    await say({
      text: "No problem! I've cancelled the bug report. Feel free to report it again when you have more details.",
      thread_ts: state.threadTs
    });

    state.step = 'complete';
    await redisService.setBugTriageState(state.userId, state.threadTs, state);

    return {
      text: "Bug triage cancelled by user",
      threadTs: state.threadTs,
      shouldStore: false
    };
  }

  private async handleMaxAttempts(state: EnhancedBugTriageState, say: SlackSayFunction): Promise<AgentResponse> {
    await say({
      text: `I've gathered what I can (${state.completenessScore}% complete). Creating bug report with available information.`,
      thread_ts: state.threadTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "⚠️ *Partial Bug Report*\nI'll create the report with the information provided. You can always add more details later."
          }
        }
      ]
    });

    // Force severity to low for incomplete reports
    state.severity = 'low';
    return await this.finalizeBugReport(state, say);
  }
}

// Factory function
export function bugTriageAgent(client: WebClient): BugTriageAgent {
  return new BugTriageAgent(client);
}