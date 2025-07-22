import { Handler } from 'aws-lambda';

interface UpdateBugEvent {
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
  newInfo: {
    reproductionSteps?: string;
    environment?: string;
    impact?: string;
    errorMessages?: string;
    frequency?: string;
  };
}

export const handler: Handler<UpdateBugEvent> = async (event) => {
  console.log('Updating bug report:', JSON.stringify(event, null, 2));
  
  // Merge new information into bug report
  const updatedBugReport = {
    ...event.bugReport,
    ...event.newInfo,
    lastUpdated: new Date().toISOString()
  };
  
  // Recalculate completeness
  const completeness = calculateCompleteness(updatedBugReport);
  
  return {
    ...updatedBugReport,
    completenessScore: completeness
  };
};

function calculateCompleteness(bugReport: {
  reproductionSteps?: string;
  environment?: string;
  impact?: string;
  errorMessages?: string;
  frequency?: string;
}): number {
  let score = 25; // Base score for having a description
  
  if (bugReport.reproductionSteps) score += 25;
  if (bugReport.environment) score += 20;
  if (bugReport.impact) score += 15;
  if (bugReport.errorMessages) score += 10;
  if (bugReport.frequency) score += 5;
  
  return Math.min(score, 100);
}