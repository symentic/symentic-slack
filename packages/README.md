# Symentic Slack Bot - Packages

This directory contains the monorepo packages for the Symentic Slack Bot.

## Package Structure

### @symentic/core
Core business logic and shared services:
- **agents/**: AI agent implementations (BugTriageAgent, CalendarAgent)
- **services/**: Core services (DynamoDB, OpenAI, Slack, Redis, etc.)
- **types/**: Shared TypeScript types and interfaces

### @symentic/lambdas
AWS Lambda function handlers:
- **router/**: Main event router for Slack messages
- **bug-triage/**: Bug workflow Lambda functions
- **calendar/**: Calendar integration functions
- **notification/**: Slack notification handlers

### @symentic/infrastructure
AWS CDK infrastructure code:
- **stacks/**: CDK stack definitions
- **constructs/**: Reusable CDK constructs
- **step-functions/**: Step Function state machines
- **types/**: Infrastructure-specific types

## Development

Each package has its own:
- `package.json` with specific dependencies
- `tsconfig.json` extending the base configuration
- Build scripts and test configuration

## Building

From the root directory:
```bash
npm run build          # Build all packages
npm run build:core     # Build core only
npm run build:lambdas  # Build lambdas only
npm run build:infra    # Build infrastructure only
```