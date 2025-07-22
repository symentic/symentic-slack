# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the Symentic Slack Bot codebase.

## Project Overview

The Symentic Slack Bot is a production-ready Node.js application that serves as the master AI agent for the Symentic platform. It's designed as an intelligent Slack bot that observes workspace activity, manages child agents, maintains memory across short and long-term storage, and provides automated workflows like bug triage with integrated calendar scheduling.

## Architecture

### Hybrid Architecture (Step Functions + Lambda)
As of the latest update, the bot uses a hybrid architecture combining AWS Step Functions for complex workflows with Lambda functions for individual tasks. This provides better state management, visual debugging, and scalability.

### Core Stack
- **Runtime**: Node.js 20.x with TypeScript
- **Framework**: Slack Bolt SDK for Slack app functionality
- **Deployment**: AWS Lambda with Serverless Framework
- **Orchestration**: AWS Step Functions for complex workflows
- **AI Models**:
  - GPT-3.5-turbo: Intent classification, simple tasks
  - GPT-4o-mini: Bug triage intelligence (default)
  - GPT-4o: Emergency/critical bugs only
- **Memory Storage**:
  - Short-term: In-memory (Redis optional)
  - Long-term: DynamoDB (for user profiles, engrams, bug reports)
  - Workflow state: Step Functions state management
- **Message Queuing**: SQS for async processing
- **Calendar Integration**: Google Calendar API for meeting scheduling

### AWS Services
- **Lambda Functions**:
  - Router: Main event handler for Slack events
  - Bug Triage Functions: analyze, questions, process-response, update, find-engineers, create-channel, save
  - Calendar Functions: check-availability, schedule-meeting
  - Notification Functions: slack notifications
- **Step Functions**: Orchestrates complex workflows like bug triage
- **API Gateway**: HTTP endpoints for Slack events
- **SQS**: Queue for handling user responses in workflows
- **DynamoDB Tables**:
  - `SemanticUsers`: User profiles and preferences
  - `SemanticWorkspaces`: Workspace configurations
  - `SemanticEngrams`: Long-term memory/knowledge storage
  - `SemanticBugReports`: Bug tracking data
  - `SemanticCalendarTokens`: OAuth tokens for calendar access
  - `SemanticMeetings`: Scheduled meeting records
  - `SemanticAreaExpertise`: Engineer expertise mapping
  - `SemanticWorkflows`: Active workflow references for thread routing

## Development Workflow

### Local Development
```bash
# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev

# Build TypeScript
npm run build

# Run linting
npm run lint

# Run tests
npm run test
```

### Deployment
```bash
# Install dependencies including Step Functions plugin
npm install
npm install --save-dev serverless-step-functions

# Deploy to AWS Lambda with Step Functions
npm run deploy

# Or use serverless directly
serverless deploy --stage prod

# View Step Function in AWS Console after deployment
# Navigate to Step Functions → State machines → BugTriageStateMachine-prod
```

### Deployment Notes
- TypeScript compilation requires increased memory: Use `NODE_OPTIONS="--max-old-space-size=4096"` if encountering memory issues
- The Step Function ARN is dynamically discovered at runtime to avoid circular dependencies

## Key Components

### 1. Router Lambda (`src/lambdas/router/index.ts`)
- Entry point for all Slack events
- Performs intent classification
- Routes to appropriate workflows or handlers
- Manages thread response routing

### 2. Step Functions (`src/step-functions/bug-triage.yml`)
- Orchestrates complex workflows
- Manages state between Lambda invocations
- Handles async operations with SQS
- Provides visual debugging in AWS Console

### 3. Specialized Lambda Functions
- **Bug Analysis**: Evaluates bug report quality
- **Question Generation**: Creates contextual follow-ups
- **Response Processing**: Extracts info from user replies
- **Engineer Finding**: Matches bugs to expertise
- **Channel Creation**: Sets up private triage channels
- **Meeting Scheduling**: Integrates with Google Calendar
- **Notifications**: Sends updates to Slack

### 4. Thread Response Handler (`src/lambdas/router/thread-response-handler.ts`)
- Routes thread replies to active workflows
- Manages workflow references in DynamoDB
- Sends responses to SQS for Step Function processing

### 5. Original Components (Still Used)
#### Message Handler (`src/handlers/messageHandler.ts`)
- Pre-filters incoming messages to determine processing needs
- Checks for direct mentions, keywords, and bot questions
- Manages context loading from Redis and DynamoDB
- Generates appropriate AI responses
- Handles special cases like bug reports

### 2. Bug Triage Agent (`src/agents/bugTriageAgent.ts`)
- Specialized agent for bug report workflow
- Guides users through structured bug reporting
- Identifies relevant engineers based on expertise
- Creates private triage channels
- Automatically schedules meetings via Google Calendar

### 3. Service Layer (`src/services/`)
- **slack.ts**: Slack API interactions (sending messages, creating channels)
- **openai.ts**: GPT-4 integration for AI responses
- **redis.ts**: Short-term memory and conversation state
- **dynamodb.ts**: Long-term storage for users, engrams, bugs
- **googleCalendar.ts**: Calendar integration for meeting scheduling
- **serviceInitializer.ts**: Bootstraps all services on cold start

### 4. Internal API (`src/api/internalAPI.ts`)
- REST endpoints for developer access
- Requires `X-API-Key` authentication
- Endpoints: `/messages`, `/users`, `/memory`, `/message`, `/create-bot`

## Message Processing Flow (Hybrid Architecture)

### New Architecture Flow:
1. **Message Received**: Slack sends event to Router Lambda via API Gateway
2. **Thread Response Check**: If message is in active workflow thread, route to SQS
3. **Pre-filtering**: For new messages, check if bot should respond
4. **Intent Classification**: Use GPT-3.5-turbo to classify intent
5. **Workflow Routing**:
   - Simple intents: Handle directly in Router Lambda
   - Complex workflows: Start Step Function execution
6. **Step Function Orchestration**: Manages state through workflow steps
7. **Response Handling**: Individual Lambda functions handle each step

### Bug Triage Workflow (Step Function):
1. **Analyze Bug Report**: Assess quality and completeness
2. **Quality Check**: If <80% complete, ask follow-up questions
3. **Wait for Response**: Use SQS with task token for async handling
4. **Process Response**: Extract information from user reply
5. **Update Bug Report**: Merge new information
6. **Find Engineers**: Query expertise table for relevant people
7. **Create Channel**: For high-severity bugs
8. **Schedule Meeting**: Check calendars and create event
9. **Save Report**: Store in DynamoDB with engrams
10. **Notify**: Send completion message to Slack

## Memory System

### Short-term Memory (Redis)
- Recent conversation context (last 10 messages)
- Active bug triage states
- Temporary workflow data
- TTL: 24 hours for most keys

### Long-term Memory (DynamoDB)
- **Engrams**: Key insights and facts about users/projects
- **User Profiles**: Preferences, expertise, contact info
- **Bug Reports**: Complete bug history with triage data
- **Meeting Records**: Scheduled meetings and outcomes

## Bug Triage Workflow

1. User mentions "bug:" in message
2. Bot creates thread and initiates triage conversation
3. Collects: description, reproduction steps, severity
4. Saves complete bug report to DynamoDB
5. Uses AI to identify relevant engineers
6. Creates private Slack channel for triage
7. Checks engineer calendars via Google Calendar
8. Schedules meeting and posts details

## Configuration & Environment

### Required Environment Variables
```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# OpenAI
OPENAI_API_KEY=sk-...

# Redis
REDIS_URL=redis://...
REDIS_PASSWORD=... (optional)

# Google Calendar
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your-api/auth/google/callback

# Internal API
INTERNAL_API_KEY=...

# DynamoDB Tables (auto-generated by serverless.yml)
USERS_TABLE=SemanticUsers-prod
WORKSPACES_TABLE=SemanticWorkspaces-prod
ENGRAMS_TABLE=SemanticEngrams-prod
BUG_REPORTS_TABLE=SemanticBugReports-prod
CALENDAR_TOKENS_TABLE=SemanticCalendarTokens-prod
MEETINGS_TABLE=SemanticMeetings-prod
AREA_EXPERTISE_TABLE=SemanticAreaExpertise-prod
WORKFLOWS_TABLE=SemanticWorkflows-prod

# Step Functions and SQS (auto-generated)
BUG_TRIAGE_STATE_MACHINE_ARN=arn:aws:states:...
BUG_RESPONSE_QUEUE_URL=https://sqs.region.amazonaws.com/.../BugResponseQueue-prod
```

### Slack App Permissions
Required OAuth scopes:
- `channels:history`, `channels:read`
- `chat:write`
- `groups:history`, `groups:read`
- `im:history`, `mpim:history`
- `users:read`, `users:read.email`

## Development Guidelines

1. **TypeScript**: Maintain strict typing, avoid `any` where possible
2. **Error Handling**: Always wrap async operations in try-catch
3. **Logging**: Use structured logging with context
4. **Memory Management**: Be mindful of Lambda cold starts
5. **Rate Limits**: Respect Slack API rate limits (1 msg/sec)
6. **Testing**: Write unit tests for new agents and handlers

## Migration Guide (Monolithic → Hybrid Architecture)

### Current Status
✅ **MIGRATION COMPLETE**: The codebase has been successfully migrated to the hybrid Step Functions architecture.
- **Old architecture**: Removed (previously `serverless-old.yml`)
- **New architecture**: Deployed (`serverless.yml`, `src/lambdas/`)

### Migration Results
1. **Architecture**: Successfully migrated from monolithic Lambda to Step Functions + multiple Lambdas
2. **Deployment**: New architecture deployed to production
3. **Step Function**: `BugTriageStateMachine-prod` created and operational
4. **Endpoint**: `https://fty0uj86ma.execute-api.us-east-1.amazonaws.com/prod/slack/events`

### Key Differences
- **State Management**: Step Functions instead of Redis
- **Error Handling**: Built-in retries and error states
- **Debugging**: Visual workflow in AWS Console
- **Scalability**: Each function scales independently
- **Cost**: Slightly higher but more efficient

## Common Tasks

### Adding a New Workflow (Step Function)
1. Create workflow definition in `src/step-functions/`
2. Create Lambda functions in `src/lambdas/[workflow-name]/`
3. Update `serverless-new.yml` with new functions
4. Add routing logic to Router Lambda
5. Deploy and test

### Adding a New Agent (Legacy)
1. Create agent class in `src/agents/`
2. Implement handler method with proper typing
3. Register in message handler for trigger conditions
4. Add any new DynamoDB tables to serverless.yml
5. Update IAM permissions if needed

### Modifying AI Behavior
1. Update system prompts in OpenAI service
2. Adjust context window in message handler
3. Modify engram extraction logic if needed

### Adding New Slash Commands
Currently not implemented - all interactions are message-based

## Debugging

### CloudWatch Logs
- Log group: `/aws/lambda/semantic-slack-bot-prod-app`
- Filter by request ID for specific invocations

### Local Testing
- Use ngrok for local Slack event testing
- Mock AWS services with local DynamoDB/Redis

## Multi-Agent Architecture (In Development)

### Overview
The bot is transitioning from a monolithic design to a scalable multi-agent architecture where each agent handles specific domains (calendar, bugs, tasks, notifications, etc.).

### Architecture Components

#### 1. Intent Classification System
- **Purpose**: Analyze incoming messages to determine intent and extract entities
- **Model**: GPT-3.5-turbo for simple intents, GPT-4 for complex/ambiguous messages
- **Output**: Intent type, confidence score, extracted entities, required follow-ups
- **Example**: "Schedule meeting tomorrow 2pm with John" → 
  ```json
  {
    "intent": "calendar.schedule",
    "confidence": 0.95,
    "entities": {
      "time": "tomorrow 2pm",
      "participants": ["John"]
    },
    "model_used": "gpt-3.5-turbo" // or "gpt-4o-mini" or "gpt-4o"
  }
  ```

#### Model Selection Strategy
- **GPT-3.5-turbo**: 
  - Intent classification for all requests
  - Entity extraction
  - Simple Q&A responses
  - Status updates and confirmations
  - General conversation
  - Cost: ~$0.0015 per 1K tokens
  
- **GPT-4o-mini**: 
  - Bug triage intelligence (default)
  - Bug quality analysis
  - Contextual follow-up generation
  - Complex but non-critical analysis
  - Cost: ~$0.00015 per 1K tokens (10x cheaper than GPT-3.5)

- **GPT-4o**: 
  - Emergency/critical bugs only
  - Production outages
  - Security breaches
  - High-severity issues affecting all users
  - Cost: ~$0.01 per 1K tokens

- **Decision Logic**:
  ```typescript
  // Intent classification
  if (emergencyIndicators.test(message)) {
    use GPT-4o // Only for emergency detection in classification
  } else {
    use GPT-3.5-turbo // All other intent classification
  }
  
  // Bug triage
  if (isEmergencyBug(bugInfo)) {
    use GPT-4o // Critical bugs only
  } else {
    use GPT-4o-mini // Standard bug triage
  }
  ```

#### 2. Agent Registry
- **Central registry** of all available agents
- **Agent capabilities**: Each agent declares handled intents
- **Dynamic loading**: Agents can be added/removed at runtime
- **Priority system**: Handle overlapping capabilities

#### 3. Base Agent Interface
```typescript
interface BaseAgent {
  name: string;
  intents: string[];
  canHandle(intent: IntentResult): boolean;
  handle(context: ConversationContext): Promise<AgentResponse>;
  handoff?(toAgent: string, context: ConversationContext): Promise<void>;
}
```

#### 4. Agent Types (Planned)
- **CalendarAgent**: Meeting scheduling, availability checks
- **BugTriageAgent**: Bug reporting and triage workflow
- **TaskAgent**: Task creation and management
- **NotificationAgent**: Reminders and alerts
- **NotionAgent**: Notion integration
- **GitHubAgent**: PR/Issue management
- **QueryAgent**: General Q&A and search

#### 5. Context Management
- **Conversation State**: Maintained across agent interactions
- **Memory Bridge**: Agents share context via Redis/DynamoDB
- **Hand-off Protocol**: Agents can transfer control to others
- **Multi-turn Support**: Complex workflows spanning multiple messages

### Implementation Strategy

1. **Phase 1**: Refactor current bug triage to use base agent interface
2. **Phase 2**: Extract calendar functionality into CalendarAgent
3. **Phase 3**: Implement intent classification with GPT-4
4. **Phase 4**: Add agent registry and dynamic routing
5. **Phase 5**: Add new agents incrementally

### Message Flow
```
User Message
    ↓
Pre-filter (shouldProcessMessage)
    ↓
Intent Classifier (GPT-4)
    ↓
Agent Router
    ↓
Selected Agent(s)
    ↓
Response Aggregation
    ↓
Send to Slack
```

### Benefits
- **Modularity**: Each agent is self-contained
- **Scalability**: Easy to add new capabilities
- **Maintainability**: Changes to one agent don't affect others
- **Testability**: Agents can be tested in isolation
- **Extensibility**: Third-party agents can be added

## Future Enhancements

1. **Multi-workspace Support**: Handle multiple Slack workspaces
2. **Voice Integration**: Process voice messages with transcription
3. **Advanced Analytics**: Track bot usage and effectiveness
4. **Plugin System**: Allow custom agents as plugins
5. **Proactive Notifications**: Alert on important events
6. **Integration Hub**: Connect with Jira, GitHub, etc.

## Security Considerations

1. All API endpoints require authentication
2. Secrets stored in AWS Parameter Store/Secrets Manager
3. Lambda functions have minimal IAM permissions
4. No sensitive data in CloudWatch logs
5. OAuth tokens encrypted in DynamoDB

## Performance Optimization

1. Redis connection pooling for efficiency
2. DynamoDB batch operations where possible
3. Lazy loading of services to reduce cold starts
4. Parallel processing of independent operations
5. Response streaming for long AI outputs