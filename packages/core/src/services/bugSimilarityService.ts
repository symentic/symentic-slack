import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { BugReport } from '../types/domain';
import { openAIService } from './openai';
import crypto from 'crypto';

interface SimilarBug {
  bugId: string;
  bugNumber: number;
  channelName: string;
  channelId: string;
  similarity: number;
  description: string;
  severity: string;
  status: string;
}

export class BugSimilarityService {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = process.env.BUG_REPORTS_TABLE || 'SemanticBugReports';
  }

  /**
   * Find similar bugs using exact match and semantic similarity
   */
  async findSimilarBugs(
    workspaceId: string, 
    newBugDescription: string,
    category?: string
  ): Promise<SimilarBug[]> {
    // 1. First check for exact match using hash
    const descriptionHash = this.generateDescriptionHash(newBugDescription);
    const exactMatch = await this.findExactMatch(workspaceId, descriptionHash);
    
    if (exactMatch) {
      return [{
        ...exactMatch,
        similarity: 1.0
      }];
    }

    // 2. Find semantically similar bugs
    const recentBugs = await this.getRecentBugs(workspaceId, category);
    if (recentBugs.length === 0) {
      return [];
    }

    // 3. Use GPT to analyze similarity
    const similarities = await this.analyzeSimilarity(newBugDescription, recentBugs);
    
    // 4. Filter and sort by similarity score
    return similarities
      .filter(bug => bug.similarity > 0.7) // 70% similarity threshold
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5); // Return top 5 similar bugs
  }

  /**
   * Generate a hash of the bug description for exact matching
   */
  private generateDescriptionHash(description: string): string {
    // Normalize description: lowercase, trim, remove extra spaces
    const normalized = description
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, ''); // Remove punctuation
    
    return crypto.createHash('md5').update(normalized).digest('hex');
  }

  /**
   * Find exact duplicate by description hash
   */
  private async findExactMatch(
    workspaceId: string, 
    descriptionHash: string
  ): Promise<SimilarBug | null> {
    try {
      // Query by workspace and description hash
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'workspace-hash-index', // Assuming we have this GSI
        KeyConditionExpression: 'workspaceId = :workspaceId AND descriptionHash = :hash',
        ExpressionAttributeValues: {
          ':workspaceId': workspaceId,
          ':hash': descriptionHash
        },
        Limit: 1
      }));

      if (result.Items && result.Items.length > 0) {
        const bug = result.Items[0] as BugReport;
        return {
          bugId: bug.bugId,
          bugNumber: bug.bugNumber || 0,
          channelName: bug.channelName || `bug-${bug.bugNumber}`,
          channelId: bug.triageChannel || bug.channelId,
          similarity: 1.0,
          description: bug.description,
          severity: bug.severity,
          status: bug.status
        };
      }
    } catch (error) {
      console.warn('Exact match query failed, falling back to scan:', error);
    }

    return null;
  }

  /**
   * Get recent bugs from the workspace for similarity comparison
   */
  private async getRecentBugs(
    workspaceId: string,
    category?: string
  ): Promise<BugReport[]> {
    try {
      // Get bugs from the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const params: any = {
        TableName: this.tableName,
        FilterExpression: 'workspaceId = :workspaceId AND createdAt > :date AND #status <> :resolved',
        ExpressionAttributeValues: {
          ':workspaceId': workspaceId,
          ':date': thirtyDaysAgo.toISOString(),
          ':resolved': 'resolved'
        },
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        Limit: 100
      };

      // Add category filter if provided
      if (category) {
        params.FilterExpression += ' AND category = :category';
        params.ExpressionAttributeValues[':category'] = category;
      }

      const result = await this.docClient.send(new ScanCommand(params));
      return (result.Items || []) as BugReport[];
    } catch (error) {
      console.error('Error fetching recent bugs:', error);
      return [];
    }
  }

  /**
   * Use GPT to analyze semantic similarity between bugs
   */
  private async analyzeSimilarity(
    newDescription: string,
    existingBugs: BugReport[]
  ): Promise<SimilarBug[]> {
    if (existingBugs.length === 0) {
      return [];
    }

    const prompt = `Analyze the similarity between this new bug report and existing bugs.
Return a JSON array with similarity scores (0-1) for each existing bug.

New Bug Description:
"${newDescription}"

Existing Bugs:
${existingBugs.map((bug, idx) => `
${idx + 1}. Bug #${bug.bugNumber || bug.bugId} (${bug.severity}):
   Description: "${bug.description}"
   Category: ${bug.category || 'uncategorized'}
   Status: ${bug.status}
`).join('\n')}

Consider:
- Similar error messages or symptoms
- Same affected components/features
- Similar root causes
- Impact on same functionality

Return JSON format:
[
  { "index": 1, "similarity": 0.95, "reason": "Same error in same component" },
  ...
]`;

    try {
      const response = await openAIService.classifyWithModel(
        'You are a bug similarity analyzer. Return only valid JSON.',
        prompt,
        'gpt-4o-mini'
      );

      const similarities = JSON.parse(response);
      
      return similarities.map((sim: any) => {
        const bug = existingBugs[sim.index - 1];
        return {
          bugId: bug.bugId,
          bugNumber: bug.bugNumber || 0,
          channelName: bug.channelName || `bug-${bug.bugNumber}`,
          channelId: bug.triageChannel || bug.channelId,
          similarity: sim.similarity,
          description: bug.description,
          severity: bug.severity,
          status: bug.status
        };
      });
    } catch (error) {
      console.error('Error analyzing similarity:', error);
      return [];
    }
  }

  /**
   * Link two bugs as related
   */
  async linkBugs(bugId1: string, bugId2: string): Promise<void> {
    try {
      // Update both bugs to reference each other
      await Promise.all([
        this.addRelatedBug(bugId1, bugId2),
        this.addRelatedBug(bugId2, bugId1)
      ]);
    } catch (error) {
      console.error('Error linking bugs:', error);
      throw error;
    }
  }

  /**
   * Add a related bug reference
   */
  private async addRelatedBug(bugId: string, relatedBugId: string): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { bugId },
      UpdateExpression: 'SET relatedBugs = list_append(if_not_exists(relatedBugs, :empty), :bug)',
      ExpressionAttributeValues: {
        ':empty': [],
        ':bug': [relatedBugId]
      }
    }));
  }
}

// Singleton instance
export const bugSimilarityService = new BugSimilarityService();