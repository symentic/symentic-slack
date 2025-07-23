# Symentic Slack Bot Documentation

## Project Structure

This is a monorepo project using npm workspaces. The codebase is organized into three main packages:

### Packages

1. **`@symentic/core`** - Core business logic and shared services
   - Types and interfaces
   - Services (DynamoDB, OpenAI, Slack, etc.)
   - Agent implementations
   - Shared utilities

2. **`@symentic/lambdas`** - AWS Lambda function handlers
   - Router (main event handler)
   - Bug triage workflows
   - Calendar integration
   - Notification handlers

3. **`@symentic/infrastructure`** - AWS CDK infrastructure code
   - Stack definitions
   - Constructs for resources
   - Step Functions definitions
   - Deployment configuration

## Architecture

The bot uses a serverless architecture deployed on AWS:

- **API Gateway** - Receives Slack events
- **Lambda Functions** - Process events and execute business logic
- **Step Functions** - Orchestrate complex workflows (like bug triage)
- **DynamoDB** - Store user data, bug reports, and execution state
- **SQS** - Handle asynchronous responses in workflows

## Key Concepts

### 1. Intent Classification
All incoming messages are classified using GPT-3.5 to determine the appropriate handler.

### 2. Agent System
Different agents handle different types of requests:
- Bug Triage Agent
- Calendar Agent
- General Query Agent (planned)

### 3. Memory System
- Short-term: Conversation context
- Long-term: User profiles and engrams (learned information)

### 4. Workflow Orchestration
Complex workflows use AWS Step Functions with wait states for user responses.

## Development

See individual package READMEs for specific development instructions:
- [Core Package](../packages/core/README.md)
- [Lambda Package](../packages/lambdas/README.md)
- [Infrastructure Package](../packages/infrastructure/README.md)