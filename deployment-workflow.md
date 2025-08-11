# Deployment Workflow for Team Development

## Quick Setup (One-time)

```bash
# 1. Each developer creates their own branch
git checkout -b dev/yourname
git push -u origin dev/yourname

# 2. Set your default stage
echo "export CDK_STAGE=dev-yourname" >> ~/.bashrc
source ~/.bashrc
```

## Daily Workflow

### 1. Start Your Work Session
```bash
# Pull latest changes from main
git checkout main
git pull origin main
git checkout dev/yourname
git merge main

# Deploy to your personal dev stage
npm run deploy:dev
# This runs: npx cdk deploy --all --context stage=$CDK_STAGE
```

### 2. While Developing
```bash
# Make changes and test in your dev stage
npm run deploy:dev

# Your Slack bot will have its own endpoint
# https://dnnc01ddj0.execute-api.us-east-1.amazonaws.com/dev-yourname/slack/events
```

### 3. Ready to Deploy to Production
```bash
# Create a pull request
git push origin dev/yourname
# Then create PR on GitHub

# OR deploy directly (coordinate with team)
git checkout main
git pull origin main
git merge dev/yourname
npm run deploy:prod
```

## Package.json Scripts

Add these to make it easier:

```json
{
  "scripts": {
    "deploy:dev": "npx cdk deploy --all --context stage=${CDK_STAGE:-dev-$USER}",
    "deploy:prod": "npx cdk deploy --all --context stage=prod",
    "diff:dev": "npx cdk diff --all --context stage=${CDK_STAGE:-dev-$USER}",
    "diff:prod": "npx cdk diff --all --context stage=prod",
    "destroy:dev": "npx cdk destroy --all --context stage=${CDK_STAGE:-dev-$USER}"
  }
}
```

## Slack Workspace Setup

Each developer can either:
1. **Share the same Slack workspace** - Create separate apps for each stage
2. **Use a test workspace** - One app per developer

### Option 1: Multiple Apps, Same Workspace
```
Production Bot: @symentic-bot
Your Dev Bot: @symentic-bot-dev-yourname
Co-founder's Bot: @symentic-bot-dev-cofounder
```

### Option 2: Separate Test Workspace
Create a free Slack workspace for testing, each developer has their own bot.

## Environment Variables

Create `.env.dev-yourname` for your stage:
```bash
SLACK_BOT_TOKEN=xoxb-your-dev-token
SLACK_SIGNING_SECRET=your-dev-secret
# ... other vars
```

Then load it:
```bash
export $(cat .env.dev-yourname | xargs)
npm run deploy:dev
```

## Deployment Coordination

### Before Production Deploy:
1. **Check who deployed last:**
   ```bash
   aws cloudformation describe-stacks \
     --stack-name symentic-slack-bot-v2-prod \
     --query 'Stacks[0].LastUpdatedTime' \
     --output text
   ```

2. **Post in Slack:**
   ```
   @channel Deploying to prod in 2 mins, please hold deployments
   ```

3. **Run diff first:**
   ```bash
   npm run diff:prod
   ```

## Quick Commands Reference

```bash
# Deploy to your dev
npm run deploy:dev

# Check what will change in prod
npm run diff:prod

# Deploy to prod (coordinate first!)
npm run deploy:prod

# Destroy your dev stack (cleanup)
npm run destroy:dev
```

## Conflict Resolution

If you both modified the same files:
```bash
# Pull their changes
git pull origin main

# Resolve conflicts
git status  # See conflicted files
# Edit files to resolve
git add .
git commit -m "Resolved conflicts"

# Test in your dev stage first
npm run deploy:dev
```