/**
 * Autonomous Scrum Team Plugin - Worker Entry Point
 *
 * Dieser Worker verwaltet die Backend-Logik des Plugins:
 * - Event-Driven Workflow
 * - Scrum Board State Management
 * - KI-Agent Koordination
 * - Persistenz und Synchronisation
 * - Idle-Detection State Machine (CRITICAL: System must NEVER be idle!)
 */

import type {
  PluginMessage,
  WorkerState,
  ScrumTask,
  ScrumSprint,
  PluginContext,
  TaskStatus,
  ScrumAgent,
  CeremonyType,
  CeremonyRecord,
} from '@shared/types';

import {
  onStatusChange,
  createInitialMetrics,
  recalculateMetrics,
  getNextStatuses,
  formatCycleTime,
} from './hooks';

import {
  runOnboarding,
  loadAgentInstructionsFromFiles,
  createOnboardingLogger,
  type OnboardingContext,
  type OnboardingResult,
} from './onboarding';

import { createClientFromEnv } from './api';

import { createScrumTask } from '@shared/factories';

import { collectDecisions } from './communication';

import { CeremonyTriggerEngine } from './triggers';

import {
  DebouncedSaver,
  clearState,
  detectStorageAdapter,
  restoreState,
} from './storage';

import {
  runSprintPlanning,
  runBacklogRefinement,
  runImpedimentResolution,
  runSprintReview,
  runRetrospective,
  reviewTicket,
  type AgentWorkRequest,
  type CeremonyContext,
  type QaChecklist,
} from './ceremonies';

import {
  createStateMachine,
  evaluateBoardState,
  createActionExecutor,
  type StateMachine,
  type StateMachineAction,
  type StateChangeLog,
  type ActionExecutor,
} from './state-machine';
import { createDefaultSettings } from '@shared/types';

// =============================================================================
// Worker State
// =============================================================================

/**
 * Erzeugt einen leeren Worker-State.
 *
 * Wird beim Start und beim Uninstall verwendet, damit beide Pfade garantiert
 * dieselbe Struktur erzeugen.
 */
function createEmptyState(): WorkerState {
  return {
    initialized: false,
    currentSprint: null,
    tasks: [],
    agents: [],
    settings: createDefaultSettings(),
    metrics: createInitialMetrics(),
    messages: [],
    ceremonies: [],
    completedSprints: [],
    learnings: [],
    skills: [],
    proposedStories: [],
  };
}

let state: WorkerState = createEmptyState();

/** Beim Start erkanntes Storage-Backend (Host-API, localStorage oder Memory). */
const storageAdapter = detectStorageAdapter();

/** Entprellter Writer, damit eine Zeremonie nicht dutzendfach schreibt. */
const saver = new DebouncedSaver(storageAdapter);

let currentAgent: ScrumAgent | null = null;

// State Machine instance for Idle-Detection
let stateMachine: StateMachine | null = null;

// Action Executor for bridging state machine to Paperclip API
let actionExecutor: ActionExecutor | null = null;

// Plugin configuration (set during install)
let pluginConfig: {
  companyId?: string;
  projectId?: string;
} = {};

// =============================================================================
// Plugin Context Factory
// =============================================================================

/**
 * Erstellt den Plugin Context für Hooks
 */
function createPluginContext(): PluginContext {
  return {
    state,
    currentAgent,
    emit: (event: string, data: unknown) => {
      postMessage({ type: event.toUpperCase().replace(/:/g, '_'), payload: data });
    },
    updateState: (updates: Partial<WorkerState>) => {
      state = { ...state, ...updates };
    },
    saveState: async () => {
      await saveState();
    },
  };
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialisiert den Worker und lädt gespeicherte Daten
 */
async function initialize(): Promise<void> {
  console.log('[Worker] Initializing Autonomous Scrum Team Plugin...');

  try {
    // Lade gespeicherte Daten aus dem Plugin Storage
    const savedState = await loadState();
    if (savedState) {
      state = {
        ...state,
        ...savedState,
        initialized: true,
        metrics: savedState.metrics || createInitialMetrics(),
      };
    } else {
      state.initialized = true;
    }

    // Metriken neu berechnen falls nötig
    state.metrics = recalculateMetrics(state);

    // Initialize State Machine for Idle-Detection
    // CRITICAL: System must NEVER be idle!
    initializeStateMachine();

    // Beim Start bewusst ohne Flankenspeicher auswerten: nach einem Neustart
    // soll das Board sofort wieder anlaufen, statt auf die nächste Änderung zu
    // warten (Spec §4 — das System darf nie im Leerlauf stehen).
    notifyStateChanged();

    console.log('[Worker] Initialization complete');
    postMessage({ type: 'WORKER_READY', payload: { state } });
  } catch (error) {
    console.error('[Worker] Initialization failed:', error);
    postMessage({ type: 'WORKER_ERROR', payload: { error: String(error) } });
  }
}

/**
 * Initialisiert die State Machine für Idle-Detection
 */
function initializeStateMachine(): void {
  console.log('[Worker] Initializing State Machine for Idle-Detection...');

  // Initialize Action Executor if we have API access
  initializeActionExecutor();

  stateMachine = createStateMachine(
    // Worker state getter
    () => state,
    // Action executor
    async (action: StateMachineAction) => {
      return executeStateMachineAction(action);
    },
    // Log emitter
    (log: StateChangeLog) => {
      console.log('[StateMachine] State change:', log.changes.map(
        c => `${String(c.field)}: ${c.previousValue} → ${c.currentValue}`
      ).join(', '));

      // Emit to UI for logging/display
      postMessage({
        type: 'STATE_MACHINE_LOG',
        payload: { log },
      });
    },
    // Config - 5 minute polling interval
    {
      pollingIntervalMs: 5 * 60 * 1000,
      notificationsEnabled: state.settings.notificationsEnabled,
    }
  );

  // Start the state machine
  stateMachine.start();
  console.log('[Worker] State Machine started with 5-minute polling interval');
}

/**
 * Initializes the Action Executor for real Paperclip API integration
 */
function initializeActionExecutor(): void {
  try {
    // Check if we have API access
    const apiUrl = process.env.PAPERCLIP_API_URL;
    const apiKey = process.env.PAPERCLIP_API_KEY;
    const companyId = pluginConfig.companyId || process.env.PAPERCLIP_COMPANY_ID;

    if (!apiUrl || !apiKey || !companyId) {
      console.log('[Worker] Paperclip API not configured, running in UI-only mode');
      actionExecutor = null;
      return;
    }

    // Create Paperclip client
    const client = createClientFromEnv();

    // Create action executor
    actionExecutor = createActionExecutor({
      client,
      companyId,
      projectId: pluginConfig.projectId,
      rateLimitWindowMs: 5 * 60 * 1000, // 5 minutes
      maxEventsPerWindow: 1, // 1 event per type per 5 minutes
      onNotification: (notification) => {
        postMessage({
          type: 'NOTIFICATION',
          payload: notification,
        });
      },
      onTriggerEvent: (event) => {
        postMessage({
          type: 'TRIGGER_EVENT',
          payload: event,
        });
      },
    });

    console.log('[Worker] Action Executor initialized with Paperclip API');
  } catch (error) {
    console.warn('[Worker] Failed to initialize Action Executor:', error);
    actionExecutor = null;
  }
}

/**
 * Executes an action generated by the State Machine
 *
 * If ActionExecutor is available (Paperclip API configured), uses it to:
 * - Create real event issues
 * - Notify agents via API
 * - Apply rate-limiting
 *
 * Otherwise, falls back to UI-only notifications.
 */
async function executeStateMachineAction(action: StateMachineAction): Promise<boolean> {
  console.log(`[Worker] Executing State Machine action: ${action.type}`);

  // Zeremonien werden nicht mehr hier ausgelöst: dafür ist der Event-Trigger
  // zuständig, der denselben Board-Zustand auswertet (Spec §4). Die State
  // Machine bleibt für Benachrichtigungen und Eskalationen an die echten
  // KI-Agents verantwortlich — sonst würde dieselbe Zeremonie doppelt laufen.

  // If we have ActionExecutor, use it for real API integration
  if (actionExecutor) {
    try {
      const result = await actionExecutor.execute(action);
      
      if (!result.success) {
        if (result.rateLimited) {
          console.log(`[Worker] Action rate-limited: ${action.type}`);
          postMessage({
            type: 'ACTION_RATE_LIMITED',
            payload: {
              actionType: action.type,
              message: result.error,
            },
          });
          return true; // Rate-limiting is not a failure
        }
        console.error(`[Worker] Action execution failed: ${result.error}`);
        return false;
      }

      // Emit success event with issue info if created
      if (result.issueId) {
        postMessage({
          type: 'EVENT_ISSUE_CREATED',
          payload: {
            actionType: action.type,
            issueId: result.issueId,
            issueIdentifier: result.issueIdentifier,
          },
        });
      }

      return true;
    } catch (error) {
      console.error(`[Worker] ActionExecutor error:`, error);
      // Fall through to UI-only mode
    }
  }

  // Fallback: UI-only mode (no Paperclip API)
  return executeStateMachineActionUIOnly(action);
}

/**
 * UI-only fallback for action execution (no Paperclip API)
 */
async function executeStateMachineActionUIOnly(action: StateMachineAction): Promise<boolean> {
  try {
    switch (action.type) {
      case 'notify_developers':
        postMessage({
          type: 'NOTIFICATION',
          payload: {
            level: action.priority,
            title: action.message,
            body: action.description,
            targetAgentIds: action.targetAgentIds,
            actionType: 'notify_developers',
          },
        });
        break;

      case 'notify_po':
        postMessage({
          type: 'NOTIFICATION',
          payload: {
            level: action.priority,
            title: action.message,
            body: action.description,
            actionType: 'notify_po',
          },
        });
        break;

      case 'notify_scrum_master':
        postMessage({
          type: 'NOTIFICATION',
          payload: {
            level: action.priority,
            title: action.message,
            body: action.description,
            actionType: 'notify_scrum_master',
          },
        });
        break;

      case 'trigger_sprint_planning':
        postMessage({
          type: 'TRIGGER_EVENT',
          payload: {
            event: 'sprint_planning',
            priority: action.priority,
            message: action.message,
            context: action.context,
          },
        });
        break;

      case 'trigger_backlog_refinement':
        postMessage({
          type: 'TRIGGER_EVENT',
          payload: {
            event: 'backlog_refinement',
            priority: action.priority,
            message: action.message,
            context: action.context,
          },
        });
        break;

      case 'trigger_review_request':
        postMessage({
          type: 'TRIGGER_EVENT',
          payload: {
            event: 'review_request',
            priority: action.priority,
            message: action.message,
            context: action.context,
          },
        });
        break;

      case 'auto_assign_task':
        postMessage({
          type: 'AUTO_ASSIGN_SUGGESTED',
          payload: {
            taskId: action.taskId,
            suggestedAgentId: action.assignToAgentId,
            context: action.context,
          },
        });
        break;

      case 'escalate_to_board':
        postMessage({
          type: 'ESCALATION',
          payload: {
            level: action.priority,
            title: action.message,
            body: action.description,
            context: action.context,
          },
        });
        break;

      case 'log_state_change':
        console.log(`[StateMachine] ${action.message}: ${action.description}`);
        break;

      default:
        console.warn(`[Worker] Unknown action type: ${action.type}`);
        return false;
    }

    return true;
  } catch (error) {
    console.error(`[Worker] Failed to execute action ${action.type}:`, error);
    return false;
  }
}

/**
 * Lädt den gespeicherten State aus dem Plugin Storage.
 */
async function loadState(): Promise<Partial<WorkerState> | null> {
  try {
    const restored = await restoreState(storageAdapter);
    if (restored) {
      console.log(`[Worker] State aus "${storageAdapter.name}" wiederhergestellt`);
    }
    return restored;
  } catch (error) {
    // Ein defekter Speicherstand darf den Worker nicht am Start hindern
    console.error('[Worker] State konnte nicht geladen werden:', error);
    return null;
  }
}

/**
 * Speichert den aktuellen State (entprellt).
 */
async function saveState(): Promise<void> {
  saver.schedule(state);
}

/**
 * Schreibt ausstehende Änderungen sofort weg.
 */
async function flushState(): Promise<void> {
  await saver.flush();
}

// =============================================================================
// Sprint Management
// =============================================================================

/**
 * Erstellt einen neuen Sprint
 */
function createSprint(name: string, startDate: Date, endDate: Date, goal?: string): ScrumSprint {
  const sprint: ScrumSprint = {
    id: crypto.randomUUID(),
    name,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    status: 'planned',
    taskIds: [],
    goal: goal ?? null,
    velocity: 0,
    completedPoints: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  state.currentSprint = sprint;

  // Metriken für neuen Sprint zurücksetzen
  state.metrics = createInitialMetrics();

  return sprint;
}

// =============================================================================
// Scrum-Zeremonien (Spec §2)
// =============================================================================

/**
 * Event-Trigger für Zeremonien (Spec §2, §4).
 *
 * Die Auswertung hängt ausschließlich am Board-Zustand und wird nach jeder
 * Zustandsänderung angestoßen — nicht von einem Timer. Agents arbeiten
 * schneller, als ein Zeitplan abbilden könnte.
 */
const triggerEngine = new CeremonyTriggerEngine({
  getState: () => state,
  run: (ceremony, reason) => {
    console.log(`[Trigger] ${ceremony} ausgelöst: ${reason}`);
    postMessage({
      type: 'CEREMONY_TRIGGERED',
      payload: { ceremony, reason },
    });
    runCeremony(ceremony);
  },
});

/**
 * Meldet dem Trigger-System eine Zustandsänderung.
 *
 * Wird nach jeder Mutation des Boards aufgerufen. Die Engine schützt sich
 * selbst gegen Rekursion, sodass auch Zeremonien diese Funktion auslösen
 * dürfen, ohne eine Endlosschleife zu erzeugen.
 */
function notifyStateChanged(): void {
  triggerEngine.evaluate();
}

/**
 * Baut den Kontext für eine Zeremonie.
 *
 * `requestAgentWork` übersetzt die Anforderung inhaltlicher Arbeit in ein
 * Paperclip-Event: existiert eine API-Verbindung, entsteht daraus ein
 * Event-Issue, das der zuständige KI-Agent aufgreift. Ohne API-Verbindung
 * bleibt es bei einer UI-Benachrichtigung.
 */
function createCeremonyContext(): CeremonyContext {
  return {
    state,
    requestAgentWork: (request: AgentWorkRequest) => {
      console.log(
        `[Ceremony] Agent-Arbeit angefordert: ${request.role} (${request.taskIds.length} Ticket(s))`
      );
      postMessage({
        type: 'AGENT_WORK_REQUESTED',
        payload: request,
      });
    },
  };
}

/**
 * Führt eine Zeremonie aus und persistiert den State danach.
 */
function runCeremony(ceremony: CeremonyType): CeremonyRecord | null {
  const ctx = createCeremonyContext();

  let record: CeremonyRecord;
  switch (ceremony) {
    case 'sprint_planning':
      record = runSprintPlanning(ctx);
      break;
    case 'backlog_refinement':
      record = runBacklogRefinement(ctx);
      break;
    case 'impediment_resolution': {
      // Kann null liefern, wenn es nichts aufzulösen gab
      const resolved = runImpedimentResolution(ctx);
      if (!resolved) return null;
      record = resolved;
      break;
    }
    case 'sprint_review':
      record = runSprintReview(ctx);
      break;
    case 'sprint_retrospective':
      record = runRetrospective(ctx);
      break;
    default:
      return null;
  }

  // Zeremonien verschieben Tickets — Metriken danach neu berechnen
  state.metrics = recalculateMetrics(state);

  console.log(`[Ceremony] ${ceremony}: ${record.summary}`);

  if (state.settings.autoSaveEnabled) {
    void saveState();
  }

  return record;
}

// =============================================================================
// Task Management
// =============================================================================

/**
 * Erstellt eine neue Scrum Task
 *
 * Nimmt zusätzlich zu den Pflichtfeldern beliebige weitere Ticket-Felder
 * entgegen, damit der Product Owner Typ/Akzeptanzkriterien direkt mitgeben und
 * der Technical Lead beim Refinement Subtasks anlegen kann.
 */
function createTask(
  title: string,
  description: string,
  storyPoints: number,
  column: TaskStatus,
  parentId?: string,
  priority: ScrumTask['priority'] = 'medium',
  extra: Partial<ScrumTask> = {}
): ScrumTask {
  const task = createScrumTask({
    ...extra,
    title,
    description,
    storyPoints,
    column,
    parentId: parentId ?? null,
    priority,
    sprintId: extra.sprintId ?? state.currentSprint?.id ?? null,
    statusHistory: [
      {
        from: null,
        to: column,
        timestamp: new Date().toISOString(),
        triggeredBy: currentAgent?.id ?? null,
      },
    ],
  });

  state.tasks.push(task);

  if (state.currentSprint) {
    state.currentSprint.taskIds.push(task.id);
  }

  // Metriken aktualisieren
  state.metrics.totalPoints += storyPoints;
  state.metrics.remainingPoints += storyPoints;

  // Changelog Eintrag
  state.metrics.changelog.push({
    id: crypto.randomUUID(),
    taskId: task.id,
    taskTitle: task.title,
    action: 'created',
    description: `Task created with ${storyPoints} story points`,
    timestamp: new Date().toISOString(),
    agentId: currentAgent?.id ?? null,
  });

  return task;
}

/**
 * Verschiebt eine Task in eine andere Spalte (mit Lifecycle Hooks)
 */
async function moveTask(taskId: string, newColumn: TaskStatus): Promise<ScrumTask | null> {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return null;

  const previousColumn = task.column;

  // Wenn gleicher Status, nichts tun
  if (previousColumn === newColumn) {
    return task;
  }

  // Lifecycle Hooks ausführen
  const context = createPluginContext();
  const result = await onStatusChange(task, previousColumn, newColumn, context);

  if (!result.success) {
    console.error(`[Worker] Move task failed: ${result.error}`);
    postMessage({
      type: 'TASK_MOVE_FAILED',
      payload: {
        taskId,
        from: previousColumn,
        to: newColumn,
        error: result.error,
        cancelled: result.cancelled,
      },
    });
    return null;
  }

  // Event senden
  postMessage({
    type: 'TASK_MOVED',
    payload: {
      taskId,
      from: previousColumn,
      to: newColumn,
      task,
      cycleTime: (result.data as { cycleTime?: number })?.cycleTime,
    },
  });

  // Auto-Save wenn aktiviert
  if (state.settings.autoSaveEnabled) {
    await saveState();
  }

  // Das Verschieben kann eine Zeremonie fällig machen — etwa das letzte
  // Sprint-Ticket auf "done" (→ Review) oder ein leer gewordenes TODO
  // (→ Planning).
  notifyStateChanged();

  return task;
}

/**
 * Gibt mögliche nächste Status für eine Task zurück
 */
function getAvailableTransitions(taskId: string): TaskStatus[] {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return [];

  return getNextStatuses(task.column);
}

// =============================================================================
// Agent Management
// =============================================================================

/**
 * Setzt den aktuellen Agent
 */
function setCurrentAgent(agentId: string | null): void {
  if (agentId === null) {
    currentAgent = null;
    return;
  }

  const agent = state.agents.find((a) => a.id === agentId);
  if (agent) {
    currentAgent = agent;
  }
}

/**
 * Weist eine Task einem Agent zu
 */
function assignTask(taskId: string, agentId: string | null): ScrumTask | null {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return null;

  // Vorherigen Agent freigeben
  if (task.assignedAgentId) {
    const prevAgent = state.agents.find((a) => a.id === task.assignedAgentId);
    if (prevAgent && prevAgent.currentTaskId === taskId) {
      prevAgent.status = 'idle';
      prevAgent.currentTaskId = null;
    }
  }

  task.assignedAgentId = agentId;
  task.updatedAt = new Date().toISOString();

  // Neuen Agent Status setzen
  if (agentId) {
    const newAgent = state.agents.find((a) => a.id === agentId);
    if (newAgent) {
      newAgent.currentTaskId = taskId;
    }
  }

  postMessage({
    type: 'TASK_ASSIGNED',
    payload: { taskId, agentId, task },
  });

  return task;
}

// =============================================================================
// Metrics & Reporting
// =============================================================================

/**
 * Gibt aktuelle Sprint-Metriken zurück
 */
function getSprintMetrics(): {
  metrics: typeof state.metrics;
  sprint: ScrumSprint | null;
  formattedCycleTime: string;
} {
  return {
    metrics: state.metrics,
    sprint: state.currentSprint,
    formattedCycleTime: formatCycleTime(state.metrics.averageCycleTime),
  };
}

// =============================================================================
// Message Handler
// =============================================================================

/**
 * Verarbeitet eingehende Nachrichten vom UI
 */
async function handleMessage(event: MessageEvent<PluginMessage>): Promise<void> {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT':
      await initialize();
      break;

    case 'CREATE_SPRINT': {
      const sprint = createSprint(
        payload.name as string,
        new Date(payload.startDate as string),
        new Date(payload.endDate as string),
        payload.goal as string | undefined
      );
      postMessage({ type: 'SPRINT_CREATED', payload: { sprint } });
      break;
    }

    case 'CREATE_TASK': {
      const task = createTask(
        payload.title as string,
        payload.description as string,
        payload.storyPoints as number,
        (payload.column as TaskStatus) || 'backlog',
        payload.parentId as string | undefined,
        payload.priority as ScrumTask['priority'] | undefined,
        {
          type: payload.type as ScrumTask['type'] | undefined,
          labels: payload.labels as string[] | undefined,
          acceptanceCriteria: payload.acceptanceCriteria as
            | ScrumTask['acceptanceCriteria']
            | undefined,
          technicalNotes: payload.technicalNotes as string | null | undefined,
        }
      );
      postMessage({ type: 'TASK_CREATED', payload: { task } });
      // Ein neues Ticket kann den Backlog über das Minimum heben
      notifyStateChanged();
      break;
    }

    case 'MOVE_TASK': {
      const movedTask = await moveTask(payload.taskId as string, payload.newColumn as TaskStatus);
      if (!movedTask) {
        // Error wird bereits von moveTask gesendet
      }
      break;
    }

    case 'ASSIGN_TASK': {
      const assignedTask = assignTask(
        payload.taskId as string,
        (payload.agentId as string) || null
      );
      if (!assignedTask) {
        postMessage({ type: 'ERROR', payload: { message: 'Task not found' } });
      }
      break;
    }

    case 'GET_AVAILABLE_TRANSITIONS': {
      const transitions = getAvailableTransitions(payload.taskId as string);
      postMessage({
        type: 'AVAILABLE_TRANSITIONS',
        payload: { taskId: payload.taskId, transitions },
      });
      break;
    }

    case 'SET_CURRENT_AGENT': {
      setCurrentAgent((payload.agentId as string) || null);
      postMessage({ type: 'CURRENT_AGENT_SET', payload: { agentId: payload.agentId } });
      break;
    }

    case 'GET_STATE':
      postMessage({ type: 'STATE_UPDATE', payload: { state } });
      break;

    case 'GET_METRICS': {
      const metricsData = getSprintMetrics();
      postMessage({ type: 'METRICS_UPDATE', payload: metricsData });
      break;
    }

    case 'SAVE_STATE':
      // Explizites Speichern soll sofort wirken, nicht erst nach der Entprellung
      await flushState();
      postMessage({ type: 'STATE_SAVED', payload: { timestamp: new Date().toISOString() } });
      break;

    case 'RECALCULATE_METRICS':
      state.metrics = recalculateMetrics(state);
      postMessage({ type: 'METRICS_UPDATE', payload: { metrics: state.metrics } });
      break;

    // ==========================================================================
    // Scrum-Zeremonien (Spec §2)
    // ==========================================================================

    case 'RUN_CEREMONY': {
      const ceremony = payload.ceremony as CeremonyType;
      const record = runCeremony(ceremony);
      if (record) {
        postMessage({ type: 'CEREMONY_COMPLETED', payload: { record, state } });
      } else {
        postMessage({
          type: 'ERROR',
          payload: { message: `Unbekannte Zeremonie: ${String(ceremony)}` },
        });
      }
      break;
    }

    case 'REVIEW_TICKET': {
      const result = reviewTicket(state, payload.taskId as string, {
        metCriterionIds: payload.metCriterionIds as string[] | undefined,
        checklist: payload.checklist as Partial<QaChecklist> | undefined,
        notes: payload.notes as string | undefined,
      });

      if (!result) {
        postMessage({
          type: 'ERROR',
          payload: {
            message: 'Review nicht möglich — Ticket unbekannt oder nicht in der Review-Spalte.',
            taskId: payload.taskId,
          },
        });
        break;
      }

      state.metrics = recalculateMetrics(state);
      if (state.settings.autoSaveEnabled) void saveState();

      // Ein bestandenes Review kann das letzte offene Sprint-Ticket schließen
      // und damit das Sprint Review auslösen
      notifyStateChanged();

      postMessage({
        type: 'TICKET_REVIEWED',
        payload: {
          taskId: payload.taskId,
          passed: result.passed,
          column: result.column,
          unmetCriteria: result.unmetCriteria,
          failedChecks: result.failedChecks,
        },
      });
      break;
    }

    case 'GET_CEREMONIES':
      postMessage({
        type: 'CEREMONIES',
        payload: { ceremonies: state.ceremonies },
      });
      break;

    case 'GET_MESSAGES':
      postMessage({
        type: 'MESSAGES',
        payload: {
          messages: state.messages,
          decisions: collectDecisions(state, (payload.limit as number) ?? 100),
        },
      });
      break;

    // ==========================================================================
    // State Machine Commands (Idle-Detection)
    // ==========================================================================

    case 'EVALUATE_BOARD_STATE': {
      // Manual evaluation trigger
      const evalResult = evaluateBoardState(state);
      postMessage({
        type: 'BOARD_STATE_EVALUATED',
        payload: evalResult,
      });
      break;
    }

    case 'GET_STATE_MACHINE_STATUS': {
      if (stateMachine) {
        const machineState = stateMachine.getState();
        postMessage({
          type: 'STATE_MACHINE_STATUS',
          payload: {
            running: machineState.running,
            lastEvaluation: machineState.lastEvaluation,
            lastPollAt: machineState.lastPollAt,
            healthyStreak: machineState.healthyStreak,
            unhealthyStreak: machineState.unhealthyStreak,
            pendingActionsCount: machineState.pendingActions.length,
            executedActionsCount: machineState.executedActions.length,
          },
        });
      } else {
        postMessage({
          type: 'STATE_MACHINE_STATUS',
          payload: { running: false, error: 'State machine not initialized' },
        });
      }
      break;
    }

    case 'START_STATE_MACHINE': {
      if (stateMachine && !stateMachine.getState().running) {
        stateMachine.start();
        postMessage({
          type: 'STATE_MACHINE_STARTED',
          payload: { timestamp: new Date().toISOString() },
        });
      }
      break;
    }

    case 'STOP_STATE_MACHINE': {
      if (stateMachine && stateMachine.getState().running) {
        stateMachine.stop();
        postMessage({
          type: 'STATE_MACHINE_STOPPED',
          payload: { timestamp: new Date().toISOString() },
        });
      }
      break;
    }

    case 'GET_BOARD_STATE': {
      if (stateMachine) {
        const boardState = stateMachine.getBoardState();
        postMessage({
          type: 'BOARD_STATE',
          payload: boardState,
        });
      } else {
        // Fallback: direct evaluation
        const evalResult = evaluateBoardState(state);
        postMessage({
          type: 'BOARD_STATE',
          payload: evalResult.boardState,
        });
      }
      break;
    }

    case 'UPDATE_STATE_MACHINE_CONFIG': {
      if (stateMachine && payload.config) {
        stateMachine.updateConfig(payload.config as Record<string, unknown>);
        postMessage({
          type: 'STATE_MACHINE_CONFIG_UPDATED',
          payload: { config: stateMachine.getState().config },
        });
      }
      break;
    }

    // ==========================================================================
    // Plugin Lifecycle Events
    // ==========================================================================

    case 'PLUGIN_INSTALL': {
      console.log('[Worker] Plugin install triggered, running onboarding...');
      const installResult = await handlePluginInstall(payload);
      postMessage({
        type: 'PLUGIN_INSTALL_COMPLETE',
        payload: installResult,
      });
      break;
    }

    case 'PLUGIN_UNINSTALL': {
      console.log('[Worker] Plugin uninstall triggered');
      await handlePluginUninstall();
      postMessage({
        type: 'PLUGIN_UNINSTALL_COMPLETE',
        payload: { success: true },
      });
      break;
    }

    default:
      console.warn('[Worker] Unknown message type:', type);
  }
}

// =============================================================================
// Plugin Lifecycle Handlers
// =============================================================================

/**
 * Handles plugin installation - creates the Scrum team.
 */
async function handlePluginInstall(payload: Record<string, unknown>): Promise<OnboardingResult> {
  const logger = createOnboardingLogger();

  try {
    // Create Paperclip API client from environment
    const client = createClientFromEnv(logger);

    // Extract configuration from payload
    const companyId = (payload.companyId as string) || process.env.PAPERCLIP_COMPANY_ID || '';
    const projectId = payload.projectId as string | undefined;
    const ceoAgentId = payload.ceoAgentId as string | undefined;
    const agentsBasePath = (payload.agentsBasePath as string) || './agents';
    const adapterType = payload.adapterType as string | undefined;
    const adapterConfig = payload.adapterConfig as Record<string, unknown> | undefined;

    // Store plugin configuration for ActionExecutor
    pluginConfig = {
      companyId,
      projectId,
    };

    // Re-initialize Action Executor with new config
    initializeActionExecutor();

    // Load agent instructions from files
    const agentInstructions = await loadAgentInstructionsFromFiles(
      agentsBasePath,
      async (path: string) => {
        // In a worker environment, we need to fetch the file
        // This would be provided by the plugin host
        const response = await fetch(path);
        if (!response.ok) {
          throw new Error(`Failed to load ${path}: ${response.statusText}`);
        }
        return response.text();
      }
    );

    // Build onboarding context
    const context: OnboardingContext = {
      client,
      companyId,
      projectId,
      ceoAgentId,
      agentInstructions,
      logger,
      adapterType,
      adapterConfig,
    };

    // Run the onboarding process
    const result = await runOnboarding(context);

    // Update local state with created agents
    if (result.success && result.agents.length > 0) {
      state.agents = result.agents.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        status: 'idle' as const,
        currentTaskId: null,
        capabilities: [],
      }));
    }

    return result;
  } catch (error) {
    logger.error('Plugin install failed:', error);
    return {
      success: false,
      agents: [],
      labels: [],
      sprint: null,
      errors: [
        {
          step: 'agent',
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

/**
 * Handles plugin uninstallation - cleanup.
 */
async function handlePluginUninstall(): Promise<void> {
  console.log('[Worker] Cleaning up plugin state...');

  // Stop the state machine if running
  if (stateMachine) {
    console.log('[Worker] Stopping State Machine...');
    stateMachine.stop();
    stateMachine = null;
  }

  // Persistierten State entfernen, damit eine Neuinstallation sauber startet
  try {
    await clearState(storageAdapter);
  } catch (error) {
    console.error('[Worker] Persistierter State konnte nicht gelöscht werden:', error);
  }

  // Reset state
  state = createEmptyState();

  // Note: We don't delete the agents from Paperclip here
  // That decision is left to the board/user

  console.log('[Worker] Plugin cleanup complete');
}

// Event Listener für Nachrichten
self.addEventListener('message', (event: MessageEvent<PluginMessage>) => {
  handleMessage(event).catch((error) => {
    console.error('[Worker] Message handler error:', error);
    postMessage({ type: 'WORKER_ERROR', payload: { error: String(error) } });
  });
});

// Worker ist bereit
console.log('[Worker] Autonomous Scrum Team Worker loaded');
