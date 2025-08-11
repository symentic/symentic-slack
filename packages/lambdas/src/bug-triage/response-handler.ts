import { SQSHandler } from 'aws-lambda';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { executionTracker } from '@symentic/core';

const stepFunctions = new SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });

interface BugResponseMessage {
  taskToken: string;
  executionArn: string;
  bugId: string;
  userId: string;
  threadTs: string;
  channelId?: string;
  attemptCount?: number;
  isTaskTokenMessage?: boolean; // Flag to identify task token messages
  response?: { // Optional since task token messages won't have this
    text: string;
    userId: string;
    timestamp: string;
  };
}

export const handler: SQSHandler = async (event) => {
  console.log('Bug response handler triggered:', JSON.stringify(event, null, 2));
  
  for (const record of event.Records) {
    try {
      const message: BugResponseMessage = JSON.parse(record.body);
      
      // Check if this is just a task token message (not a user response)
      if (message.isTaskTokenMessage) {
        console.log('Received task token message, storing for later use');
        
        // Store the task token in the execution tracker
        if (message.threadTs) {
          const execution = await executionTracker.getExecutionByThread(message.threadTs);
          if (execution) {
            await executionTracker.updateTaskToken(
              execution.executionId,
              message.taskToken,
              message.executionArn
            );
            console.log(`Stored task token for thread ${message.threadTs}`);
          }
        }
        
        // Don't complete the task yet - wait for actual user response
        return;
      }
      
      // This is an actual user response
      if (!message.response) {
        throw new Error('User response is missing');
      }
      
      // Update execution tracker with conversation history
      if (message.threadTs) {
        const execution = await executionTracker.getExecutionByThread(message.threadTs);
        if (execution) {
          await executionTracker.addConversationMessage(execution.executionId, {
            userId: message.response.userId,
            message: message.response.text,
            timestamp: message.response.timestamp,
            role: 'user'
          });
          
          // Update metadata with current attempt count if provided
          if (message.attemptCount !== undefined) {
            await executionTracker.updateExecution(execution.executionId, {
              metadata: {
                ...execution.metadata,
                attemptCount: message.attemptCount
              }
            });
          }
        }
      }
      
      // Send the response back to the Step Function
      const successCommand = new SendTaskSuccessCommand({
        taskToken: message.taskToken,
        output: JSON.stringify({
          userResponse: message.response
        })
      });
      await stepFunctions.send(successCommand);
      
      console.log(`Sent response back to Step Function for bug ${message.bugId}`);
    } catch (error) {
      console.error('Error processing bug response:', error);
      
      // Try to fail the task so it doesn't hang
      try {
        const message: BugResponseMessage = JSON.parse(record.body);
        if (!message.isTaskTokenMessage && message.taskToken) {
          const failureCommand = new SendTaskFailureCommand({
            taskToken: message.taskToken,
            error: 'ProcessingError',
            cause: JSON.stringify(error)
          });
          await stepFunctions.send(failureCommand);
        }
      } catch (failError) {
        console.error('Failed to send task failure:', failError);
      }
    }
  }
};