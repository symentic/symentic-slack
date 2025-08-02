import { Handler } from 'aws-lambda';
import { openAIService } from '@symentic/core';

interface BugReportData {
  description: string;
  reproductionSteps?: string;
  environment?: string;
  impact?: string;
  errorMessages?: string;
  frequency?: string;
  reportedBy?: string;
  channel?: string;
  timestamp?: string;
  severity?: string;
}

interface ConversationPair {
  question: string;
  response: string;
}

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
  console.log('Generating follow-up questions:', JSON.stringify(event, null, 2));
  
  // Handle Step Functions nested payload structure
  const analysisData = event.analysis?.Payload || event.analysis || {};
  
  try {
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
    
    // Log if no acknowledgment was generated (for debugging)
    if (conversationHistory.length === 0 && !result.acknowledgment) {
      console.warn('WARNING: No acknowledgment generated for first questions. Bug description:', bugReportData.description);
    }
    
    // Ensure we only get one question for natural conversation
    const questions = result.questions ? result.questions.slice(0, 1) : [];
    
    // Log the result for debugging
    console.log('AI-generated result:', JSON.stringify(result, null, 2));
    console.log('Previous questions asked:', previousQuestions);
    console.log('User responses received:', userResponses);
    console.log('Current bug data:', JSON.stringify(bugReportData, null, 2));
    
    // Check if AI explicitly said to stop (empty questions array means we have enough info)
    const aiWantsToStop = result.questions && result.questions.length === 0;
    
    // HARDCODED: Stop after exactly 3 questions
    const hasExactlyThreeQuestions = conversationHistory.length >= 3;
    const shouldStop = hasExactlyThreeQuestions; // Always stop after 3 questions
    
    return {
      acknowledgment: result.acknowledgment,
      questions: shouldStop ? [] : (questions.length > 0 ? questions : getDefaultQuestions(analysisData.missingInformation || []).slice(0, 1)),
      priority: result.priority,
      reasoning: result.reasoning + (hasExactlyThreeQuestions ? ' (3 questions completed)' : ` (${3 - conversationHistory.length} more questions needed)`),
      conversationHistory,
      shouldContinue: !shouldStop && questions.length > 0
    };
  } catch (error) {
    console.error('Error generating questions:', error);
    
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