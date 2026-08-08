/**
 * Status Transition Rules
 *
 * Definiert erlaubte Status-Transitionen und Validierung.
 * Basiert auf Scrum/Kanban Best Practices.
 */

import type { TaskStatus, StatusTransition, AutoAction } from '@shared/types';

// =============================================================================
// Transition Rules
// =============================================================================

/**
 * Definiert alle erlaubten Status-Transitionen
 */
export const TRANSITION_RULES: StatusTransition[] = [
  // Aus Backlog
  {
    from: 'backlog',
    to: 'todo',
    requiresReason: false,
    autoActions: [{ type: 'log_changelog', action: 'moved' }],
  },
  {
    from: 'backlog',
    to: 'blocked',
    requiresReason: true,
    autoActions: [
      { type: 'log_changelog', action: 'blocked' },
      { type: 'notify', target: 'board' },
    ],
  },

  // Aus Todo
  {
    from: 'todo',
    to: 'in_progress',
    requiresReason: false,
    autoActions: [
      { type: 'set_timestamp', field: 'startedAt' },
      { type: 'log_changelog', action: 'moved' },
      { type: 'notify', target: 'agent' },
    ],
  },
  {
    from: 'todo',
    to: 'backlog',
    requiresReason: false,
    autoActions: [{ type: 'log_changelog', action: 'moved' }],
  },
  {
    from: 'todo',
    to: 'blocked',
    requiresReason: true,
    autoActions: [
      { type: 'log_changelog', action: 'blocked' },
      { type: 'notify', target: 'board' },
    ],
  },

  // Aus In Progress
  {
    from: 'in_progress',
    to: 'in_review',
    requiresReason: false,
    autoActions: [
      { type: 'log_changelog', action: 'moved' },
      { type: 'notify', target: 'board' },
    ],
  },
  {
    from: 'in_progress',
    to: 'blocked',
    requiresReason: true,
    autoActions: [
      { type: 'log_changelog', action: 'blocked' },
      { type: 'notify', target: 'board' },
    ],
  },
  {
    from: 'in_progress',
    to: 'todo',
    requiresReason: true,
    autoActions: [{ type: 'log_changelog', action: 'moved' }],
  },
  // NOTE: in_progress -> done ist NICHT erlaubt!
  // Alle Tasks MÜSSEN durch Review (in_review) gehen.
  // Dies stellt sicher, dass die Business-Regel "Tickets MÜSSEN durch Review" eingehalten wird.

  // Aus In Review
  {
    from: 'in_review',
    to: 'done',
    requiresReason: false,
    autoActions: [
      { type: 'set_timestamp', field: 'completedAt' },
      { type: 'update_metrics' },
      { type: 'update_parent' },
      { type: 'log_changelog', action: 'completed' },
    ],
  },
  {
    from: 'in_review',
    to: 'in_progress',
    requiresReason: true, // Review rejected - Grund erforderlich
    autoActions: [{ type: 'log_changelog', action: 'moved' }],
  },
  {
    from: 'in_review',
    to: 'blocked',
    requiresReason: true,
    autoActions: [
      { type: 'log_changelog', action: 'blocked' },
      { type: 'notify', target: 'board' },
    ],
  },

  // Aus Blocked
  {
    from: 'blocked',
    to: 'todo',
    requiresReason: false,
    autoActions: [
      { type: 'log_changelog', action: 'unblocked' },
      { type: 'notify', target: 'agent' },
    ],
  },
  {
    from: 'blocked',
    to: 'in_progress',
    requiresReason: false,
    autoActions: [
      { type: 'log_changelog', action: 'unblocked' },
      { type: 'notify', target: 'agent' },
    ],
  },
  {
    from: 'blocked',
    to: 'backlog',
    requiresReason: false,
    autoActions: [{ type: 'log_changelog', action: 'moved' }],
  },

  // Aus Done (Reopen)
  {
    from: 'done',
    to: 'in_progress',
    requiresReason: true, // Reopen erfordert Begründung
    autoActions: [{ type: 'log_changelog', action: 'moved' }],
  },
  {
    from: 'done',
    to: 'todo',
    requiresReason: true,
    autoActions: [{ type: 'log_changelog', action: 'moved' }],
  },
];

// =============================================================================
// Validation
// =============================================================================

export interface TransitionValidationResult {
  valid: boolean;
  error?: string;
  transition?: StatusTransition;
}

/**
 * Validiert ob eine Status-Transition erlaubt ist
 */
export function validateTransition(
  from: TaskStatus,
  to: TaskStatus
): TransitionValidationResult {
  // Gleicher Status = keine Transition nötig
  if (from === to) {
    return { valid: true };
  }

  // Transition-Regel finden
  const transition = TRANSITION_RULES.find((t) => t.from === from && t.to === to);

  if (!transition) {
    return {
      valid: false,
      error: `Invalid transition: ${from} -> ${to} is not allowed`,
    };
  }

  return {
    valid: true,
    transition,
  };
}

/**
 * Gibt alle möglichen nächsten Status für einen gegebenen Status zurück
 */
export function getNextStatuses(currentStatus: TaskStatus): TaskStatus[] {
  return TRANSITION_RULES.filter((t) => t.from === currentStatus).map((t) => t.to);
}

/**
 * Prüft ob eine Transition einen Grund erfordert
 */
export function transitionRequiresReason(from: TaskStatus, to: TaskStatus): boolean {
  const transition = TRANSITION_RULES.find((t) => t.from === from && t.to === to);
  return transition?.requiresReason ?? false;
}

/**
 * Gibt die Auto-Actions für eine Transition zurück
 */
export function getAutoActions(from: TaskStatus, to: TaskStatus): AutoAction[] {
  const transition = TRANSITION_RULES.find((t) => t.from === from && t.to === to);
  return transition?.autoActions ?? [];
}

// =============================================================================
// Workflow Templates
// =============================================================================

/**
 * Standard Scrum Workflow
 */
export const SCRUM_WORKFLOW: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
];

/**
 * Prüft ob ein Status im Standard-Workflow "weiter vorne" ist
 */
export function isProgressForward(from: TaskStatus, to: TaskStatus): boolean {
  const fromIndex = SCRUM_WORKFLOW.indexOf(from);
  const toIndex = SCRUM_WORKFLOW.indexOf(to);

  // blocked ist ein Sonderfall
  if (from === 'blocked' || to === 'blocked') {
    return to !== 'blocked'; // Aus blocked raus ist Fortschritt
  }

  return toIndex > fromIndex;
}

/**
 * Berechnet den Workflow-Progress als Prozent (0-100)
 */
export function calculateWorkflowProgress(status: TaskStatus): number {
  if (status === 'blocked') return 0;

  const index = SCRUM_WORKFLOW.indexOf(status);
  if (index === -1) return 0;

  return Math.round((index / (SCRUM_WORKFLOW.length - 1)) * 100);
}
