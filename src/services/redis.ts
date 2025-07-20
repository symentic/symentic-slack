import { createClient, RedisClientType } from 'redis';

export class RedisService {
  private client: RedisClientType | null = null;
  private isConnected = false;
  private isEnabled = false;
  private inMemoryStore: Map<string, { value: any; expires: number }> = new Map();

  constructor() {
    // Only enable Redis if a valid external URL is provided
    const redisUrl = process.env.REDIS_URL || '';
    this.isEnabled = redisUrl && !redisUrl.includes('localhost') && !redisUrl.includes('127.0.0.1');
    
    if (this.isEnabled) {
      this.client = createClient({
        url: redisUrl,
        password: process.env.REDIS_PASSWORD,
      });

      this.client.on('error', (err) => console.error('Redis Client Error', err));
      this.client.on('connect', () => console.log('Redis Client Connected'));
    } else {
      console.log('Redis is disabled - using in-memory storage');
    }
  }

  async connect(): Promise<void> {
    if (!this.isEnabled || !this.client) return;
    
    if (!this.isConnected) {
      try {
        await this.client.connect();
        this.isConnected = true;
      } catch (error) {
        console.error('Failed to connect to Redis:', error);
        this.isEnabled = false;
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected && this.client) {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  // Clean up expired entries from in-memory store
  private cleanupInMemoryStore(): void {
    const now = Date.now();
    for (const [key, item] of this.inMemoryStore.entries()) {
      if (item.expires < now) {
        this.inMemoryStore.delete(key);
      }
    }
  }

  // Short-term memory operations
  async setShortTermMemory(key: string, value: any, ttl: number = 3600): Promise<void> {
    if (this.isEnabled && this.client) {
      await this.connect();
      await this.client.setEx(key, ttl, JSON.stringify(value));
    } else {
      // In-memory fallback
      this.inMemoryStore.set(key, {
        value: value,
        expires: Date.now() + (ttl * 1000)
      });
      this.cleanupInMemoryStore();
    }
  }

  async getShortTermMemory(key: string): Promise<any | null> {
    if (this.isEnabled && this.client) {
      await this.connect();
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } else {
      // In-memory fallback
      this.cleanupInMemoryStore();
      const item = this.inMemoryStore.get(key);
      if (item && item.expires > Date.now()) {
        return item.value;
      }
      return null;
    }
  }

  async deleteShortTermMemory(key: string): Promise<void> {
    if (this.isEnabled && this.client) {
      await this.connect();
      await this.client.del(key);
    } else {
      // In-memory fallback
      this.inMemoryStore.delete(key);
    }
  }

  // Conversation state management
  async setConversationState(userId: string, threadTs: string, state: any): Promise<void> {
    const key = `conversation:${userId}:${threadTs}`;
    await this.setShortTermMemory(key, state, 7200); // 2 hour TTL
  }

  async getConversationState(userId: string, threadTs: string): Promise<any | null> {
    const key = `conversation:${userId}:${threadTs}`;
    return await this.getShortTermMemory(key);
  }

  // Bug triage state management
  async setBugTriageState(userId: string, threadTs: string, state: any): Promise<void> {
    const key = `bug-triage:${userId}:${threadTs}`;
    await this.setShortTermMemory(key, state, 3600); // 1 hour TTL
  }

  async getBugTriageState(userId: string, threadTs: string): Promise<any | null> {
    const key = `bug-triage:${userId}:${threadTs}`;
    return await this.getShortTermMemory(key);
  }

  // Recent messages cache
  async cacheRecentMessage(channelId: string, message: any): Promise<void> {
    const key = `recent-messages:${channelId}`;
    await this.connect();
    
    // Get existing messages
    const existingMessages = await this.getShortTermMemory(key) || [];
    
    // Add new message and keep only last 100
    existingMessages.unshift(message);
    if (existingMessages.length > 100) {
      existingMessages.pop();
    }
    
    await this.setShortTermMemory(key, existingMessages, 86400); // 24 hour TTL
  }

  async getRecentMessages(channelId: string, limit: number = 50): Promise<any[]> {
    const key = `recent-messages:${channelId}`;
    const messages = await this.getShortTermMemory(key) || [];
    return messages.slice(0, limit);
  }
}

// Singleton instance
export const redisService = new RedisService();