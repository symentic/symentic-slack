import { SQS, DynamoDB } from 'aws-sdk';
import { SlackMessage } from '../../types/slack';

const sqs = new SQS();
const dynamodb = new DynamoDB.DocumentClient();

interface ActiveWorkflow {
  workflowType: 'bug_triage' | 'meeting_schedule' | 'task_create';
  executionArn: string;
  taskToken?: string;
  state: string;
}

export async function handleThreadResponse(
  message: SlackMessage,
  _client: unknown
): Promise<boolean> {
  if (!message.thread_ts || message.thread_ts === message.ts) {
    return false; // Not a thread reply
  }
  
  try {
    // Look up active workflow for this thread
    const workflow = await getActiveWorkflow(message.user!, message.thread_ts);
    
    if (!workflow) {
      console.log('No active workflow found for thread:', message.thread_ts);
      return false;
    }
    
    console.log(`Routing thread response to ${workflow.workflowType} workflow`);
    
    switch (workflow.workflowType) {
      case 'bug_triage':
        await routeToBugTriage(message, workflow);
        return true;
        
      case 'meeting_schedule':
        // TODO: Implement meeting schedule response routing
        console.log('Meeting schedule response routing not yet implemented');
        return false;
        
      case 'task_create':
        // TODO: Implement task create response routing
        console.log('Task create response routing not yet implemented');
        return false;
        
      default:
        return false;
    }
  } catch (error) {
    console.error('Error handling thread response:', error);
    return false;
  }
}

async function getActiveWorkflow(
  userId: string,
  threadTs: string
): Promise<ActiveWorkflow | null> {
  try {
    // Query DynamoDB for active workflows
    const params = {
      TableName: process.env.WORKFLOWS_TABLE || 'SemanticWorkflows',
      Key: {
        threadId: `${userId}:${threadTs}`
      }
    };
    
    const result = await dynamodb.get(params).promise();
    
    if (!result.Item) {
      return null;
    }
    
    return {
      workflowType: result.Item.workflowType,
      executionArn: result.Item.executionArn,
      taskToken: result.Item.taskToken,
      state: result.Item.state
    };
  } catch (error) {
    console.error('Error getting active workflow:', error);
    return null;
  }
}

async function routeToBugTriage(
  message: SlackMessage,
  workflow: ActiveWorkflow
): Promise<void> {
  // Send message to bug response queue
  const queueUrl = process.env.BUG_RESPONSE_QUEUE_URL;
  
  if (!queueUrl) {
    throw new Error('BUG_RESPONSE_QUEUE_URL not configured');
  }
  
  const messageBody = {
    taskToken: workflow.taskToken,
    executionArn: workflow.executionArn,
    bugId: workflow.executionArn.split('-').slice(-1)[0], // Extract from execution name
    userId: message.user,
    threadTs: message.thread_ts,
    response: {
      text: message.text || '',
      userId: message.user!,
      timestamp: message.ts
    }
  };
  
  await sqs.sendMessage({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(messageBody)
  }).promise();
  
  console.log('Sent bug response to queue');
}

// Helper function to store workflow references
export async function storeWorkflowReference(
  userId: string,
  threadTs: string,
  workflowType: string,
  executionArn: string,
  taskToken?: string
): Promise<void> {
  const params = {
    TableName: process.env.WORKFLOWS_TABLE || 'SemanticWorkflows',
    Item: {
      threadId: `${userId}:${threadTs}`,
      userId,
      threadTs,
      workflowType,
      executionArn,
      taskToken,
      state: 'active',
      createdAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 86400 // 24 hour TTL
    }
  };
  
  await dynamodb.put(params).promise();
}