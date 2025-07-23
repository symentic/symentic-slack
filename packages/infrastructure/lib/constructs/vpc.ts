import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface VpcConstructProps {
  stage: string;
}

export class VpcConstruct extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;
  public readonly redisSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: VpcConstructProps) {
    super(scope, id);

    const { stage } = props;

    // Create VPC with public and private subnets
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `semantic-vpc-${stage}`,
      maxAzs: 2, // For high availability
      natGateways: 1, // Single NAT gateway for cost optimization
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Create security group for Lambda functions
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `semantic-lambda-sg-${stage}`,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    // Create security group for Redis
    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `semantic-redis-sg-${stage}`,
      description: 'Security group for ElastiCache Redis',
      allowAllOutbound: false, // Redis doesn't need outbound
    });

    // Allow Lambda to connect to Redis
    this.redisSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow Lambda functions to connect to Redis'
    );

    // Add tags
    cdk.Tags.of(this.vpc).add('Name', `semantic-vpc-${stage}`);
    cdk.Tags.of(this.vpc).add('Stage', stage);
  }
}