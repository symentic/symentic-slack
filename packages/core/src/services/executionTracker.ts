import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { v4 as uuidv4 } from 'uuid';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
const stepFunctions = new SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });

export interface ExecutionData {
  executionId: string;
  threadId: string;
  userId: string;
  channelId: string;
  teamId: string;
  agentType: 'bug_triage' | 'feature_request' | 'general';
  status: 'active' | 'waiting_response' | 'completed' | 'failed' | 'timeout';
  taskToken?: string;
  executionArn?: string;
  originalMessage: string;
  conversationHistory: ConversationMessage[];
  metadata: {
    attemptCount: number;
    completenessScore?: number;
    bugReport?: any;
    engineersFound?: string[];
    channelCreated?: string;
    meetingScheduled?: any;
    bugId?: string;
  };
  createdAt: string;
  updatedAt: string;
  ttl: number;
}

export interface ConversationMessage {
  userId: string;
  message: string;
  timestamp: string;
  role: 'user' | 'assistant';
}

export class ExecutionTracker {
  private tableName: string;

  constructor() {
    this.tableName = process.env.EXECUTIONS_TABLE || 'SymenticExecutions';
  }

  async createExecution(params: {
    threadId: string;
    userId: string;
    channelId: string;
    teamId: string;
    agentType: ExecutionData['agentType'];
    originalMessage: string;
  }): Promise<ExecutionData> {
    const executionId = uuidv4();
    const now = new Date().toISOString();
    
    const execution: ExecutionData = {
      executionId,
      threadId: params.threadId,
      userId: params.userId,
      channelId: params.channelId,
      teamId: params.teamId,
      agentType: params.agentType,
      status: 'active',
      originalMessage: params.originalMessage,
      conversationHistory: [
        {
          userId: params.userId,
          message: params.originalMessage,
          timestamp: now,
          role: 'user'
        }
      ],
      metadata: {
        attemptCount: 0
      },
      createdAt: now,
      updatedAt: now,
      ttl: Math.floor(Date.now() / 1000) + 172800 // 48 hours
    };

    const command = new PutCommand({
      TableName: this.tableName,
      Item: execution
    });
    await dynamodb.send(command);

    return execution;
  }

  async updateExecution(executionId: string, updates: Partial<ExecutionData>): Promise<void> {
    const updateExpression: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    Object.keys(updates).forEach((key, index) => {
      if (key !== 'executionId') {
        const attrName = `#attr${index}`;
        const attrValue = `:val${index}`;
        updateExpression.push(`${attrName} = ${attrValue}`);
        expressionAttributeNames[attrName] = key;
        expressionAttributeValues[attrValue] = updates[key as keyof ExecutionData];
      }
    });

    // Always update the updatedAt timestamp
    updateExpression.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: { executionId },
      UpdateExpression: `SET ${updateExpression.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    });
    await dynamodb.send(command);
  }

  async getExecutionByThread(threadId: string): Promise<ExecutionData | null> {
    const params = {
      TableName: this.tableName,
      IndexName: 'threadId-createdAt-index',
      KeyConditionExpression: 'threadId = :threadId',
      ExpressionAttributeValues: {
        ':threadId': threadId
      },
      ScanIndexForward: false, // Get most recent first
      Limit: 1
    };

    const command = new QueryCommand(params);
    const result = await dynamodb.send(command);
    return result.Items && result.Items.length > 0 ? result.Items[0] as ExecutionData : null;
  }

  async getActiveExecutionsByUser(userId: string): Promise<ExecutionData[]> {
    const params = {
      TableName: this.tableName,
      IndexName: 'userId-status-index',
      KeyConditionExpression: 'userId = :userId AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':status': 'active'
      }
    };

    const command = new QueryCommand(params);
    const result = await dynamodb.send(command);
    return (result.Items || []) as ExecutionData[];
  }

  async addConversationMessage(
    executionId: string,
    message: ConversationMessage
  ): Promise<void> {
    const execution = await this.getExecution(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    execution.conversationHistory.push(message);

    await this.updateExecution(executionId, {
      conversationHistory: execution.conversationHistory
    });
  }

  async updateTaskToken(executionId: string, taskToken: string, executionArn: string): Promise<void> {
    await this.updateExecution(executionId, {
      taskToken,
      executionArn,
      status: 'waiting_response'
    });
  }

  async completeExecution(executionId: string, success: boolean = true): Promise<void> {
    await this.updateExecution(executionId, {
      status: success ? 'completed' : 'failed'
    });
  }

  async getExecution(executionId: string): Promise<ExecutionData | null> {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: { executionId }
    });
    const result = await dynamodb.send(command);

    return result.Item as ExecutionData | null;
  }

  async sendTaskSuccess(executionId: string, output: any): Promise<void> {
    const execution = await this.getExecution(executionId);
    if (!execution || !execution.taskToken) {
      throw new Error(`No task token found for execution ${executionId}`);
    }

    const command = new SendTaskSuccessCommand({
      taskToken: execution.taskToken,
      output: JSON.stringify(output)
    });
    await stepFunctions.send(command);

    await this.updateExecution(executionId, {
      status: 'active',
      taskToken: undefined
    });
  }

  async sendTaskFailure(executionId: string, error: string, cause: string): Promise<void> {
    const execution = await this.getExecution(executionId);
    if (!execution || !execution.taskToken) {
      throw new Error(`No task token found for execution ${executionId}`);
    }

    const command = new SendTaskFailureCommand({
      taskToken: execution.taskToken,
      error,
      cause
    });
    await stepFunctions.send(command);

    await this.updateExecution(executionId, {
      status: 'failed',
      taskToken: undefined
    });
  }
}

export const executionTracker = new ExecutionTracker();