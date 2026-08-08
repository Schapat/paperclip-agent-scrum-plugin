/**
 * Worker Hooks Module
 *
 * Exportiert alle Lifecycle Hooks und Utilities.
 */

// Lifecycle Hooks
export {
  onStatusChange,
  calculateCycleTime,
  formatCycleTime,
  createInitialMetrics,
  recalculateMetrics,
  type BeforeStatusChangeContext,
  type AfterStatusChangeContext,
} from './lifecycle';

// Transition Rules & Validation
export {
  validateTransition,
  getNextStatuses,
  transitionRequiresReason,
  getAutoActions,
  isProgressForward,
  calculateWorkflowProgress,
  TRANSITION_RULES,
  SCRUM_WORKFLOW,
} from './transitions';
