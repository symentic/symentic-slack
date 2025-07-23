# Lambda Functions Organization

This directory contains all Lambda function handlers organized by feature/domain.

## Current Structure

```
lambdas/
├── router/              # Main event routing
│   ├── index.ts        # Main handler
│   └── thread-response-handler.ts
├── bug-triage/         # Bug workflow functions
│   ├── analyze.ts
│   ├── questions.ts
│   ├── process-response.ts
│   ├── update-bug.ts
│   ├── find-engineers.ts
│   ├── create-channel.ts
│   ├── save-bug.ts
│   ├── track-execution.ts
│   └── response-handler.ts
├── calendar/           # Calendar integration
│   ├── check-availability.ts
│   └── schedule-meeting.ts
└── notification/       # Slack notifications
    └── slack.ts
```

## Future Structure Suggestions

As the bot grows, consider organizing by:

### Feature-based Structure
```
lambdas/
├── router/
├── agents/
│   ├── bug-triage/
│   ├── feature-request/
│   ├── task-management/
│   └── general-query/
├── integrations/
│   ├── calendar/
│   ├── github/
│   ├── jira/
│   └── notion/
├── notifications/
└── shared/
    ├── utils/
    └── middleware/
```

### Domain-based Structure
```
lambdas/
├── core/               # Core routing and orchestration
├── workflows/          # Step Function handlers
├── integrations/       # External service integrations  
├── data/              # Data access and persistence
└── communications/    # Notifications and messaging
```

## Best Practices

1. **Single Responsibility**: Each Lambda should do one thing well
2. **Shared Code**: Use layers or shared modules for common functionality
3. **Error Handling**: Consistent error handling across all functions
4. **Logging**: Structured logging with correlation IDs
5. **Testing**: Unit tests for each handler
6. **Types**: Strong typing for all inputs/outputs