// Shared types for bug triage workflow

export interface ConversationPair {
  question: string;
  response: string;
}

export interface SlackContext {
  userId: string;
  channelId: string;
  teamId: string;
  slackClient?: string;
}

export interface BugReportData {
  description: string;
  reportedBy: string;
  channel: string;
  timestamp: string;
  severity?: string;
  reproductionSteps?: string;
  environment?: string;
  impact?: string;
  errorMessages?: string;
  frequency?: string;
  completenessScore?: number;
  bugId?: string;
  bugNumber?: number;
  category?: string;
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: string;
  }>;
  accessory?: {
    type: string;
    text?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    value?: string;
    url?: string;
    action_id?: string;
  };
  block_id?: string;
  fields?: Array<{
    type: 'mrkdwn' | 'plain_text';
    text: string;
  }>;
}

export interface ChannelInfo {
  id: string;
  name: string;
  is_channel: boolean;
  is_group: boolean;
  is_im: boolean;
  is_mpim: boolean;
  is_private: boolean;
  created: number;
  creator: string;
  is_archived: boolean;
  is_general: boolean;
  unlinked: number;
  name_normalized: string;
  is_shared: boolean;
  is_ext_shared: boolean;
  is_org_shared: boolean;
  pending_shared: string[];
  is_pending_ext_shared: boolean;
  is_member: boolean;
  is_private_dm?: boolean;
  topic?: {
    value: string;
    creator: string;
    last_set: number;
  };
  purpose?: {
    value: string;
    creator: string;
    last_set: number;
  };
}

export interface Engineer {
  userId: string;
  name: string;
  expertise?: string[];
  relevanceScore?: number;
}