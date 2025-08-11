// Comprehensive Slack Block types

export interface SlackTextObject {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
  verbatim?: boolean;
}

export interface SlackOption {
  text: SlackTextObject;
  value: string;
  description?: SlackTextObject;
  url?: string;
}

export interface SlackAccessory {
  type: string;
  action_id?: string;
  text?: SlackTextObject;
  value?: string;
  url?: string;
  options?: SlackOption[];
  initial_option?: SlackOption;
  placeholder?: SlackTextObject;
}

export interface SlackElement {
  type: string;
  text?: SlackTextObject | string;
  action_id?: string;
  value?: string;
  style?: string;
  url?: string;
  placeholder?: SlackTextObject;
  initial_option?: SlackOption;
  options?: SlackOption[];
}

export interface SlackBlock {
  type: 'section' | 'divider' | 'image' | 'actions' | 'context' | 'header';
  block_id?: string;
  text?: SlackTextObject;
  fields?: SlackTextObject[];
  accessory?: SlackAccessory;
  elements?: SlackElement[];
  image_url?: string;
  alt_text?: string;
  title?: SlackTextObject;
  fallback?: string;
  image_width?: number;
  image_height?: number;
  image_bytes?: number;
}