# Comprehensive Testing Plan for Calendar Agent

## Pre-Test Setup
1. Open CloudWatch logs in 3 terminals:
```bash
# Terminal 1: Router logs
aws logs tail /aws/lambda/semantic-slack-bot-dev-richard-router --follow --profile richard

# Terminal 2: Calendar Query logs  
aws logs tail /aws/lambda/semantic-slack-bot-dev-richard-calendarQuery --follow --profile richard

# Terminal 3: Check for any error logs
aws logs tail /aws/lambda/semantic-slack-bot-dev-richard-router --profile richard --filter-pattern "ERROR" --since 30m
```

## Test Sequence

### Phase 1: Basic Connectivity (5 tests)

1. **Test Bot Response**
   - Send: "hello" 
   - Expected: Bot processes message, classifies as non-calendar intent
   - Verify in logs: `Processing message: "hello"` appears

2. **Test Direct Calendar Query**
   - Send: "What's my schedule today?"
   - Expected: 
     - Immediate: "📅 Let me check your calendar..."
     - Then: Mock calendar data with meetings
   - Verify in logs: 
     - `Intent classified: calendar.check`
     - `Invoking calendar query Lambda`

3. **Test Typo Handling**
   - Send: "wuts ma scheudle"
   - Expected: Same calendar response (proves pre-filter removed)
   - Verify: Intent still classified correctly despite typo

4. **Test Alternative Phrasings**
   - Send these one by one:
     - "show my calendar"
     - "what meetings do I have"
     - "am I free at 2pm"
   - Expected: All trigger calendar responses

5. **Test Non-Calendar Message**
   - Send: "help me debug my code"
   - Expected: Different intent classification (not calendar)
   - Verify: No calendar Lambda invocation

### Phase 2: Edge Cases (5 tests)

6. **Test Empty/Minimal Messages**
   - Send: "calendar"
   - Send: "schedule"  
   - Send: "?"
   - Expected: Should still process through intent classifier

7. **Test Long Message**
   - Send: "I need to check my calendar for today and tomorrow and also next week because I have a lot of meetings coming up and need to plan ahead"
   - Expected: Should handle without truncation errors

8. **Test Special Characters**
   - Send: "What's my schedule? 📅"
   - Send: "calendar!!!"
   - Expected: Should process normally

9. **Test Thread Responses**
   - Send: "What's my schedule?"
   - After bot responds, reply in thread: "what about tomorrow?"
   - Expected: Thread message should also be processed

10. **Test Rapid Messages**
    - Send 3 messages quickly:
      - "schedule"
      - "calendar" 
      - "meetings today"
    - Expected: All should be processed (check for rate limiting)

### Phase 3: Error Detection (5 tests)

11. **Test Lambda Timeout**
    - Monitor how long calendar query takes
    - Verify: Response time < 3 seconds

12. **Test Concurrent Requests**
    - Have 2 people send calendar requests simultaneously
    - Expected: Both get responses, no conflicts

13. **Test After Long Idle**
    - Wait 15 minutes, then send: "What's my schedule?"
    - Expected: Still works (tests cold start)

14. **Test Channel vs DM**
    - DM: "What's my schedule?"
    - Channel: "@SymenticBotDev-Richard what's my schedule?"
    - Expected: Both work identically

15. **Test Intent Classification Accuracy**
    - Send these ambiguous messages:
      - "meeting"
      - "time"
      - "busy"
    - Note: What intent is assigned? Are there false positives?

## Bug Checklist

### Check Logs For:
- [ ] Any ERROR messages
- [ ] Any timeout warnings  
- [ ] Any "undefined" or "null" values
- [ ] Any failed Lambda invocations
- [ ] Any Redis connection errors
- [ ] Any missing environment variables

### Common Issues to Watch For:
1. **Double Responses**: Bot responds twice to same message
2. **Missing Responses**: Bot acknowledges but no follow-up
3. **Slow Responses**: >5 seconds to respond
4. **Wrong User Context**: Response mentions wrong user
5. **Format Issues**: Slack blocks not rendering correctly

## Performance Metrics to Note

1. **Response Times**:
   - Intent classification: ___ms
   - Calendar Lambda: ___ms
   - Total response: ___ms

2. **Success Rate**:
   - Messages processed: ___/___
   - Correct intent: ___/___
   - Successful responses: ___/___

3. **Error Rate**:
   - Timeouts: ___
   - Lambda errors: ___
   - Missing responses: ___

## Post-Test Verification

Run these queries to check for issues:
```bash
# Check for any errors in last hour
aws logs filter-log-events --log-group-name /aws/lambda/semantic-slack-bot-dev-richard-router --filter-pattern "ERROR" --start-time $(date -u -d '1 hour ago' +%s)000 --profile richard

# Check for timeouts
aws logs filter-log-events --log-group-name /aws/lambda/semantic-slack-bot-dev-richard-router --filter-pattern "Task timed out" --start-time $(date -u -d '1 hour ago' +%s)000 --profile richard

# Check calendar lambda invocations
aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Invocations --dimensions Name=FunctionName,Value=semantic-slack-bot-dev-richard-calendarQuery --statistics Sum --start-time $(date -u -d '1 hour ago' --iso-8601) --end-time $(date -u --iso-8601) --period 300 --profile richard
```

## Results Summary Template

```
Test Date: _______
Tester: _______

Basic Tests: ___/5 passed
Edge Cases: ___/5 passed  
Error Tests: ___/5 passed

Issues Found:
1. 
2. 
3. 

Recommendations:
1.
2.
3.
```