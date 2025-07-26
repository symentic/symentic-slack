#!/bin/bash
# Deploy script for dev-richard stage

echo "🚀 Deploying dev-richard stage..."

# Set AWS profile
export AWS_PROFILE=richard
export CDK_DEFAULT_ACCOUNT=842733143746
export CDK_DEFAULT_REGION=us-east-1

# Navigate to infrastructure directory
cd packages/infrastructure

# Deploy with CDK
AWS_PROFILE=richard npx cdk deploy --all --context stage=dev-richard --require-approval never

echo "✅ Deployment complete!"
echo ""
echo "📋 Your dev environment details:"
echo "   API Endpoint: https://x1ktug3za3.execute-api.us-east-1.amazonaws.com/dev-richard/slack/events"
echo "   Bot Name: SymenticBotDev-Richard"
echo ""
echo "🧪 Test your bot:"
echo "   1. In Slack, find SymenticBotDev-Richard in Apps"
echo "   2. Send a direct message: 'What's my schedule today?'"
echo "   3. Or in a channel: '@SymenticBotDev-Richard what's my schedule?'"
echo ""
echo "📊 Monitor logs:"
echo "   aws logs tail /aws/lambda/semantic-slack-bot-dev-richard-router --follow"