/**
 * Tests für die Scrum-Zeremonien (Spec §2)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentWorkRequest, CeremonyContext } from '../types';
import type { ScrumAgent, ScrumSprint, ScrumTask, WorkerState } from '@shared/types';
import { createDefaultSettings } from '@shared/types';
import { createAcceptanceCriterion, createScrumTask } from '@shared/factories';

import { runSprintPlanning, sprintCapacity } from '../sprint-planning';
import { runBacklogRefinement, analyzeBacklog, MIN_READY_BACKLOG } from '../refinement';
import { runSprintReview, analyzeSprint } from '../sprint-review';
import { runRetrospective, analyzeProcess, countReviewRejections, averageTimePerColumn } from '../retrospective';
import { pickAssignee, rankCandidates } from '../assignment';

// =============================================================================
// Fixtures
// =============================================================================

function agent(id: string, role: string, skills: string[] = []): ScrumAgent {
  return {
    id,
    name: id,
    role,
    status: 'idle',
    currentTaskId: null,
    capabilities: [],
    skills,
  };
}

function sprint(): ScrumSprint {
  return {
    id: 'sprint-1',
    name: 'Sprint 1',
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-08-14T00:00:00.000Z',
    status: 'active',
    taskIds: [],
    goal: 'Ziel',
    velocity: 0,
    completedPoints: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

/** Ein sprintreifes Ticket: verfeinert, geschätzt, mit Akzeptanzkriterium. */
function readyTask(overrides: Partial<ScrumTask> = {}): ScrumTask {
  return createScrumTask({
    title: 'Ready',
    description: '',
    storyPoints: 3,
    refined: true,
    acceptanceCriteria: [createAcceptanceCriterion('AC-1')],
    ...overrides,
  });
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
      agent('dev-2', 'developer', ['backend']),
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
    agentInstructions: {},
    ...overrides,
  };
}

function createCtx(state: WorkerState) {
  const requests: AgentWorkRequest[] = [];
  const ctx: CeremonyContext = {
    state,
    requestAgentWork: (r) => requests.push(r),
  };
  return { ctx, requests };
}

// =============================================================================
// Sprint Planning
// =============================================================================

describe('Sprint Planning', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('zieht nur sprintreife Tickets in den Sprint', () => {
    const ready = readyTask({ title: 'Fertig geschnitten', priority: 'high' });
    const unrefined = createScrumTask({ title: 'Roh', description: '', storyPoints: 3 });
    state.tasks.push(ready, unrefined);

    const { ctx } = createCtx(state);
    runSprintPlanning(ctx);

    expect(ready.column).not.toBe('backlog');
    expect(unrefined.column).toBe('backlog');
  });

  it('schickt unfertige Tickets zur Ausarbeitung an den Technical Lead', () => {
    state.tasks.push(createScrumTask({ title: 'Roh', description: '' }));

    const { ctx, requests } = createCtx(state);
    runSprintPlanning(ctx);

    const req = requests.find((r) => r.role === 'technical_lead');
    expect(req).toBeDefined();
    expect(req!.instruction).toContain('Akzeptanzkriterien');
  });

  it('priorisiert nach Business Value', () => {
    const low = readyTask({ title: 'Niedrig', priority: 'low' });
    const critical = readyTask({ title: 'Kritisch', priority: 'critical' });
    state.tasks.push(low, critical);
    // Nur ein TODO-Slot, damit die Reihenfolge sichtbar wird
    state.settings.wipLimits.todo = 1;

    const { ctx } = createCtx(state);
    runSprintPlanning(ctx);

    expect(critical.column).not.toBe('backlog');
    expect(low.column).toBe('backlog');
  });

  it('überspringt Tickets, die eine offene Abhängigkeit haben', () => {
    const blocker = createScrumTask({ id: 'blocker', title: 'Blocker', description: '' });
    const dependent = readyTask({
      title: 'Abhängig',
      links: [{ taskId: 'blocker', type: 'blocked_by' }],
    });
    state.tasks.push(blocker, dependent);

    const { ctx } = createCtx(state);
    runSprintPlanning(ctx);

    expect(dependent.column).toBe('backlog');
  });

  it('respektiert die Sprint-Kapazität', () => {
    // Kapazität künstlich auf 3 Punkte begrenzen
    state.completedSprints.push({ ...sprint(), id: 'old', velocity: 3, status: 'completed' });
    const a = readyTask({ title: 'A', storyPoints: 3, priority: 'critical' });
    const b = readyTask({ title: 'B', storyPoints: 3, priority: 'high' });
    state.tasks.push(a, b);

    const { ctx } = createCtx(state);
    runSprintPlanning(ctx);

    expect(sprintCapacity(ctx)).toBe(3);
    expect(a.column).not.toBe('backlog');
    expect(b.column).toBe('backlog');
  });

  it('weist nach Skill zu und protokolliert die Begründung', () => {
    const task = readyTask({ title: 'Frontend-Arbeit', labels: ['frontend'] });
    state.tasks.push(task);

    const { ctx } = createCtx(state);
    runSprintPlanning(ctx);

    expect(task.assignedAgentId).toBe('dev-1');
    const decision = task.decisions.find((d) => d.type === 'auto_assign');
    expect(decision).toBeDefined();
    expect(decision!.reasoning).toContain('frontend');
  });

  it('startet zugewiesene Tickets, ohne das WIP-Limit zu verletzen', () => {
    state.settings.wipLimits.development = 1;
    state.settings.wipLimits.todo = 10;
    const a = readyTask({ title: 'A', labels: ['frontend'], priority: 'critical' });
    const b = readyTask({ title: 'B', labels: ['frontend'], priority: 'high' });
    state.tasks.push(a, b);

    const { ctx } = createCtx(state);
    runSprintPlanning(ctx);

    const inProgress = state.tasks.filter((t) => t.column === 'in_progress');
    // Pro Developer höchstens ein laufendes Ticket
    for (const dev of ['dev-1', 'dev-2']) {
      expect(inProgress.filter((t) => t.assignedAgentId === dev).length).toBeLessThanOrEqual(1);
    }
  });

  it('protokolliert einen Broadcast des Scrum Masters', () => {
    const { ctx } = createCtx(state);
    runSprintPlanning(ctx);

    const start = state.messages.find((m) => m.subject.includes('Sprint Planning'));
    expect(start).toBeDefined();
    expect(start!.fromAgentRole).toBe('scrum_master');
    expect(start!.toAgentIds).toBeNull();
  });

  it('nimmt ohne Historie eine konservative Startkapazität an', () => {
    const { ctx } = createCtx(state);
    // 8 Punkte × 2 Developer × 2 Wochen
    expect(sprintCapacity(ctx)).toBe(32);
  });
});

// =============================================================================
// Backlog Refinement
// =============================================================================

describe('Backlog Refinement', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('erkennt ein zu kleines Backlog und fordert neue Items an', () => {
    const { ctx, requests } = createCtx(state);
    runBacklogRefinement(ctx);

    const req = requests.find((r) => r.role === 'product_owner');
    expect(req).toBeDefined();
    expect(req!.instruction).toContain('Produktvision');
  });

  it('fordert keine neuen Items an, wenn genug sprintreif ist', () => {
    for (let i = 0; i < MIN_READY_BACKLOG; i++) {
      state.tasks.push(readyTask({ title: `T${i}` }));
    }

    const { ctx, requests } = createCtx(state);
    runBacklogRefinement(ctx);

    expect(analyzeBacklog(state).needsNewItems).toBe(false);
    expect(requests.find((r) => r.role === 'product_owner')).toBeUndefined();
  });

  it('meldet zu große Tickets zur Zerlegung', () => {
    state.tasks.push(readyTask({ title: 'Riese', storyPoints: 21 }));

    const { ctx, requests } = createCtx(state);
    runBacklogRefinement(ctx);

    const split = requests.find((r) => r.instruction.includes('Zerlege'));
    expect(split).toBeDefined();
    expect(split!.taskIds).toHaveLength(1);
  });

  it('beauftragt jedes Ticket nur einmal, auch bei mehreren Lücken', () => {
    // Unverfeinert UND ungeschätzt UND ohne Kriterien
    state.tasks.push(createScrumTask({ title: 'Roh', description: '', storyPoints: 0 }));

    const { ctx, requests } = createCtx(state);
    runBacklogRefinement(ctx);

    const req = requests.find((r) => r.role === 'technical_lead');
    expect(req!.taskIds).toHaveLength(1);
  });

  it('protokolliert die Refinement-Entscheidung mit Begründung', () => {
    const raw = createScrumTask({ title: 'Roh', description: '', storyPoints: 0 });
    state.tasks.push(raw);

    const { ctx } = createCtx(state);
    runBacklogRefinement(ctx);

    const decision = raw.decisions.find((d) => d.type === 'refinement');
    expect(decision).toBeDefined();
    expect(decision!.reasoning).toContain('nicht geschätzt');
  });
});

// =============================================================================
// Sprint Review
// =============================================================================

describe('Sprint Review', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('trennt Abgeschlossenes von Übernommenem', () => {
    state.tasks.push(
      readyTask({ title: 'Fertig', column: 'done', storyPoints: 5, sprintId: 'sprint-1' }),
      readyTask({ title: 'Offen', column: 'in_progress', storyPoints: 3, sprintId: 'sprint-1' })
    );

    const result = analyzeSprint(state);
    expect(result.completed).toHaveLength(1);
    expect(result.carriedOver).toHaveLength(1);
    expect(result.completedPoints).toBe(5);
  });

  it('schreibt Velocity fest und schließt den Sprint ab', () => {
    state.tasks.push(readyTask({ title: 'Fertig', column: 'done', storyPoints: 8, sprintId: 'sprint-1' }));

    const { ctx } = createCtx(state);
    runSprintReview(ctx);

    expect(state.completedSprints).toHaveLength(1);
    expect(state.completedSprints[0].velocity).toBe(8);
    expect(state.metrics.velocity).toBe(8);
  });

  it('berechnet die Abdeckung der Akzeptanzkriterien', () => {
    const met = createAcceptanceCriterion('erfüllt');
    met.met = true;
    state.tasks.push(
      readyTask({
        title: 'Halb',
        column: 'done',
        sprintId: 'sprint-1',
        acceptanceCriteria: [met, createAcceptanceCriterion('offen')],
      })
    );

    expect(analyzeSprint(state).criteriaCoverage).toBe(0.5);
  });

  it('kommt mit einem leeren Sprint zurecht', () => {
    const { ctx } = createCtx(state);
    const record = runSprintReview(ctx);

    expect(record.summary).toContain('0 Ticket(s) abgeschlossen');
    expect(analyzeSprint(state).criteriaCoverage).toBe(1);
  });
});

// =============================================================================
// Retrospektive
// =============================================================================

describe('Retrospektive', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('zählt Rückweisungen aus dem Review', () => {
    const task = readyTask({ title: 'Pingpong' });
    task.statusHistory = [
      { from: 'in_progress', to: 'in_review', timestamp: '2026-08-01T00:00:00.000Z', triggeredBy: null },
      { from: 'in_review', to: 'in_progress', timestamp: '2026-08-02T00:00:00.000Z', triggeredBy: null },
      { from: 'in_progress', to: 'in_review', timestamp: '2026-08-03T00:00:00.000Z', triggeredBy: null },
      { from: 'in_review', to: 'in_progress', timestamp: '2026-08-04T00:00:00.000Z', triggeredBy: null },
    ];
    state.tasks.push(task);

    expect(countReviewRejections(state.tasks)).toBe(2);
    expect(analyzeProcess(state).bottlenecks.some((b) => b.includes('zurück in die Entwicklung'))).toBe(true);
  });

  it('berechnet die Verweildauer je Spalte', () => {
    const task = readyTask({ title: 'Langsam' });
    task.statusHistory = [
      { from: null, to: 'todo', timestamp: '2026-08-01T00:00:00.000Z', triggeredBy: null },
      { from: 'todo', to: 'in_progress', timestamp: '2026-08-02T00:00:00.000Z', triggeredBy: null },
    ];

    const avg = averageTimePerColumn([task], Date.parse('2026-08-02T00:00:00.000Z'));
    expect(avg.todo).toBeCloseTo(24, 1);
  });

  it('meldet eine langsame Spalte als Bottleneck mit Verbesserung', () => {
    const task = readyTask({ title: 'Review-Stau' });
    task.statusHistory = [
      { from: 'in_progress', to: 'in_review', timestamp: '2026-08-01T00:00:00.000Z', triggeredBy: null },
      { from: 'in_review', to: 'done', timestamp: '2026-08-05T00:00:00.000Z', triggeredBy: null },
    ];
    state.tasks.push(task);

    const result = analyzeProcess(state);
    expect(result.bottlenecks.some((b) => b.includes('Review'))).toBe(true);
    expect(result.improvements.some((i) => i.includes('Review-Kapazität'))).toBe(true);
  });

  it('meldet blockierte Tickets', () => {
    state.tasks.push(readyTask({ title: 'Blockiert', column: 'blocked' }));
    expect(analyzeProcess(state).bottlenecks.some((b) => b.includes('blockiert'))).toBe(true);
  });

  it('bestätigt einen sauberen Prozess, wenn nichts klemmt', () => {
    const result = analyzeProcess(state);
    expect(result.bottlenecks).toHaveLength(0);
    expect(result.wentWell.some((w) => w.includes('Keine Bottlenecks'))).toBe(true);
  });

  it('hängt das Ergebnis an den Zeremonie-Eintrag', () => {
    const { ctx } = createCtx(state);
    const record = runRetrospective(ctx);

    expect(record.retrospective).toBeDefined();
    expect(state.ceremonies).toContain(record);
  });
});

// =============================================================================
// Zuweisung
// =============================================================================

describe('Skill-basierte Zuweisung', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('bevorzugt den passenden Skill', () => {
    const task = readyTask({ labels: ['backend'] });
    const devs = state.agents.filter((a) => a.role === 'developer');
    expect(pickAssignee(task, devs, state)!.agent.id).toBe('dev-2');
  });

  it('schließt Entwickler am WIP-Limit aus', () => {
    state.settings.wipLimits.development = 1;
    state.tasks.push(readyTask({ column: 'in_progress', assignedAgentId: 'dev-1' }));

    const task = readyTask({ labels: ['frontend'] });
    const devs = state.agents.filter((a) => a.role === 'developer');
    const ranked = rankCandidates(task, devs, state);

    expect(ranked.map((c) => c.agent.id)).not.toContain('dev-1');
  });

  it('liefert null, wenn alle Entwickler ausgelastet sind', () => {
    state.settings.wipLimits.development = 1;
    state.tasks.push(
      readyTask({ column: 'in_progress', assignedAgentId: 'dev-1' }),
      readyTask({ column: 'in_progress', assignedAgentId: 'dev-2' })
    );

    const devs = state.agents.filter((a) => a.role === 'developer');
    expect(pickAssignee(readyTask(), devs, state)).toBeNull();
  });

  it('wählt bei fehlendem Skill-Match den am wenigsten ausgelasteten', () => {
    state.tasks.push(readyTask({ column: 'in_progress', assignedAgentId: 'dev-1' }));

    const task = readyTask({ labels: ['datenbank'] });
    const devs = state.agents.filter((a) => a.role === 'developer');
    expect(pickAssignee(task, devs, state)!.agent.id).toBe('dev-2');
  });
});
