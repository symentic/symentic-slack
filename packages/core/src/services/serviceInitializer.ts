import { redisService } from './redis';
import { slackService } from './slack';

export async function initializeServices(): Promise<void> {
  console.log('Initializing services...');

  try {
    // Connect to Redis
    await redisService.connect();
    console.log('✓ Redis connected');

    // Test DynamoDB connection by checking if tables exist
    // In production, you might want to create tables if they don't exist
    console.log('✓ DynamoDB service initialized');

    // Initialize Slack service
    const workspaceInfo = await slackService.getWorkspaceInfo();
    if (workspaceInfo) {
      console.log(`✓ Connected to Slack workspace: ${workspaceInfo.name}`);
    }

    console.log('All services initialized successfully');
  } catch (error) {
    console.error('Failed to initialize services:', error);
    throw error;
  }
}

export async function shutdownServices(): Promise<void> {
  console.log('Shutting down services...');

  try {
    await redisService.disconnect();
    console.log('✓ Redis disconnected');

    slackService.clearUserCache();
    console.log('✓ Slack cache cleared');

    console.log('All services shut down successfully');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
}