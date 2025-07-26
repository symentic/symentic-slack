# Fix Summary

## Issue
The bot stopped responding to ALL messages because `shouldRespond` was coming back as `undefined` from the GPT classifier, and the router was treating `undefined` as falsy (should not respond).

## Root Cause
The GPT is being asked to return `shouldRespond` but it's not always including it in the response, resulting in `undefined`.

## Fix Applied
Changed the router logic from:
```javascript
if (!intent.shouldRespond)  // This treats undefined as falsy
```

To:
```javascript
if (intent.shouldRespond === false)  // Only ignore when explicitly false
```

## Current Behavior
- `shouldRespond: true` → Bot responds
- `shouldRespond: false` → Bot ignores
- `shouldRespond: undefined` → Bot responds (defaults to responding)

## Test Now
Try these messages again:
1. "hello" → Should get response (unless GPT sets shouldRespond=false)
2. "what's my schedule" → Should get calendar response
3. "bug: xyz broken" → Should start bug triage
4. Random text → Depends on GPT's analysis

The bot should now be working properly!