export interface EngramProfile {
  // Composite keys for business isolation
  id: string;                    // profile_{businessId}_{userId}
  businessId: string;            // Slack workspace ID (REQUIRED for all queries)
  userId: string;                // Slack user ID or external_{email/id}
  userType: 'internal' | 'external' | 'customer';
  
  // Profile data
  name: string;
  email?: string;
  role: string;
  description: string;
  tags: string[];
  expertise: string[];
  enrichments: Enrichment[];
  
  // Metadata
  source: 'slack' | 'email' | 'external_interaction' | 'manual';
  firstSeen: string;            // ISO timestamp when first encountered
  lastUpdated: string;          // ISO timestamp of last update
  lastInteraction: string;      // ISO timestamp of last message/interaction
  interactionCount: number;     // Total interactions
  
  // Consent tracking (mainly for external users)
  consent?: {
    given: boolean;
    timestamp?: string;
    method?: 'implicit' | 'explicit' | 'terms_acceptance';
  };
  
  // Internal users only (Slack members)
  slackProfile?: {
    slackUserId: string;
    realName: string;
    displayName: string;
    title?: string;
    department?: string;
    profilePictureUrl?: string;
    timezone?: string;
    statusText?: string;
    isOwner?: boolean;
    isAdmin?: boolean;
  };
  
  // External users only
  externalProfile?: {
    company?: string;
    domain?: string;              // Email domain for grouping
    firstContactChannel?: string; // Where they first appeared
    primaryContact?: string;      // Internal user who interacts most
    referenceCount?: number;      // How many times mentioned
  };
  
  // Calendar integration
  calendarTokenId?: string;       // Reference to calendar OAuth token
}

export interface Enrichment {
  // Simple format for dashboard display
  agent: string;                  // e.g., "bug agent", "sourcing agent", "enrichment agent"
  date: string;                   // YYYY-MM-DD format
  detail: string;                 // Short, concise description of the activity
  
  // Optional extended fields (not displayed on dashboard)
  id?: string;                    // Unique enrichment ID
  metadata?: {
    bugId?: string;
    meetingId?: string;
    channelId?: string;
    messageTs?: string;
    workflowId?: string;
  };
}

export interface ProfileInteraction {
  businessId: string;
  userId: string;
  timestamp: string;
  type: 'message' | 'bug_report' | 'meeting' | 'mention' | 'reaction';
  channel?: string;
  
  // Interaction details
  details?: {
    intent?: string;
    confidence?: number;
    entities?: Record<string, unknown>;
    message?: string;
    participants?: string[];
  };
}

export interface ProfileSearchFilters {
  businessId: string;             // Always required
  userType?: 'internal' | 'external' | 'customer';
  tags?: string[];                // Match any tag
  expertise?: string[];           // Match any expertise
  lastInteractionAfter?: string;  // ISO timestamp
  hasConsent?: boolean;           // For external users
  domain?: string;                // For external users by company
}

export interface ProfileUpdateRequest {
  businessId: string;
  userId: string;
  updates: Partial<EngramProfile>;
  enrichments?: Enrichment[];     // New enrichments to add
}

// Slack user type subset we care about
export interface SlackUserData {
  id: string;
  name: string;
  real_name?: string;
  is_bot?: boolean;
  is_owner?: boolean;
  is_admin?: boolean;
  deleted?: boolean;
  tz?: string;
  profile?: {
    display_name?: string;
    title?: string;
    status_text?: string;
    email?: string;
    image_192?: string;
    image_512?: string;
    fields?: Record<string, unknown>;
  };
}

// Helper type for creating profiles
export interface CreateProfileRequest {
  businessId: string;
  userId: string;
  userType: 'internal' | 'external' | 'customer';
  name: string;
  email?: string;
  source: 'slack' | 'email' | 'external_interaction' | 'manual';
  
  // Optional initial data
  role?: string;
  description?: string;
  tags?: string[];
  slackData?: SlackUserData;    // Typed Slack user object
  consent?: EngramProfile['consent'];
}