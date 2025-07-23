# Step Functions

This directory contains AWS Step Functions state machine definitions as separate constructs.

## Structure

Each state machine should be its own file/class that extends `Construct` and exports a `stateMachine` property.

## Current State Machines

### Bug Triage State Machine (`bug-triage-state-machine.ts`)
Handles the complete bug reporting workflow:
- Analyzes bug report quality
- Asks follow-up questions if needed
- Waits for user responses (48-hour timeout)
- Finds relevant engineers
- Creates Slack channels for high-severity bugs
- Schedules meetings
- Saves bug reports

## Adding New State Machines

1. Create a new file in this directory (e.g., `feature-request-state-machine.ts`)
2. Extend `Construct` and create your state machine
3. Export the state machine as a property
4. Import and use it in the `StepFunctionsStack`

Example structure:
```typescript
export class FeatureRequestStateMachine extends Construct {
  public readonly stateMachine: stepfunctions.StateMachine;
  
  constructor(scope: Construct, id: string, props: FeatureRequestStateMachineProps) {
    super(scope, id);
    // Build your state machine here
  }
}
```