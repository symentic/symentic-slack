import { WebClient } from '@slack/web-api';
import { BaseAgent } from '../agents/base/BaseAgent';
import { CalendarAgent } from '../agents/calendarAgent';
import { BugTriageAgent } from '../agents/bugTriageAgent';
import { SlackSayFunction } from '../types/slack';
import { IntentResult, ConversationContext, AgentResponse } from '../types/domain';

export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();
  private client: WebClient;

  constructor(client: WebClient) {
    this.client = client;
    this.initializeAgents();
  }

  // Initialize all available agents
  private initializeAgents(): void {
    // Register core agents
    this.registerAgent(new CalendarAgent(this.client));
    this.registerAgent(new BugTriageAgent(this.client));
    
    // Future agents can be added here:
    // this.registerAgent(new TaskAgent(this.client));
    // this.registerAgent(new ReminderAgent(this.client));
    // this.registerAgent(new NotionAgent(this.client));
    
    console.log(`Initialized ${this.agents.size} agents`);
  }

  // Register a new agent
  registerAgent(agent: BaseAgent): void {
    const config = agent.getConfig();
    this.agents.set(config.name, agent);
    console.log(`Registered agent: ${config.name} handling intents: ${config.intents.join(', ')}`);
  }

  // Unregister an agent
  unregisterAgent(agentName: string): boolean {
    return this.agents.delete(agentName);
  }

  // Find the best agent for a given intent
  findAgent(intent: IntentResult): BaseAgent | null {
    let bestAgent: BaseAgent | null = null;
    let highestPriority = -1;

    for (const agent of this.agents.values()) {
      if (agent.canHandle(intent)) {
        const config = agent.getConfig();
        if (config.priority > highestPriority) {
          bestAgent = agent;
          highestPriority = config.priority;
        }
      }
    }

    return bestAgent;
  }

  // Get all agents that can handle an intent (for complex scenarios)
  findAllAgents(intent: IntentResult): BaseAgent[] {
    const matchingAgents: BaseAgent[] = [];
    
    for (const agent of this.agents.values()) {
      if (agent.canHandle(intent)) {
        matchingAgents.push(agent);
      }
    }

    // Sort by priority
    return matchingAgents.sort((a, b) => 
      b.getConfig().priority - a.getConfig().priority
    );
  }

  // Route a message to the appropriate agent
  async routeToAgent(
    context: ConversationContext,
    say: SlackSayFunction
  ): Promise<AgentResponse | null> {
    const agent = this.findAgent(context.intent);
    
    if (!agent) {
      console.log(`No agent found for intent: ${context.intent.intent}`);
      return null;
    }

    console.log(`Routing to agent: ${agent.getConfig().name} for intent: ${context.intent.intent}`);
    
    try {
      const response = await agent.handle(context, say);
      
      // Handle agent handoff if requested
      if (response.handoffTo) {
        const nextAgent = this.agents.get(response.handoffTo);
        if (nextAgent) {
          context.previousAgents = [...(context.previousAgents || []), agent.getConfig().name];
          return await nextAgent.handleHandoff(
            agent.getConfig().name,
            context,
            say
          );
        }
      }
      
      return response;
    } catch (error) {
      console.error(`Agent ${agent.getConfig().name} error:`, error);
      throw error;
    }
  }

  // Get list of all registered agents
  getRegisteredAgents(): Array<{
    name: string;
    description: string;
    intents: string[];
  }> {
    return Array.from(this.agents.values()).map(agent => {
      const config = agent.getConfig();
      return {
        name: config.name,
        description: config.description,
        intents: config.intents
      };
    });
  }

  // Check health of all agents
  async healthCheck(): Promise<Map<string, boolean>> {
    const health = new Map<string, boolean>();
    
    for (const [name, _agent] of this.agents.entries()) {
      try {
        // You could implement a health check method in BaseAgent
        // For now, just check if agent exists
        health.set(name, true);
      } catch (error) {
        health.set(name, false);
      }
    }
    
    return health;
  }
}

// Factory function to create registry
export function createAgentRegistry(client: WebClient): AgentRegistry {
  return new AgentRegistry(client);
}