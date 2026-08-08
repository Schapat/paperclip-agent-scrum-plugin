import { describe, expect, it } from 'vitest';

import { agentPresentation } from '../agent-presentation';

describe('agent presentation', () => {
  it('resolves a ticket assignee ID to the agent name and role', () => {
    expect(
      agentPresentation('agent-developer', [
        { id: 'agent-developer', name: 'Developer 1', role: 'developer' },
      ])
    ).toEqual({ id: 'agent-developer', name: 'Developer 1', role: 'developer' });
  });

  it('returns a neutral fallback for an unknown agent ID', () => {
    expect(agentPresentation('missing-agent', [])).toEqual({
      id: 'missing-agent',
      name: 'Unknown agent',
      role: 'unknown',
    });
  });
});