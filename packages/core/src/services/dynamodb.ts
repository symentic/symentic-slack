import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  QueryCommand,
  UpdateCommand,
  ScanCommand
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { UserProfile, Engram, BugReport, Meeting, AreaExpertise } from '../types/domain';

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
  async saveUserProfile(userId: string, profile: Partial<UserProfile>): Promise<void> {
    const params = {
      TableName: process.env.USERS_TABLE || 'SymenticUsers',
      Item: {
        userId,
        ...profile,
        updatedAt: new Date().toISOString(),
      },
    };

    await this.docClient.send(new PutCommand(params));
  }

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const params = {
      TableName: process.env.USERS_TABLE || 'SymenticUsers',
      Key: { userId },
    };

    const result = await this.docClient.send(new GetCommand(params));
    return (result.Item as UserProfile) || null;
  }

  // Workspace management
  async saveWorkspaceProfile(workspaceId: string, profile: Record<string, unknown>): Promise<void> {
    const params = {
      TableName: process.env.WORKSPACES_TABLE || 'SymenticWorkspaces',
      Item: {
        workspaceId,
        ...profile,
        updatedAt: new Date().toISOString(),
      },
    };

    await this.docClient.send(new PutCommand(params));
  }

  async getWorkspaceProfile(workspaceId: string): Promise<Record<string, unknown> | null> {
    const params = {
      TableName: process.env.WORKSPACES_TABLE || 'SymenticWorkspaces',
      Key: { workspaceId },
    };

    const result = await this.docClient.send(new GetCommand(params));
    return result.Item || null;
  }

  // Engram (long-term memory) management
  async saveEngram(engram: {
    userId: string;
    timestamp: string;
    type: string;
    content: Record<string, unknown>;
  }): Promise<string> {
    const engramId = uuidv4();
    const params = {
      TableName: process.env.ENGRAMS_TABLE || 'SymenticEngrams',
      Item: {
        engramId,
        ...engram,
        createdAt: new Date().toISOString(),
      },
    };

    await this.docClient.send(new PutCommand(params));
    return engramId;
  }

  async getUserEngrams(userId: string, limit: number = 50): Promise<Engram[]> {
    const params = {
      TableName: process.env.ENGRAMS_TABLE || 'SymenticEngrams',
      IndexName: 'userId-createdAt-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      Limit: limit,
      ScanIndexForward: false, // Get most recent first
    };

    const result = await this.docClient.send(new QueryCommand(params));
    return (result.Items as Engram[]) || [];
  }

  // Bug report management
  async saveBugReport(bugReport: Omit<BugReport, 'bugId'>): Promise<string> {
    const bugId = `BUG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const params = {
      TableName: process.env.BUG_REPORTS_TABLE || 'SymenticBugReports',
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

  async getBugReport(bugId: string): Promise<BugReport | null> {
    const params = {
      TableName: process.env.BUG_REPORTS_TABLE || 'SymenticBugReports',
      Key: { bugId },
    };

    const result = await this.docClient.send(new GetCommand(params));
    return (result.Item as BugReport) || null;
  }

  async updateBugReport(bugId: string, updates: Partial<BugReport>): Promise<void> {
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    Object.keys(updates).forEach((key, index) => {
      updateExpressions.push(`#attr${index} = :val${index}`);
      expressionAttributeNames[`#attr${index}`] = key;
      expressionAttributeValues[`:val${index}`] = (updates as Record<string, unknown>)[key];
    });

    const params = {
      TableName: process.env.BUG_REPORTS_TABLE || 'SymenticBugReports',
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
  async saveCalendarToken(userId: string, tokens: Record<string, unknown>): Promise<void> {
    const params = {
      TableName: process.env.CALENDAR_TOKENS_TABLE || 'SymenticCalendarTokens',
      Item: {
        userId,
        tokens,
        updatedAt: new Date().toISOString(),
      },
    };

    await this.docClient.send(new PutCommand(params));
  }

  async getCalendarToken(userId: string): Promise<Record<string, unknown> | null> {
    const params = {
      TableName: process.env.CALENDAR_TOKENS_TABLE || 'SymenticCalendarTokens',
      Key: { userId },
    };

    const result = await this.docClient.send(new GetCommand(params));
    return result.Item?.tokens || null;
  }

  // Meeting management
  async saveMeeting(meeting: Omit<Meeting, 'meetingId'>): Promise<string> {
    const meetingId = uuidv4();
    const params = {
      TableName: process.env.MEETINGS_TABLE || 'SymenticMeetings',
      Item: {
        meetingId,
        ...meeting,
        createdAt: new Date().toISOString(),
      },
    };

    await this.docClient.send(new PutCommand(params));
    return meetingId;
  }

  async getMeeting(meetingId: string): Promise<Meeting | null> {
    const params = {
      TableName: process.env.MEETINGS_TABLE || 'SymenticMeetings',
      Key: { meetingId },
    };

    const result = await this.docClient.send(new GetCommand(params));
    return (result.Item as Meeting) || null;
  }

  // Area expertise tracking
  async trackAreaExpertise(userId: string, area: string, bugId: string): Promise<void> {
    const params = {
      TableName: process.env.AREA_EXPERTISE_TABLE || 'SymenticAreaExpertise',
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
    } catch (error) {
      // If item exists, update it
      if ((error as Error).name === 'ConditionalCheckFailedException') {
        const updateParams = {
          TableName: process.env.AREA_EXPERTISE_TABLE || 'SymenticAreaExpertise',
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

  async getAreaExperts(area: string, limit: number = 5): Promise<AreaExpertise[]> {
    const params = {
      TableName: process.env.AREA_EXPERTISE_TABLE || 'SymenticAreaExpertise',
      IndexName: 'area-count-index',
      KeyConditionExpression: 'area = :area',
      ExpressionAttributeValues: {
        ':area': area,
      },
      Limit: limit,
      ScanIndexForward: false, // Get highest count first
    };

    const result = await this.docClient.send(new QueryCommand(params));
    return (result.Items as AreaExpertise[]) || [];
  }
  // Area expertise management
  async saveAreaExpertise(expertise: {
    userId: string;
    area: string;
    level: 'expert' | 'intermediate' | 'beginner';
    keywords: string[];
  }): Promise<void> {
    const params = {
      TableName: process.env.AREA_EXPERTISE_TABLE || 'SymenticAreaExpertise',
      Item: {
        userId: expertise.userId,
        area: expertise.area,
        level: expertise.level,
        keywords: expertise.keywords,
        updatedAt: new Date().toISOString()
      },
    };

    await this.docClient.send(new PutCommand(params));
  }

  async findEngineersForArea(area: string, keywords: string[] = []): Promise<Array<{
    userId: string;
    level: string;
    matchScore: number;
  }>> {
    try {
      // Query all expertise records
      const params = {
        TableName: process.env.AREA_EXPERTISE_TABLE || 'SymenticAreaExpertise',
      };

      const result = await this.docClient.send(new ScanCommand(params));
      const items = result.Items || [];

      // Score each engineer based on area and keyword matches
      const engineers = items.map(item => {
        let score = 0;
        
        // Area match
        if (item.area.toLowerCase() === area.toLowerCase()) {
          score += 10;
        } else if (item.area.toLowerCase().includes(area.toLowerCase())) {
          score += 5;
        }

        // Keyword matches
        const expertKeywords = (item.keywords || []).map((k: string) => k.toLowerCase());
        keywords.forEach(keyword => {
          if (expertKeywords.includes(keyword.toLowerCase())) {
            score += 3;
          }
        });

        // Level bonus
        if (item.level === 'expert') score += 5;
        if (item.level === 'intermediate') score += 3;

        return {
          userId: item.userId,
          level: item.level,
          matchScore: score
        };
      });

      // Filter and sort by score
      return engineers
        .filter(e => e.matchScore > 0)
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 5); // Top 5 matches
    } catch (error) {
      console.error('Error finding engineers:', error);
      return [];
    }
  }
}

// Singleton instance
export const dynamoDBService = new DynamoDBService();