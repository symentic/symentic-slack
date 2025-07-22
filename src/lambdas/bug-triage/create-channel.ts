import { Handler } from 'aws-lambda';
import { WebClient } from '@slack/web-api';

interface CreateChannelEvent {
  bugReport: {
    bugId: string;
    description: string;
    reportedBy: string;
    severity?: string;
  };
  engineers: Array<{
    userId: string;
    name: string;
  }>;
}

interface ChannelResult {
  channelId: string;
  channelName: string;
}

export const handler: Handler<CreateChannelEvent, ChannelResult> = async (event) => {
  console.log('Creating triage channel:', JSON.stringify(event, null, 2));
  
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  
  try {
    // Generate channel name
    const channelName = generateChannelName(event.bugReport);
    
    // Create private channel
    const result = await slack.conversations.create({
      name: channelName,
      is_private: true
    });
    
    if (!result.channel?.id) {
      throw new Error('Failed to create channel');
    }
    
    const channelId = result.channel.id;
    
    // Invite relevant users
    const userIds = [
      event.bugReport.reportedBy,
      ...event.engineers.map(e => e.userId)
    ];
    
    await slack.conversations.invite({
      channel: channelId,
      users: userIds.join(',')
    });
    
    // Post initial message
    await slack.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🐛 Bug Triage Channel'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Bug ID:* ${event.bugReport.bugId}\n*Severity:* ${event.bugReport.severity || 'Medium'}\n*Reporter:* <@${event.bugReport.reportedBy}>`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Description:*\n${event.bugReport.description}`
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Assigned Engineers:*\n${event.engineers.map(e => `• <@${e.userId}>`).join('\n')}`
          }
        }
      ]
    });
    
    return {
      channelId,
      channelName
    };
  } catch (error) {
    console.error('Error creating channel:', error);
    throw error;
  }
};

function generateChannelName(bugReport: { severity?: string; description: string }): string {
  // Slack channel names must be lowercase, no spaces, max 21 chars
  const severity = bugReport.severity?.toLowerCase() || 'med';
  const timestamp = Date.now().toString(36).slice(-4);
  const description = bugReport.description
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .substr(0, 10);
    
  return `bug-${severity}-${description}-${timestamp}`.substr(0, 21);
}