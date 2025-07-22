# Setting up AWS ElastiCache for semantic-slack

## Quick Setup Guide

### Step 1: Create ElastiCache Redis Cluster

1. Go to AWS Console → ElastiCache
2. Click "Create" → "Redis cluster"
3. Choose:
   - **Cluster mode**: Disabled
   - **Node type**: cache.t3.micro (for testing)
   - **Number of replicas**: 0 (for testing)
   - **Multi-AZ**: Disabled (for testing)

### Step 2: Configure Network

1. **Subnet group**: Create new or use existing
2. **Security group**: Create new with:
   - Inbound rule: Port 6379 from your Lambda security group
   - Or for testing: Port 6379 from anywhere (0.0.0.0/0) - NOT recommended for production

### Step 3: Get the Endpoint

After creation, copy the **Primary Endpoint** (looks like: `your-cluster.xxxxx.cache.amazonaws.com:6379`)

### Step 4: Update Configuration

1. Update your `env.json`:
```json
{
  "REDIS_URL": "redis://your-cluster.xxxxx.cache.amazonaws.com:6379",
  "REDIS_PASSWORD": ""
}
```

### Step 5: Configure Lambda VPC (if using VPC)

If your ElastiCache is in a VPC, your Lambda must be in the same VPC:

1. In serverless.yml, add:
```yaml
provider:
  vpc:
    securityGroupIds:
      - sg-xxxxxx  # Your Lambda security group
    subnetIds:
      - subnet-xxxxx  # Same subnets as ElastiCache
      - subnet-yyyyy
```

2. Ensure Lambda security group has:
   - Outbound rule: Port 6379 to ElastiCache security group
   - Outbound rule: HTTPS (443) to 0.0.0.0/0 (for internet access)

### Step 6: Deploy

```bash
npm run deploy
```

## Alternative: Use Upstash Redis (Serverless Redis)

For a simpler setup without VPC complexity:

1. Sign up at https://upstash.com
2. Create a Redis database
3. Copy the Redis URL
4. Update env.json with the Upstash URL
5. No VPC configuration needed!

## Cost Estimates

- **ElastiCache t3.micro**: ~$12/month
- **NAT Gateway (if using VPC)**: ~$45/month
- **Upstash**: $0.2 per 100K commands (pay-per-use)

## Troubleshooting

1. **Connection timeout**: Check security groups and VPC configuration
2. **Lambda timeout**: Increase Lambda timeout if connecting takes time
3. **"Redis is disabled"**: Check REDIS_URL format and remove localhost/127.0.0.1

## Current Redis Service Features

Your Redis service already supports:
- Automatic fallback to in-memory storage when Redis is unavailable
- Connection retry logic
- TTL-based expiration
- All necessary operations for the Slack bot

No code changes needed - just set the REDIS_URL!