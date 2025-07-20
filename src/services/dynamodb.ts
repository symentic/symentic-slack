import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  QueryCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

export class DynamoDBService {
  private client: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;

  constructor() {
    this.client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    
    this.docClient = DynamoDBDocumentClient.from(this.client);
  }

  // User profile management
  async saveUserProfile(userId: string, profile: any): Promise<void> {
    const params = {
      TableName: process.env.USERS_TABLE || 'SemanticUsers',
      Item: {
        userId,
        ...profile,
        updatedAt: new Date().toISOString(),
      },
    };

    await this.docClient.send(new PutCommand(params));
  }

  async getUserProfile(userId: string): Promise<any | null> {
    const params = {
      TableName: process.env.USERS_TABLE || 'SemanticUsers',
      Key: { userId },
    };

    const result = await this.docClient.send(new GetCommand(params));
    return result.Item || null;
  }

  // Workspace management
  async saveWorkspaceProfile(workspaceId: string, profile: any): Promise<void> {
    const params = {
      TableName: process.env.WORKSPACES_TABLE || 'SemanticWorkspaces',
      Item: {
        workspaceId,
        ...profile,
        updatedAt: new Date().toISOString(),
      },
    };

    await this.docClient.send(new PutCommand(params));
  }

  async getWorkspaceProfile(workspaceId: string): Promise<any | null> {
    const params = {
      TableName: process.env.WORKSPACES_TABLE || 'SemanticWorkspaces',
      Key: { workspaceId },
    };

    const result = await this.docClient.send(new GetCommand(params));
    return result.Item || null;
  }

  // Engram (long-term memory) management
  async saveEngram(userId: string, engram: any): Promise<string> {
    const engramId = uuidv4();
    const params = {
      TableName: process.env.ENGRAMS_TABLE || 'SemanticEngrams',
      Item: {
        engramId,
        userId,
        ...engram,
        createdAt: new Date().toISOString(),
      },
    };

    await this.docClient.send(new PutCommand(params));
    return engramId;
  }

  async getUserEngrams(userId: string, limit: number = 50): Promise<any[]> {
    const params = {
      TableName: process.env.ENGRAMS_TABLE || 'SemanticEngrams',
      IndexName: 'userId-createdAt-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      Limit: limit,
      ScanIndexForward: false, // Get most recent first
    };

    const result = await this.docClient.send(new QueryCommand(params));
    return result.Items || [];
  }

  // Bug report management
  async saveBugReport(bugReport: any): Promise<string> {
    const bugId = `BUG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const params = {
      TableName: process.env.BUG_REPORTS_TABLE || 'SemanticBugReports',
      Item: {
        bugId,
        ...bugReport,
        status: 'open',
        createdAt: new Date().toISOString(),
      },
    };

    await this.docClient.send(new PutCommand(params));
    return bugId;
  }

  async getBugReport(bugId: string): Promise<any | null> {
    const params = {
      TableName: process.env.BUG_REPORTS_TABLE || 'SemanticBugReports',
      Key: { bugId },
    };

    const result = await this.docClient.send(new GetCommand(params));
    return result.Item || null;
  }

  async updateBugReport(bugId: string, updates: any): Promise<void> {
    const updateExpressions: string[] = [];
    const expressionAttributeNames: any = {};
    const expressionAttributeValues: any = {};

    Object.keys(updates).forEach((key, index) => {
      updateExpressions.push(`#attr${index} = :val${index}`);
      expressionAttributeNames[`#attr${index}`] = key;
      expressionAttributeValues[`:val${index}`] = updates[key];
    });

    const params = {
      TableName: process.env.BUG_REPORTS_TABLE || 'SemanticBugReports',
      Key: { bugId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}, updatedAt = :updatedAt`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: {
        ...expressionAttributeValues,
        ':updatedAt': new Date().toISOString(),
      },
    };

    await this.docClient.send(new UpdateCommand(params));
  }

  // Google Calendar OAuth token management
  async saveCalendarToken(userId: string, tokens: any): Promise<void> {
    const params = {
      TableName: process.env.CALENDAR_TOKENS_TABLE || 'SemanticCalendarTokens',
      Item: {
        userId,
        tokens,
        updatedAt: new Date().toISOString(),
      },
    };

    await this.docClient.send(new PutCommand(params));
  }

  async getCalendarToken(userId: string): Promise<any | null> {
    const params = {
      TableName: process.env.CALENDAR_TOKENS_TABLE || 'SemanticCalendarTokens',
      Key: { userId },
    };

    const result = await this.docClient.send(new GetCommand(params));
    return result.Item?.tokens || null;
  }

  // Meeting management
  async saveMeeting(meeting: any): Promise<string> {
    const meetingId = uuidv4();
    const params = {
      TableName: process.env.MEETINGS_TABLE || 'SemanticMeetings',
      Item: {
        meetingId,
        ...meeting,
        createdAt: new Date().toISOString(),
      },
    };

    await this.docClient.send(new PutCommand(params));
    return meetingId;
  }

  async getMeeting(meetingId: string): Promise<any | null> {
    const params = {
      TableName: process.env.MEETINGS_TABLE || 'SemanticMeetings',
      Key: { meetingId },
    };

    const result = await this.docClient.send(new GetCommand(params));
    return result.Item || null;
  }

  // Area expertise tracking
  async trackAreaExpertise(userId: string, area: string, bugId: string): Promise<void> {
    const params = {
      TableName: process.env.AREA_EXPERTISE_TABLE || 'SemanticAreaExpertise',
      Item: {
        userId,
        area,
        bugIds: [bugId],
        lastWorkedOn: new Date().toISOString(),
        count: 1,
      },
    };

    try {
      await this.docClient.send(new PutCommand(params));
    } catch (error: any) {
      // If item exists, update it
      if (error.name === 'ConditionalCheckFailedException') {
        const updateParams = {
          TableName: process.env.AREA_EXPERTISE_TABLE || 'SemanticAreaExpertise',
          Key: { userId, area },
          UpdateExpression: 'SET bugIds = list_append(bugIds, :bugId), lastWorkedOn = :date, #count = #count + :inc',
          ExpressionAttributeNames: {
            '#count': 'count',
          },
          ExpressionAttributeValues: {
            ':bugId': [bugId],
            ':date': new Date().toISOString(),
            ':inc': 1,
          },
        };
        await this.docClient.send(new UpdateCommand(updateParams));
      } else {
        throw error;
      }
    }
  }

  async getAreaExperts(area: string, limit: number = 5): Promise<any[]> {
    const params = {
      TableName: process.env.AREA_EXPERTISE_TABLE || 'SemanticAreaExpertise',
      IndexName: 'area-count-index',
      KeyConditionExpression: 'area = :area',
      ExpressionAttributeValues: {
        ':area': area,
      },
      Limit: limit,
      ScanIndexForward: false, // Get highest count first
    };

    const result = await this.docClient.send(new QueryCommand(params));
    return result.Items || [];
  }
}

// Singleton instance
export const dynamoDBService = new DynamoDBService();