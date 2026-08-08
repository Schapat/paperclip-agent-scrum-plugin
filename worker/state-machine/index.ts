/**
 * State Machine Module
 *
 * Exports all state machine functionality for the Autonomous Scrum Team Plugin.
 *
 * CRITICAL RULE: The system must NEVER be idle!
 */

// Core State Machine
export { StateMachine, createStateMachine, evaluateBoardState } from './state-machine';

// Action Executor - bridges state machine to real Paperclip API
export {
  ActionExecutor,
  createActionExecutor,
  type ScrumEventType,
  type ActionExecutorConfig,
  type ActionExecutionResult,
  type NotificationTarget,
  type NotificationPayload,
  type TriggerEventPayload,
} from './action-executor';

// Types
export type {
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
  StateRule,
  ActionType,
  ActionPriority,
} from './types';

export { DEFAULT_CONFIG } from './types';

// Rules
export {
  ALL_RULES,
  RULE_NO_DEVELOPMENT,
  RULE_BACKLOG_LOW,
  RULE_BACKLOG_UNREFINED,
  RULE_TODO_EMPTY,
  RULE_REVIEW_EMPTY,
  RULE_BLOCKED_TASKS,
  RULE_LONG_IDLE,
  getRulesByPriority,
  getRuleById,
} from './rules';
