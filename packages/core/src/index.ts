// Types
export * from './types/domain';
export * from './types/slack';
export * from './types/profile-engram';

// Services
export { dynamoDBService } from './services/dynamodb';
export { executionTracker } from './services/executionTracker';
export { googleCalendarService } from './services/googleCalendar';
export { intentClassifier } from './services/intentClassifier';
export { openAIService } from './services/openai';
export { redisService } from './services/redis';
export { initializeServices } from './services/serviceInitializer';
export { slackService } from './services/slack';
export { createAgentRegistry } from './services/agentRegistry';
export { profileEngramService } from './services/profileEngramService';
export { bugCounterService } from './services/bugCounterService';
export { bugSimilarityService } from './services/bugSimilarityService';

// Agents
export { BaseAgent } from './agents/base/BaseAgent';
export { BugTriageAgent } from './agents/bugTriageAgent';
export { CalendarAgent } from './agents/calendarAgent';

// Re-export types for convenience
export type {
  ConversationContext,
  AgentResponse,
  IntentResult,
  UserProfile,
  Engram,
  BugReport,
  Meeting,
  AreaExpertise,
  ExecutionData,
  ConversationMessage
} from './types/domain';

export type {
  EngramProfile,
  Enrichment,
  ProfileInteraction,
  ProfileSearchFilters,
  CreateProfileRequest,
  ProfileUpdateRequest,
  SlackUserData
} from './types/profile-engram';