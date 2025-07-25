import { Handler } from 'aws-lambda';
import { WebClient } from '@slack/web-api';
import { bugCounterService } from '@symentic/core';

interface CreateChannelEvent {
  bugReport: {
    Payload?: {
      bugId: string;
      bugNumber?: number;
      description: string;
      reportedBy: string;
      severity?: string;
      category?: string;
      reproductionSteps?: string;
      environment?: string;
      impact?: string;
      duplicateOf?: string;
      channelId?: string; // Existing channel if duplicate
    };
  } | {
    bugId: string;
    bugNumber?: number;
    description: string;
    reportedBy: string;
    severity?: string;
    category?: string;
    reproductionSteps?: string;
    environment?: string;
    impact?: string;
    duplicateOf?: string;
    channelId?: string;
  };
  engineers?: {
    Payload?: Array<{
      userId: string;
      name: string;
    }>;
  } | Array<{
    userId: string;
    name: string;
  }>;
  workspaceId: string;
}

interface ChannelResult {
  channelId: string;
  channelName: string;
  isExisting?: boolean;
  bugNumber?: number;
}

export const handler: Handler<CreateChannelEvent, ChannelResult> = async (event) => {
  console.log('Creating/updating triage channel:', JSON.stringify(event, null, 2));
  
  // Handle Step Functions nested payload structure
  const bugReport = 'Payload' in event.bugReport ? event.bugReport.Payload : event.bugReport;
  const engineers = event.engineers && 'Payload' in event.engineers ? event.engineers.Payload : (event.engineers || []);
  
  if (!bugReport) {
    throw new Error('Bug report data is missing');
  }
  
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  
  try {
    let channelId: string;
    let channelName: string;
    let isExisting = false;
    let bugNumber = bugReport.bugNumber;
    
    // Check if this is a duplicate bug with existing channel
    if (bugReport.channelId) {
      channelId = bugReport.channelId;
      isExisting = true;
      
      // Get channel info
      const channelInfo = await slack.conversations.info({ channel: channelId });
      channelName = channelInfo.channel?.name || 'unknown';
      
      console.log('Using existing channel for duplicate bug:', channelName);
    } else {
      // Get next bug number if not provided
      if (!bugNumber) {
        bugNumber = await bugCounterService.getNextBugNumber(event.workspaceId);
      }
      
      channelName = `bug-${bugNumber}`;
      
      // Try to create channel, handle name collision
      let attemptCount = 0;
      let created = false;
      
      while (!created && attemptCount < 5) {
        try {
          const result = await slack.conversations.create({
            name: attemptCount === 0 ? channelName : `${channelName}-${attemptCount}`,
            is_private: false // Making it public for easier access
          });
          
          if (!result.channel?.id) {
            throw new Error('Failed to create channel');
          }
          
          channelId = result.channel.id;
          channelName = result.channel.name || channelName;
          created = true;
        } catch (error: any) {
          if (error?.data?.error === 'name_taken') {
            // Try to find and use existing channel
            const existingChannels = await slack.conversations.list({
              exclude_archived: true
            });
            
            const existingChannel = existingChannels.channels?.find(
              ch => ch.name === (attemptCount === 0 ? channelName : `${channelName}-${attemptCount}`)
            );
            
            if (existingChannel) {
              channelId = existingChannel.id!;
              channelName = existingChannel.name!;
              isExisting = true;
              created = true;
            } else {
              attemptCount++;
            }
          } else {
            throw error;
          }
        }
      }
      
      if (!created) {
        throw new Error('Failed to create channel after multiple attempts');
      }
    }
    
    // Invite relevant users
    const userIds = [
      bugReport.reportedBy,
      ...(engineers || []).map((e: any) => e.userId)
    ].filter(Boolean);
    
    if (userIds.length > 0) {
      try {
        await slack.conversations.invite({
          channel: channelId,
          users: userIds.join(',')
        });
      } catch (error: any) {
        // Users might already be in channel if reusing
        console.log('Error inviting users (might already be members):', error?.data?.error);
      }
    }
    
    // Post bug overview (for new channels or updates to existing)
    const overviewMessage = await slack.chat.postMessage({
      channel: channelId,
      blocks: createBugOverviewBlocks(bugReport, engineers, bugNumber, isExisting)
    });
    
    // Pin the overview message for easy reference
    if (overviewMessage.ts && !isExisting) {
      try {
        await slack.pins.add({
          channel: channelId,
          timestamp: overviewMessage.ts
        });
      } catch (error) {
        console.log('Error pinning message:', error);
      }
    }
    
    return {
      channelId,
      channelName,
      isExisting,
      bugNumber
    };
  } catch (error) {
    console.error('Error creating channel:', error);
    throw error;
  }
};

function createBugOverviewBlocks(
  bugReport: any,
  engineers: any[] | undefined,
  bugNumber?: number,
  isUpdate = false
): any[] {
  const severity = bugReport.severity || 'medium';
  const severityEmoji = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢'
  }[severity] || '🟡';
  
  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🐛 Bug #${bugNumber || 'Unknown'} ${isUpdate ? '(Updated)' : ''}`
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Severity:*\n${severityEmoji} ${severity.charAt(0).toUpperCase() + severity.slice(1)}`
        },
        {
          type: 'mrkdwn',
          text: `*Category:*\n${bugReport.category || 'Uncategorized'}`
        },
        {
          type: 'mrkdwn',
          text: `*Reporter:*\n<@${bugReport.reportedBy}>`
        },
        {
          type: 'mrkdwn',
          text: `*Bug ID:*\n\`${bugReport.bugId}\``
        }
      ]
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Description:*\n${bugReport.description}`
      }
    }
  ];
  
  // Add reproduction steps if available
  if (bugReport.reproductionSteps) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reproduction Steps:*\n${bugReport.reproductionSteps}`
      }
    });
  }
  
  // Add environment if available
  if (bugReport.environment) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Environment:*\n${bugReport.environment}`
      }
    });
  }
  
  // Add impact if available
  if (bugReport.impact) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Impact:*\n${bugReport.impact}`
      }
    });
  }
  
  // Add assigned engineers
  if (engineers && engineers.length > 0) {
    blocks.push(
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Assigned Engineers:*\n${engineers.map((e: any) => `• <@${e.userId}> - ${e.name}`).join('\n')}`
        }
      }
    );
  }
  
  // Add duplicate notice if applicable
  if (bugReport.duplicateOf) {
    blocks.push(
      {
        type: 'divider'
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `⚠️ This appears to be a duplicate of Bug #${bugReport.duplicateOf}`
          }
        ]
      }
    );
  }
  
  // Add timestamp
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Created: <!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} at {time}|${new Date().toISOString()}>`
      }
    ]
  });
  
  return blocks;
}