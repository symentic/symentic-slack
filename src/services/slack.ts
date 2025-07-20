import { WebClient } from '@slack/web-api';

export class SlackService {
  private client: WebClient;
  private userCache: Map<string, any> = new Map();

  constructor() {
    this.client = new WebClient(process.env.SLACK_BOT_TOKEN);
  }

  async getUserInfo(userId: string): Promise<any> {
    // Check cache first
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId);
    }

    try {
      const result = await this.client.users.info({ user: userId });
      if (result.user) {
        this.userCache.set(userId, result.user);
        return result.user;
      }
    } catch (error) {
      console.error(`Failed to get user info for ${userId}:`, error);
    }

    return null;
  }

  async getChannelInfo(channelId: string): Promise<any> {
    try {
      const result = await this.client.conversations.info({ channel: channelId });
      return result.channel;
    } catch (error) {
      console.error(`Failed to get channel info for ${channelId}:`, error);
      return null;
    }
  }

  async getWorkspaceInfo(): Promise<any> {
    try {
      const result = await this.client.team.info();
      return result.team;
    } catch (error) {
      console.error('Failed to get workspace info:', error);
      return null;
    }
  }

  async getUserByEmail(email: string): Promise<any> {
    try {
      const result = await this.client.users.lookupByEmail({ email });
      return result.user;
    } catch (error) {
      console.error(`Failed to find user by email ${email}:`, error);
      return null;
    }
  }

  async listChannelMembers(channelId: string): Promise<string[]> {
    try {
      const result = await this.client.conversations.members({ channel: channelId });
      return result.members || [];
    } catch (error) {
      console.error(`Failed to list channel members for ${channelId}:`, error);
      return [];
    }
  }

  async getMessagePermalink(channelId: string, messageTs: string): Promise<string | null> {
    try {
      const result = await this.client.chat.getPermalink({
        channel: channelId,
        message_ts: messageTs,
      });
      return result.permalink || null;
    } catch (error) {
      console.error('Failed to get message permalink:', error);
      return null;
    }
  }

  clearUserCache(): void {
    this.userCache.clear();
  }
}

// Singleton instance
export const slackService = new SlackService();