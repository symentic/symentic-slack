# Semantic Slack Bot Architecture Proposal

## Current Issues with Single Lambda
- All logic in one function (getting complex)
- State management is manual with Redis
- Difficult to handle long-running workflows
- Hard to scale specific features independently
- Timeout constraints (15 minutes max)

## Proposed Hybrid Architecture

### 1. Main Lambda (Event Router)
- **Purpose**: Handle all Slack events and route to appropriate services
- **Responsibilities**:
  - Receive Slack events
  - Quick message filtering
  - Intent classification
  - Route to appropriate handler
  - Send immediate responses
- **Benefits**: Low latency, simple responses handled immediately

### 2. Step Functions for Complex Workflows
Each complex workflow becomes a Step Function state machine:

#### Bug Triage Workflow
```
Start → Analyze Bug → Ask Questions → Collect Responses → 
→ Validate Quality → Find Engineers → Schedule Meeting → Complete
```

#### Meeting Scheduling Workflow  
```
Start → Check Calendars → Find Slots → Propose Times → 
→ Confirm Selection → Create Event → Send Invites → Complete
```

### 3. Specialized Lambda Functions
- **Bug Analysis Lambda**: AI-powered bug analysis
- **Calendar Lambda**: Google Calendar operations
- **Notification Lambda**: Send updates/reminders
- **Memory Lambda**: Handle engram storage

### 4. Message Flow
```
Slack Event → API Gateway → Main Lambda (Router)
                                ↓
                    [Intent Classification]
                                ↓
    Simple Response ←────────────────────→ Complex Workflow
          ↓                                       ↓
    Direct Reply                           Step Function
                                                 ↓
                                         Specialized Lambdas
```

## Implementation Plan

### Phase 1: Extract Bug Triage to Step Functions
1. Create Step Function for bug triage workflow
2. Main Lambda triggers Step Function for bug reports
3. Step Function manages state (no Redis needed)
4. Each step is a separate Lambda function

### Phase 2: Add Event-Driven Updates
1. Use EventBridge for async notifications
2. Step Functions emit events at key stages
3. Notification Lambda listens and updates Slack

### Phase 3: Extract Other Workflows
1. Meeting scheduling → Step Function
2. Task management → Step Function
3. Keep simple queries in main Lambda

## Benefits
1. **Better State Management**: Step Functions handle state automatically
2. **Visual Workflows**: See and debug workflows in AWS console
3. **Independent Scaling**: Each function scales independently
4. **Error Handling**: Built-in retry and error handling per step
5. **Long-Running Operations**: Step Functions can run for up to 1 year
6. **Cost Optimization**: Only pay for what you use

## Example: Bug Triage Step Function

```json
{
  "Comment": "Bug Triage Workflow",
  "StartAt": "AnalyzeBug",
  "States": {
    "AnalyzeBug": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:analyzeBug",
      "Next": "CheckQuality"
    },
    "CheckQuality": {
      "Type": "Choice",
      "Choices": [{
        "Variable": "$.quality",
        "NumericGreaterThanEquals": 80,
        "Next": "FindEngineers"
      }],
      "Default": "AskQuestions"
    },
    "AskQuestions": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:askBugQuestions",
      "Next": "WaitForResponse"
    },
    "WaitForResponse": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
      "Parameters": {
        "QueueUrl": "https://sqs.REGION.amazonaws.com/ACCOUNT/bug-responses",
        "MessageBody": {
          "taskToken.$": "$$.Task.Token",
          "bugId.$": "$.bugId"
        }
      },
      "Next": "ProcessResponse"
    },
    "ProcessResponse": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:processBugResponse",
      "Next": "CheckQuality"
    },
    "FindEngineers": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:findEngineers",
      "Next": "ScheduleMeeting"
    },
    "ScheduleMeeting": {
      "Type": "Task", 
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:scheduleMeeting",
      "End": true
    }
  }
}
```

## Migration Strategy
1. Start with new features (don't refactor everything at once)
2. Keep existing Lambda running
3. Gradually move workflows to Step Functions
4. Monitor performance and costs
5. Optimize based on actual usage

## Estimated Costs
- **Current**: ~$50-100/month (single Lambda)
- **Proposed**: ~$75-150/month (multiple services)
- **Note**: Costs depend on usage, but modular approach allows better optimization

## Next Steps
1. Create proof-of-concept Step Function for bug triage
2. Compare performance with current implementation
3. Evaluate developer experience
4. Make decision based on results