import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

export class BugCounterService {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = process.env.WORKSPACES_TABLE || 'SemanticWorkspaces';
  }

  /**
   * Get the next bug number for a workspace
   * Uses atomic counter to ensure unique sequential numbers
   */
  async getNextBugNumber(workspaceId: string): Promise<number> {
    try {
      const result = await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: {
          workspaceId
        },
        UpdateExpression: 'SET bugCounter = if_not_exists(bugCounter, :zero) + :inc',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':inc': 1
        },
        ReturnValues: 'UPDATED_NEW'
      }));

      return result.Attributes?.bugCounter || 1;
    } catch (error) {
      console.error('Error getting next bug number:', error);
      // Fallback to timestamp-based number if counter fails
      return Date.now() % 100000;
    }
  }

  /**
   * Get the current bug counter without incrementing
   */
  async getCurrentBugNumber(workspaceId: string): Promise<number> {
    try {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          workspaceId
        },
        ProjectionExpression: 'bugCounter'
      }));

      return result.Item?.bugCounter || 0;
    } catch (error) {
      console.error('Error getting current bug number:', error);
      return 0;
    }
  }
}

// Singleton instance
export const bugCounterService = new BugCounterService();