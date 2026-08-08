/**
 * Action Executor Tests
 *
 * Tests for the ActionExecutor that bridges State Machine actions to Paperclip API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ActionExecutor,
  createActionExecutor,
} from '../action-executor';
import type { StateMachineAction } from '../types';
import type { PaperclipClient, PaperclipIssue } from '../../api/paperclip-client';

// =============================================================================
// Test Helpers
// =============================================================================

function createMockClient(): PaperclipClient {
  return {
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    getIssue: vi.fn(),
    listIssues: vi.fn(),
    checkoutIssue: vi.fn(),
    releaseIssue: vi.fn(),
    addComment: vi.fn(),
    listComments: vi.fn(),
    getComment: vi.fn(),
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    getMe: vi.fn(),
    createAgentHire: vi.fn(),
    updateAgent: vi.fn(),
    listLabels: vi.fn(),
    createLabel: vi.fn(),
    deleteLabel: vi.fn(),
    listRoutines: vi.fn(),
    getRoutine: vi.fn(),
    createRoutine: vi.fn(),
    updateRoutineStatus: vi.fn(),
    deleteRoutine: vi.fn(),
    getInbox: vi.fn(),
    getDashboard: vi.fn(),
  } as unknown as PaperclipClient;
}

function createMockAction(
  type: StateMachineAction['type'],
  overrides?: Partial<StateMachineAction>
): StateMachineAction {
  return {
    id: `action-${Date.now()}`,
    type,
    priority: 'high',
    message: `Test message for ${type}`,
    description: `Test description for ${type}`,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockIssue(identifier: string): PaperclipIssue {
  return {
    id: `issue-${identifier}`,
    identifier,
    title: 'Test Issue',
    description: 'Test Description',
    status: 'todo',
    priority: 'high',
    assigneeAgentId: null,
    assigneeUserId: null,
    projectId: null,
    parentId: null,
    goalId: null,
    labels: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ActionExecutor', () => {
  let mockClient: PaperclipClient;
  let onNotification: ReturnType<typeof vi.fn>;
  let onTriggerEvent: ReturnType<typeof vi.fn>;
  let executor: ActionExecutor;

  beforeEach(() => {
    mockClient = createMockClient();
    onNotification = vi.fn();
    onTriggerEvent = vi.fn();

    executor = createActionExecutor({
      client: mockClient,
      companyId: 'test-company',
      projectId: 'test-project',
      rateLimitWindowMs: 60000, // 1 minute for testing
      maxEventsPerWindow: 1,
      onNotification,
      onTriggerEvent,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Event Triggering Tests
  // ===========================================================================

  describe('Event Triggering', () => {
    it('should create a sprint_planning issue when triggered', async () => {
      const mockIssue = createMockIssue('TST-1');
      vi.mocked(mockClient.createIssue).mockResolvedValue(mockIssue);

      const action = createMockAction('trigger_sprint_planning', {
        event: 'sprint_planning',
        context: {
          backlogSize: 10,
          backlogPoints: 50,
        },
      });

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(result.issueId).toBe(mockIssue.id);
      expect(result.issueIdentifier).toBe(mockIssue.identifier);

      expect(mockClient.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Sprint Planning'),
          status: 'todo',
          priority: 'high',
          projectId: 'test-project',
        })
      );
    });

    it('should create a backlog_refinement issue when triggered', async () => {
      const mockIssue = createMockIssue('TST-2');
      vi.mocked(mockClient.createIssue).mockResolvedValue(mockIssue);

      const action = createMockAction('trigger_backlog_refinement', {
        event: 'backlog_refinement',
        context: {
          unrefinedCount: 5,
        },
      });

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(mockClient.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Backlog Refinement'),
        })
      );
    });

    it('should create a review_request issue when triggered', async () => {
      const mockIssue = createMockIssue('TST-3');
      vi.mocked(mockClient.createIssue).mockResolvedValue(mockIssue);

      const action = createMockAction('trigger_review_request', {
        event: 'review_request',
      });

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(mockClient.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Code Review'),
        })
      );
    });

    it('should emit trigger event callback on success', async () => {
      const mockIssue = createMockIssue('TST-4');
      vi.mocked(mockClient.createIssue).mockResolvedValue(mockIssue);

      const action = createMockAction('trigger_sprint_planning');
      await executor.execute(action);

      expect(onTriggerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'sprint_planning',
          issueId: mockIssue.id,
          issueIdentifier: mockIssue.identifier,
        })
      );
    });
  });

  // ===========================================================================
  // Rate Limiting Tests
  // ===========================================================================

  describe('Rate Limiting', () => {
    it('should rate-limit duplicate events within window', async () => {
      const mockIssue = createMockIssue('TST-5');
      vi.mocked(mockClient.createIssue).mockResolvedValue(mockIssue);

      const action = createMockAction('trigger_sprint_planning');

      // First call should succeed
      const result1 = await executor.execute(action);
      expect(result1.success).toBe(true);
      expect(mockClient.createIssue).toHaveBeenCalledTimes(1);

      // Second call should be rate-limited
      const result2 = await executor.execute(action);
      expect(result2.success).toBe(false);
      expect(result2.rateLimited).toBe(true);
      expect(mockClient.createIssue).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should allow different event types independently', async () => {
      const mockIssue1 = createMockIssue('TST-6');
      const mockIssue2 = createMockIssue('TST-7');
      vi.mocked(mockClient.createIssue)
        .mockResolvedValueOnce(mockIssue1)
        .mockResolvedValueOnce(mockIssue2);

      const sprintAction = createMockAction('trigger_sprint_planning');
      const refinementAction = createMockAction('trigger_backlog_refinement');

      const result1 = await executor.execute(sprintAction);
      const result2 = await executor.execute(refinementAction);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(mockClient.createIssue).toHaveBeenCalledTimes(2);
    });

    it('should provide rate limit info', async () => {
      const mockIssue = createMockIssue('TST-8');
      vi.mocked(mockClient.createIssue).mockResolvedValue(mockIssue);

      // Before any events
      let info = executor.getRateLimitInfo('sprint_planning');
      expect(info.isLimited).toBe(false);
      expect(info.lastTriggered).toBeNull();

      // Trigger an event
      await executor.execute(createMockAction('trigger_sprint_planning'));

      // After event
      info = executor.getRateLimitInfo('sprint_planning');
      expect(info.isLimited).toBe(true);
      expect(info.lastTriggered).not.toBeNull();
      expect(info.nextAllowedAt).not.toBeNull();
    });

    it('should clear rate limits when requested', async () => {
      const mockIssue = createMockIssue('TST-9');
      vi.mocked(mockClient.createIssue).mockResolvedValue(mockIssue);

      // Trigger and rate-limit
      await executor.execute(createMockAction('trigger_sprint_planning'));
      expect(executor.isRateLimited('sprint_planning')).toBe(true);

      // Clear limits
      executor.clearRateLimits();
      expect(executor.isRateLimited('sprint_planning')).toBe(false);

      // Should be able to trigger again
      const result = await executor.execute(createMockAction('trigger_sprint_planning'));
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Notification Tests
  // ===========================================================================

  describe('Notifications', () => {
    it('should emit notification for notify_developers action', async () => {
      const action = createMockAction('notify_developers', {
        targetAgentIds: ['agent-1', 'agent-2'],
      });

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(onNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: action.message,
          body: action.description,
          targetAgentIds: ['agent-1', 'agent-2'],
          actionType: 'notify_developers',
        })
      );
    });

    it('should emit notification for notify_po action', async () => {
      const action = createMockAction('notify_po');

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(onNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'notify_po',
        })
      );
    });

    it('should emit notification for notify_scrum_master action', async () => {
      const action = createMockAction('notify_scrum_master');

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(onNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'notify_scrum_master',
        })
      );
    });
  });

  // ===========================================================================
  // Escalation Tests
  // ===========================================================================

  describe('Escalation', () => {
    it('should emit escalation notification', async () => {
      const action = createMockAction('escalate_to_board', {
        priority: 'critical',
      });

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(onNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'critical',
          title: expect.stringContaining('ESKALATION'),
          actionType: 'escalate_to_board',
        })
      );
    });
  });

  // ===========================================================================
  // Auto-Assign Tests
  // ===========================================================================

  describe('Auto-Assign', () => {
    it('should emit auto-assign suggestion', async () => {
      const action = createMockAction('auto_assign_task', {
        taskId: 'task-1',
        assignToAgentId: 'agent-1',
        context: {
          idleDevelopers: [{ id: 'agent-1', name: 'Dev 1' }],
        },
      });

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(onNotification).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Log State Change Tests
  // ===========================================================================

  describe('Log State Change', () => {
    it('should succeed without emitting notification', async () => {
      const action = createMockAction('log_state_change');

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(onNotification).not.toHaveBeenCalled();
      expect(onTriggerEvent).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      vi.mocked(mockClient.createIssue).mockRejectedValue(new Error('API Error'));

      const action = createMockAction('trigger_sprint_planning');
      const result = await executor.execute(action);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API Error');
    });

    it('should handle unknown action types', async () => {
      const action = createMockAction('unknown_action' as StateMachineAction['type']);
      const result = await executor.execute(action);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action type');
    });
  });

  // ===========================================================================
  // Context Enrichment Tests
  // ===========================================================================

  describe('Context Enrichment', () => {
    it('should include context data in issue description', async () => {
      const mockIssue = createMockIssue('TST-10');
      vi.mocked(mockClient.createIssue).mockResolvedValue(mockIssue);

      const action = createMockAction('trigger_sprint_planning', {
        description: 'Base description',
        context: {
          backlogSize: 15,
          backlogPoints: 75,
          readyForSprint: 10,
        },
      });

      await executor.execute(action);

      expect(mockClient.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('Backlog-Größe: 15'),
        })
      );
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('ActionExecutor Integration', () => {
  it('should work with createActionExecutor factory', () => {
    const mockClient = createMockClient();
    const executor = createActionExecutor({
      client: mockClient,
      companyId: 'test-company',
    });

    expect(executor).toBeInstanceOf(ActionExecutor);
  });

  it('should use default config values', async () => {
    const mockClient = createMockClient();
    const executor = createActionExecutor({
      client: mockClient,
      companyId: 'test-company',
    });

    // Should not be rate-limited initially
    expect(executor.isRateLimited('sprint_planning')).toBe(false);
  });
});
