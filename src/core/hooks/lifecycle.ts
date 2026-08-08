/**
 * Ticket Lifecycle Hooks
 *
 * Implementiert automatische Aktionen bei Status-Änderungen:
 * - onStatusChange Hook mit Before/After Logik
 * - Automatische Done-Aktionen (Changelog, Metriken, Velocity)
 * - Cycle-Time Berechnung
 * - Sprint-Progress-Update bei Done
 * - Subtask-Handling (Parent auto-update)
 */

import type {
  ScrumTask,
  TaskStatus,
  PluginContext,
  HookResult,
  StatusHistoryEntry,
  ChangelogEntry,
  SprintMetrics,
  WorkerState,
} from '../types';
import { validateTransition } from './transitions';

// =============================================================================
// Before/After Hook Types
// =============================================================================

export interface BeforeStatusChangeContext {
  task: ScrumTask;
  from: TaskStatus;
  to: TaskStatus;
  context: PluginContext;
  /** Setze auf true um die Transition zu blockieren */
  cancel: boolean;
  /** Grund für Blockierung */
  cancelReason?: string;
}

export interface AfterStatusChangeContext {
  task: ScrumTask;
  from: TaskStatus;
  to: TaskStatus;
  context: PluginContext;
  /** Cycle Time in Millisekunden (nur bei done) */
  cycleTime?: number;
}

// =============================================================================
// Main Status Change Hook
// =============================================================================

/**
 * Haupteinstiegspunkt für Status-Änderungen.
 * Führt Before-Hooks, Validation, Mutation und After-Hooks aus.
 */
export async function onStatusChange(
  task: ScrumTask,
  from: TaskStatus,
  to: TaskStatus,
  context: PluginContext
): Promise<HookResult> {
  console.log(`[Lifecycle] Status change: ${task.id} ${from} -> ${to}`);

  // 1. Before Hooks ausführen
  const beforeContext: BeforeStatusChangeContext = {
    task,
    from,
    to,
    context,
    cancel: false,
  };

  await runBeforeHooks(beforeContext);

  if (beforeContext.cancel) {
    console.log(`[Lifecycle] Transition cancelled: ${beforeContext.cancelReason}`);
    return {
      success: false,
      cancelled: true,
      error: beforeContext.cancelReason || 'Transition was cancelled by a hook',
    };
  }

  // 2. Transition validieren
  const validation = validateTransition(from, to);
  if (!validation.valid) {
    console.log(`[Lifecycle] Invalid transition: ${validation.error}`);
    return {
      success: false,
      error: validation.error,
    };
  }

  // 3. Status-Mutation durchführen
  const previousColumn = task.column;
  task.column = to;
  task.updatedAt = new Date().toISOString();

  // Status-History aktualisieren
  const historyEntry: StatusHistoryEntry = {
    from: previousColumn,
    to,
    timestamp: new Date().toISOString(),
    triggeredBy: context.currentAgent?.id ?? null,
  };
  task.statusHistory = task.statusHistory || [];
  task.statusHistory.push(historyEntry);

  // 4. Status-spezifische Timestamps setzen
  if (to === 'in_progress' && !task.startedAt) {
    task.startedAt = new Date().toISOString();
    console.log(`[Lifecycle] Task ${task.id} started at ${task.startedAt}`);
  }

  if (to === 'done' && !task.completedAt) {
    task.completedAt = new Date().toISOString();
    console.log(`[Lifecycle] Task ${task.id} completed at ${task.completedAt}`);
  }

  // 5. After Hooks ausführen
  const afterContext: AfterStatusChangeContext = {
    task,
    from,
    to,
    context,
  };

  // Cycle Time berechnen wenn done
  if (to === 'done' && task.startedAt) {
    afterContext.cycleTime = calculateCycleTime(task);
  }

  await runAfterHooks(afterContext);

  // 6. Event emittieren
  context.emit('task:status_changed', {
    taskId: task.id,
    from,
    to,
    cycleTime: afterContext.cycleTime,
  });

  return {
    success: true,
    data: {
      task,
      cycleTime: afterContext.cycleTime,
    },
  };
}

// =============================================================================
// Before Hooks
// =============================================================================

/**
 * Führt alle Before-Hooks aus
 */
async function runBeforeHooks(context: BeforeStatusChangeContext): Promise<void> {
  // Hook: Blocked-Check
  await beforeBlockedCheck(context);
  if (context.cancel) return;

  // Hook: Sprint-Zugehörigkeit prüfen
  await beforeSprintCheck(context);
  if (context.cancel) return;

  // Hook: Agent-Verfügbarkeit prüfen (bei in_progress)
  await beforeAgentCheck(context);
}

/**
 * Prüft ob Task aus blocked-Status heraus darf
 */
async function beforeBlockedCheck(context: BeforeStatusChangeContext): Promise<void> {
  if (context.from === 'blocked' && context.to !== 'blocked') {
    // Optional: Prüfen ob Blocker gelöst wurde
    // Kann für spätere Implementierung erweitert werden
    console.log(`[Lifecycle:Before] Task ${context.task.id} wird aus blocked-Status bewegt`);
  }
}

/**
 * Prüft Sprint-Zugehörigkeit bei bestimmten Transitions
 */
async function beforeSprintCheck(context: BeforeStatusChangeContext): Promise<void> {
  const { task, to, context: pluginContext } = context;

  // Wenn Task in in_progress geht, sollte sie einem Sprint zugeordnet sein
  if (to === 'in_progress' && !task.sprintId) {
    // Warnung loggen, aber nicht blockieren
    console.warn(`[Lifecycle:Before] Task ${task.id} hat keinen Sprint zugeordnet`);

    // Optional: Zum aktuellen Sprint hinzufügen
    if (pluginContext.state.currentSprint) {
      task.sprintId = pluginContext.state.currentSprint.id;
      pluginContext.state.currentSprint.taskIds.push(task.id);
      console.log(`[Lifecycle:Before] Task ${task.id} zum aktuellen Sprint hinzugefügt`);
    }
  }
}

/**
 * Prüft Agent-Verfügbarkeit
 */
async function beforeAgentCheck(context: BeforeStatusChangeContext): Promise<void> {
  const { task, to, context: pluginContext } = context;

  if (to === 'in_progress' && task.assignedAgentId) {
    const agent = pluginContext.state.agents.find((a) => a.id === task.assignedAgentId);
    if (agent && agent.status === 'working' && agent.currentTaskId !== task.id) {
      console.warn(
        `[Lifecycle:Before] Agent ${agent.name} arbeitet bereits an Task ${agent.currentTaskId}`
      );
      // Nicht blockieren, nur warnen - Multi-Tasking erlauben
    }
  }
}

// =============================================================================
// After Hooks
// =============================================================================

/**
 * Führt alle After-Hooks aus
 */
async function runAfterHooks(context: AfterStatusChangeContext): Promise<void> {
  // Hook: Changelog aktualisieren
  await afterUpdateChangelog(context);

  // Hook: Done-spezifische Aktionen
  if (context.to === 'done') {
    await onTicketDone(context);
  }

  // Hook: Parent-Task aktualisieren
  await afterUpdateParent(context);

  // Hook: Agent-Status aktualisieren
  await afterUpdateAgentStatus(context);
}

/**
 * Aktualisiert den Changelog
 */
async function afterUpdateChangelog(context: AfterStatusChangeContext): Promise<void> {
  const { task, from, to, context: pluginContext } = context;

  const action = mapStatusToChangelogAction(from, to);

  const entry: ChangelogEntry = {
    id: crypto.randomUUID(),
    taskId: task.id,
    taskTitle: task.title,
    action,
    description: `Status changed from ${from} to ${to}`,
    timestamp: new Date().toISOString(),
    agentId: pluginContext.currentAgent?.id ?? null,
  };

  // Changelog zu Metriken hinzufügen
  if (!pluginContext.state.metrics.changelog) {
    pluginContext.state.metrics.changelog = [];
  }
  pluginContext.state.metrics.changelog.push(entry);

  // Auf max 1000 Einträge begrenzen
  if (pluginContext.state.metrics.changelog.length > 1000) {
    pluginContext.state.metrics.changelog = pluginContext.state.metrics.changelog.slice(-1000);
  }

  console.log(`[Lifecycle:After] Changelog updated: ${entry.action} for ${task.id}`);
}

/**
 * Mappt Status-Transition auf Changelog-Action
 */
function mapStatusToChangelogAction(
  from: TaskStatus,
  to: TaskStatus
): ChangelogEntry['action'] {
  if (to === 'done') return 'completed';
  if (to === 'blocked') return 'blocked';
  if (from === 'blocked') return 'unblocked';
  return 'moved';
}

/**
 * Aktionen wenn ein Ticket auf Done gesetzt wird
 */
async function onTicketDone(context: AfterStatusChangeContext): Promise<void> {
  const { task, cycleTime, context: pluginContext } = context;

  console.log(`[Lifecycle:After] Ticket Done: ${task.id}`);

  // 1. Metriken aktualisieren
  await updateMetricsOnDone(task, cycleTime, pluginContext);

  // 2. Sprint-Progress aktualisieren
  await updateSprintProgress(task, pluginContext);

  // 3. Velocity aktualisieren
  await updateVelocity(task.storyPoints, pluginContext);

  // 4. Burndown aktualisieren
  await updateBurndown(pluginContext);

  // 5. Event emittieren für UI
  pluginContext.emit('task:done', {
    taskId: task.id,
    storyPoints: task.storyPoints,
    cycleTime,
  });
}

/**
 * Aktualisiert Metriken bei Done
 */
async function updateMetricsOnDone(
  task: ScrumTask,
  cycleTime: number | undefined,
  context: PluginContext
): Promise<void> {
  const metrics = context.state.metrics;

  // Completed Points erhöhen
  metrics.completedPoints += task.storyPoints;
  metrics.remainingPoints = Math.max(0, metrics.totalPoints - metrics.completedPoints);

  // Cycle Time Durchschnitt berechnen
  if (cycleTime !== undefined) {
    recordCycleTime(cycleTime, context);
  }

  console.log(
    `[Lifecycle:Metrics] Completed: ${metrics.completedPoints}/${metrics.totalPoints} points`
  );
}

/**
 * Aktualisiert Sprint-Progress
 */
async function updateSprintProgress(task: ScrumTask, context: PluginContext): Promise<void> {
  const sprint = context.state.currentSprint;
  if (!sprint || task.sprintId !== sprint.id) return;

  sprint.completedPoints += task.storyPoints;
  sprint.updatedAt = new Date().toISOString();

  console.log(`[Lifecycle:Sprint] Progress: ${sprint.completedPoints} points completed`);

  context.emit('sprint:progress', {
    sprintId: sprint.id,
    completedPoints: sprint.completedPoints,
  });
}

/**
 * Aktualisiert die Team-Velocity
 */
async function updateVelocity(_storyPoints: number, context: PluginContext): Promise<void> {
  const sprint = context.state.currentSprint;
  if (!sprint) return;

  // Velocity ist die Summe der abgeschlossenen Story Points im Sprint
  sprint.velocity = sprint.completedPoints;
  context.state.metrics.velocity = sprint.velocity;

  console.log(`[Lifecycle:Velocity] Updated to ${sprint.velocity}`);
}

/**
 * Aktualisiert das Burndown Chart
 */
async function updateBurndown(context: PluginContext): Promise<void> {
  const metrics = context.state.metrics;
  const today = new Date().toISOString().split('T')[0];

  // Prüfen ob bereits ein Eintrag für heute existiert
  const existingEntry = metrics.burndownData.find((e) => e.date === today);

  if (existingEntry) {
    existingEntry.remainingPoints = metrics.remainingPoints;
  } else {
    // Ideale Linie berechnen
    const sprint = context.state.currentSprint;
    let idealRemaining = metrics.remainingPoints;

    if (sprint) {
      const startDate = new Date(sprint.startDate);
      const endDate = new Date(sprint.endDate);
      const todayDate = new Date(today);

      const totalDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const daysPassed = Math.ceil(
        (todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const dailyRate = metrics.totalPoints / totalDays;
      idealRemaining = Math.max(0, metrics.totalPoints - dailyRate * daysPassed);
    }

    metrics.burndownData.push({
      date: today,
      remainingPoints: metrics.remainingPoints,
      idealRemaining: Math.round(idealRemaining * 10) / 10,
    });
  }

  // Auf letzte 30 Tage begrenzen
  if (metrics.burndownData.length > 30) {
    metrics.burndownData = metrics.burndownData.slice(-30);
  }

  console.log(`[Lifecycle:Burndown] Updated for ${today}`);
}

/**
 * Aktualisiert den Parent-Task Status wenn alle Subtasks done sind
 */
async function afterUpdateParent(context: AfterStatusChangeContext): Promise<void> {
  const { task, to, context: pluginContext } = context;

  if (!task.parentId) return;

  const parentTask = pluginContext.state.tasks.find((t) => t.id === task.parentId);
  if (!parentTask) return;

  // Alle Subtasks des Parents finden
  const subtasks = pluginContext.state.tasks.filter((t) => t.parentId === task.parentId);

  if (to === 'done') {
    // Prüfen ob alle Subtasks done sind
    const allDone = subtasks.every((t) => t.column === 'done');

    if (allDone && parentTask.column !== 'done') {
      console.log(
        `[Lifecycle:Parent] All subtasks done, updating parent ${parentTask.id} to in_review`
      );

      // Parent auf in_review setzen (nicht direkt done - Scrum Master sollte prüfen)
      await onStatusChange(parentTask, parentTask.column, 'in_review', pluginContext);

      pluginContext.emit('parent:subtasks_complete', {
        parentId: parentTask.id,
        subtaskCount: subtasks.length,
      });
    }
  }

  // Berechne Progress des Parents basierend auf Subtasks
  const doneSubtasks = subtasks.filter((t) => t.column === 'done').length;
  const progress = subtasks.length > 0 ? Math.round((doneSubtasks / subtasks.length) * 100) : 0;

  pluginContext.emit('parent:progress', {
    parentId: parentTask.id,
    progress,
    doneSubtasks,
    totalSubtasks: subtasks.length,
  });
}

/**
 * Aktualisiert den Agent-Status
 */
async function afterUpdateAgentStatus(context: AfterStatusChangeContext): Promise<void> {
  const { task, to, context: pluginContext } = context;

  if (!task.assignedAgentId) return;

  const agent = pluginContext.state.agents.find((a) => a.id === task.assignedAgentId);
  if (!agent) return;

  if (to === 'in_progress') {
    agent.status = 'working';
    agent.currentTaskId = task.id;
    console.log(`[Lifecycle:Agent] ${agent.name} is now working on ${task.id}`);
  } else if (to === 'done' || to === 'blocked') {
    if (agent.currentTaskId === task.id) {
      agent.status = 'idle';
      agent.currentTaskId = null;
      console.log(`[Lifecycle:Agent] ${agent.name} is now idle`);
    }
  }
}

// =============================================================================
// Cycle Time Calculation
// =============================================================================

/**
 * Berechnet die Cycle Time für einen Task (in Millisekunden)
 * Cycle Time = Zeit von in_progress bis done
 */
export function calculateCycleTime(task: ScrumTask): number {
  if (!task.startedAt || !task.completedAt) {
    return 0;
  }

  const started = new Date(task.startedAt).getTime();
  const completed = new Date(task.completedAt).getTime();

  return completed - started;
}

/**
 * Formatiert Cycle Time für Anzeige
 */
export function formatCycleTime(milliseconds: number): string {
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }

  return `${hours}h ${minutes}m`;
}

/**
 * Zeichnet Cycle Time auf und berechnet Durchschnitt
 */
function recordCycleTime(cycleTime: number, context: PluginContext): void {
  const metrics = context.state.metrics;

  // Simple rolling average - in Produktion würde man hier mehr Datenpunkte speichern
  if (metrics.averageCycleTime === 0) {
    metrics.averageCycleTime = cycleTime;
  } else {
    // Weighted moving average (neue Werte haben mehr Gewicht)
    metrics.averageCycleTime = metrics.averageCycleTime * 0.7 + cycleTime * 0.3;
  }

  console.log(
    `[Lifecycle:CycleTime] Recorded: ${formatCycleTime(cycleTime)}, Average: ${formatCycleTime(metrics.averageCycleTime)}`
  );
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Initialisiert leere Metriken
 */
export function createInitialMetrics(): SprintMetrics {
  return {
    totalPoints: 0,
    completedPoints: 0,
    remainingPoints: 0,
    averageCycleTime: 0,
    velocity: 0,
    burndownData: [],
    changelog: [],
  };
}

/**
 * Berechnet Metriken aus dem aktuellen State
 */
export function recalculateMetrics(state: WorkerState): SprintMetrics {
  const tasks = state.tasks;
  const sprint = state.currentSprint;

  const sprintTasks = sprint ? tasks.filter((t) => t.sprintId === sprint.id) : tasks;

  const totalPoints = sprintTasks.reduce((sum, t) => sum + t.storyPoints, 0);
  const completedPoints = sprintTasks
    .filter((t) => t.column === 'done')
    .reduce((sum, t) => sum + t.storyPoints, 0);

  return {
    ...state.metrics,
    totalPoints,
    completedPoints,
    remainingPoints: totalPoints - completedPoints,
  };
}
