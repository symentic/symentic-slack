import { SQSHandler } from 'aws-lambda';
import { StepFunctions } from 'aws-sdk';
import { executionTracker } from '@symentic/core';

const stepFunctions = new StepFunctions();

interface BugResponseMessage {
  taskToken: string;
  executionArn: string;
  bugId: string;
  userId: string;
  threadTs: string;
  channelId?: string;
  attemptCount?: number;
  response: {
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
      await stepFunctions.sendTaskSuccess({
        taskToken: message.taskToken,
        output: JSON.stringify({
          userResponse: message.response
        })
      }).promise();
      
      console.log(`Sent response back to Step Function for bug ${message.bugId}`);
    } catch (error) {
      console.error('Error processing bug response:', error);
      
      // Try to fail the task so it doesn't hang
      try {
        const message: BugResponseMessage = JSON.parse(record.body);
        await stepFunctions.sendTaskFailure({
          taskToken: message.taskToken,
          error: 'ProcessingError',
          cause: JSON.stringify(error)
        }).promise();
      } catch (failError) {
        console.error('Failed to send task failure:', failError);
      }
    }
  }
};