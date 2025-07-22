# ElastiCache with VPC setup guide for semantic-slack

## Option 1: Simpler Approach - Using Existing VPC

If you already have a VPC or want a simpler setup, update your serverless.yml:

```yaml
provider:
  # ... existing config ...
  environment:
    REDIS_URL: ${env:ELASTICACHE_ENDPOINT}  # Set this after creating ElastiCache
```

## Option 2: Manual ElastiCache Setup

1. Create ElastiCache Redis cluster in AWS Console:
   - Go to ElastiCache in AWS Console
   - Create Redis cluster
   - Choose cache.t3.micro for testing
   - Use your existing VPC or create new one
   - Note the endpoint URL

2. Update your Lambda function:
   - Add Lambda to same VPC as ElastiCache
   - Configure security groups to allow Redis port 6379

3. Set environment variable:
   ```bash
   export ELASTICACHE_ENDPOINT="redis://your-cluster.xxxxx.cache.amazonaws.com:6379"
   ```

## Option 3: Full Infrastructure as Code

Use the provided serverless-resources.yml which creates:
- VPC with public/private subnets
- NAT Gateway for Lambda internet access
- ElastiCache Redis cluster
- Security groups with proper access

Deploy with:
```bash
serverless deploy
```

Note: This creates additional AWS resources that incur costs:
- NAT Gateway: ~$45/month
- ElastiCache t3.micro: ~$12/month
- VPC: Free