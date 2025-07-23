import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { LambdaFunctions } from '../types';
import { BugTriageStateMachine } from '../step-functions/bug-triage-state-machine';

export interface StepFunctionsStackProps extends cdk.StackProps {
  stage: string;
  lambdaFunctions: LambdaFunctions;
  bugResponseQueue: sqs.Queue;
}

export class StepFunctionsStack extends cdk.Stack {
  public readonly bugTriageStateMachine: BugTriageStateMachine;

  constructor(scope: Construct, id: string, props: StepFunctionsStackProps) {
    super(scope, id, props);

    // Create Bug Triage State Machine
    this.bugTriageStateMachine = new BugTriageStateMachine(this, 'BugTriageStateMachine', {
      lambdaFunctions: props.lambdaFunctions,
      bugResponseQueue: props.bugResponseQueue,
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
  }
}