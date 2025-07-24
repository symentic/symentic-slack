import { Handler } from 'aws-lambda';
import { openAIService } from '@symentic/core';

interface BugReportData {
  description: string;
  reportedBy: string;
  channel: string;
  timestamp: string;
  severity?: string;
  reproductionSteps?: string;
  environment?: string;
  impact?: string;
}

interface AnalyzeBugEvent {
  bugReport: BugReportData | {
    Payload: BugReportData;
  };
  context: {
    userId: string;
    channelId: string;
    teamId: string;
  };
}

interface AnalysisResult {
  completenessScore: number;
  qualityRating: number;
  missingInformation: string[];
  followUpQuestions: string[];
  confidence: number;
  category?: string;
  isEmergency: boolean;
}

export const handler: Handler<AnalyzeBugEvent, AnalysisResult> = async (event) => {
  console.log('Analyzing bug report:', JSON.stringify(event, null, 2));
  
  try {
    // Handle nested payload structure from Step Functions
    const bugReportData: BugReportData = 'Payload' in event.bugReport && event.bugReport.Payload ? event.bugReport.Payload : event.bugReport as BugReportData;
    
    if (!bugReportData || !bugReportData.description) {
      console.error('Bug report description is missing');
      return {
        completenessScore: 0,
        qualityRating: 0,
        missingInformation: ['Bug description is missing'],
        followUpQuestions: ['Please describe the bug you encountered'],
        confidence: 0,
        isEmergency: false
      };
    }
    
    // Use OpenAI to analyze the bug report
    const analysis = await openAIService.analyzeBugReportQuality({
      description: bugReportData.description,
      reproductionSteps: bugReportData.reproductionSteps,
      environment: bugReportData.environment,
      impact: bugReportData.impact
    });
    
    // Check if this is an emergency
    const isEmergency = await checkIfEmergency(bugReportData);
    
    return {
      ...analysis,
      isEmergency
    };
  } catch (error) {
    console.error('Error analyzing bug report:', error);
    throw error;
  }
};

async function checkIfEmergency(bugReport: { description?: string; impact?: string }): Promise<boolean> {
  const emergencyKeywords = [
    'production down',
    'all users affected',
    'critical',
    'emergency',
    'urgent',
    'data loss',
    'security breach',
    'complete outage'
  ];
  
  const description = (bugReport.description || '').toLowerCase();
  const impact = (bugReport.impact || '').toLowerCase();
  const fullText = `${description} ${impact}`;
  
  return emergencyKeywords.some(keyword => fullText.includes(keyword));
}