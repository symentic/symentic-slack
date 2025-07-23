import { WebClient } from '@slack/web-api';
import { SlackSayFunction } from '../../types/slack';
import { IntentResult, ConversationContext, AgentResponse } from '../../types/domain';

// Configuration for each agent
export interface AgentConfig {
  name: string;
  description: string;
  intents: string[];
  priority: number;
  requiredServices: string[];
  modelPreference?: 'gpt-3.5-turbo' | 'gpt-4o-mini' | 'gpt-4o';
}

// Base class that all agents extend
export abstract class BaseAgent {
  protected client: WebClient;
  protected config: AgentConfig;

  constructor(client: WebClient, config: AgentConfig) {
    this.client = client;
    this.config = config;
  }

  // Check if this agent can handle the given intent
  canHandle(intent: IntentResult): boolean {
    return this.config.intents.some(
      supportedIntent => 
        intent.intent.startsWith(supportedIntent) && 
        intent.confidence >= 0.7
    );
  }

  // Get agent metadata
  getConfig(): AgentConfig {
    return this.config;
  }

  // Main handler - must be implemented by each agent
  abstract handle(
    context: ConversationContext,
    say: SlackSayFunction
  ): Promise<AgentResponse>;

  // Optional: Handle when another agent hands off to this one
  async handleHandoff(
    _fromAgent: string,
    context: ConversationContext,
    say: SlackSayFunction
  ): Promise<AgentResponse> {
    // Default implementation
    return this.handle(context, say);
  }

  // Optional: Validate if agent has required data to proceed
  async validateContext(_context: ConversationContext): Promise<{
    isValid: boolean;
    missingData?: string[];
  }> {
    return { isValid: true };
  }

  // Helper: Store agent interaction in memory
  protected async storeInteraction(
    context: ConversationContext,
    _response: AgentResponse
  ): Promise<void> {
    // This would be implemented to store in Redis/DynamoDB
    console.log(`[${this.config.name}] Storing interaction for user ${context.userId}`);
  }

  // Helper: Format response with agent signature
  protected formatResponse(text: string): string {
    return text; // Agents can override to add their own formatting
  }
}