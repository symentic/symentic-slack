import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  QueryCommand, 
  UpdateCommand,
  BatchWriteCommand,
  BatchGetCommand
} from '@aws-sdk/lib-dynamodb';
import { 
  EngramProfile, 
  Enrichment, 
  ProfileInteraction, 
  ProfileSearchFilters,
  CreateProfileRequest,
  ProfileUpdateRequest,
  SlackUserData
} from '../types/profile-engram';
import { openAIService } from './openai';

export class ProfileEngramService {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;
  private workspaceNameCache: Map<string, string> = new Map();

  constructor() {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = process.env.PROFILE_ENGRAMS_TABLE || 'SymenticProfileEngrams';
  }

  /**
   * Create a new profile with business isolation
   */
  async createProfile(request: CreateProfileRequest): Promise<EngramProfile> {
    const profileId = this.generateProfileId(request.businessId, request.userId);
    
    const profile: EngramProfile = {
      id: profileId,
      businessId: request.businessId,
      userId: request.userId,
      userType: request.userType,
      name: request.name,
      email: request.email,
      role: request.role || 'Team Member',
      description: request.description || '',
      tags: request.tags || [],
      expertise: [],
      enrichments: [],
      source: request.source,
      firstSeen: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      lastInteraction: new Date().toISOString(),
      interactionCount: 0,
      consent: request.consent
    };

    // Add Slack-specific data if available
    if (request.slackData && request.userType === 'internal') {
      profile.slackProfile = this.extractSlackProfile(request.slackData);
    }

    // Generate AI description if not provided
    if (!profile.description && profile.name) {
      profile.description = await this.generateDescription(profile);
    }

    await this.saveProfile(profile);
    return profile;
  }

  /**
   * Get a profile by businessId and userId
   */
  async getProfile(businessId: string, userId: string): Promise<EngramProfile | null> {
    try {
      const workspaceKey = await this.getWorkspaceKey(businessId);
      const result = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: workspaceKey,
          SK: `USER#${userId}`
        }
      }));

      if (!result.Item) return null;

      return this.mapDynamoItemToProfile(result.Item);
    } catch (error) {
      console.error('Error getting profile:', error);
      return null;
    }
  }

  /**
   * Update an existing profile
   */
  async updateProfile(request: ProfileUpdateRequest): Promise<EngramProfile | null> {
    const { businessId, userId, updates, enrichments } = request;

    // Build update expression
    const updateExpressions: string[] = ['#lastUpdated = :lastUpdated'];
    const expressionAttributeNames: Record<string, string> = { '#lastUpdated': 'lastUpdated' };
    const expressionAttributeValues: Record<string, unknown> = { ':lastUpdated': new Date().toISOString() };

    // Add field updates
    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'businessId' && key !== 'userId' && value !== undefined) {
        updateExpressions.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = value;
      }
    });

    // Add enrichments if provided
    if (enrichments && enrichments.length > 0) {
      updateExpressions.push('#enrichments = list_append(#enrichments, :newEnrichments)');
      expressionAttributeNames['#enrichments'] = 'enrichments';
      expressionAttributeValues[':newEnrichments'] = enrichments;
    }

    try {
      const workspaceKey = await this.getWorkspaceKey(businessId);
      const result = await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: workspaceKey,
          SK: `USER#${userId}`
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW'
      }));

      return result.Attributes ? this.mapDynamoItemToProfile(result.Attributes) : null;
    } catch (error) {
      console.error('Error updating profile:', error);
      return null;
    }
  }

  /**
   * Record an interaction and update profile
   */
  async recordInteraction(interaction: ProfileInteraction): Promise<void> {
    const { businessId, userId } = interaction;

    try {
      const workspaceKey = await this.getWorkspaceKey(businessId);
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: workspaceKey,
          SK: `USER#${userId}`
        },
        UpdateExpression: `
          SET #lastInteraction = :timestamp,
              #interactionCount = #interactionCount + :inc,
              #lastUpdated = :timestamp
          ADD #interactions :one
        `,
        ExpressionAttributeNames: {
          '#lastInteraction': 'lastInteraction',
          '#interactionCount': 'interactionCount',
          '#lastUpdated': 'lastUpdated',
          '#interactions': 'interactions'
        },
        ExpressionAttributeValues: {
          ':timestamp': interaction.timestamp,
          ':inc': 1,
          ':one': 1
        }
      }));

      // Store detailed interaction in separate record (for analytics)
      await this.storeInteractionDetail(interaction);
    } catch (error) {
      console.error('Error recording interaction:', error);
    }
  }

  /**
   * Search profiles within a business
   */
  async searchProfiles(filters: ProfileSearchFilters): Promise<EngramProfile[]> {
    const { businessId } = filters;

    try {
      // Start with basic query for business
      interface QueryParams {
        TableName: string;
        KeyConditionExpression: string;
        ExpressionAttributeValues: Record<string, unknown>;
        FilterExpression?: string;
      }
      
      const workspaceKey = await this.getWorkspaceKey(businessId);
      const queryParams: QueryParams = {
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': workspaceKey
        }
      };

      // Add filters
      const filterExpressions: string[] = [];
      
      if (filters.userType) {
        filterExpressions.push('userType = :userType');
        queryParams.ExpressionAttributeValues[':userType'] = filters.userType;
      }

      if (filters.hasConsent !== undefined) {
        filterExpressions.push('consent.given = :hasConsent');
        queryParams.ExpressionAttributeValues[':hasConsent'] = filters.hasConsent;
      }

      if (filterExpressions.length > 0) {
        queryParams.FilterExpression = filterExpressions.join(' AND ');
      }

      const result = await this.docClient.send(new QueryCommand(queryParams));
      
      return (result.Items || []).map(item => this.mapDynamoItemToProfile(item));
    } catch (error) {
      console.error('Error searching profiles:', error);
      return [];
    }
  }

  /**
   * Batch create profiles (for initial sync)
   */
  async batchCreateProfiles(businessId: string, profiles: CreateProfileRequest[]): Promise<void> {
    const chunks = this.chunkArray(profiles, 25); // DynamoDB batch limit

    for (const chunk of chunks) {
      const items = await Promise.all(
        chunk.map(async (req) => {
          const profile = await this.createProfileObject(req);
          const item = await this.mapProfileToDynamoItem(profile);
          return {
            PutRequest: {
              Item: item
            }
          };
        })
      );

      try {
        await this.docClient.send(new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: items
          }
        }));
      } catch (error) {
        console.error('Error batch creating profiles:', error);
      }
    }
  }

  /**
   * Create or update external user profile
   */
  async createOrUpdateExternalProfile(
    businessId: string,
    externalUserId: string,
    data: {
      name?: string;
      email?: string;
      company?: string;
      firstContactChannel?: string;
      interactedWith?: string;
    }
  ): Promise<EngramProfile> {
    const userId = externalUserId.startsWith('external_') 
      ? externalUserId 
      : `external_${externalUserId}`;

    // Check if profile exists
    let profile = await this.getProfile(businessId, userId);

    if (!profile) {
      // Create new external profile
      profile = await this.createProfile({
        businessId,
        userId,
        userType: 'external',
        name: data.name || data.email || 'Unknown User',
        email: data.email,
        source: 'external_interaction',
        consent: {
          given: false, // Default to no consent
          method: 'implicit'
        }
      });
    }

    // Update external profile data
    const updates: Record<string, unknown> = {};
    if (!profile.externalProfile) {
      updates.externalProfile = {};
    }

    if (data.company) {
      updates['externalProfile.company'] = data.company;
    }

    if (data.email && !data.company) {
      // Extract domain as company
      const domain = data.email.split('@')[1];
      updates['externalProfile.domain'] = domain;
    }

    if (data.firstContactChannel) {
      updates['externalProfile.firstContactChannel'] = data.firstContactChannel;
    }

    if (Object.keys(updates).length > 0) {
      await this.updateProfile({
        businessId,
        userId,
        updates
      });
    }

    return profile!;
  }

  /**
   * Add enrichment to profile
   */
  async addEnrichment(
    businessId: string,
    userId: string,
    enrichment: Omit<Enrichment, 'id' | 'timestamp'>
  ): Promise<void> {
    const fullEnrichment: Enrichment = {
      ...enrichment,
      id: `enr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString()
    };

    await this.updateProfile({
      businessId,
      userId,
      updates: {},
      enrichments: [fullEnrichment]
    });
  }

  // Private helper methods

  private generateProfileId(businessId: string, userId: string): string {
    return `profile_${businessId}_${userId}`;
  }

  private extractSlackProfile(slackUser: SlackUserData): EngramProfile['slackProfile'] {
    return {
      slackUserId: slackUser.id,
      realName: slackUser.real_name || slackUser.name,
      displayName: slackUser.profile?.display_name || slackUser.name,
      title: slackUser.profile?.title,
      profilePictureUrl: slackUser.profile?.image_512 || slackUser.profile?.image_192,
      timezone: slackUser.tz,
      statusText: slackUser.profile?.status_text,
      isOwner: slackUser.is_owner || false,
      isAdmin: slackUser.is_admin || false
    };
  }

  private async generateDescription(profile: Partial<EngramProfile>): Promise<string> {
    try {
      const prompt = `Generate a brief professional description for:
Name: ${profile.name}
Role: ${profile.role || 'Team Member'}
Type: ${profile.userType}
${profile.slackProfile?.title ? `Title: ${profile.slackProfile.title}` : ''}
${profile.slackProfile?.statusText ? `Status: ${profile.slackProfile.statusText}` : ''}

Keep it concise (1-2 sentences) and professional.
Return your response as JSON with a "description" field.`;

      const response = await openAIService.classifyWithModel(
        'You are a professional profile writer. Generate concise descriptions. Always return valid JSON.',
        prompt,
        'gpt-4o-mini'
      );

      return JSON.parse(response).description || 'Team member';
    } catch (error) {
      console.error('Error generating description:', error);
      return `${profile.role || 'Team member'} at the organization`;
    }
  }

  private async createProfileObject(request: CreateProfileRequest): Promise<EngramProfile> {
    const profileId = this.generateProfileId(request.businessId, request.userId);
    
    const profile: EngramProfile = {
      id: profileId,
      businessId: request.businessId,
      userId: request.userId,
      userType: request.userType,
      name: request.name,
      email: request.email,
      role: request.role || 'Team Member',
      description: request.description || '',
      tags: request.tags || [],
      expertise: [],
      enrichments: [],
      source: request.source,
      firstSeen: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      lastInteraction: new Date().toISOString(),
      interactionCount: 0,
      consent: request.consent
    };

    if (request.slackData && request.userType === 'internal') {
      profile.slackProfile = this.extractSlackProfile(request.slackData);
    }

    if (!profile.description && profile.name) {
      profile.description = await this.generateDescription(profile);
    }

    return profile;
  }

  private async saveProfile(profile: EngramProfile): Promise<void> {
    const item = await this.mapProfileToDynamoItem(profile);
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: item
    }));
  }

  private async mapProfileToDynamoItem(profile: EngramProfile): Promise<any> {
    const workspaceKey = await this.getWorkspaceKey(profile.businessId);
    return {
      PK: workspaceKey,
      SK: `USER#${profile.userId}`,
      GSI1PK: workspaceKey,
      GSI1SK: `TYPE#${profile.userType}#USER#${profile.userId}`,
      ...profile
    };
  }

  private mapDynamoItemToProfile(item: Record<string, unknown>): EngramProfile {
    // Remove DynamoDB-specific keys
    const { PK, SK, GSI1PK, GSI1SK, ...profileData } = item;
    
    // Ensure required fields exist
    if (!profileData.id || !profileData.businessId || !profileData.userId || !profileData.userType) {
      throw new Error('Invalid profile data: missing required fields');
    }
    
    // Cast to EngramProfile - we trust DynamoDB data structure
    return profileData as unknown as EngramProfile;
  }

  private async storeInteractionDetail(interaction: ProfileInteraction): Promise<void> {
    // Store in separate interactions table or as time-series data
    // This could be used for analytics later
    try {
      const workspaceKey = await this.getWorkspaceKey(interaction.businessId);
      await this.docClient.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: workspaceKey,
          SK: `INTERACTION#${interaction.timestamp}#${interaction.userId}`,
          ...interaction
        }
      }));
    } catch (error) {
      console.error('Error storing interaction detail:', error);
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Get a workspace key that combines name and hash for uniqueness
   * Format: {workspace_name}_{hash}
   * Example: acme-corp_a1b2c3
   */
  private async getWorkspaceKey(businessId: string): Promise<string> {
    // Check cache first
    const cached = this.workspaceNameCache.get(businessId);
    if (cached) return cached;

    try {
      // Try to get workspace name from Slack API
      if (process.env.SLACK_BOT_TOKEN) {
        const { WebClient } = await import('@slack/web-api');
        const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
        
        try {
          const teamInfo = await slack.team.info({ team: businessId });
          if (teamInfo.team?.name) {
            // Create a hash from the businessId for uniqueness
            const hash = businessId.substring(0, 6).toLowerCase();
            // Sanitize workspace name: lowercase, replace spaces with dashes, remove special chars
            const sanitizedName = teamInfo.team.name
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, '')
              .replace(/\s+/g, '-')
              .substring(0, 30); // Limit length
            
            const key = `${sanitizedName}_${hash}`;
            this.workspaceNameCache.set(businessId, key);
            return key;
          }
        } catch (slackError) {
          console.warn('Could not fetch workspace name from Slack:', slackError);
        }
      }
    } catch (error) {
      console.warn('Error getting workspace name:', error);
    }

    // Fallback to ID-based key if name lookup fails
    const fallbackKey = businessId;
    this.workspaceNameCache.set(businessId, fallbackKey);
    return fallbackKey;
  }
}

// Singleton instance
export const profileEngramService = new ProfileEngramService();