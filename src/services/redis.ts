import { createClient, RedisClientType } from 'redis';

export class RedisService {
  private client: RedisClientType | null = null;
  private isConnected = false;
  private isEnabled = false;
  private inMemoryStore: Map<string, { value: unknown; expires: number }> = new Map();

  constructor() {
    // Only enable Redis if a valid external URL is provided
    const redisUrl = process.env.REDIS_URL || '';
    this.isEnabled = Boolean(
      redisUrl && 
      !redisUrl.includes('localhost') && 
      !redisUrl.includes('127.0.0.1') &&
      !redisUrl.includes('YOUR-ELASTICACHE-ENDPOINT') &&
      !redisUrl.includes('YOUR_REDIS_ENDPOINT')
    );
    
    if (this.isEnabled) {
      this.client = createClient({
        url: redisUrl,
        password: process.env.REDIS_PASSWORD,
      });

      this.client.on('error', (err) => console.error('Redis Client Error', err)); // eslint-disable-line no-console
      this.client.on('connect', () => console.log('Redis Client Connected')); // eslint-disable-line no-console
    } else {
      console.log('Redis is disabled - using in-memory storage'); // eslint-disable-line no-console
    }
  }

  async connect(): Promise<void> {
    if (!this.isEnabled || !this.client) return;
    
    if (!this.isConnected) {
      try {
        await this.client.connect();
        this.isConnected = true;
      } catch (error) {
        console.error('Failed to connect to Redis:', error); // eslint-disable-line no-console
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
  async setShortTermMemory(key: string, value: unknown, ttl: number = 3600): Promise<void> {
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

  async getShortTermMemory(key: string): Promise<unknown | null> {
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
  async setConversationState(userId: string, threadTs: string, state: Record<string, unknown>): Promise<void> {
    const key = `conversation:${userId}:${threadTs}`;
    await this.setShortTermMemory(key, state, 7200); // 2 hour TTL
  }

  async getConversationState(userId: string, threadTs: string): Promise<Record<string, unknown> | null> {
    const key = `conversation:${userId}:${threadTs}`;
    const result = await this.getShortTermMemory(key);
    return result as Record<string, unknown> | null;
  }

  // Enhanced bug triage state management
  async setBugTriageState(userId: string, threadTs: string, state: {
    step: string;
    description: string;
    reproductionSteps?: string;
    environment?: string;
    impact?: string;
    severity?: 'low' | 'medium' | 'high';
    completenessScore: number;
    qualityRating: number;
    missingInformation: string[];
    previousQuestions: string[];
    userResponses: string[];
    attemptCount: number;
    category?: string;
    confidence: number;
    userId: string;
    channelId: string;
    threadTs: string;
    timestamp: string;
    lastUpdated: string;
  }): Promise<void> {
    const key = `bug-triage:${userId}:${threadTs}`;
    const updatedState = {
      ...state,
      lastUpdated: new Date().toISOString()
    };
    await this.setShortTermMemory(key, updatedState, 7200); // 2 hour TTL
  }

  async getBugTriageState(userId: string, threadTs: string): Promise<Record<string, unknown> | null> {
    const key = `bug-triage:${userId}:${threadTs}`;
    const result = await this.getShortTermMemory(key);
    return result as Record<string, unknown> | null;
  }

  // Update specific fields in bug triage state
  async updateBugTriageState(userId: string, threadTs: string, updates: Partial<{
    reproductionSteps: string;
    environment: string;
    impact: string;
    severity: 'low' | 'medium' | 'high';
    completenessScore: number;
    qualityRating: number;
    userResponses: string[];
    previousQuestions: string[];
    attemptCount: number;
  }>): Promise<void> {
    const currentState = await this.getBugTriageState(userId, threadTs);
    if (currentState) {
      const updatedState = {
        ...currentState,
        ...updates,
        lastUpdated: new Date().toISOString()
      };
      await this.setBugTriageState(userId, threadTs, updatedState as Parameters<typeof this.setBugTriageState>[2]);
    }
  }

  // Recent messages cache
  async cacheRecentMessage(channelId: string, message: {
    userId: string;
    text: string;
    ts: string;
    threadTs?: string;
  }): Promise<void> {
    const key = `recent-messages:${channelId}`;
    await this.connect();
    
    // Get existing messages
    const existingMessages = (await this.getShortTermMemory(key) || []) as Array<{
      userId: string;
      text: string;
      ts: string;
      threadTs?: string;
    }>;
    
    // Add new message and keep only last 100
    existingMessages.unshift(message);
    if (existingMessages.length > 100) {
      existingMessages.pop();
    }
    
    await this.setShortTermMemory(key, existingMessages, 86400); // 24 hour TTL
  }

  async getRecentMessages(channelId: string, limit: number = 50): Promise<Array<{
    userId: string;
    text: string;
    ts: string;
    threadTs?: string;
  }>> {
    const key = `recent-messages:${channelId}`;
    const messages = (await this.getShortTermMemory(key) || []) as Array<{
      userId: string;
      text: string;
      ts: string;
      threadTs?: string;
    }>;
    return messages.slice(0, limit);
  }

  // Get all keys matching a pattern
  async getKeys(pattern: string): Promise<string[]> {
    if (!this.isEnabled || !this.client) {
      // For in-memory store, filter keys by pattern
      const keys: string[] = [];
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      for (const key of this.inMemoryStore.keys()) {
        if (regex.test(key)) {
          keys.push(key);
        }
      }
      return keys;
    }

    try {
      await this.connect();
      return await this.client.keys(pattern);
    } catch (error) {
      console.error('Redis getKeys error:', error);
      return [];
    }
  }
}

// Singleton instance
export const redisService = new RedisService();