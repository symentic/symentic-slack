import { ConversationContext, AgentResponse } from '../agents/base/BaseAgent';
import { intentClassifier } from '../services/intentClassifier';
import { createAgentRegistry } from '../services/agentRegistry';
import { redisService } from '../services/redis';
import { dynamoDBService } from '../services/dynamodb';
import { MessageHandlerContext } from '../types/slack';

// Pre-filter function (same as before)
function shouldProcessMessage(text: string, channelType: string, botUserId?: string): boolean {
  const lowerText = text.toLowerCase();
  
  if (channelType === 'im') return true;
  if (botUserId && text.includes(`<@${botUserId}>`)) return true;
  
  const triggerKeywords = [
    'bug:', 'bug', 'schedule', 'meeting', 'remind me', 'help me',
    'can you', 'could you', 'would you', '@semantic', 'there is a bug',
    'found a bug', 'fix', 'error', 'issue', 'problem'
  ];
  
  return triggerKeywords.some(keyword => lowerText.includes(keyword));
}

export async function messageHandler({
  message,
  say,
  client,
}: MessageHandlerContext): Promise<void> {
  // Skip bot messages
  if (message.bot_id || message.subtype === 'bot_message') {
    return;
  }

  // Prevent duplicate processing
  const messageKey = `processed:${message.ts}`;
  if (await redisService.getShortTermMemory(messageKey)) {
    console.log(`Skipping duplicate message with timestamp ${message.ts} - already processed`);
    return;
  }
  await redisService.setShortTermMemory(messageKey, true, 300);

  const userId = message.user || '';
  const channelId = message.channel || '';
  const threadTs = message.thread_ts || message.ts;
  const text = message.text || '';

  // Skip if no user ID (shouldn't happen for real messages)
  if (!userId) {
    console.log('Message has no user ID, skipping');
    return;
  }

  try {
    // Pre-filter check
    const channelType = message.channel_type || (channelId.startsWith('D') ? 'im' : 'channel');
    let botUserId = await redisService.getShortTermMemory('bot:userId') as string | undefined;
    
    if (!botUserId) {
      const authTest = await client.auth.test();
      botUserId = authTest.user_id || undefined;
      if (botUserId) {
        await redisService.setShortTermMemory('bot:userId', botUserId, 86400);
      }
    }
    
    if (!shouldProcessMessage(text, channelType, botUserId)) {
      console.log(`Message does not require processing. Text: "${text}", Channel type: ${channelType}, Bot mentioned: ${botUserId && text.includes(`<@${botUserId}>`)}`);
      return;
    }

    // STEP 1: Classify intent using AI
    const recentMessages = await redisService.getRecentMessages(channelId, 5);
    const intent = await intentClassifier.classifyIntent({
      message: text,
      userId,
      channelId,
      recentContext: recentMessages.map(m => m.text)
    });

    console.log(`Intent classified: ${intent.intent} (confidence: ${intent.confidence}, model: ${intent.modelUsed})`);

    // STEP 2: Load conversation context
    const context: ConversationContext = {
      userId,
      channelId,
      threadTs,
      messageTs: message.ts,
      originalText: text,
      intent,
      memory: {
        shortTerm: await loadShortTermMemory(userId, channelId),
        longTerm: await loadLongTermMemory(userId)
      }
    };

    // STEP 3: Get agent registry and route to appropriate agent
    const agentRegistry = createAgentRegistry(client);
    const response = await agentRegistry.routeToAgent(context, say);

    if (!response) {
      // No agent could handle this intent - fallback to general response
      await say({
        text: "I'm not sure how to help with that. Try asking about scheduling meetings, reporting bugs, or creating tasks.",
        thread_ts: threadTs
      });
      return;
    }

    // STEP 4: Store interaction if needed
    if (response.shouldStore) {
      await storeInteraction(context, response);
    }

    // Update user activity
    await dynamoDBService.saveUserProfile(userId, {
      lastActiveAt: new Date().toISOString(),
      lastChannel: channelId,
      lastIntent: intent.intent
    });

  } catch (error) {
    console.error('Error in message handler:', error);
    
    if (message.channel_type === 'im') {
      await say({
        text: "I encountered an error processing your message. Please try again.",
        thread_ts: threadTs,
      });
    }
  }
}

// Helper functions
async function loadShortTermMemory(userId: string, channelId: string): Promise<Record<string, unknown>> {
  const memory: Record<string, unknown> = {};
  
  // Load recent messages
  memory.recentMessages = await redisService.getRecentMessages(channelId, 10);
  
  // Load any active workflows
  const bugTriageKey = `bug-triage:${userId}:*`;
  const activeWorkflows = await redisService.getKeys(bugTriageKey);
  if (activeWorkflows.length > 0) {
    memory.activeWorkflows = activeWorkflows;
  }
  
  return memory;
}

async function loadLongTermMemory(userId: string): Promise<Record<string, unknown>> {
  const memory: Record<string, unknown> = {};
  
  // Load user profile
  memory.userProfile = await dynamoDBService.getUserProfile(userId);
  
  // Load recent engrams
  const engrams = await dynamoDBService.getUserEngrams(userId, 20);
  memory.engrams = engrams;
  
  return memory;
}

async function storeInteraction(context: ConversationContext, response: AgentResponse): Promise<void> {
  // Store significant interactions as engrams
  if (context.intent.confidence > 0.8) {
    await dynamoDBService.saveEngram({
      userId: context.userId,
      timestamp: new Date().toISOString(),
      type: 'interaction',
      content: {
        intent: context.intent.intent,
        entities: context.intent.entities,
        response: response.text,
        metadata: response.metadata
      }
    });
  }
}