import { Handler } from 'aws-lambda';

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
  
  // Merge new information into bug report, preserving existing data
  const updatedBugReport: BugReportData = {
    ...bugReportData,
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
  
  // Recalculate completeness
  const completeness = calculateCompleteness(updatedBugReport);
  
  return {
    ...updatedBugReport,
    completenessScore: completeness
  };
};

function calculateCompleteness(bugReport: BugReportData): number {
  let score = 25; // Base score for having a description
  
  // Check for quality and completeness of each field
  if (bugReport.reproductionSteps && bugReport.reproductionSteps.length > 10) {
    score += 25;
  }
  
  if (bugReport.environment && bugReport.environment.length > 5) {
    score += 20;
  }
  
  if (bugReport.impact && bugReport.impact.length > 10) {
    score += 15;
  }
  
  if (bugReport.errorMessages) {
    score += 10;
  }
  
  if (bugReport.frequency) {
    score += 5;
  }
  
  // Bonus for payment-specific information
  const description = (bugReport.description || '').toLowerCase();
  const allText = `${description} ${bugReport.environment || ''} ${bugReport.impact || ''}`.toLowerCase();
  
  if (allText.includes('payment') || allText.includes('checkout') || allText.includes('transaction')) {
    // For payment bugs, check for payment-specific details
    if (allText.includes('credit card') || allText.includes('paypal') || allText.includes('stripe')) {
      score += 5; // Payment method mentioned
    }
    if (allText.includes('error') || allText.includes('failed') || allText.includes('declined')) {
      score += 5; // Error details mentioned
    }
  }
  
  return Math.min(score, 100);
}