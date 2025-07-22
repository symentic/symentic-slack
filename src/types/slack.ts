// Slack-specific type definitions
import { WebClient } from '@slack/web-api';

export interface SlackMessage {
  type: string;
  subtype?: string;
  text?: string;
  user?: string;
  ts: string;
  thread_ts?: string;
  channel: string;
  channel_type?: string;
  bot_id?: string;
  team?: string;
  event_ts?: string;
}

export interface SlackSayFunction {
  (message: string | SlackMessageBlock): Promise<void>;
  (options: {
    text?: string;
    blocks?: SlackBlock[];
    thread_ts?: string;
    unfurl_links?: boolean;
    unfurl_media?: boolean;
  }): Promise<void>;
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
    text?: { type: string; text: string };
    value?: string;
    action_id?: string;
  }>;
  accessory?: {
    type: string;
    text?: { type: string; text: string };
    value?: string;
  };
  block_id?: string;
  fields?: Array<{ type: string; text: string }>;
}

export interface SlackMessageBlock {
  text: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
}

export interface SlackAction {
  type: string;
  action_id: string;
  block_id: string;
  value?: string;
  text?: {
    type: string;
    text: string;
  };
  action_ts: string;
  user: {
    id: string;
    username: string;
    name: string;
    team_id: string;
  };
  team: {
    id: string;
    domain: string;
  };
  channel: {
    id: string;
    name: string;
  };
  message: {
    type: string;
    user: string;
    ts: string;
    thread_ts?: string;
    text: string;
  };
}

export interface MessageHandlerContext {
  message: SlackMessage;
  say: SlackSayFunction;
  client: WebClient;
}

export interface SlackElement {
  type: string;
  text?: { type: string; text: string };
  value?: string;
  action_id?: string;
}