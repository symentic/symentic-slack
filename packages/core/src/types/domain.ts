// Domain-specific type definitions

// Intent classification result from GPT
export interface IntentResult {
  intent: string;
  confidence: number;
  entities: Record<string, unknown>;
  modelUsed: 'gpt-3.5-turbo' | 'gpt-4o-mini' | 'gpt-4o';
  requiresFollowUp?: string[];
  shouldRespond?: boolean;
}

// Context passed between agents and messages
export interface ConversationContext {
  userId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  originalText: string;
  intent: IntentResult;
  memory: {
    shortTerm: Record<string, unknown>;
    longTerm: Record<string, unknown>;
  };
  previousAgents?: string[];
}

// Response from an agent
export interface AgentResponse {
  text?: string;
  threadTs?: string;
  blocks?: Array<Record<string, unknown>>;
  shouldStore?: boolean;
  handoffTo?: string;
  metadata?: Record<string, unknown>;
}

// Execution tracking data
export interface ExecutionData {
  workflowId: string;
  executionId: string;
  userId: string;
  channelId: string;
  threadTs: string;
  intent: string;
  startTime: string;
  lastUpdate: string;
  state: Record<string, unknown>;
  status: 'active' | 'completed' | 'failed';
}

// Conversation message
export interface ConversationMessage {
  userId: string;
  channelId: string;
  text: string;
  timestamp: string;
  threadTs?: string;
}

export interface BugReport {
  bugId: string;
  userId: string;
  channelId: string;
  threadTs: string;
  description: string;
  reproductionSteps: string;
  environment: string;
  impact: string;
  severity: 'low' | 'medium' | 'high';
  category?: string;
  completenessScore: number;
  qualityRating: number;
  confidence: number;
  status: 'open' | 'in_progress' | 'resolved' | 'closed' | 'triaged';
  createdAt: string;
  updatedAt?: string;
  reportedBy: string;
  assignedTo?: string[];
  triageChannel?: string;
  meetingId?: string;
  conversations: {
    questions: string[];
    responses: string[];
  };
}

export interface Engineer {
  userId: string;
  level: 'expert' | 'intermediate' | 'beginner';
  matchScore: number;
}

export interface Meeting {
  meetingId: string;
  organizerId: string;
  participants: Array<{
    slackId: string;
    email: string;
    name: string;
  }>;
  scheduledAt: string;
  createdAt: string;
  title?: string;
  description?: string;
  duration?: number;
}

export interface CalendarEvent {
  time: string;
  title: string;
  attendees?: string;
}

export interface UserProfile {
  userId: string;
  slackId: string;
  email?: string;
  displayName?: string;
  realName?: string;
  timezone?: string;
  lastActiveAt?: string;
  lastChannel?: string;
  lastIntent?: string;
  messageCount?: number;
  preferences?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface Engram {
  engramId: string;
  userId: string;
  timestamp: string;
  type: string;
  content: {
    intent?: string;
    entities?: Record<string, unknown>;
    response?: string;
    metadata?: Record<string, unknown>;
  };
  createdAt: string;
}

export interface AreaExpertise {
  userId: string;
  area: string;
  level: 'expert' | 'intermediate' | 'beginner';
  keywords: string[];
  updatedAt: string;
}

export interface EnhancedBugTriageState {
  step: 'initial' | 'gathering_details' | 'analyzing_quality' | 'requesting_more_info' | 'finalizing' | 'complete';
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
}