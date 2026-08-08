/**
 * Tests für die Event-Trigger der Zeremonien (Spec §2, §4)
 *
 * Kernfragen: Löst der richtige Board-Zustand die richtige Zeremonie aus, und
 * bleibt das System dabei frei von Endlosschleifen?
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CeremonyType, ScrumAgent, ScrumSprint, ScrumTask, WorkerState } from '../../types';
import { createDefaultSettings } from '../../types';
import { createAcceptanceCriterion, createCeremonyRecord, createScrumTask } from '../../factories';
import { createInitialProjectOnboarding } from '../../project-onboarding';
import {
  CeremonyTriggerEngine,
  MAX_CASCADE,
  TRIGGER_BACKLOG_LOW,
  TRIGGER_BLOCKED,
  TRIGGER_DEVELOPER_IDLE,
  TRIGGER_NO_DEVELOPMENT,
  TRIGGER_RETRO_PENDING,
  TRIGGER_SPRINT_COMPLETE,
  TRIGGER_TODO_EMPTY,
  activeConditions,
  isCeremonyEnabled,
  newlyFired,
  type TriggerCondition,
} from '../ceremony-triggers';
import { MIN_READY_BACKLOG } from '../../ceremonies/refinement';

// =============================================================================
// Fixtures
// =============================================================================

function agent(id: string, role: string): ScrumAgent {
  return { id, name: id, role, status: 'idle', currentTaskId: null, capabilities: [] };
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

/** Sprintreifes Ticket: verfeinert, geschätzt, mit Akzeptanzkriterium. */
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

function createState(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    initialized: true,
    currentSprint: sprint(),
    tasks: [],
    agents: [agent('dev-1', 'developer'), agent('dev-2', 'developer'), agent('sm-1', 'scrum_master')],
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

/** Füllt das Backlog mit genug sprintreifen Tickets, damit BACKLOG_LOW ruht. */
function stockedBacklog(count = MIN_READY_BACKLOG): ScrumTask[] {
  return Array.from({ length: count }, (_, i) => ready({ title: `B${i}` }));
}

// =============================================================================
// Einzelne Bedingungen
// =============================================================================

describe('Auslösebedingungen', () => {
  it('TODO leer mit sprintreifem Backlog → Sprint Planning', () => {
    const state = createState({ tasks: stockedBacklog() });
    expect(TRIGGER_TODO_EMPTY.isActive(state)).toBe(true);
    expect(TRIGGER_TODO_EMPTY.ceremony).toBe('sprint_planning');
  });

  it('TODO leer ohne sprintreifes Backlog löst kein Planning aus', () => {
    // Planning hätte nichts zu tun — sonst bliebe die Bedingung dauerhaft aktiv
    const state = createState({ tasks: [createScrumTask({ title: 'Roh', description: '' })] });
    expect(TRIGGER_TODO_EMPTY.isActive(state)).toBe(false);
  });

  it('TODO gefüllt löst kein Planning aus', () => {
    const state = createState({ tasks: [...stockedBacklog(), ready({ column: 'todo' })] });
    expect(TRIGGER_TODO_EMPTY.isActive(state)).toBe(false);
  });

  it('keine Entwicklung und nichts Sprintreifes → Refinement', () => {
    const state = createState({ tasks: [createScrumTask({ title: 'Roh', description: '' })] });
    expect(TRIGGER_NO_DEVELOPMENT.isActive(state)).toBe(true);
    expect(TRIGGER_NO_DEVELOPMENT.ceremony).toBe('backlog_refinement');
  });

  it('laufende Entwicklung unterdrückt den Refinement-Trigger', () => {
    const state = createState({ tasks: [ready({ column: 'in_progress' })] });
    expect(TRIGGER_NO_DEVELOPMENT.isActive(state)).toBe(false);
  });

  it('zu wenig sprintreife Tickets → Refinement', () => {
    const state = createState({ tasks: stockedBacklog(MIN_READY_BACKLOG - 1) });
    expect(TRIGGER_BACKLOG_LOW.isActive(state)).toBe(true);
  });

  it('ausreichend gefülltes Backlog ruht', () => {
    const state = createState({ tasks: stockedBacklog() });
    expect(TRIGGER_BACKLOG_LOW.isActive(state)).toBe(false);
  });

  it('blockiertes Ticket → Blocker-Auflösung', () => {
    const state = createState({ tasks: [ready({ column: 'blocked' })] });
    expect(TRIGGER_BLOCKED.isActive(state)).toBe(true);
    expect(TRIGGER_BLOCKED.ceremony).toBe('impediment_resolution');
  });

  it('freier Developer bei wartender Arbeit → Blocker-Auflösung', () => {
    const state = createState({
      tasks: [ready({ column: 'in_progress', assignedAgentId: 'dev-1' }), ready({ column: 'todo' })],
    });
    // dev-2 ist frei, während ein Ticket in TODO wartet
    expect(TRIGGER_DEVELOPER_IDLE.isActive(state)).toBe(true);
  });

  it('freier Developer ohne wartende Arbeit ist kein Flow-Problem', () => {
    const state = createState({ tasks: [ready({ column: 'in_progress', assignedAgentId: 'dev-1' })] });
    expect(TRIGGER_DEVELOPER_IDLE.isActive(state)).toBe(false);
  });

  it('alle Sprint-Tickets fertig → Sprint Review', () => {
    const state = createState({
      currentSprint: sprint({ taskIds: ['a'] }),
      tasks: [ready({ id: 'a', column: 'done', sprintId: 'sprint-1' })],
    });
    expect(TRIGGER_SPRINT_COMPLETE.isActive(state)).toBe(true);
  });

  it('offene Sprint-Tickets lösen kein Review aus', () => {
    const state = createState({
      currentSprint: sprint({ taskIds: ['a', 'b'] }),
      tasks: [
        ready({ id: 'a', column: 'done', sprintId: 'sprint-1' }),
        ready({ id: 'b', column: 'in_progress', sprintId: 'sprint-1' }),
      ],
    });
    expect(TRIGGER_SPRINT_COMPLETE.isActive(state)).toBe(false);
  });

  it('ein leerer Sprint gilt nicht als abgeschlossen', () => {
    const state = createState();
    expect(TRIGGER_SPRINT_COMPLETE.isActive(state)).toBe(false);
  });

  it('Review ohne Retrospektive → Retrospektive', () => {
    const state = createState({
      ceremonies: [createCeremonyRecord('sprint_review', 'sprint-1', 'Review')],
    });
    expect(TRIGGER_RETRO_PENDING.isActive(state)).toBe(true);
  });

  it('nach durchgeführter Retrospektive ruht der Trigger', () => {
    const state = createState({
      ceremonies: [
        createCeremonyRecord('sprint_review', 'sprint-1', 'Review'),
        createCeremonyRecord('sprint_retrospective', 'sprint-1', 'Retro'),
      ],
    });
    expect(TRIGGER_RETRO_PENDING.isActive(state)).toBe(false);
  });
});

// =============================================================================
// Flankensteuerung
// =============================================================================

describe('Flankensteuerung', () => {
  it('feuert nur bei neu eingetretenen Bedingungen', () => {
    const state = createState({ tasks: stockedBacklog() });

    const first = newlyFired(state, new Set());
    expect(first.map((f) => f.ceremony)).toContain('sprint_planning');

    // Zweiter Durchlauf mit denselben aktiven Bedingungen: nichts Neues
    const active = activeConditions(state);
    expect(newlyFired(state, active)).toHaveLength(0);
  });

  it('macht eine Bedingung wieder scharf, nachdem sie inaktiv war', () => {
    const state = createState({ tasks: stockedBacklog() });
    const active = activeConditions(state);
    expect(newlyFired(state, active)).toHaveLength(0);

    // TODO füllt sich → Bedingung inaktiv
    state.tasks.push(ready({ column: 'todo' }));
    const afterFill = activeConditions(state);
    expect(afterFill.has('todo-empty')).toBe(false);

    // TODO leert sich wieder → feuert erneut
    state.tasks = state.tasks.filter((t) => t.column !== 'todo');
    expect(newlyFired(state, afterFill).map((f) => f.ceremony)).toContain('sprint_planning');
  });

  it('führt dieselbe Zeremonie pro Durchlauf nur einmal aus', () => {
    // Leeres Board: no-development UND backlog-low verlangen beide Refinement
    const state = createState();
    const fired = newlyFired(state, new Set());

    const refinements = fired.filter((f) => f.ceremony === 'backlog_refinement');
    expect(refinements).toHaveLength(1);
  });

  it('liefert eine Begründung für das Log', () => {
    const state = createState({ tasks: stockedBacklog() });
    const fired = newlyFired(state, new Set());
    expect(fired.every((f) => f.reason.length > 0)).toBe(true);
  });
});

// =============================================================================
// Schalter
// =============================================================================

describe('Ein-/Ausschalter der Trigger', () => {
  it('wartet bei einem neuen Projekt auf die Backlog-Freigabe', () => {
    const state = createState({ tasks: stockedBacklog() });
    state.projectOnboarding = createInitialProjectOnboarding();

    const fired = newlyFired(state, new Set()).map((entry) => entry.ceremony);

    expect(fired).not.toContain('sprint_planning');
    expect(fired).not.toContain('backlog_refinement');
  });

  it('unterdrückt eine abgeschaltete Zeremonie', () => {
    const state = createState({ tasks: stockedBacklog() });
    state.settings.events.enableAutoPlanning = false;

    expect(newlyFired(state, new Set()).map((f) => f.ceremony)).not.toContain('sprint_planning');
  });

  it('lässt die übrigen Zeremonien unberührt', () => {
    const state = createState({ tasks: [ready({ column: 'blocked' })] });
    state.settings.events.enableAutoPlanning = false;

    expect(newlyFired(state, new Set()).map((f) => f.ceremony)).toContain('impediment_resolution');
  });

  it('deckt mit einem Schalter Review und Retrospektive ab', () => {
    const settings = createDefaultSettings();
    settings.events.enableAutoReview = false;

    const state = createState({
      settings,
      ceremonies: [createCeremonyRecord('sprint_review', 'sprint-1', 'Review')],
    });

    expect(isCeremonyEnabled(state, 'sprint_review')).toBe(false);
    expect(isCeremonyEnabled(state, 'sprint_retrospective')).toBe(false);
    expect(newlyFired(state, new Set()).map((f) => f.ceremony)).not.toContain(
      'sprint_retrospective'
    );
  });

  it('betrachtet jede Zeremonie ohne gesetzten Schalter als aktiv', () => {
    const state = createState();
    for (const ceremony of [
      'sprint_planning',
      'backlog_refinement',
      'impediment_resolution',
      'sprint_review',
      'sprint_retrospective',
    ] as CeremonyType[]) {
      expect(isCeremonyEnabled(state, ceremony)).toBe(true);
    }
  });
});

// =============================================================================
// Engine
// =============================================================================

describe('CeremonyTriggerEngine', () => {
  let state: WorkerState;

  beforeEach(() => {
    state = createState();
  });

  it('führt fällige Zeremonien aus', () => {
    state.tasks = stockedBacklog();
    const run = vi.fn();
    const engine = new CeremonyTriggerEngine({ getState: () => state, run });

    const executed = engine.evaluate();
    expect(executed).toContain('sprint_planning');
    expect(run).toHaveBeenCalled();
  });

  it('wiederholt eine Zeremonie nicht, solange die Bedingung anhält', () => {
    state.tasks = stockedBacklog();
    const run = vi.fn();
    const engine = new CeremonyTriggerEngine({ getState: () => state, run });

    engine.evaluate();
    const callsAfterFirst = run.mock.calls.length;

    // Zustand unverändert → keine neue Flanke
    engine.evaluate();
    expect(run.mock.calls).toHaveLength(callsAfterFirst);
  });

  it('läuft nicht endlos, wenn eine Zeremonie ihre Bedingung nicht auflöst', () => {
    // Bedingung, die dauerhaft aktiv bleibt und deren "Zeremonie" nichts ändert
    const stuck: TriggerCondition = {
      id: 'immer-aktiv',
      ceremony: 'impediment_resolution',
      isActive: () => true,
      describe: () => 'bleibt aktiv',
    };

    const run = vi.fn();
    const engine = new CeremonyTriggerEngine({
      getState: () => state,
      run,
      conditions: [stuck],
    });

    const executed = engine.evaluate();
    // Genau einmal: nach dem ersten Durchlauf ist die Bedingung im
    // Flankenspeicher und feuert nicht erneut
    expect(executed).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('deckelt Kaskaden, wenn Bedingungen einander abwechselnd auslösen', () => {
    // Zwei Bedingungen, die sich gegenseitig scharf machen — pathologischer Fall
    let flip = true;
    const a: TriggerCondition = {
      id: 'a',
      ceremony: 'impediment_resolution',
      isActive: () => flip,
      describe: () => 'a',
    };
    const b: TriggerCondition = {
      id: 'b',
      ceremony: 'backlog_refinement',
      isActive: () => !flip,
      describe: () => 'b',
    };

    const run = vi.fn(() => {
      flip = !flip;
    });
    const engine = new CeremonyTriggerEngine({ getState: () => state, run, conditions: [a, b] });

    const executed = engine.evaluate();
    expect(executed.length).toBeLessThanOrEqual(MAX_CASCADE);
    expect(run.mock.calls.length).toBeLessThanOrEqual(MAX_CASCADE);
  });

  it('erlaubt die Kette Review → Retrospektive', () => {
    state.currentSprint = sprint({ taskIds: ['a'] });
    state.tasks = [ready({ id: 'a', column: 'done', sprintId: 'sprint-1' })];

    const executed: CeremonyType[] = [];
    const engine = new CeremonyTriggerEngine({
      getState: () => state,
      run: (ceremony) => {
        executed.push(ceremony);
        // Zeremonien wie im Worker nachbilden: sie schreiben ihren Eintrag
        if (ceremony === 'sprint_review') {
          state.ceremonies.push(createCeremonyRecord('sprint_review', 'sprint-1', 'Review'));
          state.currentSprint!.status = 'completed';
        }
        if (ceremony === 'sprint_retrospective') {
          state.ceremonies.push(createCeremonyRecord('sprint_retrospective', 'sprint-1', 'Retro'));
        }
      },
    });

    engine.evaluate();
    expect(executed).toContain('sprint_review');
    expect(executed).toContain('sprint_retrospective');
    expect(executed.indexOf('sprint_review')).toBeLessThan(executed.indexOf('sprint_retrospective'));
  });

  it('schützt gegen Rekursion, wenn eine Zeremonie erneut auswertet', () => {
    state.tasks = stockedBacklog();
    const run = vi.fn(() => {
      // Zeremonie stößt die Auswertung erneut an; die Closure läuft erst nach
      // der Initialisierung von `engine`
      engine.evaluate();
    });
    const engine = new CeremonyTriggerEngine({ getState: () => state, run });

    expect(() => engine.evaluate()).not.toThrow();
    expect(run.mock.calls.length).toBeLessThanOrEqual(MAX_CASCADE);
  });
});
