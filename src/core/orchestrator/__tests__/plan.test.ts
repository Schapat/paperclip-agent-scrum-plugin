/**
 * Tests fuer die Wiedervorlage des Boards.
 *
 * Die Kernfrage ist nicht "faellt die richtige Absicht an?" — das ist die
 * leichte Haelfte. Entscheidend ist, dass sie *wieder* anfaellt, solange die
 * Lage besteht: jeder Deadlock, den dieses Plugin bisher hatte, war ein
 * Uebergang, den niemand ein zweites Mal versucht hat.
 */

import { describe, it, expect } from 'vitest';
import type { ScrumAgent, ScrumSprint, ScrumTask, TicketStall, WorkerState } from '../../types';
import { createDefaultSettings } from '../../types';
import { createAcceptanceCriterion, createScrumTask } from '../../factories';
import { planBoard } from '../plan';
import type { BoardIntent } from '../intents';

// =============================================================================
// Fixtures
// =============================================================================

function agent(id: string, role: string, overrides: Partial<ScrumAgent> = {}): ScrumAgent {
  return {
    id,
    name: id,
    role,
    status: 'idle',
    currentTaskId: null,
    capabilities: [],
    ...overrides,
  } as ScrumAgent;
}

function sprint(): ScrumSprint {
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
  };
}

/** Sprintreifes Ticket: verfeinert, geschaetzt, mit Akzeptanzkriterium. */
function ready(overrides: Partial<ScrumTask> = {}): ScrumTask {
  return createScrumTask({
    title: 'Ready',
    description: '',
    storyPoints: 3,
    refined: true,
    acceptanceCriteria: [createAcceptanceCriterion('AC')],
    ...overrides,
  });
}

/** Unverfeinertes Ticket: weder Schaetzung noch Kriterien. */
function raw(overrides: Partial<ScrumTask> = {}): ScrumTask {
  return createScrumTask({ title: 'Raw', description: '', ...overrides });
}

function createState(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    initialized: true,
    currentSprint: sprint(),
    tasks: [],
    agents: [
      agent('po-1', 'product_owner'),
      agent('tl-1', 'technical_lead'),
      agent('qa-1', 'qa_engineer'),
      agent('dev-1', 'developer'),
      agent('dev-2', 'developer'),
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
  } as WorkerState;
}

function plan(state: WorkerState, live: string[] = []): BoardIntent[] {
  return planBoard({ state, liveRunTaskIds: new Set(live) });
}

function forTask(intents: BoardIntent[], taskId: string): BoardIntent | undefined {
  return intents.find((intent) => intent.taskId === taskId);
}

// =============================================================================
// Zuständigkeit je Spalte
// =============================================================================

describe('Zuständigkeit je Spalte', () => {
  it('unverfeinertes Backlog-Ticket geht an den Technical Lead', () => {
    const task = raw({ column: 'backlog' });
    const intent = forTask(plan(createState({ tasks: [task] })), task.id);

    expect(intent?.kind).toBe('refine');
    expect(intent?.role).toBe('technical_lead');
    expect(intent?.agentId).toBe('tl-1');
  });

  it('sprintreifes Backlog-Ticket wird einem Entwickler zugewiesen', () => {
    const task = ready({ column: 'backlog' });
    const intent = forTask(plan(createState({ tasks: [task] })), task.id);

    expect(intent?.kind).toBe('assign');
    expect(intent?.role).toBe('developer');
    expect(intent?.agentId).toMatch(/^dev-/);
  });

  it('Ticket im Review geht an die QA', () => {
    const task = ready({ column: 'in_review', assignedAgentId: 'dev-1' });
    const intent = forTask(plan(createState({ tasks: [task] })), task.id);

    expect(intent?.kind).toBe('review');
    expect(intent?.agentId).toBe('qa-1');
  });

  it('blockiertes Ticket geht an den Technical Lead', () => {
    const task = ready({ column: 'blocked' });
    const intent = forTask(plan(createState({ tasks: [task] })), task.id);

    expect(intent?.kind).toBe('unblock');
    expect(intent?.agentId).toBe('tl-1');
  });

  it('fertiges Ticket erzeugt keine Absicht', () => {
    const task = ready({ column: 'done', assignedAgentId: 'dev-1' });
    expect(plan(createState({ tasks: [task] }))).toHaveLength(0);
  });
});

// =============================================================================
// Nebenläufigkeit
// =============================================================================

describe('Laufende Agenten', () => {
  it('ein laufender Lauf unterdrückt jede Absicht für sein Ticket', () => {
    const task = ready({ column: 'in_progress', assignedAgentId: 'dev-1' });
    const state = createState({ tasks: [task] });

    expect(forTask(plan(state, [task.id]), task.id)).toBeUndefined();
  });

  it('ein laufender Lauf hält die Kapazität für andere Tickets belegt', () => {
    const running = ready({ column: 'in_progress', assignedAgentId: 'dev-1' });
    const waiting = ready({ column: 'backlog' });
    const state = createState({ tasks: [running, waiting] });

    // dev-1 ist beschäftigt, dev-2 ist frei — das wartende Ticket geht an dev-2.
    expect(forTask(plan(state, [running.id]), waiting.id)?.agentId).toBe('dev-2');
  });
});

// =============================================================================
// Wiedervorlage — die Deadlocks von früher
// =============================================================================

describe('Refinement-Stapel', () => {
  it('ein laufender Stapel unterdrückt jede weitere Verfeinerung', () => {
    // Der Lauf hängt am Träger-Ticket; die übrigen Mitglieder des Stapels haben
    // keinen eigenen. Ohne diese Sperre stößt die Wiedervorlage einen zweiten
    // Stapel an und der Technical Lead fängt von vorne an.
    const carrier = raw({ column: 'backlog' });
    const member = raw({ column: 'backlog' });
    const state = createState({ tasks: [carrier, member] });

    const plan = planBoard({
      state,
      liveRunTaskIds: new Set([carrier.id]),
      refinementInFlight: true,
    });

    expect(plan.filter((intent) => intent.kind === 'refine')).toHaveLength(0);
  });

  it('ohne laufenden Stapel fällt jedes unverfeinerte Ticket an', () => {
    const state = createState({ tasks: [raw({ column: 'backlog' }), raw({ column: 'backlog' })] });

    expect(plan(state).filter((intent) => intent.kind === 'refine')).toHaveLength(2);
  });

  it('der laufende Stapel hält andere Arbeit nicht auf', () => {
    const carrier = raw({ column: 'backlog' });
    const review = ready({ column: 'in_review' });
    const state = createState({ tasks: [carrier, review] });

    const intents = planBoard({
      state,
      liveRunTaskIds: new Set([carrier.id]),
      refinementInFlight: true,
    });

    expect(forTask(intents, review.id)?.kind).toBe('review');
  });
});

describe('Wiedervorlage', () => {
  it('angefangene Arbeit ohne laufenden Agenten fällt erneut an', () => {
    // Der abgestürzte Run: das Ticket steht auf in_progress, aber niemand
    // arbeitet. Flankengesteuert war das endgültig — hier fällt es wieder an.
    const task = ready({ column: 'in_progress', assignedAgentId: 'dev-1' });
    const intent = forTask(plan(createState({ tasks: [task] })), task.id);

    expect(intent?.kind).toBe('implement');
    expect(intent?.agentId).toBe('dev-1');
  });

  it('ein herrenloses TODO-Ticket bekommt einen Bearbeiter', () => {
    // Ohne Bearbeiter weckt der Worker niemanden — das Ticket wartet auf einen
    // Agenten, den nie jemand benannt hat.
    const task = ready({ column: 'todo', assignedAgentId: null });
    const intent = forTask(plan(createState({ tasks: [task] })), task.id);

    expect(intent?.kind).toBe('assign');
    expect(intent?.agentId).toMatch(/^dev-/);
  });

  it('ein Ticket in Arbeit ohne Bearbeiter wird neu zugewiesen', () => {
    const task = ready({ column: 'in_progress', assignedAgentId: null });
    expect(forTask(plan(createState({ tasks: [task] })), task.id)?.kind).toBe('assign');
  });

  it('dieselbe Lage ergibt dieselben Absichten — ohne Flankengedächtnis', () => {
    const state = createState({
      tasks: [raw({ column: 'backlog' }), ready({ column: 'in_review' })],
    });

    expect(plan(state)).toEqual(plan(state));
  });

  it('der Schlüssel einer Absicht überlebt einen Neustart', () => {
    // Der Schlüssel hängt nur an Ticket und Art. Der alte Versuchszähler lag im
    // Arbeitsspeicher und begann nach jedem Neustart wieder bei 1.
    const task = ready({ column: 'in_review' });
    const first = forTask(plan(createState({ tasks: [task] })), task.id);
    const afterRestart = forTask(plan(createState({ tasks: [task] })), task.id);

    expect(first?.key).toBe(afterRestart?.key);
    expect(first?.key).toBe(`${task.id}:review`);
  });
});

// =============================================================================
// Kapazität
// =============================================================================

describe('Kapazität', () => {
  it('das WIP-Limit der Entwicklung begrenzt neue Zuweisungen', () => {
    const settings = createDefaultSettings();
    settings.wipLimits.development = 1;

    const busy = ready({ column: 'in_progress', assignedAgentId: 'dev-1' });
    const busy2 = ready({ column: 'in_progress', assignedAgentId: 'dev-2' });
    const waiting = ready({ column: 'backlog' });
    const state = createState({ tasks: [busy, busy2, waiting], settings });

    // Beide Entwickler sind am Limit — das wartende Ticket bleibt liegen.
    expect(forTask(plan(state, [busy.id, busy2.id]), waiting.id)).toBeUndefined();
  });

  it('ohne Entwickler wird nichts eingeplant', () => {
    const state = createState({
      tasks: [ready({ column: 'backlog' })],
      agents: [agent('tl-1', 'technical_lead')],
    });

    expect(state.tasks.map((task) => forTask(plan(state), task.id)?.kind)).toEqual([undefined]);
  });

  it('ein Ticket, das auf ein anderes wartet, wird nicht eingeplant', () => {
    const blocker = ready({ column: 'in_progress', assignedAgentId: 'dev-1' });
    const dependent = ready({
      column: 'backlog',
      links: [{ taskId: blocker.id, type: 'blocked_by' }],
    } as Partial<ScrumTask>);
    const state = createState({ tasks: [blocker, dependent] });

    expect(forTask(plan(state, [blocker.id]), dependent.id)).toBeUndefined();
  });
});

// =============================================================================
// Grenze der Automatik
// =============================================================================

describe('Menschliche Entscheidungen', () => {
  it('eine wartende Freigabe beendet die Automatik für ihr Ticket', () => {
    const task = ready({ column: 'in_progress', assignedAgentId: 'dev-1' });
    const stall: TicketStall = {
      taskId: task.id,
      kind: 'awaiting_approval',
      reason: 'Waiting for a human approval outside the board.',
      detectedAt: '2026-08-01T00:00:00.000Z',
      retriedAt: null,
    };
    const intent = forTask(plan(createState({ tasks: [task], stalls: [stall] })), task.id);

    expect(intent?.kind).toBe('await_human');
    expect(intent?.role).toBe('human');
  });

  it('ein Budget-Stillstand schlägt die Zuständigkeit der Rolle', () => {
    const task = ready({ column: 'blocked' });
    const stall: TicketStall = {
      taskId: task.id,
      kind: 'budget',
      reason: 'The agent is blocked in Delivery: budget exhausted.',
      detectedAt: '2026-08-01T00:00:00.000Z',
      retriedAt: null,
    };

    expect(forTask(plan(createState({ tasks: [task], stalls: [stall] })), task.id)?.kind).toBe(
      'await_human'
    );
  });

  it('eine Rückfrage im Ticket beendet die Automatik für ihr Ticket', () => {
    // Der Host haelt das Ticket an, bis ein Mensch antwortet. Weiterzuwecken
    // kostet fuenf Versuche und endet in einer Eskalation, die die eigentliche
    // Frage verdeckt.
    const task = ready({ column: 'blocked', assignedAgentId: 'dev-1' });
    const stall: TicketStall = {
      taskId: task.id,
      kind: 'awaiting_decision',
      reason: 'GAM-42 is waiting for a decision that an agent asked for inside the ticket.',
      detectedAt: '2026-08-01T00:00:00.000Z',
      retriedAt: null,
    };
    const intent = forTask(plan(createState({ tasks: [task], stalls: [stall] })), task.id);

    expect(intent?.kind).toBe('await_human');
    expect(intent?.role).toBe('human');
  });

  it('ein Ticket, das einem Menschen gehört, weckt keinen Agenten', () => {
    // Der Fall aus dem echten Board: "GitHub-Repository einrichten" lag im
    // Review und war einem Board-Nutzer zugewiesen. Das Board weckte dafür die
    // QA — und meldete ansonsten nur, es laufe gerade kein Agent, während vier
    // Stories in der Lieferkette dahinter standen.
    const task = ready({ column: 'in_review', assignedAgentId: null });
    (task as ScrumTask).assignedUserId = 'local-board';
    const intent = forTask(plan(createState({ tasks: [task] })), task.id);

    expect(intent?.kind).toBe('await_human');
    expect(intent?.role).toBe('human');
    expect(intent?.reason).toContain('assigned to a person');
    expect(intent?.reason).toContain(task.title);
  });

  it('ein erledigtes Ticket eines Menschen hält nichts mehr auf', () => {
    const task = ready({ column: 'done', assignedAgentId: null });
    (task as ScrumTask).assignedUserId = 'local-board';

    expect(forTask(plan(createState({ tasks: [task] })), task.id)).toBeUndefined();
  });

  it('ein zugewiesener Agent schlägt die menschliche Zuweisung', () => {
    // Beides gesetzt heisst: ein Agent arbeitet daran, der Mensch ist nur
    // Eigentuemer. Dann bleibt es Agentenarbeit.
    const task = ready({ column: 'todo', assignedAgentId: 'dev-1' });
    (task as ScrumTask).assignedUserId = 'local-board';

    expect(forTask(plan(createState({ tasks: [task] })), task.id)?.kind).toBe('implement');
  });

  it('ein technischer Stillstand beendet die Automatik nicht', () => {
    // Ein abgestürzter Run ist kein Fall für einen Menschen — er wird wiederholt.
    const task = ready({ column: 'in_progress', assignedAgentId: 'dev-1' });
    const stall: TicketStall = {
      taskId: task.id,
      kind: 'run_failed',
      reason: 'The agent run ended without a result.',
      detectedAt: '2026-08-01T00:00:00.000Z',
      retriedAt: null,
    };

    expect(forTask(plan(createState({ tasks: [task], stalls: [stall] })), task.id)?.kind).toBe(
      'implement'
    );
  });
});
