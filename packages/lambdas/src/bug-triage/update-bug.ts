import { Handler } from 'aws-lambda';
import { openAIService } from '@symentic/core';

interface ConversationPair {
  question: string;
  response: string;
}

interface BugReportData {
  bugId?: string;
  bugNumber?: number;
  description: string;
  reportedBy: string;
  channel: string;
  timestamp: string;
  severity?: string;
  category?: string;
  reproductionSteps?: string;
  environment?: string;
  impact?: string;
  errorMessages?: string;
  frequency?: string;
  completenessScore?: number;
  lastUpdated?: string;
  conversationHistory?: ConversationPair[];
  threadTs?: string;
}

interface UpdateBugEvent {
  bugReport: BugReportData | {
    Payload: BugReportData;
  };
  processedResponse?: {
    Payload?: {
      extractedInfo: {
        reproductionSteps?: string;
        environment?: string;
        impact?: string;
        errorMessages?: string;
        frequency?: string;
      };
    };
  };
  // Analysis result from analyze lambda
  analysis?: {
    Payload?: {
      isEmergency?: boolean;
      completenessScore?: number;
      severity?: string;
      category?: string;
      bugId?: string;
      bugNumber?: number;
    };
  };
  // Questions that were asked
  questions?: {
    Payload?: {
      questions: string[];
    };
  };
  // User's response
  userResponse?: {
    userResponse?: {
      text: string;
    };
  };
  // Conversation history from previous iterations
  conversationHistory?: ConversationPair[];
  // Legacy field for backward compatibility
  newInfo?: {
    reproductionSteps?: string;
    environment?: string;
    impact?: string;
    errorMessages?: string;
    frequency?: string;
  };
}

export const handler: Handler<UpdateBugEvent, BugReportData> = async (event) => {
  console.log('Updating bug report:', JSON.stringify(event, null, 2));
  
  // Handle Step Functions nested payload structure
  const bugReportData = 'Payload' in event.bugReport ? event.bugReport.Payload : event.bugReport;
  const newInfo = event.processedResponse?.Payload?.extractedInfo || event.newInfo || {};
  const analysisResult = event.analysis?.Payload;
  
  // Update conversation history
  const conversationHistory = [...(event.conversationHistory || [])];
  
  // Add the latest Q&A pair if available
  if (event.questions?.Payload?.questions?.[0] && event.userResponse?.userResponse?.text) {
    conversationHistory.push({
      question: event.questions.Payload.questions[0],
      response: event.userResponse.userResponse.text
    });
  }
  
  // Merge new information into bug report, preserving existing data
  const updatedBugReport: BugReportData = {
    ...bugReportData,
    conversationHistory,
    lastUpdated: new Date().toISOString()
  };
  
  // Update fields from analysis
  if (analysisResult?.severity && analysisResult.severity !== bugReportData.severity) {
    console.log(`Updating severity from ${bugReportData.severity} to ${analysisResult.severity}`);
    updatedBugReport.severity = analysisResult.severity;
  }
  
  if (analysisResult?.category) {
    updatedBugReport.category = analysisResult.category;
  }
  
  if (analysisResult?.bugId && !bugReportData.bugId) {
    updatedBugReport.bugId = analysisResult.bugId;
  }
  
  if (analysisResult?.bugNumber && !bugReportData.bugNumber) {
    updatedBugReport.bugNumber = analysisResult.bugNumber;
  }
  
  // Only update fields if new information is provided
  if (newInfo.reproductionSteps) {
    updatedBugReport.reproductionSteps = bugReportData.reproductionSteps 
      ? `${bugReportData.reproductionSteps}\n${newInfo.reproductionSteps}`
      : newInfo.reproductionSteps;
  }
  
  if (newInfo.environment) {
    updatedBugReport.environment = bugReportData.environment
      ? `${bugReportData.environment}, ${newInfo.environment}`
      : newInfo.environment;
  }
  
  if (newInfo.impact) {
    updatedBugReport.impact = bugReportData.impact
      ? `${bugReportData.impact}. ${newInfo.impact}`
      : newInfo.impact;
  }
  
  if (newInfo.errorMessages) {
    updatedBugReport.errorMessages = bugReportData.errorMessages
      ? `${bugReportData.errorMessages}, ${newInfo.errorMessages}`
      : newInfo.errorMessages;
  }
  
  if (newInfo.frequency) {
    updatedBugReport.frequency = newInfo.frequency;
  }
  
  // Recalculate completeness using AI
  let completenessScore = 25; // Default fallback
  
  try {
    // Use AI to analyze the updated bug report
    const analysis = await openAIService.analyzeBugReportQuality({
      description: updatedBugReport.description,
      reproductionSteps: updatedBugReport.reproductionSteps,
      environment: updatedBugReport.environment,
      impact: updatedBugReport.impact,
      errorMessages: updatedBugReport.errorMessages,
      frequency: updatedBugReport.frequency
    });
    
    completenessScore = analysis.completenessScore;
    console.log('AI-calculated completeness score:', completenessScore);
    
    // Also update severity if AI found it to be different
    if (analysis.severity && analysis.severity !== updatedBugReport.severity) {
      console.log(`AI suggests updating severity from ${updatedBugReport.severity} to ${analysis.severity}`);
      updatedBugReport.severity = analysis.severity;
    }
  } catch (error) {
    console.error('Failed to calculate completeness with AI, using fallback:', error);
    // Use simplified fallback calculation
    completenessScore = calculateCompleteness(updatedBugReport);
  }
  
  return {
    ...updatedBugReport,
    completenessScore
  };
};

// Simplified fallback function - only used if AI fails
function calculateCompleteness(bugReport: BugReportData): number {
  // Very basic scoring as fallback
  let score = 0;
  
  if (bugReport.description) score += 15;
  if (bugReport.reproductionSteps) score += 20;
  if (bugReport.environment) score += 15;
  if (bugReport.impact) score += 15;
  if (bugReport.errorMessages) score += 15;
  if (bugReport.frequency) score += 10;
  
  // Total text length check
  const totalLength = [
    bugReport.description,
    bugReport.reproductionSteps,
    bugReport.environment,
    bugReport.impact,
    bugReport.errorMessages
  ].filter(Boolean).join(' ').length;
  
  if (totalLength < 100) {
    score = Math.floor(score * 0.5); // Heavily penalize very short reports
  }
  
  console.log('Fallback completeness score:', score);
  return Math.min(score, 100);
}