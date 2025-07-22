import { SQSHandler } from 'aws-lambda';
import { StepFunctions } from 'aws-sdk';

const stepFunctions = new StepFunctions();

interface BugResponseMessage {
  taskToken: string;
  executionArn: string;
  bugId: string;
  userId: string;
  threadTs: string;
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