import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { DynamoDBTables } from '../types';

export interface DynamoDBTablesConstructProps {
  stage: string;
}

export class DynamoDBTablesConstruct extends Construct {
  public readonly tables: DynamoDBTables;

  constructor(scope: Construct, id: string, props: DynamoDBTablesConstructProps) {
    super(scope, id);

    const { stage } = props;

    this.tables = {
      usersTable: this.createUsersTable(stage),
      workspacesTable: this.createWorkspacesTable(stage),
      engramsTable: this.createEngramsTable(stage),
      bugReportsTable: this.createBugReportsTable(stage),
      calendarTokensTable: this.createCalendarTokensTable(stage),
      meetingsTable: this.createMeetingsTable(stage),
      areaExpertiseTable: this.createAreaExpertiseTable(stage),
      workflowsTable: this.createWorkflowsTable(stage),
      executionsTable: this.createExecutionsTable(stage),
      profileEngramsTable: this.createProfileEngramsTable(stage),
    };
  }

  private createUsersTable(stage: string): dynamodb.Table {
    return new dynamodb.Table(this, 'UsersTable', {
      tableName: `SymenticUsers-${stage}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
  }

  private createWorkspacesTable(stage: string): dynamodb.Table {
    return new dynamodb.Table(this, 'WorkspacesTable', {
      tableName: `SymenticWorkspaces-${stage}`,
      partitionKey: { name: 'workspaceId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
  }

  private createEngramsTable(stage: string): dynamodb.Table {
    const table = new dynamodb.Table(this, 'EngramsTable', {
      tableName: `SymenticEngrams-${stage}`,
      partitionKey: { name: 'engramId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'userId-createdAt-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    return table;
  }

  private createBugReportsTable(stage: string): dynamodb.Table {
    return new dynamodb.Table(this, 'BugReportsTable', {
      tableName: `SymenticBugReports-${stage}`,
      partitionKey: { name: 'bugId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
  }

  private createCalendarTokensTable(stage: string): dynamodb.Table {
    return new dynamodb.Table(this, 'CalendarTokensTable', {
      tableName: `SymenticCalendarTokens-${stage}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
  }

  private createMeetingsTable(stage: string): dynamodb.Table {
    return new dynamodb.Table(this, 'MeetingsTable', {
      tableName: `SymenticMeetings-${stage}`,
      partitionKey: { name: 'meetingId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
  }

  private createAreaExpertiseTable(stage: string): dynamodb.Table {
    const table = new dynamodb.Table(this, 'AreaExpertiseTable', {
      tableName: `SymenticAreaExpertise-${stage}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'area', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'area-count-index',
      partitionKey: { name: 'area', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'count', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    return table;
  }

  private createWorkflowsTable(stage: string): dynamodb.Table {
    return new dynamodb.Table(this, 'WorkflowsTable', {
      tableName: `SymenticWorkflows-${stage}`,
      partitionKey: { name: 'threadId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
  }

  private createExecutionsTable(stage: string): dynamodb.Table {
    const table = new dynamodb.Table(this, 'ExecutionsTable', {
      tableName: `SymenticExecutions-${stage}`,
      partitionKey: { name: 'executionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'threadId-createdAt-index',
      partitionKey: { name: 'threadId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'userId-status-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    return table;
  }

  private createProfileEngramsTable(stage: string): dynamodb.Table {
    const table = new dynamodb.Table(this, 'ProfileEngramsTable', {
      tableName: `SymenticProfileEngrams-${stage}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING }, // BUSINESS#businessId
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING }, // USER#userId or INTERACTION#timestamp#userId
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // GSI1: For querying by user type within a business
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING }, // BUSINESS#businessId
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING }, // TYPE#userType#USER#userId
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: For querying by tags within a business
    table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'businessId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'lastInteraction', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    return table;
  }
}