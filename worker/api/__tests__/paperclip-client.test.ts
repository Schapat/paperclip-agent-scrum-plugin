/**
 * Unit Tests für den Paperclip API Client
 *
 * Tests für Issues, Agents und Routines API-Operationen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PaperclipClient,
  PaperclipApiError,
  createClientFromEnv,
  type PaperclipConfig,
  type PaperclipIssue,
  type PaperclipAgent,
  type PaperclipRoutine,
  type Logger,
} from '../paperclip-client';

// =============================================================================
// Test Setup
// =============================================================================

const mockConfig: PaperclipConfig = {
  apiUrl: 'http://localhost:3100',
  apiKey: 'test-api-key',
  companyId: 'company-123',
  agentId: 'agent-456',
  runId: 'run-789',
};

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Sample response data
const mockIssue: PaperclipIssue = {
  id: 'issue-1',
  identifier: 'TEST-1',
  title: 'Test Issue',
  description: 'Test description',
  status: 'todo',
  priority: 'medium',
  assigneeAgentId: 'agent-456',
  assigneeUserId: null,
  projectId: 'project-1',
  parentId: null,
  goalId: null,
  labels: ['bug'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  completedAt: null,
};

const mockAgent: PaperclipAgent = {
  id: 'agent-456',
  companyId: 'company-123',
  name: 'Test Agent',
  role: 'general',
  title: 'Developer',
  status: 'active',
  icon: 'code',
  capabilities: 'Testing',
  reportsTo: null,
  budgetMonthlyCents: 10000,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockRoutine: PaperclipRoutine = {
  id: 'routine-1',
  companyId: 'company-123',
  name: 'Test Routine',
  description: 'A test routine',
  agentId: 'agent-456',
  status: 'active',
  triggers: [
    {
      id: 'trigger-1',
      type: 'schedule',
      config: { cron: '0 9 * * *' },
    },
  ],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

// =============================================================================
// Helper Functions
// =============================================================================

function createMockResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

function createErrorResponse(error: string, status = 400): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error }),
    text: () => Promise.resolve(JSON.stringify({ error })),
  } as Response;
}

// =============================================================================
// Tests
// =============================================================================

describe('PaperclipClient', () => {
  let client: PaperclipClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new PaperclipClient(mockConfig, mockLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Constructor & Headers Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create client with config', () => {
      expect(client).toBeInstanceOf(PaperclipClient);
    });

    it('should use default logger if none provided', () => {
      const clientNoLogger = new PaperclipClient(mockConfig);
      expect(clientNoLogger).toBeInstanceOf(PaperclipClient);
    });
  });

  describe('headers', () => {
    it('should include Authorization header', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(mockAgent));

      await client.getMe();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        })
      );
    });

    it('should include X-Paperclip-Run-Id header when runId is set', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(mockAgent));

      await client.getMe();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Paperclip-Run-Id': 'run-789',
          }),
        })
      );
    });

    it('should not include X-Paperclip-Run-Id when runId is not set', async () => {
      const clientNoRunId = new PaperclipClient(
        { ...mockConfig, runId: undefined },
        mockLogger
      );
      mockFetch.mockResolvedValueOnce(createMockResponse(mockAgent));

      await clientNoRunId.getMe();

      const callArgs = mockFetch.mock.calls[0][1] as { headers: Record<string, string> };
      expect(callArgs.headers['X-Paperclip-Run-Id']).toBeUndefined();
    });
  });

  // ===========================================================================
  // Issues API Tests
  // ===========================================================================

  describe('Issues API', () => {
    describe('listIssues', () => {
      it('should list issues without filters', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse([mockIssue]));

        const result = await client.listIssues();

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/companies/company-123/issues',
          expect.any(Object)
        );
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toEqual(mockIssue);
      });

      it('should list issues with status filter', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse([mockIssue]));

        await client.listIssues({ status: 'todo' });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/companies/company-123/issues?status=todo',
          expect.any(Object)
        );
      });

      it('should list issues with multiple status filters', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse([mockIssue]));

        await client.listIssues({ status: ['todo', 'in_progress'] });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/companies/company-123/issues?status=todo%2Cin_progress',
          expect.any(Object)
        );
      });

      it('should list issues with assignee filter', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse([mockIssue]));

        await client.listIssues({ assigneeAgentId: 'agent-456' });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/companies/company-123/issues?assigneeAgentId=agent-456',
          expect.any(Object)
        );
      });

      it('should list issues with search query', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse([mockIssue]));

        await client.listIssues({ q: 'bug fix' });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/companies/company-123/issues?q=bug+fix',
          expect.any(Object)
        );
      });
    });

    describe('getIssue', () => {
      it('should get issue by ID', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse(mockIssue));

        const result = await client.getIssue('issue-1');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/issues/issue-1',
          expect.any(Object)
        );
        expect(result).toEqual(mockIssue);
      });

      it('should throw on 404', async () => {
        mockFetch.mockResolvedValueOnce(createErrorResponse('Issue not found', 404));

        await expect(client.getIssue('nonexistent')).rejects.toThrow(PaperclipApiError);
      });
    });

    describe('createIssue', () => {
      it('should create a new issue', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse(mockIssue));

        const result = await client.createIssue({
          title: 'Test Issue',
          description: 'Test description',
          priority: 'medium',
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/companies/company-123/issues',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              title: 'Test Issue',
              description: 'Test description',
              priority: 'medium',
            }),
          })
        );
        expect(result).toEqual(mockIssue);
      });
    });

    describe('updateIssue', () => {
      it('should update an issue', async () => {
        const updatedIssue = { ...mockIssue, status: 'done' as const };
        mockFetch.mockResolvedValueOnce(createMockResponse(updatedIssue));

        const result = await client.updateIssue('issue-1', {
          status: 'done',
          comment: 'Work completed',
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/issues/issue-1',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              status: 'done',
              comment: 'Work completed',
            }),
          })
        );
        expect(result.status).toBe('done');
      });
    });

    describe('checkoutIssue', () => {
      it('should checkout an issue', async () => {
        const checkedOutIssue = { ...mockIssue, status: 'in_progress' as const };
        mockFetch.mockResolvedValueOnce(createMockResponse(checkedOutIssue));

        const result = await client.checkoutIssue('issue-1', ['todo', 'backlog']);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/issues/issue-1/checkout',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              agentId: 'agent-456',
              expectedStatuses: ['todo', 'backlog'],
            }),
          })
        );
        expect(result.status).toBe('in_progress');
      });

      it('should throw 409 on conflict', async () => {
        mockFetch.mockResolvedValueOnce(
          createErrorResponse('Issue already checked out', 409)
        );

        const error = await client.checkoutIssue('issue-1').catch((e) => e);
        expect(error).toBeInstanceOf(PaperclipApiError);
        expect((error as PaperclipApiError).isConflict()).toBe(true);
      });
    });

    describe('releaseIssue', () => {
      it('should release an issue', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse(mockIssue));

        await client.releaseIssue('issue-1');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/issues/issue-1/release',
          expect.objectContaining({ method: 'POST' })
        );
      });
    });
  });

  // ===========================================================================
  // Comments API Tests
  // ===========================================================================

  describe('Comments API', () => {
    const mockComment = {
      id: 'comment-1',
      issueId: 'issue-1',
      body: 'Test comment',
      authorAgentId: 'agent-456',
      authorUserId: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    describe('listComments', () => {
      it('should list comments for an issue', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse([mockComment]));

        const result = await client.listComments('issue-1');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/issues/issue-1/comments',
          expect.any(Object)
        );
        expect(result).toHaveLength(1);
      });

      it('should list comments with after parameter', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse([mockComment]));

        await client.listComments('issue-1', { after: 'comment-0', order: 'asc' });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/issues/issue-1/comments?after=comment-0&order=asc',
          expect.any(Object)
        );
      });
    });

    describe('addComment', () => {
      it('should add a comment to an issue', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse(mockComment));

        const result = await client.addComment('issue-1', 'Test comment');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/issues/issue-1/comments',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ body: 'Test comment' }),
          })
        );
        expect(result.body).toBe('Test comment');
      });
    });
  });

  // ===========================================================================
  // Agents API Tests
  // ===========================================================================

  describe('Agents API', () => {
    describe('listAgents', () => {
      it('should list company agents', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse([mockAgent]));

        const result = await client.listAgents();

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/companies/company-123/agents',
          expect.any(Object)
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(mockAgent);
      });
    });

    describe('getMe', () => {
      it('should get current agent', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse(mockAgent));

        const result = await client.getMe();

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/agents/me',
          expect.any(Object)
        );
        expect(result).toEqual(mockAgent);
      });
    });

    describe('getAgent', () => {
      it('should get agent by ID', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse(mockAgent));

        const result = await client.getAgent('agent-456');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/agents/agent-456',
          expect.any(Object)
        );
        expect(result).toEqual(mockAgent);
      });
    });
  });

  // ===========================================================================
  // Routines API Tests
  // ===========================================================================

  describe('Routines API', () => {
    describe('listRoutines', () => {
      it('should list routines', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse([mockRoutine]));

        const result = await client.listRoutines();

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/companies/company-123/routines',
          expect.any(Object)
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(mockRoutine);
      });
    });

    describe('getRoutine', () => {
      it('should get routine by ID', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse(mockRoutine));

        const result = await client.getRoutine('routine-1');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/routines/routine-1',
          expect.any(Object)
        );
        expect(result).toEqual(mockRoutine);
      });
    });

    describe('createRoutine', () => {
      it('should create a routine', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse(mockRoutine));

        const result = await client.createRoutine({
          name: 'Test Routine',
          description: 'A test routine',
          agentId: 'agent-456',
          triggers: [{ type: 'schedule', config: { cron: '0 9 * * *' } }],
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/companies/company-123/routines',
          expect.objectContaining({ method: 'POST' })
        );
        expect(result).toEqual(mockRoutine);
      });
    });

    describe('updateRoutineStatus', () => {
      it('should update routine status', async () => {
        const pausedRoutine = { ...mockRoutine, status: 'paused' as const };
        mockFetch.mockResolvedValueOnce(createMockResponse(pausedRoutine));

        const result = await client.updateRoutineStatus('routine-1', 'paused');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/routines/routine-1',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ status: 'paused' }),
          })
        );
        expect(result.status).toBe('paused');
      });
    });

    describe('deleteRoutine', () => {
      it('should delete a routine', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse(undefined));

        await client.deleteRoutine('routine-1');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/routines/routine-1',
          expect.objectContaining({ method: 'DELETE' })
        );
      });
    });
  });

  // ===========================================================================
  // Inbox / Dashboard Tests
  // ===========================================================================

  describe('Inbox & Dashboard', () => {
    describe('getInbox', () => {
      it('should get agent inbox', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse([mockIssue]));

        const result = await client.getInbox();

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/agents/me/inbox-lite',
          expect.any(Object)
        );
        expect(result).toHaveLength(1);
      });
    });

    describe('getDashboard', () => {
      it('should get company dashboard', async () => {
        const mockDashboard = {
          agents: { active: 5, paused: 1 },
          tasks: { open: 10, inProgress: 3, blocked: 2 },
          budget: { monthSpendCents: 5000, monthBudgetCents: 10000, utilization: 50 },
          pendingApprovals: 2,
        };
        mockFetch.mockResolvedValueOnce(createMockResponse(mockDashboard));

        const result = await client.getDashboard();

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3100/api/companies/company-123/dashboard',
          expect.any(Object)
        );
        expect(result.agents.active).toBe(5);
        expect(result.budget.utilization).toBe(50);
      });
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('Error Handling', () => {
    it('should throw PaperclipApiError on 4xx errors', async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse('Bad request', 400));

      await expect(client.getIssue('issue-1')).rejects.toThrow(PaperclipApiError);
    });

    it('should retry on 5xx errors', async () => {
      mockFetch
        .mockResolvedValueOnce(createErrorResponse('Server error', 500))
        .mockResolvedValueOnce(createMockResponse(mockIssue));

      const result = await client.getIssue('issue-1');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockIssue);
    });

    it('should fail after max retries on persistent 5xx', async () => {
      mockFetch.mockResolvedValue(createErrorResponse('Server error', 500));

      // The client retries 3 times by default
      await expect(client.getIssue('issue-1')).rejects.toThrow('Server error');
      expect(mockFetch).toHaveBeenCalledTimes(4); // 1 + 3 retries
    }, 15000); // Increase timeout for retry tests
  });

  // ===========================================================================
  // PaperclipApiError Tests
  // ===========================================================================

  describe('PaperclipApiError', () => {
    it('should identify conflict errors', () => {
      const error = new PaperclipApiError('Conflict', 409, { error: 'Conflict' });
      expect(error.isConflict()).toBe(true);
      expect(error.isNotFound()).toBe(false);
    });

    it('should identify not found errors', () => {
      const error = new PaperclipApiError('Not Found', 404, { error: 'Not Found' });
      expect(error.isNotFound()).toBe(true);
      expect(error.isConflict()).toBe(false);
    });

    it('should identify forbidden errors', () => {
      const error = new PaperclipApiError('Forbidden', 403, { error: 'Forbidden' });
      expect(error.isForbidden()).toBe(true);
    });

    it('should identify unauthorized errors', () => {
      const error = new PaperclipApiError('Unauthorized', 401, { error: 'Unauthorized' });
      expect(error.isUnauthorized()).toBe(true);
    });
  });
});

// =============================================================================
// createClientFromEnv Tests
// =============================================================================

describe('createClientFromEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all Paperclip env vars
    delete process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_API_KEY;
    delete process.env.PAPERCLIP_COMPANY_ID;
    delete process.env.PAPERCLIP_AGENT_ID;
    delete process.env.PAPERCLIP_RUN_ID;
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  it('should create client from environment variables', () => {
    process.env.PAPERCLIP_API_URL = 'http://localhost:3100';
    process.env.PAPERCLIP_API_KEY = 'test-key';
    process.env.PAPERCLIP_COMPANY_ID = 'company-123';
    process.env.PAPERCLIP_AGENT_ID = 'agent-456';
    process.env.PAPERCLIP_RUN_ID = 'run-789';

    const client = createClientFromEnv();
    expect(client).toBeInstanceOf(PaperclipClient);
  });

  it('should throw if PAPERCLIP_API_URL is missing', () => {
    process.env.PAPERCLIP_API_KEY = 'test-key';
    process.env.PAPERCLIP_COMPANY_ID = 'company-123';

    expect(() => createClientFromEnv()).toThrow('PAPERCLIP_API_URL environment variable is required');
  });

  it('should throw if PAPERCLIP_API_KEY is missing', () => {
    process.env.PAPERCLIP_API_URL = 'http://localhost:3100';
    process.env.PAPERCLIP_COMPANY_ID = 'company-123';

    expect(() => createClientFromEnv()).toThrow('PAPERCLIP_API_KEY environment variable is required');
  });

  it('should throw if PAPERCLIP_COMPANY_ID is missing', () => {
    process.env.PAPERCLIP_API_URL = 'http://localhost:3100';
    process.env.PAPERCLIP_API_KEY = 'test-key';

    expect(() => createClientFromEnv()).toThrow('PAPERCLIP_COMPANY_ID environment variable is required');
  });
});
