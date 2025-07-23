import * as cdk from 'aws-cdk-lib';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { LambdaFunctions } from '../types';

export interface BugTriageStateMachineProps {
  lambdaFunctions: LambdaFunctions;
  bugResponseQueue: sqs.Queue;
  stage: string;
}

export class BugTriageStateMachine extends Construct {
  public readonly stateMachine: stepfunctions.StateMachine;

  constructor(scope: Construct, id: string, props: BugTriageStateMachineProps) {
    super(scope, id);

    const { lambdaFunctions, bugResponseQueue, stage } = props;

    // Create all the tasks
    const tasks = this.createTasks(lambdaFunctions, bugResponseQueue);
    
    // Create all the states
    const states = this.createStates();
    
    // Build the state machine definition
    const definition = this.buildDefinition(tasks, states);
    
    // Create the state machine
    this.stateMachine = new stepfunctions.StateMachine(this, 'StateMachine', {
      stateMachineName: `BugTriageStateMachine-${stage}`,
      definition,
      timeout: cdk.Duration.hours(50),
      tracingEnabled: true,
      logs: {
        destination: new cdk.aws_logs.LogGroup(this, 'LogGroup', {
          logGroupName: `/aws/stepfunctions/BugTriageStateMachine-${stage}`,
          retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: stepfunctions.LogLevel.ALL,
      },
    });
  }

  private createTasks(lambdaFunctions: LambdaFunctions, bugResponseQueue: sqs.Queue) {
    return {
      analyzeBugReport: new stepfunctionsTasks.LambdaInvoke(this, 'AnalyzeBugReport', {
        lambdaFunction: lambdaFunctions.bugAnalyze,
        outputPath: '$.Payload',
        resultPath: '$.analysis',
      }),

      generateFollowUpQuestions: new stepfunctionsTasks.LambdaInvoke(this, 'GenerateFollowUpQuestions', {
        lambdaFunction: lambdaFunctions.bugQuestions,
        outputPath: '$.Payload',
        resultPath: '$.questions',
      }),

      sendQuestionsToSlack: new stepfunctionsTasks.LambdaInvoke(this, 'SendQuestionsToSlack', {
        lambdaFunction: lambdaFunctions.slackNotify,
        payload: stepfunctions.TaskInput.fromObject({
          action: 'sendBugQuestions',
          questions: stepfunctions.JsonPath.objectAt('$.questions'),
          context: stepfunctions.JsonPath.objectAt('$.context'),
          threadTs: stepfunctions.JsonPath.objectAt('$.threadTs'),
        }),
        outputPath: '$.Payload',
      }),

      waitForUserResponse: new stepfunctionsTasks.SqsSendMessage(this, 'WaitForUserResponse', {
        queue: bugResponseQueue,
        messageBody: stepfunctions.TaskInput.fromObject({
          taskToken: stepfunctions.JsonPath.taskToken,
          executionArn: stepfunctions.JsonPath.executionId,
          bugId: stepfunctions.JsonPath.objectAt('$.bugId'),
          userId: stepfunctions.JsonPath.objectAt('$.context.userId'),
          threadTs: stepfunctions.JsonPath.objectAt('$.threadTs'),
          channelId: stepfunctions.JsonPath.objectAt('$.context.channelId'),
          attemptCount: stepfunctions.JsonPath.objectAt('$.attemptCount'),
        }),
        integrationPattern: stepfunctions.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        timeout: cdk.Duration.hours(48),
      }),

      processUserResponse: new stepfunctionsTasks.LambdaInvoke(this, 'ProcessUserResponse', {
        lambdaFunction: lambdaFunctions.bugProcessResponse,
        outputPath: '$.Payload',
        resultPath: '$.processedResponse',
      }),

      updateBugReport: new stepfunctionsTasks.LambdaInvoke(this, 'UpdateBugReport', {
        lambdaFunction: lambdaFunctions.bugUpdate,
        outputPath: '$.Payload',
        resultPath: '$.bugReport',
      }),

      findRelevantEngineers: new stepfunctionsTasks.LambdaInvoke(this, 'FindRelevantEngineers', {
        lambdaFunction: lambdaFunctions.bugFindEngineers,
        outputPath: '$.Payload',
        resultPath: '$.engineers',
      }),

      createTriageChannel: new stepfunctionsTasks.LambdaInvoke(this, 'CreateTriageChannel', {
        lambdaFunction: lambdaFunctions.bugCreateChannel,
        outputPath: '$.Payload',
        resultPath: '$.channel',
      }),

      checkCalendarAvailability: new stepfunctionsTasks.LambdaInvoke(this, 'CheckCalendarAvailability', {
        lambdaFunction: lambdaFunctions.calendarCheckAvailability,
        outputPath: '$.Payload',
        resultPath: '$.availability',
      }),

      scheduleMeeting: new stepfunctionsTasks.LambdaInvoke(this, 'ScheduleMeeting', {
        lambdaFunction: lambdaFunctions.calendarScheduleMeeting,
        outputPath: '$.Payload',
        resultPath: '$.meeting',
      }),

      saveBugReport: new stepfunctionsTasks.LambdaInvoke(this, 'SaveBugReport', {
        lambdaFunction: lambdaFunctions.bugSave,
        outputPath: '$.Payload',
        resultPath: '$.savedBug',
      }),

      sendFinalNotification: new stepfunctionsTasks.LambdaInvoke(this, 'SendFinalNotification', {
        lambdaFunction: lambdaFunctions.slackNotify,
        payload: stepfunctions.TaskInput.fromObject({
          action: 'bugReportComplete',
          bugReport: stepfunctions.JsonPath.objectAt('$.savedBug'),
          context: stepfunctions.JsonPath.objectAt('$.context'),
          threadTs: stepfunctions.JsonPath.objectAt('$.threadTs'),
        }),
        outputPath: '$.Payload',
      }),

      handleTimeout: new stepfunctionsTasks.LambdaInvoke(this, 'HandleTimeout', {
        lambdaFunction: lambdaFunctions.slackNotify,
        payload: stepfunctions.TaskInput.fromObject({
          action: 'timeoutNotification',
          context: stepfunctions.JsonPath.objectAt('$.context'),
          threadTs: stepfunctions.JsonPath.objectAt('$.threadTs'),
        }),
        outputPath: '$.Payload',
      }),

      maxAttemptsReached: new stepfunctionsTasks.LambdaInvoke(this, 'MaxAttemptsReached', {
        lambdaFunction: lambdaFunctions.slackNotify,
        payload: stepfunctions.TaskInput.fromObject({
          action: 'maxAttemptsReached',
          context: stepfunctions.JsonPath.objectAt('$.context'),
          threadTs: stepfunctions.JsonPath.objectAt('$.threadTs'),
          bugReport: stepfunctions.JsonPath.objectAt('$.bugReport'),
        }),
        outputPath: '$.Payload',
      }),

      cancelBugReport: new stepfunctionsTasks.LambdaInvoke(this, 'CancelBugReport', {
        lambdaFunction: lambdaFunctions.slackNotify,
        payload: stepfunctions.TaskInput.fromObject({
          action: 'cancelBugReport',
          context: stepfunctions.JsonPath.objectAt('$.context'),
          threadTs: stepfunctions.JsonPath.objectAt('$.threadTs'),
        }),
        outputPath: '$.Payload',
      }),
    };
  }

  private createStates() {
    return {
      incrementAttempt: new stepfunctions.Pass(this, 'IncrementAttempt', {
        parameters: {
          'attemptCount.$': 'States.MathAdd($.attemptCount, 1)',
          'bugReport.$': '$.bugReport',
          'context.$': '$.context',
          'threadTs.$': '$.threadTs',
          'bugId.$': '$.bugId',
          'analysis.$': '$.analysis',
        },
      }),

      bugTriageComplete: new stepfunctions.Succeed(this, 'BugTriageComplete'),
      bugReportCancelled: new stepfunctions.Succeed(this, 'BugReportCancelled'),
      
      bugReportTimedOut: new stepfunctions.Fail(this, 'BugReportTimedOut', {
        error: 'BugReportTimeout',
        cause: 'User did not respond within timeout period',
      }),
      
      bugReportFailed: new stepfunctions.Fail(this, 'BugReportFailed', {
        error: 'BugReportFailed',
        cause: 'Maximum attempts reached without sufficient information',
      }),

      checkReportQuality: new stepfunctions.Choice(this, 'CheckReportQuality'),
      checkIfCancelled: new stepfunctions.Choice(this, 'CheckIfCancelled'),
      checkMaxAttempts: new stepfunctions.Choice(this, 'CheckMaxAttempts'),
      checkIfHighSeverity: new stepfunctions.Choice(this, 'CheckIfHighSeverity'),
    };
  }

  private buildDefinition(tasks: any, states: any): stepfunctions.IChainable {
    // Define the flow
    
    // Quality check
    states.checkReportQuality
      .when(
        stepfunctions.Condition.numberGreaterThanEquals('$.analysis.completenessScore', 80),
        tasks.findRelevantEngineers
      )
      .otherwise(tasks.generateFollowUpQuestions);

    // Cancel check
    states.checkIfCancelled
      .when(
        stepfunctions.Condition.stringEquals('$.processedResponse.action', 'cancel'),
        tasks.cancelBugReport
      )
      .otherwise(tasks.updateBugReport);

    // Max attempts check
    states.checkMaxAttempts
      .when(
        stepfunctions.Condition.numberGreaterThanEquals('$.attemptCount', 3),
        tasks.maxAttemptsReached
      )
      .otherwise(tasks.analyzeBugReport);

    // High severity check
    states.checkIfHighSeverity
      .when(
        stepfunctions.Condition.stringEquals('$.bugReport.severity', 'high'),
        tasks.createTriageChannel
      )
      .otherwise(tasks.saveBugReport);

    // Chain the tasks
    tasks.analyzeBugReport.next(states.checkReportQuality);
    
    tasks.generateFollowUpQuestions
      .next(tasks.sendQuestionsToSlack)
      .next(tasks.waitForUserResponse)
      .next(tasks.processUserResponse)
      .next(states.checkIfCancelled);

    tasks.cancelBugReport.next(states.bugReportCancelled);

    tasks.updateBugReport
      .next(states.incrementAttempt)
      .next(states.checkMaxAttempts);

    tasks.maxAttemptsReached.next(states.bugReportFailed);

    tasks.findRelevantEngineers.next(states.checkIfHighSeverity);

    tasks.createTriageChannel
      .next(tasks.checkCalendarAvailability)
      .next(tasks.scheduleMeeting)
      .next(tasks.saveBugReport);

    tasks.saveBugReport
      .next(tasks.sendFinalNotification)
      .next(states.bugTriageComplete);

    // Error handling
    tasks.waitForUserResponse.addCatch(tasks.handleTimeout, {
      errors: ['States.TaskFailed', 'States.Timeout'],
    });
    tasks.handleTimeout.next(states.bugReportTimedOut);

    return tasks.analyzeBugReport;
  }
}