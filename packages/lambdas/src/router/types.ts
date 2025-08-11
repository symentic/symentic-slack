// Types for router Lambda function

export interface CalendarToken {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expiry_date?: number;
  scope?: string;
}

export interface CalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  start?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  } | string;
  end?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  } | string;
  status?: string;
  visibility?: string;
  transparency?: string;
  attendees?: Array<{
    email: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
  }>;
  organizer?: {
    email: string;
    self?: boolean;
  };
  location?: string;
  htmlLink?: string;
}

export interface BusySlot {
  start: string;
  end: string;
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
    type: string;
    text: string;
  }>;
}

export interface SlackEvent {
  type: string;
  user?: string;
  channel?: string;
  team?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  event_ts?: string;
  subtype?: string;
  bot_id?: string;
  blocks?: SlackBlock[];
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    url_private?: string;
    url_private_download?: string;
  }>;
}

export interface SlackCommand {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
  api_app_id: string;
}

export interface SlackInteraction {
  type: string;
  user: {
    id: string;
    username?: string;
    name?: string;
    team_id?: string;
  };
  api_app_id: string;
  token: string;
  container?: {
    type: string;
    message_ts?: string;
    channel_id?: string;
    is_ephemeral?: boolean;
  };
  trigger_id?: string;
  team?: {
    id: string;
    domain?: string;
  };
  channel?: {
    id: string;
    name?: string;
  };
  message?: {
    type: string;
    text?: string;
    ts?: string;
    bot_id?: string;
    blocks?: SlackBlock[];
  };
  state?: {
    values?: Record<string, Record<string, unknown>>;
  };
  response_url?: string;
  actions?: Array<{
    type: string;
    action_id: string;
    block_id?: string;
    text?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    value?: string;
    style?: string;
    action_ts?: string;
  }>;
  view?: {
    id: string;
    team_id: string;
    type: string;
    blocks?: SlackBlock[];
    private_metadata?: string;
    callback_id?: string;
    state?: {
      values?: Record<string, Record<string, unknown>>;
    };
    hash?: string;
    title?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    clear_on_close?: boolean;
    notify_on_close?: boolean;
    close?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    submit?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    previous_view_id?: string | null;
    root_view_id?: string;
    app_id?: string;
    external_id?: string;
    app_installed_team_id?: string;
    bot_id?: string;
  };
}

export interface APIGatewayEvent {
  body?: string | null;
  headers: Record<string, string>;
  httpMethod: string;
  isBase64Encoded: boolean;
  path: string;
  pathParameters?: Record<string, string> | null;
  queryStringParameters?: Record<string, string> | null;
  requestContext: {
    accountId: string;
    apiId: string;
    authorizer?: Record<string, unknown>;
    domainName: string;
    domainPrefix: string;
    http: {
      method: string;
      path: string;
      protocol: string;
      sourceIp: string;
      userAgent: string;
    };
    requestId: string;
    routeKey: string;
    stage: string;
    time: string;
    timeEpoch: number;
  };
  resource: string;
  stageVariables?: Record<string, string> | null;
}

export type APIGatewayCallback = (error: Error | null, result?: {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}) => void;