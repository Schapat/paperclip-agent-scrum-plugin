import { describe, expect, it } from 'vitest';

import {
  BOUNDED_PROCESS_EXECUTION_MARKER,
  EVENT_ROUTING_MARKER,
  FEATURE_BRANCH_DELIVERY_MARKER,
  GITHUB_COMMIT_EVIDENCE_MARKER,
  HEARTBEAT_QUEUE_MARKER,
  MANAGED_AGENT_INSTRUCTIONS,
  LEGACY_REPORTING_LINE_MARKER,
  REPORTING_LINE_INSTRUCTIONS,
  REPORTING_LINE_MARKER,
  SPRINT_AUTONOMY_MARKER,
  heartbeatAwareInstructions,
  repairInstructionBundle,
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

  it('adds a bounded-process rule to existing developer instructions exactly once', () => {
    const upgraded = heartbeatAwareInstructions('developer-1', '# Existing developer guidance\n');

    expect(upgraded).toContain(BOUNDED_PROCESS_EXECUTION_MARKER);
    expect(upgraded).toContain('Verwende keine Hintergrund- oder Jobsteuerung wie `&`, `$!`, `%1`');
    expect(upgraded).toContain('`nohup`, `disown`, `setsid`, `screen` oder `tmux`');
    expect(upgraded).toContain('`npm run dev`, `next dev`, `vite` oder einen anderen Dauerprozess');
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
/**
 * Das Bundle darf nicht bei jedem Reconcile wachsen.
 *
 * Die ausgelieferten AGENTS.md tragen `scrum-team:reporting-line`, geprueft
 * wurde `agent-scrum:reporting-line`. Die Pruefung schlug damit immer fehl und
 * hat jedem Agenten bei jeder Reconciliation einen zweiten, konkurrierenden
 * Reporting-Line-Abschnitt angehaengt.
 */
describe('managed instruction bundles are stable across reconciliations', () => {
  const agentKeys = [
    'product-owner',
    'scrum-master',
    'technical-lead',
    'developer-1',
    'developer-2',
    'qa-engineer',
  ] as const;

  it('produces a byte-identical bundle on a second pass', () => {
    for (const agentKey of agentKeys) {
      const first = heartbeatAwareInstructions(agentKey, null);
      const second = heartbeatAwareInstructions(agentKey, first);
      expect(first, `${agentKey} is missing the bounded-process rule`).toContain(
        BOUNDED_PROCESS_EXECUTION_MARKER
      );
      expect(second, `${agentKey} bundle grew on the second reconcile`).toBe(first);
    }
  });

  it('never adds a second reporting-line section to a shipped bundle', () => {
    for (const agentKey of agentKeys) {
      const bundle = heartbeatAwareInstructions(agentKey, MANAGED_AGENT_INSTRUCTIONS[agentKey]);
      const reportingSections = bundle.match(/^##\s+Reporting[- ]line\s*$/gim) ?? [];
      expect(reportingSections, `${agentKey} has duplicate reporting-line sections`).toHaveLength(1);
    }
  });

  it('never restates the commit-evidence rule twice for a developer', () => {
    for (const agentKey of ['developer-1', 'developer-2'] as const) {
      const bundle = heartbeatAwareInstructions(agentKey, MANAGED_AGENT_INSTRUCTIONS[agentKey]);
      const markerBlocks = bundle.match(/agent-scrum:commit:v1/g) ?? [];
      expect(markerBlocks, `${agentKey} repeats the commit marker rule`).toHaveLength(1);
    }
  });
});

/**
 * Bereits beschaedigte Bundles muessen heilen, nicht nur aufhoeren zu wachsen.
 *
 * Die fehlerhafte Marker-Pruefung lief ueber mehrere Reconciliations. Ein Fix,
 * der nur weitere Duplikate verhindert, laesst die Agenten mit den bereits
 * angehaengten, widersprechenden Abschnitten weiterarbeiten.
 */
describe('repairs bundles damaged by the earlier marker mismatch', () => {
  function damage(agentKey: 'technical-lead' | 'developer-1'): string {
    // Genau das, was die fehlerhafte Pruefung erzeugt hat: das ausgelieferte
    // Bundle plus ein zweiter, angehaengter Reporting-Line-Abschnitt.
    return `${MANAGED_AGENT_INSTRUCTIONS[agentKey].trimEnd()}\n\n${REPORTING_LINE_INSTRUCTIONS[agentKey]}\n`;
  }

  it('drops the appended reporting line and keeps the shipped one', () => {
    const repaired = repairInstructionBundle('technical-lead', damage('technical-lead'));

    expect(repaired.match(/^##\s+Reporting[- ]line\s*$/gim) ?? []).toHaveLength(1);
    expect(repaired).toContain(LEGACY_REPORTING_LINE_MARKER);
    expect(repaired).not.toContain(REPORTING_LINE_MARKER);
  });

  it('leaves an undamaged bundle byte-identical', () => {
    const shipped = MANAGED_AGENT_INSTRUCTIONS['technical-lead'];
    expect(repairInstructionBundle('technical-lead', shipped)).toBe(shipped);
  });

  it('heals a damaged bundle through the normal reconcile path', () => {
    const healed = heartbeatAwareInstructions('developer-1', damage('developer-1'));

    expect(healed.match(/^##\s+Reporting[- ]line\s*$/gim) ?? []).toHaveLength(1);
    expect(healed.match(/agent-scrum:commit:v1/g) ?? []).toHaveLength(1);
    // Und der zweite Durchlauf aendert nichts mehr.
    expect(heartbeatAwareInstructions('developer-1', healed)).toBe(healed);
  });
});
