import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { DynamoDBTablesConstruct } from '../constructs/dynamodb-tables';
import { LambdaFunctionsConstruct } from '../constructs/lambda-functions';
import { VpcConstruct } from '../constructs/vpc';
import { ElastiCacheRedisConstruct } from '../constructs/elasticache-redis';
import { LambdaFunctions, DynamoDBTables, EnvironmentConfig } from '../types';

export interface MainStackProps extends cdk.StackProps {
  stage: string;
}

export class MainStack extends cdk.Stack {
  public readonly lambdaFunctions: LambdaFunctions;
  public readonly bugResponseQueue: sqs.Queue;
  public readonly tables: DynamoDBTables;
  private readonly stage: string;

  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, props);

    this.stage = props.stage;

    // Load environment variables from env.json
    const envConfig = this.loadEnvConfig();

    // Create VPC and networking
    const vpcConstruct = new VpcConstruct(this, 'Vpc', {
      stage: this.stage,
    });

    // Create ElastiCache Redis
    const redisConstruct = new ElastiCacheRedisConstruct(this, 'Redis', {
      vpc: vpcConstruct.vpc,
      securityGroup: vpcConstruct.redisSecurityGroup,
      stage: this.stage,
    });

    // Create DynamoDB tables
    const tablesConstruct = new DynamoDBTablesConstruct(this, 'Tables', {
      stage: this.stage,
    });
    this.tables = tablesConstruct.tables;

    // Create SQS Queue
    this.bugResponseQueue = this.createSQSQueue('BugResponseQueue');

    // Update environment config with Redis endpoint
    const updatedEnvConfig = {
      ...envConfig,
      REDIS_URL: `redis://${redisConstruct.endpoint}:${redisConstruct.port}`,
    };

    // Create Lambda functions
    const lambdaConstruct = new LambdaFunctionsConstruct(this, 'LambdaFunctions', {
      stage: this.stage,
      tables: this.tables,
      bugResponseQueue: this.bugResponseQueue,
      envConfig: updatedEnvConfig,
      vpc: vpcConstruct.vpc,
      securityGroup: vpcConstruct.lambdaSecurityGroup,
    });
    this.lambdaFunctions = lambdaConstruct.functions;

    // Create API Gateway
    this.createApiGateway();

    // Create outputs
    this.createOutputs();
  }

  private loadEnvConfig(): EnvironmentConfig {
    // Load from process.env (which can be populated from .env file)
    const requiredEnvVars = [
      'SLACK_BOT_TOKEN',
      'SLACK_SIGNING_SECRET', 
      'OPENAI_API_KEY',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'INTERNAL_API_KEY'
    ];

    const missing = requiredEnvVars.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}. Please set them in .env file or environment.`);
    }

    return {
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN!,
      SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET!,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
      GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI!,
      INTERNAL_API_KEY: process.env.INTERNAL_API_KEY!,
      REDIS_URL: process.env.REDIS_URL,
      AWS_REGION: process.env.AWS_REGION,
    };
  }

  private createSQSQueue(name: string): sqs.Queue {
    return new sqs.Queue(this, name, {
      queueName: `symentic-${name}-${this.stage}`,
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.hours(1),
    });
  }

  private createApiGateway(): void {
    const api = new apigateway.RestApi(this, 'SlackBotApi', {
              restApiName: `symentic-slack-bot-${this.stage}`,
      deployOptions: {
        stageName: this.stage,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Create /slack/events endpoint
    const slackResource = api.root.addResource('slack');
    const eventsResource = slackResource.addResource('events');

    eventsResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.router)
    );
    
    // OAuth endpoint is created manually in API Gateway to avoid conflicts
    // The /auth/google/callback route is already configured to use the router Lambda

    // Output API endpoint
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: `${api.url}slack/events`,
      description: 'Slack Events API Endpoint',
    });
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'BugResponseQueueUrl', {
      value: this.bugResponseQueue.queueUrl,
      description: 'Bug Response Queue URL',
    });

    Object.entries(this.tables).forEach(([name, table]) => {
      new cdk.CfnOutput(this, `${name}Name`, {
        value: table.tableName,
        description: `${name} DynamoDB Table Name`,
      });
    });
  }
}