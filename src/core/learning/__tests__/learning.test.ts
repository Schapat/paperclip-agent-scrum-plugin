/**
 * Tests für Learnings, Skills und Story-Vorschläge
 *
 * Kernanspruch: Ein Learning muss aus dem Board belegbar sein und darf sich
 * nicht bei jedem Sprint duplizieren.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ScrumAgent, ScrumTask, WorkerState } from '../../types';
import { createDefaultSettings } from '../../types';
import { createAcceptanceCriterion, createRisk, createScrumTask } from '../../factories';
import {
  PATTERN_THRESHOLD,
  activeSkillsForRole,
  collectCandidates,
  createSkill,
  detectFlowBottlenecks,
  detectMaterializedRisks,
  detectReviewRejections,
  detectTechnicalNotes,
  findMatchingSkill,
  reinforceSkill,
  toLearning,
} from '../extract';
import {
  collectProposals,
  proposeFollowUps,
  proposeFromRejections,
  proposeFromRisks,
  proposeFromUnmetCriteria,
} from '../story-proposals';

// =============================================================================
// Fixtures
// =============================================================================

function agent(id: string, role: string): ScrumAgent {
  return { id, name: id, role, status: 'idle', currentTaskId: null, capabilities: [] };
}

function createState(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    initialized: true,
    currentSprint: null,
    tasks: [],
    agents: [agent('dev-1', 'developer'), agent('tl-1', 'technical_lead')],
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
    agentInstructions: {},
    ...overrides,
  };
}

/** Ticket, das im Review mit einem bestimmten Grund abgelehnt wurde. */
function rejectedTask(title: string, reason: string): ScrumTask {
  const task = createScrumTask({ title, description: '', column: 'done' });
  task.statusHistory = [
    { from: 'in_progress', to: 'in_review', timestamp: '2026-08-01T00:00:00.000Z', triggeredBy: null },
    { from: 'in_review', to: 'in_progress', timestamp: '2026-08-02T00:00:00.000Z', triggeredBy: null },
  ];
  task.comments = [
    {
      id: `c-${title}`,
      taskId: task.id,
      authorId: 'qa-1',
      authorName: 'QA',
      authorRole: 'qa_engineer',
      body: `**Review abgelehnt**\n\nFolgende Acceptance Criteria fehlen:\n- ${reason}`,
      createdAt: '2026-08-02T00:00:00.000Z',
    },
  ];
  return task;
}

// =============================================================================
// Mustererkennung
// =============================================================================

describe('Review-Rückweisungen', () => {
  it('erkennt einen wiederholten Ablehnungsgrund als Muster', () => {
    const tasks = [
      rejectedTask('A', 'Fehlerbehandlung getestet'),
      rejectedTask('B', 'Fehlerbehandlung getestet'),
    ];

    const candidates = detectReviewRejections(tasks);
    const match = candidates.find((c) => c.insight.includes('Fehlerbehandlung getestet'));

    expect(match).toBeDefined();
    expect(match!.taskIds).toHaveLength(2);
    expect(match!.evidence).toContain('2 Tickets');
    expect(match!.roles).toContain('developer');
  });

  it('ignoriert einen Einzelfall', () => {
    // Ein einmal zurückgewiesenes Ticket ist Alltag, kein Learning
    expect(detectReviewRejections([rejectedTask('A', 'Randfall')])).toEqual([]);
  });

  it('meldet bei uneinheitlichen Gründen trotzdem die hohe Quote', () => {
    const tasks = [rejectedTask('A', 'Grund 1'), rejectedTask('B', 'Grund 2')];
    const candidates = detectReviewRejections(tasks);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].insight).toContain('Akzeptanzkriterien');
  });

  it('erzeugt keine Kandidaten ohne Rückweisungen', () => {
    const clean = createScrumTask({ title: 'Sauber', description: '', column: 'done' });
    expect(detectReviewRejections([clean])).toEqual([]);
  });
});

describe('Eingetretene Risiken', () => {
  it('erkennt ein Risiko, dessen Ticket blockiert war', () => {
    const task = createScrumTask({ title: 'Migration', description: '' });
    task.risks = [createRisk('Schema-Migration bricht Altdaten', 'high', 'tl-1', 'Backup einspielen')];
    task.statusHistory = [
      { from: 'in_progress', to: 'blocked', timestamp: '2026-08-01T00:00:00.000Z', triggeredBy: null },
    ];

    const candidates = detectMaterializedRisks([task]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].insight).toContain('Backup einspielen');
    expect(candidates[0].category).toBe('architecture');
  });

  it('ignoriert Risiken bei reibungslosen Tickets', () => {
    const task = createScrumTask({ title: 'Glatt', description: '', column: 'done' });
    task.risks = [createRisk('Theoretisches Risiko', 'high')];
    expect(detectMaterializedRisks([task])).toEqual([]);
  });

  it('ignoriert Risiken geringer Schwere', () => {
    const task = createScrumTask({ title: 'Klein', description: '' });
    task.risks = [createRisk('Kleinigkeit', 'low')];
    task.statusHistory = [
      { from: 'in_progress', to: 'blocked', timestamp: '2026-08-01T00:00:00.000Z', triggeredBy: null },
    ];
    expect(detectMaterializedRisks([task])).toEqual([]);
  });
});

describe('Flow-Bottlenecks', () => {
  it('erkennt eine langsame Spalte', () => {
    const candidates = detectFlowBottlenecks([], { in_review: 72 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].insight).toContain('Review-Kapazität');
    expect(candidates[0].roles).toContain('qa_engineer');
  });

  it('ignoriert schnelle Spalten', () => {
    expect(detectFlowBottlenecks([], { in_progress: 4 })).toEqual([]);
  });

  it('ignoriert Done und Backlog', () => {
    expect(detectFlowBottlenecks([], { done: 500, backlog: 900 })).toEqual([]);
  });
});

describe('Technische Hinweise', () => {
  it('übernimmt Hinweise aus abgeschlossenen Tickets', () => {
    const task = createScrumTask({
      title: 'Login',
      description: '',
      column: 'done',
      technicalNotes: 'Zod-Schema zentral in lib/validation halten.',
    });

    const candidates = detectTechnicalNotes([task]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].insight).toContain('Zod-Schema');
    expect(candidates[0].evidence).toContain('Login');
  });

  it('ignoriert nicht abgeschlossene Tickets', () => {
    const task = createScrumTask({
      title: 'Offen',
      description: '',
      column: 'in_progress',
      technicalNotes: 'Noch nicht bewährt',
    });
    expect(detectTechnicalNotes([task])).toEqual([]);
  });
});

// =============================================================================
// Skills
// =============================================================================

describe('Skills', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('aktiviert einen Skill aus einer Review-Rückweisung sofort', () => {
    const [candidate] = detectReviewRejections([
      rejectedTask('A', 'Tests ergänzt'),
      rejectedTask('B', 'Tests ergänzt'),
    ]);

    const skill = createSkill(candidate, 'learning-1');
    // Rückweisungen sind harte Evidenz — der Skill gilt sofort
    expect(skill.active).toBe(true);
    expect(skill.activatedAt).not.toBeNull();
  });

  it('legt einen Skill aus weicher Evidenz zunächst inaktiv an', () => {
    const [candidate] = detectFlowBottlenecks([], { in_review: 72 });
    const skill = createSkill(candidate, 'learning-1');

    expect(skill.active).toBe(false);
    expect(skill.activatedAt).toBeNull();
  });

  it('aktiviert einen inaktiven Skill beim zweiten Auftreten', () => {
    const [candidate] = detectFlowBottlenecks([], { in_review: 72 });
    const skill = createSkill(candidate, 'l-1');
    state.skills.push(skill);

    reinforceSkill(skill, 'l-2');

    expect(skill.active).toBe(true);
    expect(skill.reinforcementCount).toBe(2);
    expect(skill.learningIds).toEqual(['l-1', 'l-2']);
  });

  it('erkennt einen inhaltsgleichen Skill statt ein Duplikat anzulegen', () => {
    const [candidate] = detectFlowBottlenecks([], { in_review: 72 });
    state.skills.push(createSkill(candidate, 'l-1'));

    expect(findMatchingSkill(state, candidate)?.description).toBe(candidate.insight);
  });

  it('liefert null für eine unbekannte Erkenntnis', () => {
    const [candidate] = detectFlowBottlenecks([], { in_review: 72 });
    expect(findMatchingSkill(state, candidate)).toBeNull();
  });

  it('liefert aktive Skills je Rolle', () => {
    const [candidate] = detectReviewRejections([
      rejectedTask('A', 'Tests'),
      rejectedTask('B', 'Tests'),
    ]);
    state.skills.push(createSkill(candidate, 'l-1'));

    expect(activeSkillsForRole(state, 'developer')).toHaveLength(1);
    expect(activeSkillsForRole(state, 'qa_engineer')).toHaveLength(0);
  });

  it('verknüpft ein Learning mit seinem Beleg', () => {
    const [candidate] = detectReviewRejections([
      rejectedTask('A', 'Tests'),
      rejectedTask('B', 'Tests'),
    ]);
    const learning = toLearning(candidate, 'sprint-1');

    expect(learning.evidence).toBeTruthy();
    expect(learning.sourceTaskIds.length).toBeGreaterThan(0);
    expect(learning.sprintId).toBe('sprint-1');
  });
});

describe('collectCandidates', () => {
  it('führt alle Quellen zusammen', () => {
    const rejected = [rejectedTask('A', 'Tests'), rejectedTask('B', 'Tests')];
    const withNotes = createScrumTask({
      title: 'Notiz',
      description: '',
      column: 'done',
      technicalNotes: 'Hinweis',
    });

    const candidates = collectCandidates([...rejected, withNotes], { in_review: 72 });
    const sources = new Set(candidates.map((c) => c.source));

    expect(sources.has('review_rejection')).toBe(true);
    expect(sources.has('flow_bottleneck')).toBe(true);
    expect(sources.has('technical_note')).toBe(true);
  });

  it('liefert für ein sauberes Board nichts', () => {
    const clean = createScrumTask({ title: 'Sauber', description: '', column: 'done' });
    expect(collectCandidates([clean], { in_progress: 2 })).toEqual([]);
  });
});

// =============================================================================
// Story-Vorschläge
// =============================================================================

describe('Story-Vorschläge', () => {
  it('schlägt offen gebliebene Akzeptanzkriterien vor', () => {
    const met = createAcceptanceCriterion('erfüllt');
    met.met = true;
    const task = createScrumTask({
      title: 'Login',
      description: '',
      column: 'done',
      acceptanceCriteria: [met, createAcceptanceCriterion('Fehlerfall behandeln')],
    });

    const proposals = proposeFromUnmetCriteria([task]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].rationale).toContain('Fehlerfall behandeln');
    expect(proposals[0].suggestedPriority).toBe('high');
  });

  it('schlägt Gegenmaßnahmen für wirksam gewordene Risiken vor', () => {
    const task = createScrumTask({ title: 'Migration', description: '' });
    task.risks = [createRisk('Datenverlust möglich', 'high', 'tl-1', null)];
    task.statusHistory = [
      { from: 'in_progress', to: 'blocked', timestamp: '2026-08-01T00:00:00.000Z', triggeredBy: null },
    ];

    const proposals = proposeFromRisks([task]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].title).toContain('Datenverlust möglich');
  });

  it('schlägt bei vielen Rückweisungen eine Prozessarbeit vor', () => {
    const tasks = [
      rejectedTask('A', 'x'),
      rejectedTask('B', 'y'),
      rejectedTask('C', 'z'),
    ];

    const proposals = proposeFromRejections(tasks);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].title).toContain('Definition of Done');
  });

  it('schweigt bei wenigen Rückweisungen', () => {
    expect(proposeFromRejections([rejectedTask('A', 'x')])).toEqual([]);
  });

  it('schlägt Folgeschritte für abgeschlossene Epics vor', () => {
    const epic = createScrumTask({ id: 'epic-1', title: 'User Management', description: '', type: 'epic' });
    const child = createScrumTask({
      title: 'Login',
      description: '',
      parentId: 'epic-1',
      column: 'done',
    });

    const proposals = proposeFollowUps([epic, child]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].suggestedType).toBe('feature');
  });

  it('schlägt kein Epic vor, dessen Subtasks noch offen sind', () => {
    const epic = createScrumTask({ id: 'epic-1', title: 'Epic', description: '', type: 'epic' });
    const child = createScrumTask({
      title: 'Offen',
      description: '',
      parentId: 'epic-1',
      column: 'in_progress',
    });

    expect(proposeFollowUps([epic, child])).toEqual([]);
  });

  it('unterdrückt bereits bekannte Vorschläge', () => {
    const state = createState();
    const task = createScrumTask({
      title: 'Login',
      description: '',
      column: 'done',
      acceptanceCriteria: [createAcceptanceCriterion('Fehlerfall')],
    });
    state.tasks.push(task);

    const first = collectProposals(state, [task]);
    expect(first).toHaveLength(1);

    // Nach dem Übernehmen darf derselbe Anlass nicht erneut vorgeschlagen werden
    state.proposedStories.push(...first);
    expect(collectProposals(state, [task])).toEqual([]);
  });

  it('unterdrückt Vorschläge, für die schon ein Ticket existiert', () => {
    const state = createState();
    const done = createScrumTask({
      title: 'Login',
      description: '',
      column: 'done',
      acceptanceCriteria: [createAcceptanceCriterion('Fehlerfall')],
    });
    state.tasks.push(done);

    const [proposal] = collectProposals(state, [done]);
    // Aus dem Vorschlag wurde ein echtes Ticket
    state.tasks.push(createScrumTask({ title: proposal.title, description: '' }));

    expect(collectProposals(state, [done])).toEqual([]);
  });
});

describe('Schwellenwert', () => {
  it('verlangt mehr als einen Einzelfall', () => {
    expect(PATTERN_THRESHOLD).toBeGreaterThan(1);
  });
});
