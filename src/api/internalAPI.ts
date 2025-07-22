import { Express, Request, Response, NextFunction } from 'express';
import { App } from '@slack/bolt';
import { redisService } from '../services/redis';
import { dynamoDBService } from '../services/dynamodb';

export function setupInternalAPI(expressApp: Express, slackApp: App): void {
  // Middleware for API key authentication
  const authenticateAPI = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
    return;
  };

  // GET /messages - Get recent messages from a channel
  expressApp.get('/messages', authenticateAPI, async (req, res) => {
    try {
      const { channel, limit = 50 } = req.query;
      
      if (!channel) {
        return res.status(400).json({ error: 'Channel parameter is required' });
      }

      const messages = await redisService.getRecentMessages(
        channel as string,
        parseInt(limit as string)
      );

      return res.json({
        channel,
        messages,
        count: messages.length,
      });
    } catch (error) {
      console.error('Error fetching messages:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /users - Get user profiles
  expressApp.get('/users', authenticateAPI, async (req, res) => {
    try {
      const { userId, workspaceId } = req.query;

      if (userId) {
        const profile = await dynamoDBService.getUserProfile(userId as string);
        if (!profile) {
          return res.status(404).json({ error: 'User not found' });
        }
        return res.json(profile);
      }

      if (workspaceId) {
        // Get all users in workspace (simplified - in production, implement pagination)
        const workspace = await dynamoDBService.getWorkspaceProfile(workspaceId as string);
        return res.json({
          workspaceId,
          workspace,
        });
      }

      return res.status(400).json({ error: 'userId or workspaceId parameter is required' });
    } catch (error) {
      console.error('Error fetching users:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /memory - Get user memory (engrams)
  expressApp.get('/memory', authenticateAPI, async (req, res) => {
    try {
      const { user: userId, limit = 50 } = req.query;

      if (!userId) {
        return res.status(400).json({ error: 'user parameter is required' });
      }

      const engrams = await dynamoDBService.getUserEngrams(
        userId as string,
        parseInt(limit as string)
      );

      return res.json({
        userId,
        engrams,
        count: engrams.length,
      });
    } catch (error) {
      console.error('Error fetching memory:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /message - Send a message as the bot
  expressApp.post('/message', authenticateAPI, async (req, res) => {
    try {
      const { channel, text, thread_ts, blocks } = req.body;

      if (!channel || (!text && !blocks)) {
        return res.status(400).json({ 
          error: 'channel and either text or blocks are required' 
        });
      }

      const result = await slackApp.client.chat.postMessage({
        channel,
        text,
        thread_ts,
        blocks,
      });

      return res.json({
        ok: result.ok,
        ts: result.ts,
        channel: result.channel,
      });
    } catch (error) {
      console.error('Error sending message:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /create-bot - Create a new child bot/agent
  expressApp.post('/create-bot', authenticateAPI, async (req, res) => {
    try {
      const { 
        name, 
        type, 
        config,
        triggers,
        capabilities 
      } = req.body;

      if (!name || !type) {
        return res.status(400).json({ 
          error: 'name and type are required' 
        });
      }

      // Save bot configuration to DynamoDB
      const botId = `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      await dynamoDBService.saveUserProfile(botId, {
        userId: botId,
        slackId: botId,
        displayName: name,
        preferences: {
          type: 'bot',
          botType: type,
          config,
          triggers,
          capabilities,
          status: 'active'
        },
        createdAt: new Date().toISOString()
      });

      return res.json({
        botId,
        name,
        type,
        status: 'active',
        message: 'Child bot created successfully',
      });
    } catch (error) {
      console.error('Error creating bot:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /bugs - Get bug reports
  expressApp.get('/bugs', authenticateAPI, async (req, res) => {
    try {
      const { bugId } = req.query;

      if (bugId) {
        const bug = await dynamoDBService.getBugReport(bugId as string);
        if (!bug) {
          return res.status(404).json({ error: 'Bug not found' });
        }
        return res.json(bug);
      }

      // In production, implement proper querying by status/userId
      return res.json({
        message: 'Bug listing not fully implemented',
        hint: 'Provide bugId parameter to get specific bug',
      });
    } catch (error) {
      console.error('Error fetching bugs:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /health - Health check endpoint
  expressApp.get('/health', async (_req, res) => {
    try {
      // Check Redis connection
      await redisService.connect();
      
      return res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          redis: 'connected',
          dynamodb: 'available',
          slack: 'connected',
        },
      });
    } catch (error) {
      console.error('Health check failed:', error);
      return res.status(503).json({
        status: 'unhealthy',
        error: 'Service unavailable',
      });
    }
  });

  // Google Calendar OAuth routes
  // GET /auth/google - Initiate Google OAuth
  expressApp.get('/auth/google', authenticateAPI, async (req, res) => {
    try {
      const { userId } = req.query;
      
      if (!userId) {
        return res.status(400).json({ error: 'userId parameter is required' });
      }

      const { googleCalendarService } = await import('../services/googleCalendar');
      const authUrl = await googleCalendarService.getAuthUrl(userId as string);
      
      return res.json({
        authUrl,
        message: 'Visit this URL to authorize calendar access',
      });
    } catch (error) {
      console.error('Error generating auth URL:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /auth/google/callback - Handle OAuth callback
  expressApp.get('/auth/google/callback', async (req, res) => {
    try {
      const { code, state: userId } = req.query;
      
      if (!code || !userId) {
        return res.status(400).send('Missing authorization code or user ID');
      }

      const { googleCalendarService } = await import('../services/googleCalendar');
      await googleCalendarService.handleAuthCallback(code as string, userId as string);
      
      return res.send(`
        <html>
          <body>
            <h2>✅ Calendar Access Authorized</h2>
            <p>You can now close this window. Calendar integration is active for your Slack account.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('OAuth callback error:', error);
      return res.status(500).send('Authorization failed. Please try again.');
    }
  });

}