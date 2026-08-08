/**
 * Tests für Impediment Resolution und die erweiterte Retrospektive
 *
 * Beide Events wurden umgebaut, weil sie zuvor keinen verwertbaren Output
 * erzeugt haben. Genau das wird hier geprüft: Verändert das Event tatsächlich
 * etwas?
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentWorkRequest, CeremonyContext } from '../types';
import type { ScrumAgent, ScrumSprint, ScrumTask, WorkerState } from '@shared/types';
import { createDefaultSettings } from '@shared/types';
import { createAcceptanceCriterion, createScrumTask } from '@shared/factories';
import { runImpedimentResolution } from '../impediment-resolution';
import { runRetrospective } from '../retrospective';

// =============================================================================
// Fixtures
// =============================================================================

function agent(id: string, role: string, skills: string[] = []): ScrumAgent {
  return { id, name: id, role, status: 'idle', currentTaskId: null, capabilities: [], skills };
}

function sprint(overrides: Partial<ScrumSprint> = {}): ScrumSprint {
  return {
    id: 'sprint-1',
    name: 'Sprint 1',
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-08-14T00:00:00.000Z',
    status: 'active',
    taskIds: [],
    goal: null,
    velocity: 0,
    completedPoints: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function createState(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    initialized: true,
    currentSprint: sprint(),
    tasks: [],
    agents: [
      agent('po-1', 'product_owner'),
      agent('sm-1', 'scrum_master'),
      agent('tl-1', 'technical_lead'),
      agent('dev-1', 'developer', ['frontend']),
      agent('qa-1', 'qa_engineer'),
    ],
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
    ...overrides,
  };
}

function createCtx(state: WorkerState) {
  const requests: AgentWorkRequest[] = [];
  const ctx: CeremonyContext = { state, requestAgentWork: (r) => requests.push(r) };
  return { ctx, requests };
}

function ready(overrides: Partial<ScrumTask> = {}): ScrumTask {
  return createScrumTask({
    title: 'Ticket',
    description: '',
    storyPoints: 3,
    refined: true,
    acceptanceCriteria: [createAcceptanceCriterion('AC')],
    ...overrides,
  });
}

// =============================================================================
// Impediment Resolution
// =============================================================================

describe('Impediment Resolution', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('hebt eine Blockade auf, deren Ursache erledigt ist', () => {
    const blocker = ready({ id: 'blocker', title: 'Vorarbeit', column: 'done' });
    const blocked = ready({
      id: 'blocked',
      title: 'Wartet',
      column: 'blocked',
      links: [{ taskId: 'blocker', type: 'blocked_by' }],
    });
    state.tasks.push(blocker, blocked);

    const { ctx } = createCtx(state);
    runImpedimentResolution(ctx);

    // Das Event handelt, statt nur zu melden: die Blockade ist aufgehoben und
    // die Arbeit läuft im selben Durchlauf weiter
    expect(blocked.column).not.toBe('blocked');
    expect(blocked.decisions.some((d) => d.type === 'unblocked')).toBe(true);
    expect(blocked.statusHistory.some((h) => h.from === 'blocked' && h.to === 'todo')).toBe(true);
  });

  it('nimmt ein entblocktes Ticket direkt wieder in Arbeit', () => {
    const blocker = ready({ id: 'blocker', title: 'Vorarbeit', column: 'done' });
    const blocked = ready({
      id: 'blocked',
      title: 'Wartet',
      column: 'blocked',
      labels: ['frontend'],
      links: [{ taskId: 'blocker', type: 'blocked_by' }],
    });
    state.tasks.push(blocker, blocked);

    runImpedimentResolution(createCtx(state).ctx);

    expect(blocked.column).toBe('in_progress');
    expect(blocked.assignedAgentId).toBe('dev-1');
  });

  it('eskaliert eine Blockade, deren Ursache offen ist', () => {
    const blocker = ready({ id: 'blocker', title: 'Vorarbeit', column: 'in_progress' });
    const blocked = ready({
      id: 'blocked',
      title: 'Wartet',
      column: 'blocked',
      links: [{ taskId: 'blocker', type: 'blocked_by' }],
    });
    state.tasks.push(blocker, blocked);

    const { ctx, requests } = createCtx(state);
    runImpedimentResolution(ctx);

    expect(blocked.column).toBe('blocked');
    expect(requests.find((r) => r.role === 'technical_lead')?.taskIds).toContain('blocked');
    // Das Feedback benennt das blockierende Ticket
    expect(blocked.comments.some((c) => c.body.includes('Vorarbeit'))).toBe(true);
  });

  it('belegt freie Kapazität mit einem wartenden Ticket', () => {
    state.tasks.push(ready({ id: 'wartend', title: 'Wartend', column: 'todo', labels: ['frontend'] }));

    const { ctx } = createCtx(state);
    runImpedimentResolution(ctx);

    const task = state.tasks.find((t) => t.id === 'wartend')!;
    expect(task.column).toBe('in_progress');
    expect(task.assignedAgentId).toBe('dev-1');
    expect(task.decisions.some((d) => d.type === 'auto_assign')).toBe(true);
  });

  it('respektiert dabei das WIP-Limit', () => {
    state.settings.wipLimits.development = 1;
    state.tasks.push(
      ready({ column: 'in_progress', assignedAgentId: 'dev-1' }),
      ready({ id: 'wartend', column: 'todo' })
    );

    const { ctx } = createCtx(state);
    runImpedimentResolution(ctx);

    // Der einzige Developer ist ausgelastet — das Ticket bleibt liegen
    expect(state.tasks.find((t) => t.id === 'wartend')!.column).toBe('todo');
  });

  it('hinterlässt keine Spur, wenn es nichts zu tun gibt', () => {
    // Ein Event ohne Wirkung soll das Log nicht verwässern
    const record = runImpedimentResolution(createCtx(state).ctx);

    expect(record).toBeNull();
    expect(state.ceremonies).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
  });

  it('fasst die Wirkung in der Zusammenfassung zusammen', () => {
    state.tasks.push(ready({ column: 'todo', labels: ['frontend'] }));

    const record = runImpedimentResolution(createCtx(state).ctx)!;
    expect(record.summary).toContain('1 Ticket(s) neu gestartet');
  });
});

// =============================================================================
// Retrospektive mit Learnings
// =============================================================================

/** Ticket, das im Review aus einem bestimmten Grund zurückgewiesen wurde. */
function rejected(id: string, reason: string): ScrumTask {
  const task = ready({ id, title: id, column: 'done', sprintId: 'sprint-1' });
  task.statusHistory = [
    { from: 'in_progress', to: 'in_review', timestamp: '2026-08-01T00:00:00.000Z', triggeredBy: null },
    { from: 'in_review', to: 'in_progress', timestamp: '2026-08-02T00:00:00.000Z', triggeredBy: null },
  ];
  task.comments = [
    {
      id: `c-${id}`,
      taskId: id,
      authorId: 'qa-1',
      authorName: 'QA',
      authorRole: 'qa_engineer',
      body: `**Review abgelehnt**\n\nFolgende Acceptance Criteria fehlen:\n- ${reason}`,
      createdAt: '2026-08-02T00:00:00.000Z',
    },
  ];
  return task;
}

describe('Retrospektive erzeugt Learnings und Skills', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState({ currentSprint: sprint({ taskIds: ['a', 'b'] }) });
  });

  it('legt aus wiederholten Rückweisungen einen aktiven Skill an', () => {
    state.tasks.push(rejected('a', 'Fehlerbehandlung getestet'), rejected('b', 'Fehlerbehandlung getestet'));

    const { ctx } = createCtx(state);
    const record = runRetrospective(ctx);

    expect(state.learnings.length).toBeGreaterThan(0);
    expect(state.skills.length).toBeGreaterThan(0);

    const skill = state.skills.find((s) => s.description.includes('Fehlerbehandlung getestet'))!;
    expect(skill.active).toBe(true);
    expect(skill.roles).toContain('developer');
    expect(record.retrospective!.skillIds).toContain(skill.id);
  });

  it('informiert die betroffenen Rollen über aktivierte Skills', () => {
    state.tasks.push(rejected('a', 'Tests ergänzt'), rejected('b', 'Tests ergänzt'));

    const { ctx } = createCtx(state);
    runRetrospective(ctx);

    const notice = state.messages.find((m) => m.subject.includes('Skill(s) aktiviert'));
    expect(notice).toBeDefined();
    expect(notice!.toAgentIds).toContain('dev-1');
  });

  it('legt beim zweiten Sprint kein Duplikat an, sondern bestärkt', () => {
    state.tasks.push(rejected('a', 'Tests ergänzt'), rejected('b', 'Tests ergänzt'));
    const { ctx } = createCtx(state);

    runRetrospective(ctx);
    const skillsAfterFirst = state.skills.length;
    const skill = state.skills.find((s) => s.description.includes('Tests ergänzt'))!;

    runRetrospective(ctx);

    expect(state.skills).toHaveLength(skillsAfterFirst);
    expect(skill.reinforcementCount).toBeGreaterThan(1);
  });

  it('schlägt neue Backlog-Items vor und beauftragt den Product Owner', () => {
    const task = ready({
      id: 'a',
      title: 'Login',
      column: 'done',
      sprintId: 'sprint-1',
      acceptanceCriteria: [createAcceptanceCriterion('Fehlerfall behandeln')],
    });
    state.tasks.push(task);

    const { ctx, requests } = createCtx(state);
    const record = runRetrospective(ctx);

    expect(state.proposedStories.length).toBeGreaterThan(0);
    expect(record.retrospective!.proposedStories.length).toBeGreaterThan(0);

    const poRequest = requests.find((r) => r.role === 'product_owner');
    expect(poRequest?.instruction).toContain('Backlog-Items');
  });

  it('nennt Learnings und Skills in der Zusammenfassung', () => {
    state.tasks.push(rejected('a', 'Tests'), rejected('b', 'Tests'));

    const record = runRetrospective(createCtx(state).ctx);
    expect(record.summary).toMatch(/Learning\(s\)/);
    expect(record.summary).toMatch(/Skill\(s\)/);
  });

  it('betrachtet nur die Tickets des laufenden Sprints', () => {
    // Ein Ticket aus einem früheren Sprint darf keine neuen Learnings erzeugen
    state.currentSprint = sprint({ taskIds: ['a'] });
    state.tasks.push(
      rejected('a', 'Aktuell'),
      { ...rejected('alt', 'Alt'), sprintId: 'sprint-0' }
    );

    const { ctx } = createCtx(state);
    runRetrospective(ctx);

    const fromOldSprint = state.learnings.some((l) => l.sourceTaskIds.includes('alt'));
    expect(fromOldSprint).toBe(false);
  });

  it('kommt mit einem sauberen Sprint ohne Learnings zurecht', () => {
    state.tasks.push(ready({ id: 'a', column: 'done', sprintId: 'sprint-1' }));

    const { ctx } = createCtx(state);
    const record = runRetrospective(ctx);

    expect(record.retrospective!.learningIds).toEqual([]);
    expect(state.skills).toEqual([]);
  });
});
