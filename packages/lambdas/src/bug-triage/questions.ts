import { Handler } from 'aws-lambda';
import { openAIService } from '@symentic/core';

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
  bugReport: {
    description: string;
    reproductionSteps?: string;
    environment?: string;
  };
  attemptCount: number;
}

interface QuestionsResult {
  questions: string[];
  priority: 'high' | 'medium' | 'low';
  reasoning: string;
}

export const handler: Handler<GenerateQuestionsEvent, QuestionsResult> = async (event) => {
  console.log('Generating follow-up questions:', JSON.stringify(event, null, 2));
  
  // Handle Step Functions nested payload structure
  const analysisData = event.analysis?.Payload || event.analysis || {};
  
  try {
    // Don't ask too many times
    if (event.attemptCount >= 3) {
      return {
        questions: ['Can you provide any additional details that might help us resolve this issue?'],
        priority: 'low',
        reasoning: 'Maximum follow-up attempts reached'
      };
    }
    
    // Generate contextual questions based on what's missing
    const result = await openAIService.generateContextualFollowUps({
      description: event.bugReport.description,
      currentInfo: {
        reproductionSteps: event.bugReport.reproductionSteps,
        environment: event.bugReport.environment
      },
      previousQuestions: [], // TODO: Track previous questions
      userResponses: [] // TODO: Track user responses
    });
    
    // Limit to 2-3 questions for better UX
    const limitedQuestions = result.questions.slice(0, 3);
    
    return {
      questions: limitedQuestions.length > 0 ? limitedQuestions : getDefaultQuestions(analysisData.missingInformation || []),
      priority: result.priority,
      reasoning: result.reasoning
    };
  } catch (error) {
    console.error('Error generating questions:', error);
    
    // Fallback questions
    return {
      questions: getDefaultQuestions(analysisData.missingInformation || []),
      priority: 'medium',
      reasoning: 'Using default questions due to error'
    };
  }
};

function getDefaultQuestions(missingInfo: string[]): string[] {
  const defaultQuestions: Record<string, string> = {
    'reproduction steps': 'What are the exact steps to reproduce this issue?',
    'environment': 'What browser, operating system, and device are you using?',
    'impact': 'How many users are affected and how critical is this for your work?',
    'frequency': 'How often does this issue occur? Is it consistent or intermittent?',
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