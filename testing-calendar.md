# Testing Calendar Functionality - Dev Environment

## Setup Complete ✅
- **Bot Name**: SymenticBotDev-Richard
- **API Endpoint**: https://x1ktug3za3.execute-api.us-east-1.amazonaws.com/dev-richard/slack/events
- **Lambda Functions**: All deployed including `calendarQuery`

## How to Test

### 1. Direct Messages
Open a direct message with **@SymenticBotDev-Richard** and try:
- "What's my schedule today?"
- "Show my calendar"
- "What meetings do I have?"
- "Am I free at 2pm?"

### 2. Channel Messages
In any channel where the bot is added:
- "@SymenticBotDev-Richard what's my schedule?"
- "@SymenticBotDev-Richard do I have any meetings?"

### 3. Monitor Logs
```bash
# Watch router logs
aws logs tail /aws/lambda/semantic-slack-bot-dev-richard-router --follow --profile richard

# Watch calendar query logs
aws logs tail /aws/lambda/semantic-slack-bot-dev-richard-calendarQuery --follow --profile richard
```

## Expected Behavior (Phase 1)
1. Bot acknowledges with "📅 Let me check your calendar..."
2. Returns mock calendar data with formatted Slack blocks
3. Shows sample meetings for today

## What's Working
- ✅ Intent classification detects calendar queries
- ✅ Router invokes calendar Lambda
- ✅ Mock calendar data returns properly formatted

## Next Steps (Phase 2)
- Real Google Calendar integration
- OAuth flow for calendar access
- Step Function for complex calendar operations