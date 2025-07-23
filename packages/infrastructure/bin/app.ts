#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { MainStack } from '../lib/stacks/main-stack';
import { StepFunctionsStack } from '../lib/stacks/step-functions-stack';

// Load .env file from project root
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const app = new cdk.App();

const stage = app.node.tryGetContext('stage') || 'prod';
const region = app.node.tryGetContext('region') || 'us-east-1';

// Main stack with Lambda functions, DynamoDB tables, and SQS
const mainStack = new MainStack(app, `SymenticSlackBotStack-${stage}`, {
  stackName: `semantic-slack-bot-v2-${stage}`,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
  stage: stage,
  description: 'Symentic Slack Bot - Main Infrastructure'
});

// Step Functions stack (depends on main stack for Lambda ARNs)
const stepFunctionsStack = new StepFunctionsStack(app, `SymenticSlackBotStepFunctionsStack-${stage}`, {
  stackName: `semantic-slack-bot-v2-step-functions-${stage}`,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
  stage: stage,
  lambdaFunctions: mainStack.lambdaFunctions,
  bugResponseQueue: mainStack.bugResponseQueue,
  description: 'Symentic Slack Bot - Step Functions'
});

// Add dependency
stepFunctionsStack.addDependency(mainStack);

// Tag all resources
cdk.Tags.of(app).add('Project', 'SymenticSlackBot');
cdk.Tags.of(app).add('Stage', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');