import { Handler } from 'aws-lambda';
import { executionTracker } from '@symentic/core';

interface TrackExecutionEvent {
  executionArn: string;
  taskToken: string;
  bugId: string;
  threadId: string;
  userId: string;
  channelId: string;
  teamId: string;
  originalMessage: string;
}

export const handler: Handler<TrackExecutionEvent> = async (event) => {
  console.log('Tracking execution:', JSON.stringify(event, null, 2));
  
  try {
    // Get or create execution record
    let execution = await executionTracker.getExecutionByThread(event.threadId);
    
    if (!execution) {
      // Create new execution
      execution = await executionTracker.createExecution({
        threadId: event.threadId,
        userId: event.userId,
        channelId: event.channelId,
        teamId: event.teamId,
        agentType: 'bug_triage',
        originalMessage: event.originalMessage
      });
    }
    
    // Update with task token and execution ARN
    await executionTracker.updateTaskToken(
      execution.executionId,
      event.taskToken,
      event.executionArn
    );
    
    // Update metadata with bug ID
    await executionTracker.updateExecution(execution.executionId, {
      metadata: {
        ...execution.metadata,
        bugId: event.bugId
      }
    });
    
    console.log(`Execution tracked: ${execution.executionId}`);
    return { executionId: execution.executionId };
    
  } catch (error) {
    console.error('Error tracking execution:', error);
    throw error;
  }
};