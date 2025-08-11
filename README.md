# Symentic Slack Bot

A production-ready Slack bot built as a monorepo using AWS CDK, Lambda, and Step Functions. The bot acts as an intelligent AI agent for the Symentic platform, handling bug reports, scheduling meetings, and managing workflows.

## Features

- **Master AI Agent**: Observes all Slack messages and coordinates child agents
- **Bug Triage Automation**: Automatic bug report processing with intelligent triage
- **Memory Management**: 
  - Short-term memory in Redis
  - Long-term memory (engrams) in DynamoDB
- **Google Calendar Integration**: Automatic meeting scheduling based on participant availability
- **Internal REST API**: Developer endpoints for accessing bot data
- **AWS Lambda Deployment**: Serverless architecture for scalability

## Project Structure

This is a monorepo project organized into three main packages:

```
packages/
├── core/           # Shared business logic and services
├── lambdas/        # AWS Lambda function handlers  
└── infrastructure/ # AWS CDK infrastructure code
```

## Architecture

- **Infrastructure**: AWS CDK (TypeScript)
- **Compute**: AWS Lambda behind API Gateway
- **Orchestration**: AWS Step Functions
- **Queue**: AWS SQS
- **Short-term Memory**: In-memory (Redis optional)
- **Long-term Memory**: DynamoDB
- **LLM**: OpenAI GPT-3.5/GPT-4o-mini/GPT-4o
- **Calendar**: Google Calendar API

## Setup

### Prerequisites

- Node.js 20+
- AWS Account with appropriate permissions
- AWS CLI configured
- AWS CDK CLI: `npm install -g aws-cdk`
- Slack App with Bot Token
- OpenAI API Key
- Google Cloud Project with Calendar API enabled

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd symentic-slack
```

2. Install dependencies:
```bash
npm install
```

3. Copy the environment template and configure:
```bash
cp .env.example .env
# Edit .env with your credentials
```

### Slack App Configuration

1. Create a new Slack app at https://api.slack.com/apps
2. Add Bot Token Scopes:
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `groups:history`
   - `groups:read`
   - `im:history`
   - `mpim:history`
   - `users:read`
   - `users:read.email`
3. Install the app to your workspace
4. Copy the Bot User OAuth Token to `SLACK_BOT_TOKEN`
5. Copy the Signing Secret to `SLACK_SIGNING_SECRET`

### Google Calendar Setup

1. Create a project in Google Cloud Console
2. Enable Google Calendar API
3. Create OAuth 2.0 credentials
4. Set redirect URI to your Lambda endpoint + `/auth/google/callback`
5. Copy Client ID and Secret to environment variables

### Development

Run locally:
```bash
npm run dev
```

Build:
```bash
npm run build
```

Lint:
```bash
npm run lint
```

### Deployment (AWS CDK)

1. Bootstrap CDK (first time only):
```bash
npm run cdk:bootstrap
```

2. Synthesize CloudFormation templates:
```bash
npm run cdk:synth
```

3. Deploy all stacks:
```bash
npm run cdk:deploy
```

For production deployment:
```bash
npm run cdk:deploy:prod
```

To destroy all resources:
```bash
npm run cdk:destroy
```

See `infrastructure/README.md` for detailed CDK documentation.

## API Endpoints

All endpoints require `X-API-Key` header for authentication.

### GET /messages
Get recent messages from a channel
```bash
curl -H "X-API-Key: your-key" \
  "https://your-api.execute-api.region.amazonaws.com/prod/messages?channel=C1234567890&limit=50"
```

### GET /users
Get user profile
```bash
curl -H "X-API-Key: your-key" \
  "https://your-api.execute-api.region.amazonaws.com/prod/users?userId=U1234567890"
```

### GET /memory
Get user memory (engrams)
```bash
curl -H "X-API-Key: your-key" \
  "https://your-api.execute-api.region.amazonaws.com/prod/memory?user=U1234567890&limit=50"
```

### POST /message
Send a message as the bot
```bash
curl -X POST -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"channel":"C1234567890","text":"Hello from API"}' \
  "https://your-api.execute-api.region.amazonaws.com/prod/message"
```

### POST /create-bot
Create a new child bot
```bash
curl -X POST -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"name":"support-bot","type":"customer-support","config":{}}' \
  "https://your-api.execute-api.region.amazonaws.com/prod/create-bot"
```

## Bug Triage Flow

1. User posts message containing "bug:"
2. Bot creates thread and asks for:
   - Reproduction steps
   - Severity (low/medium/high)
3. Bot saves bug report to DynamoDB
4. Bot identifies relevant engineers based on expertise
5. Creates private triage channel
6. Automatically schedules meeting using Google Calendar
7. Posts meeting details in triage channel

## Environment Variables

See `.env.example` for all required environment variables.

## License

MIT