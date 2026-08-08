/**
 * State Machine Core
 *
 * Core implementation of the Idle-Detection State Machine.
 *
 * CRITICAL RULE: The system must NEVER be idle!
 *
 * This module:
 * - Evaluates board state against rules
 * - Generates actions to prevent idle states
 * - Manages polling loop
 * - Logs all state changes
 */

import type { WorkerState, ScrumTask, ScrumAgent, TaskStatus } from '@shared/types';
import type {
  BoardState,
  StateMachineState,
  StateMachineConfig,
  StateMachineAction,
  EvaluationResult,
  ExecutedAction,
  StateChangeLog,
  StateChange,
  IdleAgentInfo,
  BusyAgentInfo,
} from './types';
import { DEFAULT_CONFIG } from './types';
import { ALL_RULES } from './rules';

// =============================================================================
// State Machine Class
// =============================================================================

export class StateMachine {
  private state: StateMachineState;
  private workerStateGetter: () => WorkerState;
  private actionExecutor: (action: StateMachineAction) => Promise<boolean>;
  private logEmitter: (log: StateChangeLog) => void;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    workerStateGetter: () => WorkerState,
    actionExecutor: (action: StateMachineAction) => Promise<boolean>,
    logEmitter: (log: StateChangeLog) => void,
    config: Partial<StateMachineConfig> = {}
  ) {
    this.workerStateGetter = workerStateGetter;
    this.actionExecutor = actionExecutor;
    this.logEmitter = logEmitter;

    this.state = {
      running: false,
      lastEvaluation: null,
      evaluationHistory: [],
      pendingActions: [],
      executedActions: [],
      config: { ...DEFAULT_CONFIG, ...config },
      lastPollAt: null,
      healthyStreak: 0,
      unhealthyStreak: 0,
    };
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Start the state machine polling loop
   */
  start(): void {
    if (this.state.running) {
      console.warn('[StateMachine] Already running');
      return;
    }

    console.log(
      `[StateMachine] Starting with ${this.state.config.pollingIntervalMs}ms interval`
    );
    this.state.running = true;

    // Initial evaluation
    this.poll();

    // Start polling loop
    this.pollingInterval = setInterval(() => {
      this.poll();
    }, this.state.config.pollingIntervalMs);
  }

  /**
   * Stop the state machine polling loop
   */
  stop(): void {
    if (!this.state.running) {
      console.warn('[StateMachine] Not running');
      return;
    }

    console.log('[StateMachine] Stopping');
    this.state.running = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Manually trigger an evaluation (useful for testing or immediate checks)
   */
  async evaluate(): Promise<EvaluationResult> {
    return this.performEvaluation();
  }

  /**
   * Get current state machine state
   */
  getState(): Readonly<StateMachineState> {
    return this.state;
  }

  /**
   * Get current board state snapshot
   */
  getBoardState(): BoardState {
    return this.captureCurrentBoardState();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<StateMachineConfig>): void {
    this.state.config = { ...this.state.config, ...config };

    // Restart polling if interval changed and we're running
    if (this.state.running && config.pollingIntervalMs !== undefined) {
      this.stop();
      this.start();
    }
  }

  /**
   * Get pending actions
   */
  getPendingActions(): StateMachineAction[] {
    return [...this.state.pendingActions];
  }

  /**
   * Get executed actions history
   */
  getExecutedActions(): ExecutedAction[] {
    return [...this.state.executedActions];
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  /**
   * Perform a single poll cycle
   */
  private async poll(): Promise<void> {
    try {
      const result = await this.performEvaluation();

      // Execute generated actions
      for (const action of result.actions) {
        await this.executeAction(action);
      }
    } catch (error) {
      console.error('[StateMachine] Poll failed:', error);
    }
  }

  /**
   * Perform board state evaluation
   */
  private async performEvaluation(): Promise<EvaluationResult> {
    const boardState = this.captureCurrentBoardState();
    const previousState = this.state.lastEvaluation?.boardState;

    // Log state changes if we have previous state
    if (previousState) {
      this.logStateChanges(previousState, boardState);
    }

    // Evaluate all rules
    const actions: StateMachineAction[] = [];
    const triggeredRules: string[] = [];

    for (const rule of ALL_RULES) {
      try {
        if (rule.condition(boardState)) {
          triggeredRules.push(rule.id);
          const ruleActions = rule.actions(boardState);
          actions.push(...ruleActions);
        }
      } catch (error) {
        console.error(`[StateMachine] Rule ${rule.id} failed:`, error);
      }
    }

    // Determine if board is healthy
    // Healthy = no critical/high priority actions needed
    const criticalActions = actions.filter(
      (a) => a.priority === 'critical' || a.priority === 'high'
    );
    const healthy = criticalActions.length === 0;

    // Update streaks
    if (healthy) {
      this.state.healthyStreak++;
      this.state.unhealthyStreak = 0;
    } else {
      this.state.unhealthyStreak++;
      this.state.healthyStreak = 0;
    }

    // Build result
    const result: EvaluationResult = {
      healthy,
      actions,
      triggeredRules,
      summary: this.buildSummary(boardState, actions, triggeredRules),
      evaluatedAt: new Date().toISOString(),
      boardState,
    };

    // Update state
    this.state.lastEvaluation = result;
    this.state.lastPollAt = new Date().toISOString();

    // Keep history (last 100 evaluations)
    this.state.evaluationHistory.push(result);
    if (this.state.evaluationHistory.length > 100) {
      this.state.evaluationHistory.shift();
    }

    console.log(
      `[StateMachine] Evaluation: ${healthy ? '✅ Healthy' : '⚠️ Unhealthy'} ` +
        `(${triggeredRules.length} rules, ${actions.length} actions)`
    );

    return result;
  }

  /**
   * Capture current board state from worker state
   */
  private captureCurrentBoardState(): BoardState {
    const workerState = this.workerStateGetter();

    // Count tasks by status
    const tasksByStatus = this.countTasksByStatus(workerState.tasks);

    // Identify idle vs busy agents
    const { idleDevelopers, busyDevelopers } = this.categorizeAgents(
      workerState.agents,
      workerState.tasks
    );

    // Calculate story points
    const pointsByStatus = this.calculatePointsByStatus(workerState.tasks);

    // Count refined backlog items (those with story points set)
    const refinedBacklog = workerState.tasks.filter(
      (t) => t.column === 'backlog' && t.storyPoints > 0
    ).length;

    return {
      backlog: tasksByStatus.backlog,
      backlogRefined: refinedBacklog,
      todo: tasksByStatus.todo,
      inProgress: tasksByStatus.in_progress,
      inReview: tasksByStatus.in_review,
      done: tasksByStatus.done,
      blocked: tasksByStatus.blocked,
      idleDevelopers,
      busyDevelopers,
      backlogPoints: pointsByStatus.backlog,
      todoPoints: pointsByStatus.todo,
      inProgressPoints: pointsByStatus.in_progress,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Count tasks by status
   */
  private countTasksByStatus(tasks: ScrumTask[]): Record<TaskStatus, number> {
    const counts: Record<TaskStatus, number> = {
      backlog: 0,
      todo: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
      blocked: 0,
    };

    for (const task of tasks) {
      counts[task.column]++;
    }

    return counts;
  }

  /**
   * Calculate story points by status
   */
  private calculatePointsByStatus(
    tasks: ScrumTask[]
  ): Record<TaskStatus, number> {
    const points: Record<TaskStatus, number> = {
      backlog: 0,
      todo: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
      blocked: 0,
    };

    for (const task of tasks) {
      points[task.column] += task.storyPoints;
    }

    return points;
  }

  /**
   * Categorize agents into idle and busy
   */
  private categorizeAgents(
    agents: ScrumAgent[],
    tasks: ScrumTask[]
  ): { idleDevelopers: IdleAgentInfo[]; busyDevelopers: BusyAgentInfo[] } {
    const idleDevelopers: IdleAgentInfo[] = [];
    const busyDevelopers: BusyAgentInfo[] = [];

    for (const agent of agents) {
      // Only consider developer-type agents
      if (
        !agent.role.toLowerCase().includes('developer') &&
        !agent.role.toLowerCase().includes('dev')
      ) {
        continue;
      }

      if (agent.status === 'idle' || !agent.currentTaskId) {
        idleDevelopers.push({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          idleSince: new Date().toISOString(), // TODO: Track actual idle start time
          capabilities: agent.capabilities,
        });
      } else {
        const currentTask = tasks.find((t) => t.id === agent.currentTaskId);
        busyDevelopers.push({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          currentTaskId: agent.currentTaskId,
          currentTaskTitle: currentTask?.title ?? 'Unknown',
          workingOnSince: currentTask?.startedAt ?? new Date().toISOString(),
        });
      }
    }

    return { idleDevelopers, busyDevelopers };
  }

  /**
   * Execute a single action
   */
  private async executeAction(action: StateMachineAction): Promise<void> {
    try {
      console.log(`[StateMachine] Executing action: ${action.type} - ${action.message}`);

      const success = await this.actionExecutor(action);

      const executedAction: ExecutedAction = {
        action,
        executedAt: new Date().toISOString(),
        success,
      };

      this.state.executedActions.push(executedAction);

      // Keep last 1000 executed actions
      if (this.state.executedActions.length > 1000) {
        this.state.executedActions.shift();
      }
    } catch (error) {
      console.error(`[StateMachine] Action execution failed:`, error);

      const executedAction: ExecutedAction = {
        action,
        executedAt: new Date().toISOString(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };

      this.state.executedActions.push(executedAction);
    }
  }

  /**
   * Log state changes for audit
   */
  private logStateChanges(
    previousState: BoardState,
    currentState: BoardState
  ): void {
    const changes: StateChange[] = [];
    const numericFields: (keyof BoardState)[] = [
      'backlog',
      'backlogRefined',
      'todo',
      'inProgress',
      'inReview',
      'done',
      'blocked',
      'backlogPoints',
      'todoPoints',
      'inProgressPoints',
    ];

    for (const field of numericFields) {
      const prev = previousState[field] as number;
      const curr = currentState[field] as number;

      if (prev !== curr) {
        changes.push({
          field,
          previousValue: prev,
          currentValue: curr,
          delta: curr - prev,
        });
      }
    }

    // Check agent changes
    const prevIdle = previousState.idleDevelopers.length;
    const currIdle = currentState.idleDevelopers.length;
    if (prevIdle !== currIdle) {
      changes.push({
        field: 'idleDevelopers',
        previousValue: prevIdle,
        currentValue: currIdle,
        delta: currIdle - prevIdle,
      });
    }

    // Only log if there are changes
    if (changes.length > 0) {
      const log: StateChangeLog = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        previousState: {
          backlog: previousState.backlog,
          todo: previousState.todo,
          inProgress: previousState.inProgress,
          inReview: previousState.inReview,
          done: previousState.done,
          blocked: previousState.blocked,
        },
        currentState,
        changes,
        triggeredActions:
          this.state.lastEvaluation?.actions.map((a) => a.type) ?? [],
      };

      this.logEmitter(log);

      console.log(
        `[StateMachine] State changed: ${changes
          .map((c) => `${String(c.field)}: ${c.previousValue} → ${c.currentValue}`)
          .join(', ')}`
      );
    }
  }

  /**
   * Build a human-readable summary
   */
  private buildSummary(
    state: BoardState,
    actions: StateMachineAction[],
    _triggeredRules: string[]
  ): string {
    const parts: string[] = [];

    // Board status
    parts.push(`Board: ${state.backlog}📋 ${state.todo}📝 ${state.inProgress}🔨 ${state.inReview}👀 ${state.done}✅`);

    // Agents
    if (state.idleDevelopers.length > 0) {
      parts.push(`⚠️ ${state.idleDevelopers.length} idle Entwickler`);
    }
    if (state.busyDevelopers.length > 0) {
      parts.push(`${state.busyDevelopers.length} aktive Entwickler`);
    }

    // Blocked
    if (state.blocked > 0) {
      parts.push(`🚫 ${state.blocked} blockiert`);
    }

    // Actions
    if (actions.length > 0) {
      const criticalCount = actions.filter((a) => a.priority === 'critical').length;
      const highCount = actions.filter((a) => a.priority === 'high').length;

      if (criticalCount > 0) {
        parts.push(`🚨 ${criticalCount} kritische Aktionen!`);
      }
      if (highCount > 0) {
        parts.push(`⚠️ ${highCount} wichtige Aktionen`);
      }
    }

    return parts.join(' | ');
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates and returns a configured state machine
 */
export function createStateMachine(
  workerStateGetter: () => WorkerState,
  actionExecutor: (action: StateMachineAction) => Promise<boolean>,
  logEmitter: (log: StateChangeLog) => void,
  config?: Partial<StateMachineConfig>
): StateMachine {
  return new StateMachine(workerStateGetter, actionExecutor, logEmitter, config);
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Evaluates board state and returns actions to take.
 * This is the core function that can be called independently.
 *
 * @param workerState - Current worker state
 * @returns EvaluationResult with actions to take
 */
export function evaluateBoardState(workerState: WorkerState): EvaluationResult {
  const machine = new StateMachine(
    () => workerState,
    async () => true,
    () => {}
  );

  // Get board state snapshot
  const boardState = machine.getBoardState();

  // Evaluate all rules
  const actions: StateMachineAction[] = [];
  const triggeredRules: string[] = [];

  for (const rule of ALL_RULES) {
    if (rule.condition(boardState)) {
      triggeredRules.push(rule.id);
      const ruleActions = rule.actions(boardState);
      actions.push(...ruleActions);
    }
  }

  // Determine if healthy
  const criticalActions = actions.filter(
    (a) => a.priority === 'critical' || a.priority === 'high'
  );
  const healthy = criticalActions.length === 0;

  return {
    healthy,
    actions,
    triggeredRules,
    summary: `${healthy ? '✅' : '⚠️'} ${triggeredRules.length} rules triggered, ${actions.length} actions`,
    evaluatedAt: new Date().toISOString(),
    boardState,
  };
}
