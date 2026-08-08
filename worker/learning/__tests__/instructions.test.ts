/**
 * Tests für die Einbettung gelernter Skills in die Agenten-Instruktionen
 *
 * Kernanspruch: Der eingefügte Abschnitt muss idempotent sein. Würde er bei
 * jeder Retrospektive angehängt statt ersetzt, wüchse die Instruktionsdatei
 * unbegrenzt.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentSkill, ScrumAgent, WorkerState } from '@shared/types';
import { createDefaultSettings } from '@shared/types';
import {
  SKILL_BLOCK_END,
  SKILL_BLOCK_START,
  applySkillBlock,
  buildInstructionsForRole,
  collectInstructionUpdates,
  renderSkillBlock,
  stripSkillBlock,
} from '../instructions';

// =============================================================================
// Fixtures
// =============================================================================

function skill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: overrides.id ?? 'skill-1',
    name: 'Fehlerfälle testen',
    description: 'Vor der Übergabe ins Review sicherstellen: Fehlerbehandlung getestet',
    category: 'quality',
    roles: ['developer'],
    active: true,
    learningIds: ['l-1'],
    reinforcementCount: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    activatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function agent(id: string, role: string): ScrumAgent {
  return { id, name: id, role, status: 'idle', currentTaskId: null, capabilities: [] };
}

function createState(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    initialized: true,
    currentSprint: null,
    tasks: [],
    agents: [agent('dev-1', 'developer'), agent('dev-2', 'developer'), agent('qa-1', 'qa_engineer')],
    settings: createDefaultSettings(),
    metrics: {
      totalPoints: 0,
      completedPoints: 0,
      remainingPoints: 0,
      averageCycleTime: 0,
      velocity: 0,
      burndownData: [],
      changelog: [],
    },
    messages: [],
    ceremonies: [],
    completedSprints: [],
    learnings: [],
    skills: [],
    proposedStories: [],
    agentInstructions: { developer: '# Developer\n\nDu implementierst Tickets.' },
    ...overrides,
  };
}

const BASE = '# Developer\n\nDu implementierst Tickets.';

// =============================================================================
// Rendering
// =============================================================================

describe('renderSkillBlock', () => {
  it('rendert aktive Skills mit Markern', () => {
    const block = renderSkillBlock([skill()]);

    expect(block).toContain(SKILL_BLOCK_START);
    expect(block).toContain(SKILL_BLOCK_END);
    expect(block).toContain('Fehlerfälle testen');
    expect(block).toContain('Fehlerbehandlung getestet');
  });

  it('ignoriert inaktive Skills', () => {
    expect(renderSkillBlock([skill({ active: false })])).toBe('');
  });

  it('liefert nichts bei leerer Liste', () => {
    expect(renderSkillBlock([])).toBe('');
  });

  it('gruppiert nach Kategorie, Qualität zuerst', () => {
    const block = renderSkillBlock([
      skill({ id: 'a', category: 'process', name: 'Prozess-Skill' }),
      skill({ id: 'b', category: 'quality', name: 'Qualitäts-Skill' }),
    ]);

    // Qualität sind die Fehler, die tatsächlich passiert sind — die stehen oben
    expect(block.indexOf('Qualität')).toBeLessThan(block.indexOf('Prozess'));
  });

  it('macht die Bestätigungshäufigkeit sichtbar', () => {
    const block = renderSkillBlock([skill({ reinforcementCount: 3 })]);
    expect(block).toContain('3× bestätigt');
  });

  it('verschweigt die Häufigkeit bei einmaliger Evidenz', () => {
    expect(renderSkillBlock([skill({ reinforcementCount: 1 })])).not.toContain('bestätigt');
  });

  it('sortiert oft bestätigte Skills nach oben', () => {
    const block = renderSkillBlock([
      skill({ id: 'a', name: 'Selten', reinforcementCount: 1 }),
      skill({ id: 'b', name: 'Oft', reinforcementCount: 5 }),
    ]);

    expect(block.indexOf('Oft')).toBeLessThan(block.indexOf('Selten'));
  });
});

// =============================================================================
// Idempotenz
// =============================================================================

describe('applySkillBlock', () => {
  it('hängt den Abschnitt an die Basis an', () => {
    const result = applySkillBlock(BASE, [skill()]);

    expect(result).toContain('Du implementierst Tickets.');
    expect(result).toContain('Gelernte Arbeitsweisen');
  });

  it('ist idempotent — mehrfaches Anwenden ändert nichts', () => {
    const once = applySkillBlock(BASE, [skill()]);
    const twice = applySkillBlock(once, [skill()]);
    const thrice = applySkillBlock(twice, [skill()]);

    expect(twice).toBe(once);
    expect(thrice).toBe(once);
    // Genau ein Abschnitt, nicht drei
    expect(thrice.match(new RegExp(SKILL_BLOCK_START, 'g'))).toHaveLength(1);
  });

  it('ersetzt den Abschnitt bei geändertem Skill-Satz', () => {
    const first = applySkillBlock(BASE, [skill({ name: 'Alt' })]);
    const second = applySkillBlock(first, [skill({ id: 'x', name: 'Neu' })]);

    expect(second).toContain('Neu');
    expect(second).not.toContain('Alt');
  });

  it('entfernt den Abschnitt, wenn kein Skill mehr aktiv ist', () => {
    const withBlock = applySkillBlock(BASE, [skill()]);
    const without = applySkillBlock(withBlock, []);

    expect(without).not.toContain(SKILL_BLOCK_START);
    expect(without).toContain('Du implementierst Tickets.');
  });

  it('lässt die Basis unversehrt', () => {
    const result = applySkillBlock(BASE, [skill()]);
    expect(stripSkillBlock(result).trim()).toBe(BASE.trim());
  });
});

describe('stripSkillBlock', () => {
  it('lässt Text ohne Marker unverändert', () => {
    expect(stripSkillBlock(BASE)).toBe(BASE);
  });

  it('lässt Text mit unvollständigen Markern unverändert', () => {
    // Lieber ein doppelter Abschnitt als abgeschnittene Basis-Instruktionen
    const broken = `${BASE}\n${SKILL_BLOCK_START}\nabgeschnitten`;
    expect(stripSkillBlock(broken)).toBe(broken);
  });
});

// =============================================================================
// Zusammenbau je Rolle
// =============================================================================

describe('buildInstructionsForRole', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('kombiniert Basis mit den aktiven Skills der Rolle', () => {
    state.skills.push(skill());
    const result = buildInstructionsForRole(state, 'developer')!;

    expect(result).toContain('Du implementierst Tickets.');
    expect(result).toContain('Fehlerfälle testen');
  });

  it('übernimmt keine Skills fremder Rollen', () => {
    state.skills.push(skill({ roles: ['qa_engineer'], name: 'QA-Skill' }));
    expect(buildInstructionsForRole(state, 'developer')).not.toContain('QA-Skill');
  });

  it('liefert null ohne bekannte Basis-Instruktionen', () => {
    // Sonst würde das Update die Rollenbeschreibung des Agents überschreiben
    expect(buildInstructionsForRole(state, 'qa_engineer')).toBeNull();
  });
});

describe('collectInstructionUpdates', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
    state.skills.push(skill());
  });

  it('erzeugt ein Update je Agent der Rolle', () => {
    const updates = collectInstructionUpdates(state, ['developer']);

    expect(updates.map((u) => u.agentId).sort()).toEqual(['dev-1', 'dev-2']);
    expect(updates[0].instructions).toContain('Fehlerfälle testen');
    expect(updates[0].skillIds).toEqual(['skill-1']);
  });

  it('überspringt Rollen ohne Basis-Instruktionen', () => {
    expect(collectInstructionUpdates(state, ['qa_engineer'])).toEqual([]);
  });

  it('überspringt Agents, deren Text sich nicht ändert', () => {
    const [first] = collectInstructionUpdates(state, ['developer']);
    const current = { 'dev-1': first.instructions };

    const updates = collectInstructionUpdates(state, ['developer'], current);
    expect(updates.map((u) => u.agentId)).toEqual(['dev-2']);
  });

  it('behandelt eine Rolle auch bei Mehrfachnennung nur einmal', () => {
    expect(collectInstructionUpdates(state, ['developer', 'developer'])).toHaveLength(2);
  });
});
