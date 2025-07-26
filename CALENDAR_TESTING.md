# Calendar Agent Testing Guide

## Current Status ✅
- **Deployment**: Successfully deployed to dev-richard stage
- **Dependencies**: Fixed missing `retry` module issue
- **API Endpoint**: https://x1ktug3za3.execute-api.us-east-1.amazonaws.com/dev-richard/slack/events
- **Bot Name**: SymenticBotDev-Richard

## Phase 1 Implementation (Current)
The calendar agent currently supports basic calendar queries with mock data.

### Supported Intents
- `calendar.check` - Check schedule/meetings
- `calendar.query` - Query specific times

### Test Messages
Try these messages in Slack:

1. **Direct Message to Bot**:
   - "What's my schedule today?"
   - "Show my calendar"
   - "What meetings do I have?"
   - "Am I free at 2pm?"

2. **In a Channel** (bot must be in channel):
   - "@SymenticBotDev-Richard what's my schedule?"
   - "@SymenticBotDev-Richard show my calendar"

### Expected Response
The bot should:
1. Immediately respond with "📅 Let me check your calendar..."
2. Return a formatted Slack message with mock calendar events for today

### Mock Data
Currently returns sample events:
- 9:00 AM - 10:00 AM: Team Standup
- 10:30 AM - 11:30 AM: Product Review
- 2:00 PM - 3:00 PM: 1:1 with Manager
- 3:30 PM - 4:00 PM: Coffee Chat with Alex

## Troubleshooting

### If Bot Doesn't Respond
1. Check bot is in your workspace: Apps → SymenticBotDev-Richard
2. Verify bot has been added to the channel (if testing in channel)
3. Check CloudWatch logs:
   ```bash
   # Router logs (main entry point)
   aws logs tail /aws/lambda/semantic-slack-bot-dev-richard-router --follow --profile richard
   
   # Calendar query logs
   aws logs tail /aws/lambda/semantic-slack-bot-dev-richard-calendarQuery --follow --profile richard
   ```

### Common Issues
- **Bot not responding**: Ensure you've configured the Slack app's Event Subscriptions URL correctly
- **"retry module not found"**: This has been fixed in the latest deployment
- **Intent not recognized**: Try variations like "calendar", "schedule", "meetings"

## Next Steps (Phase 2+)
- [ ] Google Calendar OAuth integration
- [ ] Real calendar data fetching
- [ ] Meeting scheduling functionality
- [ ] Out-of-office day creation
- [ ] Conflict detection
- [ ] Step Function for complex workflows