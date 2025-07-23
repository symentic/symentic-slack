import { WebClient } from '@slack/web-api';

interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile?: {
    email?: string;
    display_name?: string;
    image_512?: string;
  };
  is_bot?: boolean;
  is_app_user?: boolean;
}

interface SlackChannel {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
}

interface SlackTeam {
  id: string;
  name: string;
  domain: string;
}

export class SlackService {
  private client: WebClient;
  private userCache: Map<string, SlackUser> = new Map();

  constructor() {
    this.client = new WebClient(process.env.SLACK_BOT_TOKEN);
  }

  async getUserInfo(userId: string): Promise<SlackUser | null> {
    // Check cache first
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId) || null;
    }

    try {
      const result = await this.client.users.info({ user: userId });
      if (result.user && result.user.id) {
        const user: SlackUser = {
          id: result.user.id,
          name: result.user.name || '',
          real_name: result.user.real_name,
          profile: result.user.profile,
          is_bot: result.user.is_bot,
          is_app_user: result.user.is_app_user
        };
        this.userCache.set(userId, user);
        return user;
      }
    } catch (error) {
      console.error(`Failed to get user info for ${userId}:`, error);
    }

    return null;
  }

  async getChannelInfo(channelId: string): Promise<SlackChannel | null> {
    try {
      const result = await this.client.conversations.info({ channel: channelId });
      if (result.channel && result.channel.id) {
        return {
          id: result.channel.id,
          name: result.channel.name,
          is_channel: result.channel.is_channel,
          is_group: result.channel.is_group,
          is_im: result.channel.is_im,
          is_mpim: result.channel.is_mpim,
          is_private: result.channel.is_private
        } as SlackChannel;
      }
      return null;
    } catch (error) {
      console.error(`Failed to get channel info for ${channelId}:`, error);
      return null;
    }
  }

  async getWorkspaceInfo(): Promise<SlackTeam | null> {
    try {
      const result = await this.client.team.info();
      if (result.team && result.team.id && result.team.name && result.team.domain) {
        return {
          id: result.team.id,
          name: result.team.name,
          domain: result.team.domain
        } as SlackTeam;
      }
      return null;
    } catch (error) {
      console.error('Failed to get workspace info:', error);
      return null;
    }
  }

  async getUserByEmail(email: string): Promise<SlackUser | null> {
    try {
      const result = await this.client.users.lookupByEmail({ email });
      if (result.user && result.user.id) {
        return {
          id: result.user.id,
          name: result.user.name || '',
          real_name: result.user.real_name,
          profile: result.user.profile,
          is_bot: result.user.is_bot,
          is_app_user: result.user.is_app_user
        } as SlackUser;
      }
      return null;
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