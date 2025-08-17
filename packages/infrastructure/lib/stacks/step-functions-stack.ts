import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { LambdaFunctions } from '../types';
import { BugTriageStateMachine } from '../step-functions/bug-triage-state-machine';
import { CalendarAgentStateMachine } from '../step-functions/calendar-agent-state-machine';

export interface StepFunctionsStackProps extends cdk.StackProps {
  stage: string;
  lambdaFunctions: LambdaFunctions;
  bugResponseQueue: sqs.Queue;
  calendarResponseQueue?: sqs.Queue;
}

export class StepFunctionsStack extends cdk.Stack {
  public readonly bugTriageStateMachine: BugTriageStateMachine;
  public readonly calendarAgentStateMachine: CalendarAgentStateMachine;

  constructor(scope: Construct, id: string, props: StepFunctionsStackProps) {
    super(scope, id, props);

    // Create Bug Triage State Machine
    this.bugTriageStateMachine = new BugTriageStateMachine(this, 'BugTriageStateMachine', {
      lambdaFunctions: props.lambdaFunctions,
      bugResponseQueue: props.bugResponseQueue,
      stage: props.stage,
    });

    // Create Calendar Response Queue if not provided
    const calendarResponseQueue = props.calendarResponseQueue || new sqs.Queue(this, 'CalendarResponseQueue', {
      queueName: `CalendarResponseQueue-${props.stage}`,
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(1),
    });

    // Create Calendar Agent State Machine
    this.calendarAgentStateMachine = new CalendarAgentStateMachine(this, 'CalendarAgentStateMachine', {
      lambdaFunctions: props.lambdaFunctions,
      calendarResponseQueue,
      stage: props.stage,
    });

    // Permission grant moved to main stack to avoid circular dependency

    // Create outputs
    new cdk.CfnOutput(this, 'BugTriageStateMachineArn', {
      value: this.bugTriageStateMachine.stateMachine.stateMachineArn,
      description: 'Bug Triage State Machine ARN',
    });

    new cdk.CfnOutput(this, 'BugTriageStateMachineName', {
      value: this.bugTriageStateMachine.stateMachine.stateMachineName,
      description: 'Bug Triage State Machine Name',
    });

    new cdk.CfnOutput(this, 'CalendarAgentStateMachineArn', {
      value: this.calendarAgentStateMachine.stateMachine.stateMachineArn,
      description: 'Calendar Agent State Machine ARN',
    });

    new cdk.CfnOutput(this, 'CalendarAgentStateMachineName', {
      value: this.calendarAgentStateMachine.stateMachine.stateMachineName,
      description: 'Calendar Agent State Machine Name',
    });

    new cdk.CfnOutput(this, 'CalendarResponseQueueUrl', {
      value: calendarResponseQueue.queueUrl,
      description: 'Calendar Response Queue URL',
    });
  }
}