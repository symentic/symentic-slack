import * as cdk from 'aws-cdk-lib';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { LambdaFunctions } from '../types';

export interface CalendarAgentStateMachineProps {
  lambdaFunctions: LambdaFunctions;
  calendarResponseQueue: sqs.Queue;
  stage: string;
}

export class CalendarAgentStateMachine extends Construct {
  public readonly stateMachine: stepfunctions.StateMachine;

  constructor(scope: Construct, id: string, props: CalendarAgentStateMachineProps) {
    super(scope, id);

    const { lambdaFunctions, calendarResponseQueue, stage } = props;

    // Create all the tasks
    const tasks = this.createTasks(lambdaFunctions, calendarResponseQueue);
    
    // Create all the states
    const states = this.createStates();
    
    // Build the state machine definition
    const definition = this.buildDefinition(tasks, states);
    
    // Create the state machine
    this.stateMachine = new stepfunctions.StateMachine(this, 'StateMachine', {
      stateMachineName: `CalendarAgentStateMachine-${stage}`,
      definition,
      timeout: cdk.Duration.hours(2), // Shorter timeout for calendar operations
      tracingEnabled: true,
      logs: {
        destination: new cdk.aws_logs.LogGroup(this, 'LogGroup', {
          logGroupName: `/aws/stepfunctions/CalendarAgentStateMachine-${stage}`,
          retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: stepfunctions.LogLevel.ALL,
      },
    });
  }

  private createTasks(lambdaFunctions: LambdaFunctions, calendarResponseQueue: sqs.Queue) {
    return {
      analyzeIntent: new stepfunctionsTasks.LambdaInvoke(this, 'AnalyzeIntent', {
        lambdaFunction: lambdaFunctions.calendarAnalyzeFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),

      extractParticipants: new stepfunctionsTasks.LambdaInvoke(this, 'ExtractParticipants', {
        lambdaFunction: lambdaFunctions.calendarExtractParticipantsFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),

      checkAvailability: new stepfunctionsTasks.LambdaInvoke(this, 'CheckAvailability', {
        lambdaFunction: lambdaFunctions.calendarCheckAvailabilityFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),

      askScheduleConfirmation: new stepfunctionsTasks.LambdaInvoke(this, 'AskScheduleConfirmation', {
        lambdaFunction: lambdaFunctions.calendarAskConfirmationFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),
      
      askOOOConfirmation: new stepfunctionsTasks.LambdaInvoke(this, 'AskOOOConfirmation', {
        lambdaFunction: lambdaFunctions.calendarAskConfirmationFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),

      waitForScheduleConfirmation: new stepfunctionsTasks.SqsSendMessage(this, 'WaitForScheduleConfirmation', {
        queue: calendarResponseQueue,
        messageBody: stepfunctions.TaskInput.fromObject({
          'taskToken.$': stepfunctions.JsonPath.taskToken,
          'data.$': '$'
        }),
        integrationPattern: stepfunctions.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        taskTimeout: stepfunctions.Timeout.duration(cdk.Duration.minutes(30)),
      }),
      
      waitForOOOConfirmation: new stepfunctionsTasks.SqsSendMessage(this, 'WaitForOOOConfirmation', {
        queue: calendarResponseQueue,
        messageBody: stepfunctions.TaskInput.fromObject({
          'taskToken.$': stepfunctions.JsonPath.taskToken,
          'data.$': '$'
        }),
        integrationPattern: stepfunctions.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        taskTimeout: stepfunctions.Timeout.duration(cdk.Duration.minutes(30)),
      }),

      processScheduleResponse: new stepfunctionsTasks.LambdaInvoke(this, 'ProcessScheduleResponse', {
        lambdaFunction: lambdaFunctions.calendarProcessResponseFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),
      
      processOOOResponse: new stepfunctionsTasks.LambdaInvoke(this, 'ProcessOOOResponse', {
        lambdaFunction: lambdaFunctions.calendarProcessResponseFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),

      createEvent: new stepfunctionsTasks.LambdaInvoke(this, 'CreateEvent', {
        lambdaFunction: lambdaFunctions.calendarCreateEventFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),

      markOOO: new stepfunctionsTasks.LambdaInvoke(this, 'MarkOOO', {
        lambdaFunction: lambdaFunctions.calendarMarkOOOFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),

      saveScheduleToEngrams: new stepfunctionsTasks.LambdaInvoke(this, 'SaveScheduleToEngrams', {
        lambdaFunction: lambdaFunctions.calendarSaveEngramsFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),
      
      saveOOOToEngrams: new stepfunctionsTasks.LambdaInvoke(this, 'SaveOOOToEngrams', {
        lambdaFunction: lambdaFunctions.calendarSaveEngramsFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),

      notifyScheduleSuccess: new stepfunctionsTasks.LambdaInvoke(this, 'NotifyScheduleSuccess', {
        lambdaFunction: lambdaFunctions.calendarNotifyFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),
      
      notifyScheduleCancel: new stepfunctionsTasks.LambdaInvoke(this, 'NotifyScheduleCancel', {
        lambdaFunction: lambdaFunctions.calendarNotifyFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),
      
      notifyOOOSuccess: new stepfunctionsTasks.LambdaInvoke(this, 'NotifyOOOSuccess', {
        lambdaFunction: lambdaFunctions.calendarNotifyFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),
      
      notifyOOOCancel: new stepfunctionsTasks.LambdaInvoke(this, 'NotifyOOOCancel', {
        lambdaFunction: lambdaFunctions.calendarNotifyFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),
      
      notifyCheck: new stepfunctionsTasks.LambdaInvoke(this, 'NotifyCheck', {
        lambdaFunction: lambdaFunctions.calendarNotifyFunction,
        outputPath: '$.Payload',
        retryOnServiceExceptions: true,
      }),
    };
  }

  private createStates() {
    return {
      success: new stepfunctions.Succeed(this, 'Success'),
      failed: new stepfunctions.Fail(this, 'Failed', {
        error: 'CalendarAgentError',
        cause: 'Failed to process calendar request',
      }),
    };
  }

  private buildDefinition(
    tasks: ReturnType<typeof this.createTasks>, 
    states: ReturnType<typeof this.createStates>
  ) {
    // Start by analyzing the intent
    const definition = tasks.analyzeIntent
      .next(
        new stepfunctions.Choice(this, 'CheckIntentType')
          .when(
            stepfunctions.Condition.stringEquals('$.intentType', 'schedule'),
            tasks.extractParticipants
              .next(tasks.checkAvailability)
              .next(tasks.askScheduleConfirmation)
              .next(tasks.waitForScheduleConfirmation)
              .next(tasks.processScheduleResponse)
              .next(
                new stepfunctions.Choice(this, 'CheckConfirmation')
                  .when(
                    stepfunctions.Condition.booleanEquals('$.confirmed', true),
                    tasks.createEvent
                      .next(tasks.saveScheduleToEngrams)
                      .next(tasks.notifyScheduleSuccess)
                      .next(states.success)
                  )
                  .otherwise(
                    tasks.notifyScheduleCancel.next(states.success)
                  )
              )
          )
          .when(
            stepfunctions.Condition.stringEquals('$.intentType', 'ooo'),
            tasks.askOOOConfirmation
              .next(tasks.waitForOOOConfirmation)
              .next(tasks.processOOOResponse)
              .next(
                new stepfunctions.Choice(this, 'CheckOOOConfirmation')
                  .when(
                    stepfunctions.Condition.booleanEquals('$.confirmed', true),
                    tasks.markOOO
                      .next(tasks.saveOOOToEngrams)
                      .next(tasks.notifyOOOSuccess)
                      .next(states.success)
                  )
                  .otherwise(
                    tasks.notifyOOOCancel.next(states.success)
                  )
              )
          )
          .when(
            stepfunctions.Condition.stringEquals('$.intentType', 'check'),
            tasks.notifyCheck
              .next(states.success)
          )
          .otherwise(states.failed)
      );

    return definition;
  }
}