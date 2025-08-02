import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { BugReport, profileEngramService, openAIService, bugCounterService } from '@symentic/core';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

interface SaveBugEvent {
  bugReport: BugReport | { Payload: BugReport };
  engineers?: {
    Payload?: Array<{
      userId: string;
      name: string;
    }>;
  } | Array<{
    userId: string;
    name: string;
  }>;
  meeting?: {
    Payload?: {
      meetingId: string;
      startTime: string;
      meetingLink?: string;
    };
  } | {
    meetingId: string;
    startTime: string;
    meetingLink?: string;
  };
  channel?: {
    Payload?: {
      channelId: string;
      channelName: string;
    };
  } | {
    channelId: string;
    channelName: string;
  };
}

export const handler: Handler<SaveBugEvent, BugReport> = async (event) => {
  console.log('Saving bug report:', JSON.stringify(event, null, 2));
  
  // Handle Step Functions nested payload structure
  const bugReport = 'Payload' in event.bugReport ? event.bugReport.Payload : event.bugReport;
  const engineers = event.engineers && 'Payload' in event.engineers ? event.engineers.Payload : event.engineers;
  const meeting = event.meeting && 'Payload' in event.meeting ? event.meeting.Payload : event.meeting;
  const channel = event.channel && 'Payload' in event.channel ? event.channel.Payload : event.channel;
  
  const bugId = bugReport.bugId || `bug-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  
  // Extract workspace ID from the channel ID pattern
  const workspaceId = bugReport.channelId?.substring(0, 11).match(/^[A-Z][0-9A-Z]+/)?.[0] || 'unknown';
  
  // Assign bug number here (only when actually saving, not when cancelled)
  const bugNumber = await bugCounterService.getNextBugNumber(workspaceId);
  
  // Generate narrative description from conversation if available
  let enhancedDescription = bugReport.description;
  if ((bugReport as any).conversationHistory?.length > 0) {
    enhancedDescription = await generateNarrativeFromConversation(
      bugReport.description,
      (bugReport as any).conversationHistory
    );
  }
  
  // Extract conversation Q&As if available
  const conversationHistory = (bugReport as any).conversationHistory || [];
  const conversations = {
    questions: conversationHistory.map((c: any) => c.question),
    responses: conversationHistory.map((c: any) => c.response)
  };
  
  const bugReportData: BugReport = {
    ...bugReport,
    bugId,
    bugNumber, // Add the bug number we just assigned
    workspaceId, // Add workspace ID for querying
    description: enhancedDescription,
    assignedTo: Array.isArray(engineers) ? engineers.map((e: any) => e.userId) : [],
    triageChannel: channel && typeof channel === 'object' && 'channelId' in channel ? channel.channelId : undefined,
    channelName: channel && typeof channel === 'object' && 'channelName' in channel ? channel.channelName : undefined,
    meetingId: meeting && typeof meeting === 'object' && 'meetingId' in meeting ? meeting.meetingId : undefined,
    status: 'triaged',
    createdAt: bugReport.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversations
  };
  
  try {
    const command = new PutCommand({
      TableName: process.env.BUG_REPORTS_TABLE!,
      Item: bugReportData
    });
    await dynamodb.send(command);
    
    console.log('Bug report saved successfully:', bugId);
    
    // Also create engrams for long-term memory
    await createBugEngram(bugReportData);
    
    return bugReportData;
  } catch (error) {
    console.error('Error saving bug report:', error);
    throw error;
  }
};

async function generateNarrativeFromConversation(
  initialReport: string,
  conversation: Array<{ question: string; response: string }>
): Promise<string> {
  if (conversation.length === 0) {
    return initialReport;
  }

  const systemPrompt = `You are creating a comprehensive bug report narrative from a conversation. 
Combine the initial report and Q&A pairs into a clear, detailed description that engineers can use to fix the issue.

Guidelines:
1. Start with a clear summary of the issue
2. Include all technical details gathered through the conversation
3. Organize information logically (what happens, when, how it affects the user)
4. Keep the technical details but make it flow naturally
5. Include error messages, steps to reproduce, and environmental details
6. End with impact/severity information if available

Output a single paragraph narrative description.`;

  const userPrompt = `Initial Report: ${initialReport}

Conversation:
${conversation.map((pair, i) => 
  `Q: ${pair.question}\nA: ${pair.response}`
).join('\n\n')}

Generate a comprehensive bug description from this conversation.`;

  try {
    const response = await openAIService.classifyWithModel(
      systemPrompt,
      userPrompt,
      'gpt-4o-mini'
    );
    
    // Try to parse as JSON first (in case the model returns JSON)
    try {
      const parsed = JSON.parse(response);
      return parsed.description || response;
    } catch {
      // If not JSON, return the raw response
      return response;
    }
  } catch (error) {
    console.error('Error generating narrative:', error);
    // Fallback to original description
    return initialReport;
  }
}

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
    const command = new PutCommand({
      TableName: process.env.ENGRAMS_TABLE!,
      Item: engram
    });
    await dynamodb.send(command);
    
    console.log('Created engram for bug report');
  } catch (error) {
    console.error('Error creating engram:', error);
    // Non-critical, don't throw
  }
}

async function enrichUserProfiles(
  bugReport: BugReport,
  engineers?: Array<{ userId: string; name: string }> | null
) {
  try {
    // Extract businessId from the first part of the channel ID (e.g., C096L631QGM -> T096L)
    // This is a simplified approach - in production, you'd want to store businessId properly
    const businessId = bugReport.channelId?.substring(0, 5).replace('C', 'T') || '';
    
    if (!businessId) {
      console.log('No businessId found, skipping profile enrichment');
      return;
    }
    
    // Enrich reporter's profile
    if (bugReport.reportedBy) {
      await profileEngramService.addEnrichment(businessId, bugReport.reportedBy, {
        title: `Reported ${bugReport.severity} Bug`,
        content: `Reported bug: "${bugReport.description.substring(0, 100)}..." - ${bugReport.severity} severity`,
        source: 'bug_report',
        metadata: {
          bugId: bugReport.bugId
        }
      });
      
      // Update expertise based on bug category
      if (bugReport.category) {
        const profile = await profileEngramService.getProfile(businessId, bugReport.reportedBy);
        if (profile) {
          const expertise = profile.expertise || [];
          if (!expertise.includes(bugReport.category)) {
            expertise.push(bugReport.category);
            await profileEngramService.updateProfile({
              businessId,
              userId: bugReport.reportedBy,
              updates: { expertise }
            });
          }
        }
      }
    }
    
    // Enrich assigned engineers' profiles
    if (engineers && Array.isArray(engineers)) {
      for (const engineer of engineers) {
        await profileEngramService.addEnrichment(businessId, engineer.userId, {
          title: `Assigned to ${bugReport.severity} Bug`,
          content: `Assigned to fix: "${bugReport.description.substring(0, 100)}..."`,
          source: 'bug_report',
          metadata: {
            bugId: bugReport.bugId
          }
        });
        
        // Update expertise
        if (bugReport.category) {
          const profile = await profileEngramService.getProfile(businessId, engineer.userId);
          if (profile) {
            const expertise = profile.expertise || [];
            if (!expertise.includes(bugReport.category)) {
              expertise.push(bugReport.category);
              await profileEngramService.updateProfile({
                businessId,
                userId: engineer.userId,
                updates: { expertise }
              });
            }
          }
        }
      }
    }
    
    console.log('User profiles enriched for bug:', bugReport.bugId);
  } catch (error) {
    console.error('Error enriching user profiles:', error);
    // Don't throw - this is a non-critical operation
  }
}