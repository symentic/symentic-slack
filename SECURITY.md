# Security Guidelines

## Environment Variables

### Never Commit
- `.env` files (already in `.gitignore`)
- `env.json` files  
- Any file containing API keys, tokens, or secrets

### Best Practices
1. Use `.env.example` as a template
2. Keep all sensitive values in `.env` file
3. Load environment variables at runtime
4. Use AWS Secrets Manager for production

## Sensitive Data Protection

### Current Protection
- ✅ `.env` is gitignored
- ✅ `env.json` is gitignored and removed
- ✅ `.serverless/` directory removed
- ✅ All secrets loaded from environment variables

### Required Environment Variables
- `SLACK_BOT_TOKEN` - Slack bot OAuth token
- `SLACK_SIGNING_SECRET` - Slack app signing secret
- `OPENAI_API_KEY` - OpenAI API key
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_REDIRECT_URI` - OAuth callback URL
- `INTERNAL_API_KEY` - Internal API authentication

## AWS Security

### IAM Best Practices
- Lambda functions use least-privilege roles
- Each function only has access to required resources
- No hardcoded AWS credentials

### Data Protection
- DynamoDB encryption at rest enabled
- CloudWatch logs auto-expire after 1 week
- SQS messages expire after 1 hour

## Deployment Security

### Local Development
1. Copy `.env.example` to `.env`
2. Fill in your development credentials
3. Never commit `.env` file

### Production Deployment
1. Use AWS Secrets Manager or Parameter Store
2. Set environment variables in CI/CD pipeline
3. Rotate credentials regularly

## Git Security

### Pre-commit Checks
Before committing, ensure:
```bash
git status | grep -E "\.env|secret|key|token" || echo "Safe to commit"
```

### If Secrets Are Accidentally Committed
1. Remove from history immediately
2. Rotate all affected credentials
3. Use `git filter-branch` or BFG Repo-Cleaner