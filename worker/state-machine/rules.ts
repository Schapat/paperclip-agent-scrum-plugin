/**
 * State Machine Rules
 *
 * Defines the rules that prevent the board from entering an idle state.
 *
 * CRITICAL RULE: The system must NEVER be idle!
 *
 * Rules are evaluated in priority order and generate actions to keep
 * the development workflow moving continuously.
 */

import type { StateRule, BoardState, StateMachineAction, ActionPriority } from './types';

// =============================================================================
// Helper Functions
// =============================================================================

function createAction(
  type: StateMachineAction['type'],
  priority: ActionPriority,
  message: string,
  description: string,
  extras?: Partial<StateMachineAction>
): StateMachineAction {
  return {
    id: crypto.randomUUID(),
    type,
    priority,
    message,
    description,
    createdAt: new Date().toISOString(),
    ...extras,
  };
}

// =============================================================================
// Core Rules - Prevent Idle State
// =============================================================================

/**
 * Rule 1: No Development Ticket
 *
 * If no tasks are in development (inProgress === 0):
 * - If TODO has tasks -> Notify developers to pick up work
 * - If TODO is empty but Backlog has tasks -> Trigger Sprint Planning
 * - If both empty -> Trigger Backlog Refinement
 *
 * CRITICAL: This is the most important rule. Developers must always have work.
 */
export const RULE_NO_DEVELOPMENT: StateRule = {
  id: 'no-development',
  name: 'Keine aktive Entwicklung',
  description: 'Erkennt wenn keine Tasks in Entwicklung sind und niemand arbeitet',
  priority: 'critical',
  condition: (state: BoardState) => {
    // Nur triggern wenn WIRKLICH keine Entwicklung UND idle Devs
    return state.inProgress === 0 && state.idleDevelopers.length > 0;
  },
  actions: (state: BoardState): StateMachineAction[] => {
    const actions: StateMachineAction[] = [];

    if (state.todo > 0) {
      // Arbeit ist verfügbar - Entwickler benachrichtigen
      actions.push(
        createAction(
          'notify_developers',
          'critical',
          '⚠️ LEERLAUF: Entwickler ohne Tasks!',
          `${state.idleDevelopers.length} Entwickler sind idle, aber ${state.todo} Tasks warten in TODO. ` +
            `Bitte sofort Tasks aufnehmen!`,
          {
            targetAgentIds: state.idleDevelopers.map((d) => d.id),
            context: {
              availableTasks: state.todo,
              idleCount: state.idleDevelopers.length,
            },
          }
        )
      );

      // Optional: Auto-Assign wenn aktiviert
      if (state.idleDevelopers.length > 0) {
        actions.push(
          createAction(
            'auto_assign_task',
            'high',
            'Auto-Assignment möglich',
            `${state.idleDevelopers.length} idle Entwickler könnten automatisch zugewiesen werden`,
            {
              context: {
                idleDevelopers: state.idleDevelopers,
                availableTodoTasks: state.todo,
              },
            }
          )
        );
      }
    } else if (state.backlog > 0) {
      // TODO ist leer, aber Backlog hat Tasks -> Sprint Planning nötig
      actions.push(
        createAction(
          'trigger_sprint_planning',
          'critical',
          '🗓️ Sprint Planning erforderlich!',
          `TODO-Spalte ist leer, aber ${state.backlog} Tasks sind im Backlog. ` +
            `Sprint Planning muss sofort durchgeführt werden!`,
          {
            event: 'sprint_planning',
            context: {
              backlogSize: state.backlog,
              backlogPoints: state.backlogPoints,
            },
          }
        )
      );
    } else {
      // Alles leer -> Backlog Refinement dringend nötig
      actions.push(
        createAction(
          'trigger_backlog_refinement',
          'critical',
          '🚨 KRITISCH: Kein Backlog!',
          'Backlog UND TODO sind leer! Backlog Refinement muss SOFORT durchgeführt werden, ' +
            'um neue Arbeit zu definieren.',
          {
            event: 'backlog_refinement',
          }
        )
      );

      actions.push(
        createAction(
          'notify_po',
          'critical',
          'Product Owner: Backlog leer!',
          'Dringend neue User Stories / Features definieren.',
          {
            context: { urgency: 'critical' },
          }
        )
      );
    }

    return actions;
  },
};

/**
 * Rule 2: Backlog Running Low
 *
 * If backlog has fewer than 5 refined items, we need more work
 * in the pipeline to prevent future stalls.
 */
export const RULE_BACKLOG_LOW: StateRule = {
  id: 'backlog-low',
  name: 'Backlog zu klein',
  description: 'Erkennt wenn der Backlog unter die Mindestgröße fällt',
  priority: 'high',
  condition: (state: BoardState) => {
    return state.backlog < 5;
  },
  actions: (state: BoardState): StateMachineAction[] => {
    const deficit = 5 - state.backlog;

    return [
      createAction(
        'notify_po',
        'high',
        '📋 Backlog aufstocken!',
        `Nur noch ${state.backlog} Tasks im Backlog (Minimum: 5). ` +
          `${deficit} weitere Tasks müssen hinzugefügt werden.`,
        {
          context: {
            currentBacklog: state.backlog,
            minimum: 5,
            deficit,
          },
        }
      ),
      createAction(
        'trigger_backlog_refinement',
        'medium',
        'Backlog Refinement einplanen',
        `Refinement Session empfohlen um ${deficit} neue Tasks zu erstellen.`,
        {
          event: 'backlog_refinement',
        }
      ),
    ];
  },
};

/**
 * Rule 3: Backlog Unrefined
 *
 * If backlog has items but they're all unrefined,
 * they can't be pulled into a sprint.
 */
export const RULE_BACKLOG_UNREFINED: StateRule = {
  id: 'backlog-unrefined',
  name: 'Backlog nicht refined',
  description: 'Erkennt wenn Backlog-Items nicht für Sprint ready sind',
  priority: 'high',
  condition: (state: BoardState) => {
    // Backlog hat Items, aber nichts ist refined
    return state.backlog >= 5 && state.backlogRefined === 0;
  },
  actions: (state: BoardState): StateMachineAction[] => {
    return [
      createAction(
        'notify_scrum_master',
        'high',
        '🔧 Backlog Refinement dringend!',
        `${state.backlog} Tasks im Backlog, aber KEINE sind refined! ` +
          `Tech Lead muss Refinement durchführen.`,
        {
          context: {
            unrefinedCount: state.backlog,
            refinedCount: state.backlogRefined,
          },
        }
      ),
      createAction(
        'trigger_backlog_refinement',
        'high',
        'Sofortiges Refinement starten',
        'Alle Backlog-Items müssen refined werden bevor der nächste Sprint starten kann.',
        {
          event: 'backlog_refinement',
        }
      ),
    ];
  },
};

/**
 * Rule 4: TODO Empty with Backlog Available
 *
 * If TODO is empty but backlog has refined items,
 * Sprint Planning needs to happen.
 */
export const RULE_TODO_EMPTY: StateRule = {
  id: 'todo-empty',
  name: 'TODO leer',
  description: 'Erkennt wenn TODO leer ist aber Arbeit im Backlog wartet',
  priority: 'high',
  condition: (state: BoardState) => {
    // TODO ist leer, aber Backlog hat refined Items
    return state.todo === 0 && state.backlog > 0 && state.backlogRefined > 0;
  },
  actions: (state: BoardState): StateMachineAction[] => {
    return [
      createAction(
        'trigger_sprint_planning',
        'high',
        '🗓️ Sprint Planning starten!',
        `TODO ist leer, aber ${state.backlogRefined} refined Tasks warten im Backlog. ` +
          `Sprint Planning durchführen um Arbeit in den Sprint zu ziehen.`,
        {
          event: 'sprint_planning',
          context: {
            readyForSprint: state.backlogRefined,
            totalBacklog: state.backlog,
            backlogPoints: state.backlogPoints,
          },
        }
      ),
    ];
  },
};

/**
 * Rule 5: Review Queue Empty (Normal State)
 *
 * If nothing is in review but there are tasks in development,
 * this is a NORMAL state - QA is waiting for work.
 * We log this for transparency but don't trigger actions.
 */
export const RULE_REVIEW_EMPTY: StateRule = {
  id: 'review-empty',
  name: 'Review-Queue leer',
  description: 'Keine Tasks in Review (QA wartet)',
  priority: 'low',
  condition: (state: BoardState) => {
    return state.inReview === 0 && state.inProgress > 0;
  },
  actions: (state: BoardState): StateMachineAction[] => {
    // Dies ist ein normaler Zustand - nur loggen zur Transparenz
    return [
      createAction(
        'log_state_change',
        'low',
        '✅ Normal: QA wartet auf Review',
        `${state.inProgress} Tasks in Entwicklung, QA wartet auf abgeschlossene Arbeit. ` +
          `Dies ist ein normaler Workflow-Zustand.`,
        {
          context: {
            inProgress: state.inProgress,
            normalState: true,
          },
        }
      ),
    ];
  },
};

/**
 * Rule 6: Blocked Tasks
 *
 * Alert when tasks are blocked - these need attention.
 */
export const RULE_BLOCKED_TASKS: StateRule = {
  id: 'blocked-tasks',
  name: 'Blockierte Tasks',
  description: 'Erkennt wenn Tasks blockiert sind',
  priority: 'high',
  condition: (state: BoardState) => {
    return state.blocked > 0;
  },
  actions: (state: BoardState): StateMachineAction[] => {
    return [
      createAction(
        'notify_scrum_master',
        'high',
        `🚫 ${state.blocked} Task(s) blockiert!`,
        `${state.blocked} Tasks sind blockiert und benötigen Aufmerksamkeit. ` +
          `Scrum Master / Tech Lead sollte Blocker analysieren und entfernen.`,
        {
          context: {
            blockedCount: state.blocked,
          },
        }
      ),
    ];
  },
};

/**
 * Rule 7: Long Idle Developers
 *
 * Alert when developers have been idle for too long.
 */
export const RULE_LONG_IDLE: StateRule = {
  id: 'long-idle',
  name: 'Lange Leerlaufzeit',
  description: 'Erkennt Entwickler die zu lange idle sind',
  priority: 'medium',
  condition: (state: BoardState) => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    return state.idleDevelopers.some((dev) => dev.idleSince < thirtyMinutesAgo);
  },
  actions: (state: BoardState): StateMachineAction[] => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const longIdleDevs = state.idleDevelopers.filter(
      (dev) => dev.idleSince < thirtyMinutesAgo
    );

    return [
      createAction(
        'escalate_to_board',
        'medium',
        `⏰ ${longIdleDevs.length} Entwickler lange idle`,
        `Folgende Entwickler sind seit über 30 Minuten ohne Task: ` +
          longIdleDevs.map((d) => d.name).join(', '),
        {
          targetAgentIds: longIdleDevs.map((d) => d.id),
          context: {
            longIdleDevelopers: longIdleDevs,
            todoAvailable: state.todo,
          },
        }
      ),
    ];
  },
};

// =============================================================================
// All Rules
// =============================================================================

/**
 * All state machine rules in priority order
 */
export const ALL_RULES: StateRule[] = [
  RULE_NO_DEVELOPMENT, // Critical - most important
  RULE_BACKLOG_LOW,
  RULE_BACKLOG_UNREFINED,
  RULE_TODO_EMPTY,
  RULE_BLOCKED_TASKS,
  RULE_LONG_IDLE,
  RULE_REVIEW_EMPTY, // Low priority - informational
];

/**
 * Gets rules by priority
 */
export function getRulesByPriority(priority: ActionPriority): StateRule[] {
  return ALL_RULES.filter((rule) => rule.priority === priority);
}

/**
 * Gets a rule by ID
 */
export function getRuleById(id: string): StateRule | undefined {
  return ALL_RULES.find((rule) => rule.id === id);
}
