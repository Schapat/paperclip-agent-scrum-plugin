import { describe, expect, it } from 'vitest';

import {
  EVENT_ROUTING_MARKER,
  FEATURE_BRANCH_DELIVERY_MARKER,
  GITHUB_COMMIT_EVIDENCE_MARKER,
  HEARTBEAT_QUEUE_MARKER,
  MANAGED_AGENT_INSTRUCTIONS,
  heartbeatAwareInstructions,
} from '../agent-instructions';

describe('managed agent instruction upgrades', () => {
  it('materializes the complete managed instructions when an agent has no bundle yet', () => {
    expect(heartbeatAwareInstructions('qa-engineer', null)).toBe(
      MANAGED_AGENT_INSTRUCTIONS['qa-engineer']
    );
  });

  it('preserves custom instructions while appending the missing event-routing rule once', () => {
    const upgraded = heartbeatAwareInstructions('developer-1', '# Custom developer guidance\n');

    expect(upgraded).toContain('# Custom developer guidance');
    expect(upgraded).toContain(EVENT_ROUTING_MARKER);
    expect(upgraded).toContain(GITHUB_COMMIT_EVIDENCE_MARKER);
    expect(heartbeatAwareInstructions('developer-1', upgraded)).toBe(upgraded);
  });

  it('overrides a legacy queue scan with event routing and adds the QA rework handoff', () => {
    const existing = `# Custom QA guidance\n\n${HEARTBEAT_QUEUE_MARKER}\n`;
    const upgraded = heartbeatAwareInstructions('qa-engineer', existing);

    expect(upgraded).toContain(EVENT_ROUTING_MARKER);
    expect(upgraded).toContain('Diese Regel hat Vorrang vor frueheren Timer- oder Queue-Scan-Anweisungen.');
    expect(upgraded).toContain('## QA Rework Handoff');
    expect(heartbeatAwareInstructions('qa-engineer', upgraded)).toBe(upgraded);
  });

  it('upgrades every existing role with the mandatory human scope guard', () => {
    const upgraded = heartbeatAwareInstructions(
      'scrum-master',
      `# Custom Scrum Master guidance\n\n${HEARTBEAT_QUEUE_MARKER}\n`
    );

    expect(upgraded).toContain('## Human Scope Guard');
    expect(heartbeatAwareInstructions('scrum-master', upgraded)).toBe(upgraded);
  });

  it('uses one feature branch and one feature pull request instead of ticket pull requests', () => {
    const developerInstructions = MANAGED_AGENT_INSTRUCTIONS['developer-1'];
    const upgraded = heartbeatAwareInstructions('developer-1', '# Existing developer guidance\n');

    expect(developerInstructions).toContain('Erstelle keinen Pull Request pro Ticket.');
    expect(developerInstructions).toContain('Feature-Branch des zugehoerigen Features');
    expect(developerInstructions).toContain('Einen Pull Request nur einmal fuer das gesamte Feature erstellen');
    expect(upgraded).toContain(FEATURE_BRANCH_DELIVERY_MARKER);
    expect(upgraded).toContain('Erstelle keinen Pull Request pro Ticket.');
  });
});