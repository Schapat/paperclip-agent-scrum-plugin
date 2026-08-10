import { describe, expect, it } from 'vitest';

import {
  EVENT_ROUTING_MARKER,
  FEATURE_BRANCH_DELIVERY_MARKER,
  GITHUB_COMMIT_EVIDENCE_MARKER,
  HEARTBEAT_QUEUE_MARKER,
  MANAGED_AGENT_INSTRUCTIONS,
  REPORTING_LINE_MARKER,
  SPRINT_AUTONOMY_MARKER,
  heartbeatAwareInstructions,
} from '../agent-instructions';

describe('managed agent instruction upgrades', () => {
  it('materializes managed instructions with all required upgrade rules when an agent has no bundle yet', () => {
    const materialized = heartbeatAwareInstructions('qa-engineer', null);

    expect(materialized).toContain(MANAGED_AGENT_INSTRUCTIONS['qa-engineer']);
    expect(materialized).toContain(SPRINT_AUTONOMY_MARKER);
  });

  it('preserves custom instructions while appending the missing event-routing rule once', () => {
    const upgraded = heartbeatAwareInstructions('developer-1', '# Custom developer guidance\n');

    expect(upgraded).toContain('# Custom developer guidance');
    expect(upgraded).toContain(EVENT_ROUTING_MARKER);
    expect(upgraded).toContain(GITHUB_COMMIT_EVIDENCE_MARKER);
    expect(heartbeatAwareInstructions('developer-1', upgraded)).toBe(upgraded);
  });

  it('adds the intended reporting line without making the Product Owner or Scrum Master a manager', () => {
    const productOwner = heartbeatAwareInstructions('product-owner', '# Custom Product Owner guidance\n');
    const scrumMaster = heartbeatAwareInstructions('scrum-master', '# Custom Scrum Master guidance\n');
    const technicalLead = heartbeatAwareInstructions('technical-lead', '# Custom Technical Lead guidance\n');
    const developer = heartbeatAwareInstructions('developer-1', '# Custom developer guidance\n');

    expect(productOwner).toContain(REPORTING_LINE_MARKER);
    expect(productOwner).toContain('keine technische oder disziplinarische Vorgesetztenrolle');
    expect(scrumMaster).toContain('keine Vorgesetztenrolle');
    expect(technicalLead).toContain('Developer 1 und Developer 2 berichten');
    expect(developer).toContain('an den Technical Lead');
    expect(heartbeatAwareInstructions('technical-lead', technicalLead)).toBe(technicalLead);
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

  it('forbids host confirmations for direct issues in a human-approved active sprint', () => {
    const upgraded = heartbeatAwareInstructions('developer-1', '# Existing developer guidance\n');

    expect(upgraded).toContain('## Approved Sprint Autonomy');
    expect(upgraded).toContain('Keine Paperclip-Confirmation');
    expect(heartbeatAwareInstructions('developer-1', upgraded)).toBe(upgraded);
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