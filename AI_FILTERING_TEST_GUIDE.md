# AI Filtering Test Guide

## What's New
The bot now uses AI to determine whether to respond to messages:
1. **First**: GPT decides if the message is relevant (`shouldRespond`)
2. **Then**: If relevant, GPT classifies the intent and routes to appropriate agent

## Test Messages

### Messages that SHOULD BE IGNORED (shouldRespond: false)
Send these in the channel - bot should NOT respond:
- "hello"
- "thanks"
- "sounds good"
- "\"
- "ok"
- "👍"
- Random conversation between humans

### Messages that SHOULD GET RESPONSES (shouldRespond: true)
Send these - bot SHOULD respond:
- "What's my schedule today?"
- "Show my calendar"
- "Schedule a meeting with John"
- "bug: login is broken"
- "I need help with scheduling"
- "Can you check my calendar?"

### Edge Cases to Test
- "calendar" (single word - might be ignored as too vague)
- "meeting" (might be ignored without more context)
- "free at 2?" (abbreviated but should work)

## Monitoring

Watch the logs to see AI decisions:
```bash
aws logs tail /aws/lambda/semantic-slack-bot-dev-richard-router --follow --profile richard | grep -E "shouldRespond|AI determined"
```

## Expected Log Output

For ignored messages:
```
Intent classified: general.chatter (0.4, shouldRespond: false)
AI determined message not relevant for bot - ignoring
```

For processed messages:
```
Intent classified: calendar.check (0.9, shouldRespond: true)
Calendar intent detected: calendar.check
```

## Success Criteria
- ✅ "hello" → No bot response
- ✅ "what's my schedule" → Calendar response
- ✅ Random chatter → Ignored
- ✅ Clear requests → Processed

## Troubleshooting
If bot responds to everything:
- Check if `shouldRespond` is being set by GPT
- Verify the router is checking `shouldRespond` before routing

If bot ignores everything:
- Check if GPT prompt is too restrictive
- Look for `shouldRespond: false` in all classifications