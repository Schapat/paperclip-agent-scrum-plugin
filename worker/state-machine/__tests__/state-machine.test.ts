/**
 * State Machine Tests
 *
 * Tests for the Idle-Detection State Machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createStateMachine,
  evaluateBoardState,
  RULE_NO_DEVELOPMENT,
  RULE_BACKLOG_LOW,
  RULE_BACKLOG_UNREFINED,
  RULE_TODO_EMPTY,
  RULE_REVIEW_EMPTY,
  RULE_BLOCKED_TASKS,
  type BoardState,
  type StateMachineAction,
  type StateChangeLog,
} from '../index';
import type { WorkerState, ScrumTask, ScrumAgent } from '@shared/types';
import { createDefaultSettings } from '@shared/types';
import { createScrumTask } from '@shared/factories';

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockWorkerState(overrides?: Partial<WorkerState>): WorkerState {
  return {
    initialized: true,
    currentSprint: null,
    tasks: [],
    agents: [],
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

function createMockTask(overrides?: Partial<ScrumTask>): ScrumTask {
  return createScrumTask({
    title: 'Test Task',
    description: 'Test Description',
    storyPoints: 3,
    column: 'backlog',
    statusHistory: [],
    ...overrides,
  });
}

function createMockAgent(overrides?: Partial<ScrumAgent>): ScrumAgent {
  return {
    id: crypto.randomUUID(),
    name: 'Test Developer',
    role: 'Developer',
    status: 'idle',
    currentTaskId: null,
    capabilities: ['coding'],
    ...overrides,
  };
}

// =============================================================================
// Rule Tests
// =============================================================================

describe('State Machine Rules', () => {
  describe('RULE_NO_DEVELOPMENT', () => {
    it('should trigger when no tasks in progress and idle developers exist', () => {
      const state: BoardState = {
        backlog: 5,
        backlogRefined: 3,
        todo: 2,
        inProgress: 0,
        inReview: 0,
        done: 0,
        blocked: 0,
        idleDevelopers: [
          {
            id: '1',
            name: 'Dev 1',
            role: 'Developer',
            idleSince: new Date().toISOString(),
            capabilities: [],
          },
        ],
        busyDevelopers: [],
        backlogPoints: 15,
        todoPoints: 6,
        inProgressPoints: 0,
        capturedAt: new Date().toISOString(),
      };

      expect(RULE_NO_DEVELOPMENT.condition(state)).toBe(true);

      const actions = RULE_NO_DEVELOPMENT.actions(state);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions[0].type).toBe('notify_developers');
      expect(actions[0].priority).toBe('critical');
    });

    it('should NOT trigger when tasks are in progress', () => {
      const state: BoardState = {
        backlog: 5,
        backlogRefined: 3,
        todo: 2,
        inProgress: 1, // Has work in progress
        inReview: 0,
        done: 0,
        blocked: 0,
        idleDevelopers: [],
        busyDevelopers: [
          {
            id: '1',
            name: 'Dev 1',
            role: 'Developer',
            currentTaskId: 'task-1',
            currentTaskTitle: 'Working',
            workingOnSince: new Date().toISOString(),
          },
        ],
        backlogPoints: 15,
        todoPoints: 6,
        inProgressPoints: 3,
        capturedAt: new Date().toISOString(),
      };

      expect(RULE_NO_DEVELOPMENT.condition(state)).toBe(false);
    });

    it('should trigger sprint planning when TODO is empty but backlog has items', () => {
      const state: BoardState = {
        backlog: 5,
        backlogRefined: 3,
        todo: 0, // Empty TODO
        inProgress: 0,
        inReview: 0,
        done: 0,
        blocked: 0,
        idleDevelopers: [
          {
            id: '1',
            name: 'Dev 1',
            role: 'Developer',
            idleSince: new Date().toISOString(),
            capabilities: [],
          },
        ],
        busyDevelopers: [],
        backlogPoints: 15,
        todoPoints: 0,
        inProgressPoints: 0,
        capturedAt: new Date().toISOString(),
      };

      expect(RULE_NO_DEVELOPMENT.condition(state)).toBe(true);

      const actions = RULE_NO_DEVELOPMENT.actions(state);
      const sprintPlanningAction = actions.find(
        (a) => a.type === 'trigger_sprint_planning'
      );
      expect(sprintPlanningAction).toBeDefined();
      expect(sprintPlanningAction?.priority).toBe('critical');
    });

    it('should trigger backlog refinement when both TODO and backlog are empty', () => {
      const state: BoardState = {
        backlog: 0, // Empty
        backlogRefined: 0,
        todo: 0, // Empty
        inProgress: 0,
        inReview: 0,
        done: 0,
        blocked: 0,
        idleDevelopers: [
          {
            id: '1',
            name: 'Dev 1',
            role: 'Developer',
            idleSince: new Date().toISOString(),
            capabilities: [],
          },
        ],
        busyDevelopers: [],
        backlogPoints: 0,
        todoPoints: 0,
        inProgressPoints: 0,
        capturedAt: new Date().toISOString(),
      };

      expect(RULE_NO_DEVELOPMENT.condition(state)).toBe(true);

      const actions = RULE_NO_DEVELOPMENT.actions(state);
      const refinementAction = actions.find(
        (a) => a.type === 'trigger_backlog_refinement'
      );
      expect(refinementAction).toBeDefined();
      expect(refinementAction?.priority).toBe('critical');
    });
  });

  describe('RULE_BACKLOG_LOW', () => {
    it('should trigger when backlog has fewer than 5 items', () => {
      const state: BoardState = {
        backlog: 3, // Below minimum
        backlogRefined: 2,
        todo: 5,
        inProgress: 2,
        inReview: 1,
        done: 10,
        blocked: 0,
        idleDevelopers: [],
        busyDevelopers: [],
        backlogPoints: 9,
        todoPoints: 15,
        inProgressPoints: 6,
        capturedAt: new Date().toISOString(),
      };

      expect(RULE_BACKLOG_LOW.condition(state)).toBe(true);

      const actions = RULE_BACKLOG_LOW.actions(state);
      expect(actions.some((a) => a.type === 'notify_po')).toBe(true);
    });

    it('should NOT trigger when backlog has 5 or more items', () => {
      const state: BoardState = {
        backlog: 5, // At minimum
        backlogRefined: 3,
        todo: 5,
        inProgress: 2,
        inReview: 1,
        done: 10,
        blocked: 0,
        idleDevelopers: [],
        busyDevelopers: [],
        backlogPoints: 15,
        todoPoints: 15,
        inProgressPoints: 6,
        capturedAt: new Date().toISOString(),
      };

      expect(RULE_BACKLOG_LOW.condition(state)).toBe(false);
    });
  });

  describe('RULE_BACKLOG_UNREFINED', () => {
    it('should trigger when backlog has items but none are refined', () => {
      const state: BoardState = {
        backlog: 8, // Has items
        backlogRefined: 0, // But none refined
        todo: 2,
        inProgress: 2,
        inReview: 1,
        done: 10,
        blocked: 0,
        idleDevelopers: [],
        busyDevelopers: [],
        backlogPoints: 0,
        todoPoints: 6,
        inProgressPoints: 6,
        capturedAt: new Date().toISOString(),
      };

      expect(RULE_BACKLOG_UNREFINED.condition(state)).toBe(true);

      const actions = RULE_BACKLOG_UNREFINED.actions(state);
      expect(actions.some((a) => a.type === 'notify_scrum_master')).toBe(true);
    });

    it('should NOT trigger when backlog has refined items', () => {
      const state: BoardState = {
        backlog: 8,
        backlogRefined: 5, // Has refined items
        todo: 2,
        inProgress: 2,
        inReview: 1,
        done: 10,
        blocked: 0,
        idleDevelopers: [],
        busyDevelopers: [],
        backlogPoints: 15,
        todoPoints: 6,
        inProgressPoints: 6,
        capturedAt: new Date().toISOString(),
      };

      expect(RULE_BACKLOG_UNREFINED.condition(state)).toBe(false);
    });
  });

  describe('RULE_TODO_EMPTY', () => {
    it('should trigger when TODO is empty but backlog has refined items', () => {
      const state: BoardState = {
        backlog: 8,
        backlogRefined: 5, // Has refined items
        todo: 0, // Empty TODO
        inProgress: 2,
        inReview: 1,
        done: 10,
        blocked: 0,
        idleDevelopers: [],
        busyDevelopers: [],
        backlogPoints: 24,
        todoPoints: 0,
        inProgressPoints: 6,
        capturedAt: new Date().toISOString(),
      };

      expect(RULE_TODO_EMPTY.condition(state)).toBe(true);

      const actions = RULE_TODO_EMPTY.actions(state);
      expect(actions[0].type).toBe('trigger_sprint_planning');
    });
  });

  describe('RULE_REVIEW_EMPTY', () => {
    it('should trigger (informational) when review is empty but dev is ongoing', () => {
      const state: BoardState = {
        backlog: 5,
        backlogRefined: 3,
        todo: 2,
        inProgress: 3, // Active development
        inReview: 0, // Empty review
        done: 10,
        blocked: 0,
        idleDevelopers: [],
        busyDevelopers: [],
        backlogPoints: 15,
        todoPoints: 6,
        inProgressPoints: 9,
        capturedAt: new Date().toISOString(),
      };

      expect(RULE_REVIEW_EMPTY.condition(state)).toBe(true);

      const actions = RULE_REVIEW_EMPTY.actions(state);
      // This is just informational logging
      expect(actions[0].type).toBe('log_state_change');
      expect(actions[0].priority).toBe('low');
    });
  });

  describe('RULE_BLOCKED_TASKS', () => {
    it('should trigger when tasks are blocked', () => {
      const state: BoardState = {
        backlog: 5,
        backlogRefined: 3,
        todo: 2,
        inProgress: 2,
        inReview: 1,
        done: 10,
        blocked: 2, // Has blocked tasks
        idleDevelopers: [],
        busyDevelopers: [],
        backlogPoints: 15,
        todoPoints: 6,
        inProgressPoints: 6,
        capturedAt: new Date().toISOString(),
      };

      expect(RULE_BLOCKED_TASKS.condition(state)).toBe(true);

      const actions = RULE_BLOCKED_TASKS.actions(state);
      expect(actions[0].type).toBe('notify_scrum_master');
      expect(actions[0].priority).toBe('high');
    });
  });
});

// =============================================================================
// evaluateBoardState Tests
// =============================================================================

describe('evaluateBoardState', () => {
  it('should return healthy when board is in good state', () => {
    const workerState = createMockWorkerState({
      tasks: [
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'todo' }),
        createMockTask({ column: 'todo' }),
        createMockTask({ column: 'in_progress' }),
        createMockTask({ column: 'in_review' }),
      ],
      agents: [
        createMockAgent({ status: 'working', currentTaskId: 'task-1' }),
      ],
    });

    const result = evaluateBoardState(workerState);

    expect(result.healthy).toBe(true);
    expect(result.boardState.backlog).toBe(5);
    expect(result.boardState.todo).toBe(2);
    expect(result.boardState.inProgress).toBe(1);
    expect(result.boardState.inReview).toBe(1);
  });

  it('should return unhealthy when no development and idle developers', () => {
    const workerState = createMockWorkerState({
      tasks: [
        createMockTask({ column: 'todo' }),
        createMockTask({ column: 'todo' }),
      ],
      agents: [
        createMockAgent({ name: 'Idle Dev', status: 'idle' }),
      ],
    });

    const result = evaluateBoardState(workerState);

    expect(result.healthy).toBe(false);
    expect(result.triggeredRules).toContain('no-development');
    expect(result.actions.some((a) => a.priority === 'critical')).toBe(true);
  });

  it('should detect backlog running low', () => {
    const workerState = createMockWorkerState({
      tasks: [
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        // Only 2 in backlog, below minimum of 5
        createMockTask({ column: 'in_progress' }),
      ],
      agents: [
        createMockAgent({ status: 'working', currentTaskId: 'task-1' }),
      ],
    });

    const result = evaluateBoardState(workerState);

    expect(result.triggeredRules).toContain('backlog-low');
  });

  it('should capture board state correctly', () => {
    const workerState = createMockWorkerState({
      tasks: [
        createMockTask({ column: 'backlog', storyPoints: 5 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'todo', storyPoints: 8 }),
        createMockTask({ column: 'in_progress', storyPoints: 5 }),
        createMockTask({ column: 'in_review', storyPoints: 3 }),
        createMockTask({ column: 'done', storyPoints: 13 }),
        createMockTask({ column: 'blocked', storyPoints: 2 }),
      ],
    });

    const result = evaluateBoardState(workerState);

    expect(result.boardState.backlog).toBe(2);
    expect(result.boardState.todo).toBe(1);
    expect(result.boardState.inProgress).toBe(1);
    expect(result.boardState.inReview).toBe(1);
    expect(result.boardState.done).toBe(1);
    expect(result.boardState.blocked).toBe(1);
    expect(result.boardState.backlogPoints).toBe(8);
    expect(result.boardState.todoPoints).toBe(8);
    expect(result.boardState.inProgressPoints).toBe(5);
  });
});

// =============================================================================
// StateMachine Class Tests
// =============================================================================

describe('StateMachine', () => {
  let actionExecutor: (action: StateMachineAction) => Promise<boolean>;
  let logEmitter: (log: StateChangeLog) => void;

  beforeEach(() => {
    actionExecutor = vi.fn().mockResolvedValue(true) as (action: StateMachineAction) => Promise<boolean>;
    logEmitter = vi.fn() as (log: StateChangeLog) => void;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create with default config', () => {
    const workerState = createMockWorkerState();
    const machine = createStateMachine(
      () => workerState,
      actionExecutor,
      logEmitter
    );

    const state = machine.getState();
    expect(state.config.pollingIntervalMs).toBe(5 * 60 * 1000);
    expect(state.config.minBacklogSize).toBe(5);
  });

  it('should start and stop polling', () => {
    const workerState = createMockWorkerState();
    const machine = createStateMachine(
      () => workerState,
      actionExecutor,
      logEmitter,
      { pollingIntervalMs: 1000 }
    );

    machine.start();
    expect(machine.getState().running).toBe(true);

    machine.stop();
    expect(machine.getState().running).toBe(false);
  });

  it('should evaluate and execute actions', async () => {
    const workerState = createMockWorkerState({
      tasks: [createMockTask({ column: 'todo' })],
      agents: [createMockAgent({ status: 'idle' })],
    });

    const machine = createStateMachine(
      () => workerState,
      actionExecutor,
      logEmitter
    );

    const result = await machine.evaluate();

    expect(result).toBeDefined();
    expect(result.evaluatedAt).toBeDefined();
    expect(result.boardState).toBeDefined();
  });

  it('should track evaluation history', async () => {
    const workerState = createMockWorkerState();
    const machine = createStateMachine(
      () => workerState,
      actionExecutor,
      logEmitter
    );

    await machine.evaluate();
    await machine.evaluate();
    await machine.evaluate();

    const state = machine.getState();
    expect(state.evaluationHistory.length).toBe(3);
  });

  it('should track healthy/unhealthy streaks', async () => {
    // A truly healthy state: enough backlog, work in TODO, work in progress, and in review
    // This avoids triggering any critical/high rules
    const healthyState = createMockWorkerState({
      tasks: [
        // 5 refined backlog items (above minimum)
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        // Tasks in TODO so sprint planning is not needed
        createMockTask({ column: 'todo', storyPoints: 3 }),
        createMockTask({ column: 'todo', storyPoints: 3 }),
        // Tasks in progress
        createMockTask({ column: 'in_progress', storyPoints: 3 }),
        // Tasks in review (so QA isn't idle)
        createMockTask({ column: 'in_review', storyPoints: 3 }),
      ],
      agents: [
        // All developers busy
        createMockAgent({ status: 'working', currentTaskId: 'task-1' }),
      ],
    });

    const machine = createStateMachine(
      () => healthyState,
      actionExecutor,
      logEmitter
    );

    await machine.evaluate();
    await machine.evaluate();
    await machine.evaluate();

    const state = machine.getState();
    // Should be healthy - no critical or high priority rules triggered
    expect(state.healthyStreak).toBeGreaterThan(0);
    expect(state.unhealthyStreak).toBe(0);
  });

  it('should call action executor for generated actions', async () => {
    const unhealthyState = createMockWorkerState({
      tasks: [createMockTask({ column: 'todo' })],
      agents: [createMockAgent({ status: 'idle' })],
    });

    const machine = createStateMachine(
      () => unhealthyState,
      actionExecutor,
      logEmitter
    );

    machine.start();
    // Trigger first poll
    await vi.advanceTimersByTimeAsync(100);

    expect(actionExecutor).toHaveBeenCalled();
    machine.stop();
  });

  it('should update config and restart polling if needed', () => {
    const workerState = createMockWorkerState();
    const machine = createStateMachine(
      () => workerState,
      actionExecutor,
      logEmitter,
      { pollingIntervalMs: 5000 }
    );

    machine.start();
    expect(machine.getState().running).toBe(true);

    machine.updateConfig({ pollingIntervalMs: 10000 });
    expect(machine.getState().config.pollingIntervalMs).toBe(10000);

    machine.stop();
  });

  it('should emit state change logs', async () => {
    let currentState = createMockWorkerState({
      tasks: [createMockTask({ column: 'backlog', storyPoints: 3 })],
    });

    const machine = createStateMachine(
      () => currentState,
      actionExecutor,
      logEmitter
    );

    // First evaluation
    await machine.evaluate();

    // Change state
    currentState = createMockWorkerState({
      tasks: [
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'todo' }), // Added task to TODO
      ],
    });

    // Second evaluation
    await machine.evaluate();

    // Log emitter should have been called with state changes
    expect(logEmitter).toHaveBeenCalled();
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('State Machine Integration', () => {
  it('should handle complete workflow scenario', async () => {
    const executedActions: StateMachineAction[] = [];
    const logs: StateChangeLog[] = [];

    // Start with empty state
    let workerState = createMockWorkerState({
      agents: [
        createMockAgent({ name: 'Dev 1', status: 'idle' }),
        createMockAgent({ name: 'Dev 2', status: 'idle' }),
      ],
    });

    const machine = createStateMachine(
      () => workerState,
      async (action) => {
        executedActions.push(action);
        return true;
      },
      (log) => logs.push(log)
    );

    // Initial evaluation - should trigger backlog refinement
    let result = await machine.evaluate();
    expect(result.healthy).toBe(false);
    expect(result.triggeredRules).toContain('no-development');
    
    // Check that the actions contain what we expect (from the evaluation result, not executor)
    expect(result.actions.some(a => a.type === 'notify_developers' || a.type === 'trigger_backlog_refinement')).toBe(true);

    // Simulate backlog being filled
    workerState = createMockWorkerState({
      tasks: [
        createMockTask({ column: 'backlog', storyPoints: 5 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 8 }),
        createMockTask({ column: 'backlog', storyPoints: 5 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
      ],
      agents: [
        createMockAgent({ name: 'Dev 1', status: 'idle' }),
        createMockAgent({ name: 'Dev 2', status: 'idle' }),
      ],
    });

    // Should now trigger sprint planning because TODO is empty
    result = await machine.evaluate();
    expect(result.triggeredRules).toContain('todo-empty');

    // Simulate sprint planning done - TODO has tasks now
    workerState = createMockWorkerState({
      tasks: [
        createMockTask({ column: 'backlog', storyPoints: 5 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 8 }),
        createMockTask({ column: 'backlog', storyPoints: 5 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'todo', storyPoints: 5 }),
        createMockTask({ column: 'todo', storyPoints: 3 }),
      ],
      agents: [
        createMockAgent({ name: 'Dev 1', status: 'idle' }),
        createMockAgent({ name: 'Dev 2', status: 'idle' }),
      ],
    });

    // Should now notify developers to pick up work (no-development rule)
    result = await machine.evaluate();
    expect(result.triggeredRules).toContain('no-development');
    expect(result.actions.some((a) => a.type === 'notify_developers')).toBe(true);

    // Simulate developers picking up work - now healthy!
    workerState = createMockWorkerState({
      tasks: [
        createMockTask({ column: 'backlog', storyPoints: 5 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'backlog', storyPoints: 8 }),
        createMockTask({ column: 'backlog', storyPoints: 5 }),
        createMockTask({ column: 'backlog', storyPoints: 3 }),
        createMockTask({ column: 'todo', storyPoints: 5 }),
        createMockTask({ column: 'in_progress', storyPoints: 5 }),
        createMockTask({ column: 'in_progress', storyPoints: 3 }),
        createMockTask({ column: 'in_review', storyPoints: 3 }),
      ],
      agents: [
        createMockAgent({ name: 'Dev 1', status: 'working', currentTaskId: 'task-1' }),
        createMockAgent({ name: 'Dev 2', status: 'working', currentTaskId: 'task-2' }),
      ],
    });

    // Should now be healthy - work is in progress, review has items
    result = await machine.evaluate();
    expect(result.healthy).toBe(true);
    expect(result.triggeredRules).not.toContain('no-development');

    // Logs should have been emitted for state changes
    expect(logs.length).toBeGreaterThan(0);
  });
});
