// Types for profile engram service

export interface SlackProfile {
  slackUserId: string;
  realName?: string;
  displayName?: string;
  title?: string;
  statusText?: string;
  statusEmoji?: string;
  isAdmin: boolean;
  isOwner: boolean;
  isPrimaryOwner: boolean;
  isBot: boolean;
  timeZone?: string;
  teamId: string;
}

export interface UserProfile {
  id: string;
  businessId: string;
  name: string;
  email?: string;
  role?: string;
  bio?: string;
  slackProfile?: SlackProfile;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
  profileType?: 'internal' | 'external';
  metadata?: Record<string, unknown>;
}

export interface ProfileUpdate {
  name?: string;
  email?: string;
  role?: string;
  bio?: string;
  slackProfile?: SlackProfile;
  isActive?: boolean;
  updatedAt: string;
  lastSyncedAt?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}