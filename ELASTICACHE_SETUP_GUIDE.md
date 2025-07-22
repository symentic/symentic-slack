# AWS ElastiCache Redis Setup Guide

This guide will walk you through setting up ElastiCache Redis in AWS, configuring VPC and security groups, and connecting it to your Lambda functions.

## Prerequisites

- AWS account with appropriate permissions
- Basic understanding of VPC and security groups
- AWS Lambda function that needs Redis access

## Step 1: Create a VPC (if needed)

### 1.1 Navigate to VPC Console
1. Go to AWS Console → Services → VPC
2. Click "Create VPC"

### 1.2 VPC Configuration
- **Name**: `elasticache-vpc` (or your preferred name)
- **IPv4 CIDR block**: `10.0.0.0/16`
- **IPv6 CIDR block**: No IPv6 CIDR block
- **Tenancy**: Default
- Click "Create VPC"

### 1.3 Create Subnets
You need at least 2 subnets in different availability zones for ElastiCache:

**Subnet 1:**
- Name: `elasticache-subnet-1`
- VPC: Select your VPC
- Availability Zone: `us-east-1a` (or your region's AZ)
- IPv4 CIDR block: `10.0.1.0/24`

**Subnet 2:**
- Name: `elasticache-subnet-2`
- VPC: Select your VPC
- Availability Zone: `us-east-1b` (different from subnet 1)
- IPv4 CIDR block: `10.0.2.0/24`

## Step 2: Create Security Groups

### 2.1 Security Group for ElastiCache
1. Go to EC2 Console → Security Groups
2. Click "Create security group"

**Configuration:**
- **Name**: `elasticache-redis-sg`
- **Description**: Security group for ElastiCache Redis
- **VPC**: Select your VPC

**Inbound Rules:**
- Type: Custom TCP
- Port range: 6379 (Redis default port)
- Source: Custom (we'll update this later with Lambda's security group)

### 2.2 Security Group for Lambda
1. Create another security group
2. **Name**: `lambda-elasticache-sg`
3. **Description**: Security group for Lambda accessing ElastiCache
4. **VPC**: Select your VPC
5. No inbound rules needed (Lambda only makes outbound connections)

### 2.3 Update ElastiCache Security Group
Go back to the ElastiCache security group and update the inbound rule:
- Source: Select the Lambda security group (`lambda-elasticache-sg`)

## Step 3: Create ElastiCache Subnet Group

### 3.1 Navigate to ElastiCache Console
1. Go to AWS Console → Services → ElastiCache
2. In the left menu, click "Subnet groups"
3. Click "Create subnet group"

### 3.2 Configure Subnet Group
- **Name**: `elasticache-subnet-group`
- **Description**: Subnet group for ElastiCache Redis
- **VPC**: Select your VPC
- **Availability Zones**: Select the subnets you created
- Click "Create"

## Step 4: Create ElastiCache Redis Cluster

### 4.1 Create Redis Cluster
1. In ElastiCache Console, click "Redis clusters"
2. Click "Create Redis cluster"

### 4.2 Cluster Mode
- Choose "Cluster mode disabled" (simpler for most use cases)

### 4.3 Cluster Settings
- **Name**: `my-redis-cluster`
- **Description**: Redis cluster for application
- **Engine version**: Latest stable version (e.g., 7.0)
- **Port**: 6379
- **Parameter group**: default.redis7 (or matching your version)
- **Node type**: `cache.t3.micro` (for testing) or `cache.r6g.large` (for production)
- **Number of replicas**: 1 (for high availability)

### 4.4 Advanced Settings
- **Subnet group**: Select `elasticache-subnet-group`
- **Availability zone**: No preference
- **Security groups**: Select `elasticache-redis-sg`
- **Encryption at rest**: Enable (recommended)
- **Encryption in transit**: Enable (recommended)
- **Backup**: Configure as needed

### 4.5 Create Cluster
Click "Create" and wait for the cluster to be available (5-10 minutes)

## Step 5: Get the Redis Endpoint URL

### 5.1 Find the Primary Endpoint
1. Go to ElastiCache Console → Redis clusters
2. Click on your cluster name
3. In the "Nodes" section, find the "Primary endpoint"

The endpoint will look like:
```
my-redis-cluster.abc123.ng.0001.use1.cache.amazonaws.com:6379
```

### 5.2 Format for REDIS_URL
If encryption in transit is enabled:
```
rediss://my-redis-cluster.abc123.ng.0001.use1.cache.amazonaws.com:6379
```

If encryption in transit is disabled:
```
redis://my-redis-cluster.abc123.ng.0001.use1.cache.amazonaws.com:6379
```

Note: Use `rediss://` (with double 's') for SSL/TLS connections.

## Step 6: Configure Lambda to Access ElastiCache

### 6.1 Update Lambda Configuration
1. Go to Lambda Console → Your function
2. Click "Configuration" → "VPC"

### 6.2 VPC Settings
- **VPC**: Select your VPC
- **Subnets**: Select the same subnets as ElastiCache
- **Security groups**: Select `lambda-elasticache-sg`

### 6.3 Add Environment Variable
1. Go to "Configuration" → "Environment variables"
2. Add:
   - **Key**: `REDIS_URL`
   - **Value**: Your Redis endpoint URL

### 6.4 Update Lambda Execution Role
Your Lambda needs VPC permissions. Add this policy to your Lambda's execution role:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ec2:CreateNetworkInterface",
                "ec2:DescribeNetworkInterfaces",
                "ec2:DeleteNetworkInterface",
                "ec2:AssignPrivateIpAddresses",
                "ec2:UnassignPrivateIpAddresses"
            ],
            "Resource": "*"
        }
    ]
}
```

## Step 7: Test the Connection

### 7.1 Sample Lambda Code
```python
import redis
import os

def lambda_handler(event, context):
    # Get Redis URL from environment
    redis_url = os.environ['REDIS_URL']
    
    # Connect to Redis
    r = redis.from_url(redis_url, decode_responses=True)
    
    # Test connection
    r.ping()
    
    # Set and get a value
    r.set('test_key', 'Hello from Lambda!')
    value = r.get('test_key')
    
    return {
        'statusCode': 200,
        'body': f'Redis test successful! Value: {value}'
    }
```

### 7.2 Common Issues and Solutions

**Connection Timeout:**
- Check security group rules
- Verify Lambda is in the same VPC
- Ensure subnets can communicate

**Authentication Failed:**
- If using AUTH, add password to Redis URL: `redis://:password@host:port`
- Check ElastiCache auth token if enabled

**SSL Certificate Error:**
- Use `ssl_cert_reqs='none'` in Redis connection for self-signed certs
- Or properly configure SSL certificates

## Step 8: Production Best Practices

### 8.1 High Availability
- Use Multi-AZ deployment
- Configure automatic failover
- Set up read replicas

### 8.2 Security
- Enable encryption at rest and in transit
- Use AUTH tokens
- Restrict security group rules
- Enable VPC Flow Logs

### 8.3 Monitoring
- Set up CloudWatch alarms for:
  - CPU utilization
  - Memory usage
  - Connection count
  - Evictions
- Enable ElastiCache insights

### 8.4 Backup
- Configure automatic backups
- Set appropriate retention period
- Test restore procedures

### 8.5 Cost Optimization
- Use reserved instances for predictable workloads
- Right-size your instances
- Monitor unused capacity

## Troubleshooting Checklist

- [ ] Lambda and ElastiCache in same VPC?
- [ ] Security groups allow traffic on port 6379?
- [ ] Lambda has VPC execution permissions?
- [ ] ElastiCache cluster is "available"?
- [ ] Using correct endpoint (primary vs reader)?
- [ ] Correct protocol (redis:// vs rediss://)?
- [ ] Subnets have route to each other?
- [ ] No Network ACL blocking traffic?

## Additional Resources

- [AWS ElastiCache Documentation](https://docs.aws.amazon.com/elasticache/)
- [Redis Best Practices](https://docs.aws.amazon.com/elasticache/latest/red-ug/BestPractices.html)
- [Lambda VPC Configuration](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)