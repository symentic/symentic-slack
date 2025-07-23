import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import * as path from 'path';
import { LambdaFunctions, DynamoDBTables, EnvironmentConfig } from '../types';

export interface LambdaFunctionsConstructProps {
  stage: string;
  tables: DynamoDBTables;
  bugResponseQueue: sqs.Queue;
  envConfig: EnvironmentConfig;
}

export class LambdaFunctionsConstruct extends Construct {
  public readonly functions: LambdaFunctions;
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: LambdaFunctionsConstructProps) {
    super(scope, id);

    const { stage, tables, bugResponseQueue, envConfig } = props;

    // Create Lambda execution role
    this.role = this.createLambdaRole(tables, bugResponseQueue);

    // Create Lambda layer for shared dependencies
    // const lambdaLayer = this.createLambdaLayer();

    // Create environment variables
    const environment = this.createEnvironmentVariables(stage, tables, bugResponseQueue, envConfig);

    // Define Lambda functions
    const functionDefinitions = [
      { name: 'router', entry: 'src/router/index.ts', handler: 'handler', memory: 512 },
      { name: 'bugAnalyze', entry: 'src/bug-triage/analyze.ts', handler: 'handler' },
      { name: 'bugQuestions', entry: 'src/bug-triage/questions.ts', handler: 'handler' },
      { name: 'bugProcessResponse', entry: 'src/bug-triage/process-response.ts', handler: 'handler' },
      { name: 'bugUpdate', entry: 'src/bug-triage/update-bug.ts', handler: 'handler' },
      { name: 'bugFindEngineers', entry: 'src/bug-triage/find-engineers.ts', handler: 'handler' },
      { name: 'bugCreateChannel', entry: 'src/bug-triage/create-channel.ts', handler: 'handler' },
      { name: 'bugSave', entry: 'src/bug-triage/save-bug.ts', handler: 'handler' },
      { name: 'bugTrackExecution', entry: 'src/bug-triage/track-execution.ts', handler: 'handler' },
      { name: 'bugResponseHandler', entry: 'src/bug-triage/response-handler.ts', handler: 'handler' },
      { name: 'calendarCheckAvailability', entry: 'src/calendar/check-availability.ts', handler: 'handler' },
      { name: 'calendarScheduleMeeting', entry: 'src/calendar/schedule-meeting.ts', handler: 'handler' },
      { name: 'slackNotify', entry: 'src/notification/slack.ts', handler: 'handler' },
    ];

    // Create Lambda functions
    const functions: any = {};
    functionDefinitions.forEach(def => {
      const fn = new lambdaNodejs.NodejsFunction(this, `${def.name}Function`, {
        functionName: `semantic-slack-bot-${stage}-${def.name}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: def.handler,
        entry: path.join(__dirname, '../../../lambdas', def.entry),
        environment,
        memorySize: def.memory || 256,
        timeout: cdk.Duration.seconds(30),
        role: this.role,
        logRetention: logs.RetentionDays.ONE_WEEK,
        bundling: {
          externalModules: ['aws-sdk'], // AWS SDK is available in the Lambda runtime
          nodeModules: ['@slack/bolt', '@slack/web-api', 'aws-lambda'], // Include these in bundle
          format: lambdaNodejs.OutputFormat.CJS, // CommonJS format
          target: 'node20',
        },
      });

      functions[def.name] = fn;
    });

    // Add SQS trigger to bugResponseHandler
    functions.bugResponseHandler.addEventSource(
      new lambdaEventSources.SqsEventSource(bugResponseQueue, {
        batchSize: 1,
      })
    );

    this.functions = functions as LambdaFunctions;
  }

  private createLambdaRole(tables: DynamoDBTables, bugResponseQueue: sqs.Queue): iam.Role {
    const role = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Add DynamoDB permissions
    Object.values(tables).forEach(table => {
      table.grantReadWriteData(role);
    });

    // Add SQS permissions
    bugResponseQueue.grantSendMessages(role);
    bugResponseQueue.grantConsumeMessages(role);

    // Add Step Functions permissions
    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'states:StartExecution',
        'states:ListStateMachines',
        'states:SendTaskSuccess',
        'states:SendTaskFailure',
      ],
      resources: ['*'],
    }));

    return role;
  }


  private createEnvironmentVariables(
    stage: string,
    tables: DynamoDBTables,
    bugResponseQueue: sqs.Queue,
    envConfig: EnvironmentConfig
  ): { [key: string]: string } {
    return {
      STAGE: stage,
      SLACK_BOT_TOKEN: envConfig.SLACK_BOT_TOKEN,
      SLACK_SIGNING_SECRET: envConfig.SLACK_SIGNING_SECRET,
      OPENAI_API_KEY: envConfig.OPENAI_API_KEY,
      GOOGLE_CLIENT_ID: envConfig.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: envConfig.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: envConfig.GOOGLE_REDIRECT_URI,
      INTERNAL_API_KEY: envConfig.INTERNAL_API_KEY,
      USERS_TABLE: tables.usersTable.tableName,
      WORKSPACES_TABLE: tables.workspacesTable.tableName,
      ENGRAMS_TABLE: tables.engramsTable.tableName,
      BUG_REPORTS_TABLE: tables.bugReportsTable.tableName,
      CALENDAR_TOKENS_TABLE: tables.calendarTokensTable.tableName,
      MEETINGS_TABLE: tables.meetingsTable.tableName,
      AREA_EXPERTISE_TABLE: tables.areaExpertiseTable.tableName,
      WORKFLOWS_TABLE: tables.workflowsTable.tableName,
      EXECUTIONS_TABLE: tables.executionsTable.tableName,
      BUG_RESPONSE_QUEUE_URL: bugResponseQueue.queueUrl,
    };
  }
}