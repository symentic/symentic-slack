import { Handler } from 'aws-lambda';
import { openAIService } from '@symentic/core';
import { BugReportData, ConversationPair, SlackContext } from './types';

interface BugReportDataWithHistory extends BugReportData {
  bugId: string;
  conversationHistory?: ConversationPair[];
}

interface EnhanceBugEvent {
  bugReport: BugReportDataWithHistory | {
    Payload: BugReportDataWithHistory;
  };
  processedResponse?: {
    Payload?: {
      extractedInfo?: {
        reproductionSteps?: string;
        environment?: string;
        impact?: string;
        errorMessages?: string;
        frequency?: string;
      };
    };
  };
  context?: SlackContext;
  threadTs?: string;
  attemptCount?: number;
  analysis?: {
    category?: string;
    severity?: string;
    isEmergency?: boolean;
  };
  engineers?: unknown;
  channel?: unknown;
  meeting?: unknown;
}

export const handler: Handler<EnhanceBugEvent, BugReportDataWithHistory> = async (event): Promise<BugReportDataWithHistory> => {
  
  try {
    // Handle nested payload structure
    const bugReport: BugReportDataWithHistory = 'Payload' in event.bugReport && event.bugReport.Payload 
      ? event.bugReport.Payload 
      : event.bugReport as BugReportDataWithHistory;
    
    // Extract any additional info from processed responses (if they exist)
    const extractedInfo = event.processedResponse?.Payload?.extractedInfo || {};
    
    // Also check if there's conversation history in the bug report itself
    const conversationHistory = bugReport.conversationHistory || [];
    
    // Merge all available information
    const completeData = {
      description: bugReport.description,
      reproductionSteps: extractedInfo.reproductionSteps || bugReport.reproductionSteps,
      environment: extractedInfo.environment || bugReport.environment,
      impact: extractedInfo.impact || bugReport.impact,
      errorMessages: extractedInfo.errorMessages || bugReport.errorMessages,
      frequency: extractedInfo.frequency || bugReport.frequency,
      severity: bugReport.severity,
      category: bugReport.category,
      // Include conversation history for better context
      conversationContext: conversationHistory.length > 0 
        ? `\n\nAdditional context from Q&A:\n${conversationHistory.map(qa => `Q: ${qa.question}\nA: ${qa.response}`).join('\n\n')}`
        : ''
    };
    
    // Enhance the bug report with all available context
    const enhancedData = {
      ...completeData,
      // Append conversation context to description for enhancement
      description: completeData.description + completeData.conversationContext
    };
    
    const enhanced = await openAIService.enhanceBugDescription(enhancedData);
    
    // Return the enhanced bug report
    const enhancedBugReport: BugReportData = {
      ...bugReport,
      description: enhanced.enhancedDescription || completeData.description,
      reproductionSteps: enhanced.enhancedSteps || completeData.reproductionSteps,
      environment: enhanced.enhancedEnvironment || completeData.environment,
      impact: enhanced.enhancedImpact || completeData.impact,
      // Keep original fields that don't get enhanced
      errorMessages: completeData.errorMessages,
      frequency: completeData.frequency,
      // Remove conversation history from the enhanced report since it's been incorporated
    };
    
    return enhancedBugReport;
  } catch (error) {
    // Return original data if enhancement fails
    const bugReport = 'Payload' in event.bugReport && event.bugReport.Payload 
      ? event.bugReport.Payload 
      : event.bugReport as BugReportDataWithHistory;
    return bugReport;
  }
};