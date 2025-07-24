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
  questions?: {
    Payload?: {
      questions: string[];
    };
  } | {
    questions: string[];
  };
  bugReport?: {
    Payload?: BugReport;
  } | BugReport;
  engineers?: {
    Payload?: Array<{
      userId: string;
      name: string;
    }>;
  } | Array<{
    userId: string;
    name: string;
  }>;
  meeting?: {
    Payload?: {
      startTime: string;
      meetingId: string;
    };
  } | {
    startTime: string;
    meetingId: string;
  };
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
        
      case 'maxAttemptsReached':
        await sendMaxAttemptsMessage(slack, event);
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
  if (!event.questions) {
    throw new Error('Questions not provided');
  }
  // Handle Step Functions nested payload structure
  const questionsData = 'Payload' in event.questions ? event.questions.Payload : event.questions;
  const questions = questionsData?.questions || [];
  
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
  if (!event.bugReport) {
    throw new Error('Bug report not provided');
  }
  // Handle Step Functions nested payload structure
  const bugReport = 'Payload' in event.bugReport ? event.bugReport.Payload : event.bugReport;
  
  const blocks: Array<{
    type: string;
    text?: {
      type: string;
      text: string;
    };
  }> = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *Bug Report Created Successfully!*\n*ID:* ${bugReport.bugId}\n*Severity:* ${bugReport.severity || 'Medium'}`
      }
    }
  ];
  
  // Handle Step Functions nested payload structure for engineers
  if (event.engineers) {
    const engineersData = 'Payload' in event.engineers ? event.engineers.Payload : event.engineers;
    if (engineersData && engineersData.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Assigned to:* ${engineersData.map((e) => `<@${e.userId}>`).join(', ')}`
        }
      });
    }
  }
  
  // Handle Step Functions nested payload structure for meeting
  if (event.meeting) {
    const meetingData = 'Payload' in event.meeting ? event.meeting.Payload : event.meeting;
    if (meetingData) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Triage Meeting:* ${new Date(meetingData.startTime).toLocaleString()}`
        }
      });
    }
  }
  
  await slack.chat.postMessage({
    channel: event.context.channelId,
    thread_ts: event.threadTs,
    blocks
  });
}

async function sendMaxAttemptsMessage(slack: WebClient, event: SlackNotificationEvent) {
  // Handle Step Functions nested payload structure
  const bugReportData = event.bugReport && 'Payload' in event.bugReport ? event.bugReport.Payload : event.bugReport;
  
  await slack.chat.postMessage({
    channel: event.context.channelId,
    thread_ts: event.threadTs,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '⚠️ *Maximum attempts reached for bug report*'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'I was unable to gather enough information after multiple attempts. The bug report has been saved with the available information.'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Summary:* ${(bugReportData as BugReport | undefined)?.description || 'No description available'}\n*Status:* Incomplete - manual review required`
        }
      }
    ]
  });
}