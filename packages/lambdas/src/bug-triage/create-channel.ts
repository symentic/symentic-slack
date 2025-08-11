import { Handler } from 'aws-lambda';
import { WebClient } from '@slack/web-api';
import { extractPayload, extractArrayPayload } from '../utils/step-functions';
import { BugReportData, Engineer, SlackBlock } from './types';

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
    Payload?: Array<Engineer & {
      title?: string;
      bio?: string;
      assignmentReason?: string;
    }>;
  } | Array<Engineer & {
    title?: string;
    bio?: string;
    assignmentReason?: string;
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
  
  // Handle Step Functions nested payload structure
  const bugReport = extractPayload(event.bugReport);
  const engineers = extractArrayPayload(event.engineers);
  
  if (!bugReport) {
    throw new Error('Bug report data is missing');
  }
  
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  
  try {
    let channelId: string = '';
    let channelName: string = '';
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
      // Bug number should already be assigned by analyze step
      if (!bugNumber) {
        throw new Error('Bug number not provided - should be assigned in analyze step');
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
        } catch (error) {
          const errorData = error as { data?: { error?: string } };
          if (errorData?.data?.error === 'name_taken') {
            // Try to find and use existing channel
            const existingChannels = await slack.conversations.list({
              exclude_archived: true
            });
            
            const targetName = attemptCount === 0 ? channelName : `${channelName}-${attemptCount}`;
            const existingChannel = existingChannels.channels?.find(
              ch => ch.name === targetName
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
      ...engineers.map((e) => e.userId)
    ].filter(Boolean);
    
    if (userIds.length > 0 && channelId) {
      try {
        await slack.conversations.invite({
          channel: channelId,
          users: userIds.join(',')
        });
      } catch (error: any) {
        // Users might already be in channel if reusing - this is expected
      }
    }
    
    // Post bug overview (for new channels or updates to existing)
    const overviewMessage = await slack.chat.postMessage({
      channel: channelId!,
      blocks: createBugOverviewBlocks(bugReport, engineers, bugNumber, isExisting)
    });
    
    // Pin the overview message for easy reference
    if (overviewMessage.ts && !isExisting) {
      try {
        await slack.pins.add({
          channel: channelId!,
          timestamp: overviewMessage.ts
        });
      } catch (error) {
        // Pinning might fail due to permissions - non-critical
      }
    }
    
    return {
      channelId: channelId!,
      channelName: channelName!,
      isExisting,
      bugNumber
    };
  } catch (error) {
    throw error;
  }
};

function createBugOverviewBlocks(
  bugReport: Partial<BugReportData> & { 
    bugId?: string; 
    bugNumber?: number; 
    duplicateOf?: string;
    description: string;
    reportedBy: string;
    severity?: string;
    category?: string;
    reproductionSteps?: string;
    environment?: string;
    impact?: string;
  },
  engineers: Array<Engineer & {
    title?: string;
    bio?: string;
    assignmentReason?: string;
  }> | undefined,
  bugNumber?: number,
  isUpdate = false
): SlackBlock[] {
  const severity = bugReport.severity || 'medium';
  const severityMap: { [key: string]: string } = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢'
  };
  const severityEmoji = severityMap[severity.toLowerCase()] || '🟡';
  
  const blocks: SlackBlock[] = [
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
          text: `*Bug ID:*\n\`${bugReport.bugId || 'Not assigned'}\``
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
  
  // Add assigned engineers with detailed information
  if (engineers && engineers.length > 0) {
    blocks.push(
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🎯 Assigned Engineers:*\n_Based on our analysis and engineer expertise, the following team members have been assigned to this issue:_'
        }
      }
    );
    
    // Add each engineer with their details
    engineers.forEach((engineer) => {
      const engineerBlocks: SlackBlock[] = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*<@${engineer.userId}>* - ${engineer.name}${engineer.title ? ` (${engineer.title})` : ''}`
          }
        }
      ];
      
      if (engineer.bio) {
        engineerBlocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `_${engineer.bio}_`
            }
          ]
        });
      }
      
      if (engineer.assignmentReason) {
        engineerBlocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `📌 *Why assigned:* ${engineer.assignmentReason}`
            }
          ]
        });
      }
      
      blocks.push(...engineerBlocks);
    });
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