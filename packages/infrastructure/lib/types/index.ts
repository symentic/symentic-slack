import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface LambdaFunctions {
  router: lambda.Function;
  bugAnalyze: lambda.Function;
  bugQuestions: lambda.Function;
  bugProcessResponse: lambda.Function;
  bugUpdate: lambda.Function;
  bugEnhance: lambda.Function;
  bugFindEngineers: lambda.Function;
  bugCreateChannel: lambda.Function;
  bugSave: lambda.Function;
  bugTrackExecution: lambda.Function;
  bugResponseHandler: lambda.Function;
  calendarCheckAvailability: lambda.Function;
  calendarScheduleMeeting: lambda.Function;
  bugTriageCheckAvailability: lambda.Function;
  bugTriageScheduleMeeting: lambda.Function;
  calendarOauthCallback: lambda.Function;
  slackNotify: lambda.Function;
  profileSyncWorkspace: lambda.Function;
  // Calendar agent functions
  calendarAnalyzeFunction: lambda.Function;
  calendarExtractParticipantsFunction: lambda.Function;
  calendarCheckAvailabilityFunction: lambda.Function;
  calendarAskConfirmationFunction: lambda.Function;
  calendarProcessResponseFunction: lambda.Function;
  calendarCreateEventFunction: lambda.Function;
  calendarMarkOOOFunction: lambda.Function;
  calendarSaveEngramsFunction: lambda.Function;
  calendarNotifyFunction: lambda.Function;
}

export interface DynamoDBTables {
  usersTable: dynamodb.Table;
  workspacesTable: dynamodb.Table;
  engramsTable: dynamodb.Table;
  bugReportsTable: dynamodb.Table;
  calendarTokensTable: dynamodb.Table;
  meetingsTable: dynamodb.Table;
  areaExpertiseTable: dynamodb.Table;
  workflowsTable: dynamodb.Table;
  executionsTable: dynamodb.Table;
  profileEngramsTable: dynamodb.Table;
  userIdMappingsTable: dynamodb.Table;
}

export interface StageConfig {
  stage: string;
  region?: string;
}

export interface EnvironmentConfig {
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  OPENAI_API_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  INTERNAL_API_KEY: string;
  REDIS_URL?: string;
  AWS_REGION?: string;
}