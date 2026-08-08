import type { ScrumAgent } from '../../core/types';

export interface AgentPresentation {
  id: string;
  name: string;
  role: string;
}

export function agentPresentation(
  agentId: string | null,
  agents: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>
): AgentPresentation | null {
  if (!agentId) return null;

  return agents.find((agent) => agent.id === agentId) ?? {
    id: agentId,
    name: 'Unknown agent',
    role: 'unknown',
  };
}

export function agentIcon(role: string | undefined): string {
  switch (role) {
    case 'product_owner':
      return '📋';
    case 'scrum_master':
      return '🛡️';
    case 'technical_lead':
      return '⚙️';
    case 'developer':
      return '💻';
    case 'qa_engineer':
      return '🔍';
    default:
      return '🤖';
  }
}