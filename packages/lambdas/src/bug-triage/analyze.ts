import { Handler } from 'aws-lambda';
import { openAIService } from '@symentic/core';

interface AnalyzeBugEvent {
  bugReport: {
    description: string;
    reportedBy: string;
    channel: string;
    timestamp: string;
    severity?: string;
    reproductionSteps?: string;
    environment?: string;
    impact?: string;
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
    // Use OpenAI to analyze the bug report
    const analysis = await openAIService.analyzeBugReportQuality({
      description: event.bugReport.description,
      reproductionSteps: event.bugReport.reproductionSteps,
      environment: event.bugReport.environment,
      impact: event.bugReport.impact
    });
    
    // Check if this is an emergency
    const isEmergency = await checkIfEmergency(event.bugReport);
    
    return {
      ...analysis,
      isEmergency
    };
  } catch (error) {
    console.error('Error analyzing bug report:', error);
    throw error;
  }
};

async function checkIfEmergency(bugReport: { description: string; impact?: string }): Promise<boolean> {
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
  
  const description = bugReport.description.toLowerCase();
  return emergencyKeywords.some(keyword => description.includes(keyword));
}