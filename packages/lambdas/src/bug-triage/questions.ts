import { Handler } from 'aws-lambda';
import { openAIService } from '@symentic/core';
import { WebClient } from '@slack/web-api';
import { BugReportData, ConversationPair, SlackBlock, SlackContext } from './types';

interface GenerateQuestionsEvent {
  analysis?: {
    Payload?: {
      completenessScore: number;
      missingInformation: string[];
      category?: string;
    };
    // Legacy fields for backward compatibility
    completenessScore?: number;
    missingInformation?: string[];
    category?: string;
  };
  bugReport: BugReportData | {
    Payload: BugReportData;
  };
  attemptCount: number;
  conversationHistory?: ConversationPair[];
  context?: SlackContext;
  threadTs?: string;
}

interface QuestionsResult {
  acknowledgment?: string;
  questions: string[];
  priority: 'high' | 'medium' | 'low';
  reasoning: string;
  conversationHistory?: ConversationPair[];
  shouldContinue?: boolean;
}

export const handler: Handler<GenerateQuestionsEvent, QuestionsResult> = async (event) => {
  // Handle Step Functions nested payload structure
  const analysisData = event.analysis?.Payload || event.analysis || {};
  
  try {
    // Initialize Slack client if context provided
    const slack = event.context ? new WebClient(event.context.slackClient || process.env.SLACK_BOT_TOKEN) : null;
    // Stop after 3 attempts (3 questions)
    if (event.attemptCount >= 3) {
      return {
        questions: [], // Stop asking questions
        priority: 'low',
        reasoning: '3 questions completed - creating bug report with current information'
      };
    }
    
    // Handle nested payload structure from Step Functions
    const bugReportData = 'Payload' in event.bugReport ? event.bugReport.Payload : event.bugReport;
    
    // Build conversation context
    const allInfo = [
      bugReportData.description,
      bugReportData.reproductionSteps,
      bugReportData.environment,
      bugReportData.impact,
      bugReportData.errorMessages
    ].filter(Boolean).join(' ');
    
    // Extract conversation history
    const conversationHistory = event.conversationHistory || [];
    const previousQuestions = conversationHistory.map(pair => pair.question);
    const userResponses = conversationHistory.map(pair => pair.response);
    
    // Generate contextual questions based on what's missing
    const result = await openAIService.generateContextualFollowUps({
      description: allInfo, // Include all available info for better context
      currentInfo: {
        // Include all fields from bugReportData
        ...bugReportData,
        // Ensure all expected fields are included
        reproductionSteps: bugReportData.reproductionSteps || '',
        environment: bugReportData.environment || '',
        impact: bugReportData.impact || '',
        errorMessages: bugReportData.errorMessages || '',
        frequency: bugReportData.frequency || ''
      },
      previousQuestions,
      userResponses
    });
    
    // Ensure we only get one question for natural conversation
    const questions = result.questions ? result.questions.slice(0, 1) : [];
    
    // Check if AI explicitly said to stop (empty questions array means we have enough info)
    const aiWantsToStop = result.questions && result.questions.length === 0;
    
    // HARDCODED: Stop after exactly 3 questions
    const hasExactlyThreeQuestions = conversationHistory.length >= 3;
    const shouldStop = hasExactlyThreeQuestions; // Always stop after 3 questions
    
    // Send to Slack if we have context and questions
    if (slack && event.context && event.threadTs && !shouldStop && questions.length > 0) {
      const acknowledgment = result.acknowledgment || '';
      
      // Build natural message
      let messageText = acknowledgment;
      if (questions.length > 0 && messageText && !messageText.includes('?')) {
        messageText += ' ' + questions[0];
      } else if (questions.length > 0 && !messageText) {
        messageText = questions[0];
      }
      
      const blocks: SlackBlock[] = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: messageText
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '_Feel free to answer in any order, or type "cancel" if you want to stop._'
            }
          ]
        }
      ];
      
      try {
        await slack.chat.postMessage({
          channel: event.context.channelId,
          thread_ts: event.threadTs,
          blocks
        });
      } catch (slackError) {
        console.error('Failed to send Slack message:', slackError);
        // Continue anyway - the state machine will handle the notification separately if needed
      }
    } else if (slack && event.context && event.threadTs && shouldStop) {
      // Send completion message
      try {
        await slack.chat.postMessage({
          channel: event.context.channelId,
          thread_ts: event.threadTs,
          text: "Great! I've collected enough information to create your bug report. Let me process this now..."
        });
      } catch (slackError) {
        console.error('Failed to send completion message:', slackError);
      }
    }
    
    return {
      acknowledgment: result.acknowledgment,
      questions: shouldStop ? [] : (questions.length > 0 ? questions : getDefaultQuestions(analysisData.missingInformation || []).slice(0, 1)),
      priority: result.priority,
      reasoning: result.reasoning + (hasExactlyThreeQuestions ? ' (3 questions completed)' : ` (${3 - conversationHistory.length} more questions needed)`),
      conversationHistory,
      shouldContinue: !shouldStop && questions.length > 0
    };
  } catch (error) {
    // Fallback questions - just one for conversation
    return {
      questions: getDefaultQuestions(analysisData.missingInformation || []).slice(0, 1),
      priority: 'medium',
      reasoning: 'Using default questions due to error'
    };
  }
};

function getDefaultQuestions(missingInfo: string[]): string[] {
  const defaultQuestions: Record<string, string> = {
    'reproduction steps': 'What are the exact steps you take to reproduce this issue?',
    'environment': 'What browser, operating system, and device are you using?',
    'impact': 'How is this affecting you and how critical is this for your work?',
    'frequency': 'How often do you experience this issue? Is it consistent or intermittent?',
    'error messages': 'Are there any error messages or console logs you can share?'
  };
  
  const questions = missingInfo
    .map(info => defaultQuestions[info.toLowerCase()] || `Can you provide more details about ${info}?`)
    .slice(0, 3);
  
  return questions.length > 0 ? questions : [
    'Can you provide step-by-step instructions to reproduce this issue?',
    'What environment are you experiencing this in?'
  ];
}