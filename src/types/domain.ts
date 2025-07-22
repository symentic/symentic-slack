// Domain-specific type definitions

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
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdAt: string;
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