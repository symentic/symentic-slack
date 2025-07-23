import { Handler } from 'aws-lambda';
import { WebClient } from '@slack/web-api';
import { BugReport } from '@symentic/core';

interface SlackNotificationEvent {
  action: string;
  context: {
    userId: string;
    channelId: string;
    teamId: string;
    slackClient?: string;
  };
  threadTs: string;
  [key: string]: any;
}

export const handler: Handler<SlackNotificationEvent> = async (event) => {
  console.log('Slack notification Lambda:', JSON.stringify(event, null, 2));
  
  const slack = new WebClient(event.context.slackClient || process.env.SLACK_BOT_TOKEN);
  
  try {
    switch (event.action) {
      case 'sendBugQuestions':
        await sendBugQuestions(slack, event);
        break;
        
      case 'cancelBugReport':
        await sendCancellationMessage(slack, event);
        break;
        
      case 'timeoutNotification':
        await sendTimeoutMessage(slack, event);
        break;
        
      case 'bugReportComplete':
        await sendCompletionMessage(slack, event);
        break;
        
      default:
        console.error('Unknown action:', event.action);
    }
  } catch (error) {
    console.error('Error sending Slack notification:', error);
    throw error;
  }
};

async function sendBugQuestions(slack: WebClient, event: SlackNotificationEvent) {
  const questions = event.questions.questions as string[];
  
  await slack.chat.postMessage({
    channel: event.context.channelId,
    thread_ts: event.threadTs,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*To help resolve this issue, I need some additional information:*'
        }
      },
      ...questions.map((q, i) => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${i + 1}. ${q}`
        }
      })),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_Please provide as much detail as possible. Type "cancel" to stop the bug report._'
        }
      }
    ]
  });
}

async function sendCancellationMessage(slack: WebClient, event: SlackNotificationEvent) {
  await slack.chat.postMessage({
    channel: event.context.channelId,
    thread_ts: event.threadTs,
    text: '✅ Bug report cancelled. Feel free to report a new bug anytime!'
  });
}

async function sendTimeoutMessage(slack: WebClient, event: SlackNotificationEvent) {
  await slack.chat.postMessage({
    channel: event.context.channelId,
    thread_ts: event.threadTs,
    text: '⏱️ This bug report has timed out. Please start a new report if you still need assistance.'
  });
}

async function sendCompletionMessage(slack: WebClient, event: SlackNotificationEvent) {
  const bugReport = event.bugReport as BugReport;
  
  const blocks: any[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *Bug Report Created Successfully!*\n*ID:* ${bugReport.bugId}\n*Severity:* ${bugReport.severity || 'Medium'}`
      }
    }
  ];
  
  if (event.engineers && event.engineers.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Assigned to:* ${event.engineers.map((e: any) => `<@${e.userId}>`).join(', ')}`
      }
    });
  }
  
  if (event.meeting) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Triage Meeting:* ${new Date(event.meeting.startTime).toLocaleString()}`
      }
    });
  }
  
  await slack.chat.postMessage({
    channel: event.context.channelId,
    thread_ts: event.threadTs,
    blocks
  });
}