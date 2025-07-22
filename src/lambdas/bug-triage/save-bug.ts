import { Handler } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import { BugReport } from '../../types/domain';

const dynamodb = new DynamoDB.DocumentClient();

interface SaveBugEvent {
  bugReport: BugReport;
  engineers?: Array<{
    userId: string;
    name: string;
  }>;
  meeting?: {
    meetingId: string;
    startTime: string;
    meetingLink?: string;
  };
  channel?: {
    channelId: string;
    channelName: string;
  };
}

export const handler: Handler<SaveBugEvent, BugReport> = async (event) => {
  console.log('Saving bug report:', JSON.stringify(event, null, 2));
  
  const bugId = event.bugReport.bugId || `bug-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  
  const bugReportData: BugReport = {
    ...event.bugReport,
    bugId,
    assignedTo: event.engineers?.map(e => e.userId) || [],
    triageChannel: event.channel?.channelId,
    meetingId: event.meeting?.meetingId,
    status: 'triaged',
    createdAt: event.bugReport.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  try {
    await dynamodb.put({
      TableName: process.env.BUG_REPORTS_TABLE!,
      Item: bugReportData
    }).promise();
    
    console.log('Bug report saved successfully:', bugId);
    
    // Also create engrams for long-term memory
    await createBugEngram(bugReportData);
    
    return bugReportData;
  } catch (error) {
    console.error('Error saving bug report:', error);
    throw error;
  }
};

async function createBugEngram(bugReport: BugReport) {
  const engram = {
    engramId: `engram-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    userId: bugReport.reportedBy,
    timestamp: new Date().toISOString(),
    type: 'bug_report',
    content: {
      bugId: bugReport.bugId,
      summary: `Bug: ${bugReport.description.substring(0, 100)}...`,
      severity: bugReport.severity,
      category: bugReport.category,
      resolved: false
    },
    createdAt: new Date().toISOString()
  };
  
  try {
    await dynamodb.put({
      TableName: process.env.ENGRAMS_TABLE!,
      Item: engram
    }).promise();
    
    console.log('Created engram for bug report');
  } catch (error) {
    console.error('Error creating engram:', error);
    // Non-critical, don't throw
  }
}