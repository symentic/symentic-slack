// Types for Step Functions

import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';

export interface BugTriageTasks {
  analyzeBugReport: stepfunctionsTasks.LambdaInvoke;
  generateFollowUpQuestions: stepfunctionsTasks.LambdaInvoke;
  sendQuestionsToSlack: stepfunctionsTasks.LambdaInvoke;
  waitForUserResponse: stepfunctionsTasks.SqsSendMessage;
  processUserResponse: stepfunctionsTasks.LambdaInvoke;
  updateBugReport: stepfunctionsTasks.LambdaInvoke;
  findRelevantEngineers: stepfunctionsTasks.LambdaInvoke;
  enhanceBugReport: stepfunctionsTasks.LambdaInvoke;
  createTriageChannel: stepfunctionsTasks.LambdaInvoke;
  checkCalendarAvailability: stepfunctionsTasks.LambdaInvoke;
  scheduleMeeting: stepfunctionsTasks.LambdaInvoke;
  saveBugReport: stepfunctionsTasks.LambdaInvoke;
  sendFinalNotification: stepfunctionsTasks.LambdaInvoke;
  handleTimeout: stepfunctionsTasks.LambdaInvoke;
  maxAttemptsReached: stepfunctionsTasks.LambdaInvoke;
  cancelBugReport: stepfunctionsTasks.LambdaInvoke;
}

export interface BugTriageStates {
  incrementAttempt: stepfunctions.Pass;
  bugTriageComplete: stepfunctions.Succeed;
  bugReportCancelled: stepfunctions.Succeed;
  bugReportTimedOut: stepfunctions.Fail;
  bugReportFailed: stepfunctions.Fail;
  checkReportQuality: stepfunctions.Choice;
  checkIfCancelled: stepfunctions.Choice;
  checkMaxAttempts: stepfunctions.Choice;
  checkIfHighSeverity: stepfunctions.Choice;
  checkUpdatedCompleteness: stepfunctions.Choice;
}