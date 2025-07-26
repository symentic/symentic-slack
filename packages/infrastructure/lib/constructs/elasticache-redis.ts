import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';

export interface ElastiCacheRedisConstructProps {
  vpc: ec2.Vpc;
  securityGroup: ec2.SecurityGroup;
  stage: string;
}

export class ElastiCacheRedisConstruct extends Construct {
  public readonly endpoint: string;
  public readonly port: string;

  constructor(scope: Construct, id: string, props: ElastiCacheRedisConstructProps) {
    super(scope, id);

    const { vpc, securityGroup, stage } = props;

    // Create subnet group for ElastiCache
    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis cluster',
      subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
              cacheSubnetGroupName: `symentic-redis-subnet-group-${stage}`,
    });

    // Create Redis replication group for high availability
    const replicationGroup = new elasticache.CfnReplicationGroup(this, 'RedisReplicationGroup', {
              replicationGroupId: `symentic-redis-${stage}`,
      replicationGroupDescription: 'Redis cluster for Symentic Slack Bot',
      engine: 'redis',
      cacheNodeType: 'cache.t3.micro', // Free tier eligible
      numCacheClusters: 1, // Single node for cost optimization
      automaticFailoverEnabled: false, // Single AZ for cost optimization
      cacheSubnetGroupName: subnetGroup.cacheSubnetGroupName,
      securityGroupIds: [securityGroup.securityGroupId],
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: false, // Disabled for simpler connection
      port: 6379,
      preferredMaintenanceWindow: 'sun:05:00-sun:06:00',
      snapshotRetentionLimit: 1, // Keep 1 day of backups
      snapshotWindow: '03:00-04:00',
      tags: [
        { key: 'Name', value: `symentic-redis-${stage}` },
        { key: 'Stage', value: stage },
      ],
    });

    replicationGroup.addDependency(subnetGroup);

    // Output the endpoint
    this.endpoint = replicationGroup.attrPrimaryEndPointAddress;
    this.port = replicationGroup.attrPrimaryEndPointPort;

    // Create outputs
    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: this.endpoint,
      description: 'Redis primary endpoint',
    });

    new cdk.CfnOutput(this, 'RedisPort', {
      value: this.port,
      description: 'Redis port',
    });
  }
}