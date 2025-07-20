import { WebClient } from '@slack/web-api';
import { redisService } from '../services/redis';
import { dynamoDBService } from '../services/dynamodb';
import { openAIService } from '../services/openai';
import { bugTriageAgent } from '../agents/bugTriageAgent';

// Pre-filter function to determine if message needs processing
function shouldProcessMessage(text: string, channelType: string, botUserId?: string): boolean {
  const lowerText = text.toLowerCase();
  
  // Always process direct messages
  if (channelType === 'im') {
    return true;
  }
  
  // Process if bot is mentioned (we'll need to get bot user ID)
  if (botUserId && text.includes(`<@${botUserId}>`)) {
    return true;
  }
  
  // Process specific commands/keywords
  const triggerKeywords = [
    'bug:',
    'bug with',
    'there is a bug',
    'found a bug',
    'bug in',
    'remind me',
    'schedule',
    'meeting',
    'help me',
    '@semantic', // in case someone tries to mention by name
  ];
  
  if (triggerKeywords.some(keyword => lowerText.includes(keyword))) {
    return true;
  }
  
  // Process questions that seem directed to the bot
  const botQuestions = [
    'can you',
    'could you',
    'would you',
    'please help',
    'i need help',
  ];
  
  if (botQuestions.some(phrase => lowerText.includes(phrase))) {
    return true;
  }
  
  // Don't process general chatter
  return false;
}

export async function messageHandler({
  message,
  say,
  client,
}: {
  message: any;
  say: any;
  client: WebClient;
}): Promise<void> {
  // Ignore bot messages
  if (message.bot_id || message.subtype === 'bot_message') {
    return;
  }

  // Check for duplicate message processing using message timestamp
  const messageKey = `processed:${message.ts}`;
  const alreadyProcessed = await redisService.getShortTermMemory(messageKey);
  if (alreadyProcessed) {
    console.log(`Skipping duplicate message: ${message.ts}`);
    return;
  }
  
  // Mark message as processed (with 5 minute TTL)
  await redisService.setShortTermMemory(messageKey, true, 300);

  const userId = message.user;
  const channelId = message.channel;
  const threadTs = message.thread_ts || message.ts;
  const text = message.text || '';

  try {
    // Cache message in Redis for recent history
    await redisService.cacheRecentMessage(channelId, {
      userId,
      text,
      ts: message.ts,
      threadTs,
    });

    // Check if this is a bug triage continuation
    const bugTriageState = await redisService.getBugTriageState(userId, threadTs);
    if (bugTriageState && bugTriageState.step !== 'complete') {
      const agent = bugTriageAgent(client);
      await agent.handleTriageResponse(message, say, bugTriageState);
      return;
    }

    // Pre-filter: Check if we should process this message
    const channelType = message.channel_type || (channelId.startsWith('D') ? 'im' : 'channel');
    
    // Get bot user ID if we don't have it cached
    let botUserId = await redisService.getShortTermMemory('bot:userId');
    if (!botUserId) {
      try {
        const authTest = await client.auth.test();
        botUserId = authTest.user_id;
        await redisService.setShortTermMemory('bot:userId', botUserId, 86400); // Cache for 24 hours
      } catch (error) {
        console.error('Failed to get bot user ID:', error);
      }
    }
    
    if (!shouldProcessMessage(text, channelType, botUserId)) {
      console.log('Message does not require bot response, skipping OpenAI API call');
      return;
    }

    // Process message with OpenAI to understand intent
    const analysis = await openAIService.processMessage(text, userId, {
      channelId,
      threadTs,
      recentMessages: await redisService.getRecentMessages(channelId, 10),
    });

    // Check if we should trigger bug triage agent
    const lowerText = text.toLowerCase();
    const bugPatterns = [
      /bug:\s*(.+)/i,
      /there is a bug(?:\s+with)?\s*(.+)/i,
      /found a bug(?:\s+in)?\s*(.+)/i,
      /bug with\s+(.+)/i,
      /bug in\s+(.+)/i
    ];
    
    let bugMatch = null;
    for (const pattern of bugPatterns) {
      const match = text.match(pattern);
      if (match) {
        bugMatch = match;
        break;
      }
    }
    
    if (bugMatch || analysis.shouldTriggerAgent === 'bug-triage') {
      const bugDescription = bugMatch ? bugMatch[1].trim() : text;
      const agent = bugTriageAgent(client);
      await agent.handleBugReport(message, say, bugDescription);
      return;
    }

    // Check for follow-up questions in triage channels
    if (channelId.startsWith('triage-')) {
      const bugId = channelId.replace('triage-', '').toUpperCase();
      if (text.includes('anything else') || text.includes('who else')) {
        const agent = bugTriageAgent(client);
        await agent.handleFollowUp(message, say, bugId);
        return;
      }
    }

    // Handle general conversation - only respond if there's actual content
    if (analysis.response && analysis.response.trim() !== '' && !text.startsWith('!silent')) {
      await say({
        text: analysis.response,
        thread_ts: threadTs,
      });
    }

    // Update user profile with activity
    await dynamoDBService.saveUserProfile(userId, {
      lastActiveAt: new Date().toISOString(),
      lastChannel: channelId,
      messageCount: (await dynamoDBService.getUserProfile(userId))?.messageCount + 1 || 1,
    });

  } catch (error) {
    console.error('Error handling message:', error);
    
    // Send error message only if it's a direct mention or DM
    // Note: botUserId is not available in the handler context, so we'll check for direct message only
    if (message.channel_type === 'im') {
      await say({
        text: "I encountered an error processing your message. Please try again later.",
        thread_ts: threadTs,
      });
    }
  }
}