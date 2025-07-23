# Constructs

This directory contains reusable CDK constructs for the Symentic Slack Bot infrastructure.

## Current Constructs

### DynamoDB Tables (`dynamodb-tables.ts`)
Creates all DynamoDB tables with proper configurations:
- Consistent naming convention
- Point-in-time recovery enabled
- GSIs where needed
- TTL for temporary data

### Lambda Functions (`lambda-functions.ts`)
Creates all Lambda functions with:
- Shared IAM role
- Lambda layer for dependencies
- Environment variables
- SQS event sources where needed

## Adding New Constructs

When creating new constructs:
1. Extend `Construct` class
2. Define clear prop interfaces
3. Export public resources that other stacks might need
4. Follow naming conventions
5. Add proper error handling and validation