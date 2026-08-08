/**
 * Worker API - Scrum Board API Handlers
 *
 * Dieser Modul enthält API-Handler für Scrum Board Operationen
 * und den Paperclip API Client.
 */

import type { ScrumTask, ScrumSprint, ApiResponse } from '@shared/types';

// =============================================================================
// Paperclip API Client Exports
// =============================================================================

export {
  PaperclipClient,
  PaperclipApiError,
  createClientFromEnv,
  type PaperclipConfig,
  type PaperclipIssue,
  type PaperclipAgent,
  type PaperclipRoutine,
  type PaperclipLabel,
  type IssueStatus,
  type IssuePriority,
  type CreateIssueParams,
  type UpdateIssueParams,
  type IssueComment,
  type AgentStatus,
  type RoutineStatus,
  type RoutineTrigger,
  type CreateRoutineParams,
  type AgentHireRequest,
  type AgentHireResponse,
  type CreateLabelParams,
  type PaginatedResponse,
  type ApiError,
  type Logger,
} from './paperclip-client';

// =============================================================================
// Local API Helpers
// =============================================================================

/**
 * API Response Helper
 */
export function createResponse<T>(success: boolean, data?: T, error?: string): ApiResponse<T> {
  return {
    success,
    data,
    error,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validiert Task-Daten
 */
export function validateTask(task: Partial<ScrumTask>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!task.title || task.title.trim().length === 0) {
    errors.push('Title is required');
  }

  if (task.storyPoints !== undefined && (task.storyPoints < 0 || task.storyPoints > 100)) {
    errors.push('Story points must be between 0 and 100');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validiert Sprint-Daten
 */
export function validateSprint(sprint: Partial<ScrumSprint>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!sprint.name || sprint.name.trim().length === 0) {
    errors.push('Sprint name is required');
  }

  if (!sprint.startDate) {
    errors.push('Start date is required');
  }

  if (!sprint.endDate) {
    errors.push('End date is required');
  }

  if (sprint.startDate && sprint.endDate) {
    const start = new Date(sprint.startDate);
    const end = new Date(sprint.endDate);
    if (start >= end) {
      errors.push('End date must be after start date');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
