# Calendar Agent Testing Steps

## Current Status
✅ Pre-filtering removed - ALL messages will now be processed
✅ Lambda function name fixed
✅ Successfully deployed to dev-richard

## Test Messages to Send in Slack

### 1. Basic Calendar Queries (Should Work)
Send these as DMs to **@SymenticBotDev-Richard**:
- "What's my schedule today?"
- "Show my calendar" 
- "What meetings do I have?"
- "Am I free at 2pm?"

### 2. Typo Test (Should Now Work!)
- "wuts ma scheudle" 
- "whats my skedule"
- Any misspelling should now be processed

### 3. Random Messages (Will Be Processed)
- "hello"
- "test"
- "123"
- These will now go through intent classification

## Expected Flow

1. **You send message** → Bot receives it
2. **No pre-filtering** → Message goes directly to intent classification
3. **GPT classifies intent** → If calendar-related, returns `calendar.check` or `calendar.query`
4. **Bot responds** → "📅 Let me check your calendar..."
5. **Lambda invoked** → `semantic-slack-bot-dev-richard-calendarQuery`
6. **Mock data returned** → Shows today's schedule with sample meetings

## Monitor in Real-Time

Open two terminal windows:

**Terminal 1 - Router Logs:**
```bash
aws logs tail /aws/lambda/semantic-slack-bot-dev-richard-router --follow --profile richard
```

**Terminal 2 - Calendar Query Logs:**
```bash
aws logs tail /aws/lambda/semantic-slack-bot-dev-richard-calendarQuery --follow --profile richard
```

## What to Look For in Logs

### Router Logs Should Show:
1. `Processing message: "your message" from user: YOUR_USER_ID`
2. `Intent classified: calendar.check (0.XX)` (confidence score)
3. `Calendar intent detected: calendar.check`
4. `Invoking calendar query Lambda`

### Calendar Query Logs Should Show:
1. `Calendar query Lambda invoked`
2. `Mock events being returned`

## Troubleshooting

If bot doesn't respond:
1. Check if bot is in your workspace
2. Verify Slack event subscriptions URL is correct
3. Look for errors in CloudWatch logs

If you get an error message:
- Check logs for specific error details
- Lambda invocation errors should now be fixed

## Next Test After Basic Works
Once basic calendar queries work, try:
- Complex queries: "What's my schedule for next Tuesday?"
- Meeting requests: "Schedule a meeting with John"
- These will help validate intent classification accuracy