# Symentic Slack Bot - CDK Infrastructure

This directory contains the AWS CDK (Cloud Development Kit) infrastructure code for the Symentic Slack Bot.

## Directory Structure

```
infrastructure/
├── bin/
│   └── app.ts                    # CDK app entry point
├── lib/
│   ├── constructs/              # Reusable CDK constructs
│   │   ├── dynamodb-tables.ts  # DynamoDB table definitions
│   │   └── lambda-functions.ts  # Lambda function definitions
│   ├── stacks/                  # CDK stack definitions
│   │   ├── main-stack.ts        # Main infrastructure stack
│   │   └── step-functions-stack.ts # Step Functions stack
│   ├── step-functions/          # State machine definitions
│   │   └── bug-triage-state-machine.ts
│   └── types/                   # TypeScript type definitions
│       └── index.ts
├── cdk.json                     # CDK configuration
├── tsconfig.json                # TypeScript configuration
└── README.md                    # This file
```

## Architecture

The infrastructure is split into two stacks for better organization and dependency management:

1. **Main Stack** (`MainStack`): Contains core infrastructure
   - Lambda functions
   - DynamoDB tables
   - SQS Queue
   - API Gateway
   - IAM roles and policies

2. **Step Functions Stack** (`StepFunctionsStack`): Contains workflow orchestration
   - Bug triage state machine
   - Future state machines for other workflows
   - Step Functions logging

## Prerequisites

1. AWS CLI configured with appropriate credentials
2. Node.js 20.x installed
3. CDK CLI installed: `npm install -g aws-cdk`
4. `.env` file in the project root (copy from `.env.example`)

## Deployment

### First Time Setup

1. Bootstrap CDK in your AWS account (one-time operation):
   ```bash
   npm run cdk:bootstrap
   ```

2. Synthesize the CloudFormation templates to verify:
   ```bash
   npm run cdk:synth
   ```

### Deploy to AWS

Deploy all stacks:
```bash
npm run cdk:deploy
```

Deploy to production:
```bash
npm run cdk:deploy:prod
```

### Other Commands

- **View changes before deploying**: `npm run cdk:diff`
- **Destroy all resources**: `npm run cdk:destroy`
- **Run any CDK command**: `npm run cdk -- <command>`

## Stack Outputs

After deployment, important values will be output:

- **API Endpoint**: URL for Slack events webhook
- **State Machine ARN**: Bug triage workflow ARN
- **Queue URL**: SQS queue for bug responses
- **Table Names**: All DynamoDB table names

## Architecture

### Lambda Functions

| Function | Purpose | Memory |
|----------|---------|--------|
| router | Main event handler for Slack | 512 MB |
| bugAnalyze | Analyze bug report quality | 256 MB |
| bugQuestions | Generate follow-up questions | 256 MB |
| bugProcessResponse | Process user responses | 256 MB |
| bugUpdate | Update bug reports | 256 MB |
| bugFindEngineers | Find relevant engineers | 256 MB |
| bugCreateChannel | Create Slack channels | 256 MB |
| bugSave | Save bug reports to DynamoDB | 256 MB |
| bugTrackExecution | Track workflow executions | 256 MB |
| bugResponseHandler | Handle SQS messages | 256 MB |
| calendarCheckAvailability | Check calendar availability | 256 MB |
| calendarScheduleMeeting | Schedule meetings | 256 MB |
| slackNotify | Send Slack notifications | 256 MB |

### DynamoDB Tables

All tables use on-demand billing mode:

- **SemanticUsers**: User profiles and preferences
- **SemanticWorkspaces**: Workspace configurations
- **SemanticEngrams**: Long-term memory storage (with GSI)
- **SemanticBugReports**: Bug report data
- **SemanticCalendarTokens**: OAuth tokens for calendar
- **SemanticMeetings**: Meeting records
- **SemanticAreaExpertise**: Engineer expertise mapping (with GSI)
- **SemanticWorkflows**: Active workflow tracking (with TTL)
- **SemanticExecutions**: Execution tracking (with TTL and 2 GSIs)

### Step Functions

The bug triage state machine orchestrates the entire bug reporting workflow:

1. Analyzes bug report completeness
2. Asks follow-up questions if needed (max 3 attempts)
3. Waits for user responses (48-hour timeout)
4. Finds relevant engineers
5. Creates Slack channels for high-severity bugs
6. Schedules meetings via calendar integration
7. Saves complete bug reports

## Environment Variables

All Lambda functions have access to:

- Slack credentials (bot token, signing secret)
- OpenAI API key
- Google Calendar OAuth credentials
- DynamoDB table names
- SQS queue URL
- Internal API key

## Security

- All sensitive values are loaded from `.env` file at build time
- Lambda functions use least-privilege IAM roles
- DynamoDB tables have encryption at rest
- CloudWatch logs are retained for 1 week

## Cost Optimization

- DynamoDB tables use PAY_PER_REQUEST billing
- Lambda functions have appropriate memory allocations
- SQS messages have 1-hour retention
- Shared dependencies are deployed as a Lambda layer

## Monitoring

- Step Functions have full tracing enabled
- CloudWatch Logs capture all Lambda invocations
- API Gateway has logging and metrics enabled

## Migration from Serverless Framework

This CDK infrastructure replaces the previous `serverless.yml` configuration with:

- Better type safety through TypeScript
- Clearer dependency management
- More granular control over resources
- Native Step Functions support
- Easier testing and local development