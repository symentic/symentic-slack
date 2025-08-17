# Calendar Agent Testing Guide

## Overview
The Calendar Agent has been successfully deployed to production and is ready for testing. This guide explains how to test the calendar functionality.

## Testing the Calendar Agent

### Prerequisites
1. Ensure your Slack bot token is set:
   ```bash
   export SLACK_BOT_TOKEN=xoxb-your-bot-token
   ```

2. (Optional) Set a specific channel ID for testing:
   ```bash
   export SLACK_CHANNEL_ID=C07U3FCEL2X  # or your test channel
   ```

### Using the Test Script

#### Interactive Mode (Recommended)
```bash
node test-calendar-agent.js
```

This opens an interactive prompt where you can:
- Type `1-5` to send predefined test messages
- Type `help` to see all test examples
- Type any custom calendar message
- Type `exit` to quit

#### Run All Tests
```bash
node test-calendar-agent.js --all
```

This automatically runs through all test scenarios.

### Test Scenarios

#### 1. Schedule Meeting (Intent: calendar.schedule)
- "I want to set up a meeting with Leo and Richard tomorrow at 2pm"
- "Schedule a meeting with @username for next Monday"
- "Can we have a team sync tomorrow morning?"

Expected behavior:
1. Bot acknowledges the request
2. Extracts participants from mentions or names
3. Checks calendar availability
4. Shows available time slots
5. Asks for confirmation with radio buttons
6. Creates calendar event upon confirmation

#### 2. Check Calendar (Intent: calendar.check)
- "What's on my calendar today?"
- "Show me my meetings for this week"
- "Do I have any meetings tomorrow?"

Expected behavior:
1. Bot checks your Google Calendar
2. Lists upcoming events
3. Shows meeting details and participants

#### 3. Out of Office (Intent: calendar.ooo)
- "Mark me as out of office next week"
- "I'll be OOO from Monday to Friday for vacation"
- "Set my status to out of office tomorrow"

Expected behavior:
1. Bot asks for confirmation
2. Shows the OOO period
3. Updates calendar with OOO event
4. Notifies team members

#### 4. Cancel Meeting (Intent: calendar.cancel)
- "Cancel my 2pm meeting today"
- "I need to cancel tomorrow's sync"

Expected behavior:
1. Bot identifies the meeting
2. Asks for confirmation
3. Removes from calendar
4. Notifies attendees

#### 5. Reschedule Meeting (Intent: calendar.reschedule)
- "Can we move our 3pm meeting to 4pm?"
- "Reschedule tomorrow's standup to 11am"

Expected behavior:
1. Bot identifies the meeting
2. Checks new time availability
3. Updates calendar event
4. Notifies attendees

### Manual Testing in Slack

You can also test directly in Slack by:
1. Going to your test channel
2. Typing any calendar-related message
3. Watching for the bot's response

### Monitoring

#### Check Lambda Logs
```bash
# View router logs
aws logs tail /aws/lambda/symentic-slack-bot-prod-router --follow

# View specific calendar function logs
aws logs tail /aws/lambda/symentic-slack-bot-prod-calendar-analyze --follow
```

#### Check Step Function Execution
1. Go to AWS Console → Step Functions
2. Find `CalendarAgentStateMachine-prod`
3. Click on recent executions to see the workflow

### Common Issues

1. **Bot doesn't respond**: Check if the bot is in the channel and has proper permissions
2. **Calendar not found**: User needs to authenticate with Google Calendar first
3. **No available slots**: The system checks 7 days ahead for availability
4. **Confirmation timeout**: Users have 30 minutes to confirm actions

### Button Actions

The calendar agent creates interactive messages with buttons:
- **Time slot selection**: Radio buttons for choosing meeting times
- **Confirm/Cancel**: Action buttons for proceeding or cancelling
- **OOO confirmation**: Specific buttons for out-of-office requests

### Profile Engram Tracking

All calendar activities are saved to the user's profile engram:
- Meeting schedules with participants
- OOO periods with reasons
- Calendar check activities

### Next Steps

After testing:
1. Check CloudWatch logs for any errors
2. Verify Step Function executions completed successfully
3. Confirm calendar events were created in Google Calendar
4. Review profile engrams for activity tracking

## Troubleshooting

### Enable Debug Logging
Set environment variable before running tests:
```bash
export DEBUG=* node test-calendar-agent.js
```

### Check SQS Queue
```bash
aws sqs receive-message --queue-url https://sqs.us-east-1.amazonaws.com/842733143746/CalendarResponseQueue-prod
```

### Force Lambda Cold Start
This helps test initialization issues:
```bash
aws lambda update-function-configuration \
  --function-name symentic-slack-bot-prod-calendar-analyze \
  --description "$(date)"
```