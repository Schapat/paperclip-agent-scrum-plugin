/**
 * Paperclip API Client
 *
 * Client für die Kommunikation mit der Paperclip Control Plane API.
 * Unterstützt Issues, Agents und Routines Operationen.
 */

// =============================================================================
// Types
// =============================================================================

export interface PaperclipConfig {
  apiUrl: string;
  apiKey: string;
  companyId: string;
  agentId?: string;
  runId?: string;
}

export interface PaperclipIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  projectId: string | null;
  parentId: string | null;
  goalId: string | null;
  blockedByIssueIds?: string[];
  labels: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type IssueStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked'
  | 'cancelled';

export type IssuePriority = 'low' | 'medium' | 'high' | 'critical';

export interface CreateIssueParams {
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeAgentId?: string;
  projectId?: string;
  parentId?: string;
  goalId?: string;
  blockedByIssueIds?: string[];
  labels?: string[];
}

export interface UpdateIssueParams {
  title?: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeAgentId?: string | null;
  projectId?: string | null;
  parentId?: string | null;
  goalId?: string | null;
  blockedByIssueIds?: string[];
  comment?: string;
}

export interface IssueComment {
  id: string;
  issueId: string;
  body: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaperclipAgent {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string | null;
  status: AgentStatus;
  icon: string | null;
  capabilities: string | null;
  reportsTo: string | null;
  budgetMonthlyCents: number | null;
  createdAt: string;
  updatedAt: string;
}

export type AgentStatus = 'active' | 'paused' | 'pending_approval' | 'disabled' | 'running' | 'idle';

export interface AgentHireRequest {
  name: string;
  role: string;
  title: string;
  icon?: string;
  capabilities?: string;
  reportsTo?: string | null;
  adapterType?: string;
  adapterConfig?: Record<string, unknown>;
  instructionsBundle?: {
    files: Record<string, string>;
  };
  runtimeConfig?: {
    heartbeat?: {
      enabled?: boolean;
      intervalSec?: number;
      wakeOnDemand?: boolean;
    };
  };
  budgetMonthlyCents?: number;
  sourceIssueId?: string;
}

export interface AgentHireResponse {
  agent: PaperclipAgent;
  approval?: {
    id: string;
    status: string;
  };
}

export interface PaperclipLabel {
  id: string;
  companyId: string;
  name: string;
  color: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLabelParams {
  name: string;
  color: string;
  description?: string;
}

export interface PaperclipRoutine {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  agentId: string;
  status: RoutineStatus;
  triggers: RoutineTrigger[];
  createdAt: string;
  updatedAt: string;
}

export type RoutineStatus = 'active' | 'paused' | 'disabled';

export interface RoutineTrigger {
  id: string;
  type: 'schedule' | 'webhook' | 'api';
  config: Record<string, unknown>;
}

export interface CreateRoutineParams {
  name: string;
  description?: string;
  agentId: string;
  status?: RoutineStatus;
  triggers?: Array<{
    type: 'schedule' | 'webhook' | 'api';
    config: Record<string, unknown>;
  }>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ApiError {
  error: string;
  message?: string;
  statusCode?: number;
}

// =============================================================================
// Logger
// =============================================================================

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

const defaultLogger: Logger = {
  debug: (msg, ...args) => console.debug(`[PaperclipClient] ${msg}`, ...args),
  info: (msg, ...args) => console.info(`[PaperclipClient] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[PaperclipClient] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[PaperclipClient] ${msg}`, ...args),
};

// =============================================================================
// Paperclip API Client
// =============================================================================

export class PaperclipClient {
  private readonly config: PaperclipConfig;
  private readonly logger: Logger;

  constructor(config: PaperclipConfig, logger: Logger = defaultLogger) {
    this.config = config;
    this.logger = logger;
  }

  // ===========================================================================
  // HTTP Helpers
  // ===========================================================================

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    };

    if (this.config.runId) {
      headers['X-Paperclip-Run-Id'] = this.config.runId;
    }

    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { retries?: number; retryDelay?: number }
  ): Promise<T> {
    const url = `${this.config.apiUrl}${path}`;
    const { retries = 3, retryDelay = 1000 } = options ?? {};

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        this.logger.debug(`${method} ${path}`, { attempt, body });

        const response = await fetch(url, {
          method,
          headers: this.getHeaders(),
          body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          let parsedError: ApiError;
          try {
            parsedError = JSON.parse(errorBody) as ApiError;
          } catch {
            parsedError = { error: errorBody, statusCode: response.status };
          }

          // Don't retry on client errors (4xx)
          if (response.status >= 400 && response.status < 500) {
            throw new PaperclipApiError(
              parsedError.error || parsedError.message || 'API Error',
              response.status,
              parsedError
            );
          }

          // Retry on server errors (5xx)
          throw new Error(`Server error: ${response.status}`);
        }

        const data = (await response.json()) as T;
        this.logger.debug(`Response from ${path}:`, { status: response.status });
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof PaperclipApiError) {
          throw error;
        }

        if (attempt < retries) {
          this.logger.warn(`Request failed, retrying in ${retryDelay}ms...`, {
            attempt,
            error: lastError.message,
          });
          await this.delay(retryDelay * (attempt + 1));
        }
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // Issues API
  // ===========================================================================

  /**
   * List issues for the company
   */
  async listIssues(params?: {
    status?: IssueStatus | IssueStatus[];
    assigneeAgentId?: string;
    projectId?: string;
    parentId?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<PaperclipIssue>> {
    const searchParams = new URLSearchParams();

    if (params?.status) {
      const statuses = Array.isArray(params.status) ? params.status.join(',') : params.status;
      searchParams.set('status', statuses);
    }
    if (params?.assigneeAgentId) searchParams.set('assigneeAgentId', params.assigneeAgentId);
    if (params?.projectId) searchParams.set('projectId', params.projectId);
    if (params?.parentId) searchParams.set('parentId', params.parentId);
    if (params?.q) searchParams.set('q', params.q);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

    const query = searchParams.toString();
    const path = `/api/companies/${this.config.companyId}/issues${query ? `?${query}` : ''}`;

    // The API returns array directly, wrap in paginated response
    const items = await this.request<PaperclipIssue[]>('GET', path);
    return {
      items,
      total: items.length,
      page: params?.page ?? 1,
      pageSize: params?.pageSize ?? items.length,
      hasMore: false,
    };
  }

  /**
   * Get a single issue by ID
   */
  async getIssue(issueId: string): Promise<PaperclipIssue> {
    return this.request<PaperclipIssue>('GET', `/api/issues/${issueId}`);
  }

  /**
   * Create a new issue
   */
  async createIssue(params: CreateIssueParams): Promise<PaperclipIssue> {
    return this.request<PaperclipIssue>(
      'POST',
      `/api/companies/${this.config.companyId}/issues`,
      params
    );
  }

  /**
   * Update an existing issue
   */
  async updateIssue(issueId: string, params: UpdateIssueParams): Promise<PaperclipIssue> {
    return this.request<PaperclipIssue>('PATCH', `/api/issues/${issueId}`, params);
  }

  /**
   * Checkout an issue (claim it for work)
   */
  async checkoutIssue(
    issueId: string,
    expectedStatuses?: IssueStatus[]
  ): Promise<PaperclipIssue> {
    const body: Record<string, unknown> = {
      agentId: this.config.agentId,
    };
    if (expectedStatuses) {
      body.expectedStatuses = expectedStatuses;
    }
    return this.request<PaperclipIssue>('POST', `/api/issues/${issueId}/checkout`, body);
  }

  /**
   * Release an issue (give up ownership)
   */
  async releaseIssue(issueId: string): Promise<PaperclipIssue> {
    return this.request<PaperclipIssue>('POST', `/api/issues/${issueId}/release`);
  }

  // ===========================================================================
  // Issue Comments API
  // ===========================================================================

  /**
   * List comments for an issue
   */
  async listComments(
    issueId: string,
    params?: { after?: string; order?: 'asc' | 'desc' }
  ): Promise<IssueComment[]> {
    const searchParams = new URLSearchParams();
    if (params?.after) searchParams.set('after', params.after);
    if (params?.order) searchParams.set('order', params.order);

    const query = searchParams.toString();
    const path = `/api/issues/${issueId}/comments${query ? `?${query}` : ''}`;
    return this.request<IssueComment[]>('GET', path);
  }

  /**
   * Get a single comment
   */
  async getComment(issueId: string, commentId: string): Promise<IssueComment> {
    return this.request<IssueComment>('GET', `/api/issues/${issueId}/comments/${commentId}`);
  }

  /**
   * Add a comment to an issue
   */
  async addComment(issueId: string, body: string): Promise<IssueComment> {
    return this.request<IssueComment>('POST', `/api/issues/${issueId}/comments`, { body });
  }

  // ===========================================================================
  // Agents API
  // ===========================================================================

  /**
   * List agents in the company
   */
  async listAgents(): Promise<PaperclipAgent[]> {
    return this.request<PaperclipAgent[]>('GET', `/api/companies/${this.config.companyId}/agents`);
  }

  /**
   * Get current agent info
   */
  async getMe(): Promise<PaperclipAgent> {
    return this.request<PaperclipAgent>('GET', '/api/agents/me');
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<PaperclipAgent> {
    return this.request<PaperclipAgent>('GET', `/api/agents/${agentId}`);
  }

  /**
   * Submit a hire request for a new agent.
   * May require board approval depending on company settings.
   */
  async createAgentHire(params: AgentHireRequest): Promise<AgentHireResponse> {
    return this.request<AgentHireResponse>(
      'POST',
      `/api/companies/${this.config.companyId}/agent-hires`,
      params
    );
  }

  /**
   * Update an existing agent's configuration.
   *
   * `instructionsBundle` überschreibt die Instruktionsdateien des Agents —
   * darüber fließen die in der Retrospektive gelernten Skills in seine
   * `AGENTS.md` ein. Beim Hire wird dasselbe Feld verwendet.
   */
  async updateAgent(
    agentId: string,
    params: Partial<{
      name: string;
      title: string;
      icon: string;
      capabilities: string;
      reportsTo: string | null;
      adapterConfig: Record<string, unknown>;
      runtimeConfig: Record<string, unknown>;
      budgetMonthlyCents: number;
      instructionsBundle: { files: Record<string, string> };
    }>
  ): Promise<PaperclipAgent> {
    return this.request<PaperclipAgent>('PATCH', `/api/agents/${agentId}`, params);
  }

  // ===========================================================================
  // Labels API
  // ===========================================================================

  /**
   * List labels for the company
   */
  async listLabels(): Promise<PaperclipLabel[]> {
    return this.request<PaperclipLabel[]>('GET', `/api/companies/${this.config.companyId}/labels`);
  }

  /**
   * Create a new label
   */
  async createLabel(params: CreateLabelParams): Promise<PaperclipLabel> {
    return this.request<PaperclipLabel>(
      'POST',
      `/api/companies/${this.config.companyId}/labels`,
      params
    );
  }

  /**
   * Delete a label
   */
  async deleteLabel(labelId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/labels/${labelId}`);
  }

  // ===========================================================================
  // Routines API
  // ===========================================================================

  /**
   * List routines for the company
   */
  async listRoutines(): Promise<PaperclipRoutine[]> {
    return this.request<PaperclipRoutine[]>(
      'GET',
      `/api/companies/${this.config.companyId}/routines`
    );
  }

  /**
   * Get routine by ID
   */
  async getRoutine(routineId: string): Promise<PaperclipRoutine> {
    return this.request<PaperclipRoutine>('GET', `/api/routines/${routineId}`);
  }

  /**
   * Create a new routine
   */
  async createRoutine(params: CreateRoutineParams): Promise<PaperclipRoutine> {
    return this.request<PaperclipRoutine>(
      'POST',
      `/api/companies/${this.config.companyId}/routines`,
      params
    );
  }

  /**
   * Update routine status
   */
  async updateRoutineStatus(routineId: string, status: RoutineStatus): Promise<PaperclipRoutine> {
    return this.request<PaperclipRoutine>('PATCH', `/api/routines/${routineId}`, { status });
  }

  /**
   * Delete a routine
   */
  async deleteRoutine(routineId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/routines/${routineId}`);
  }

  // ===========================================================================
  // Dashboard / Inbox
  // ===========================================================================

  /**
   * Get compact inbox for the current agent
   */
  async getInbox(): Promise<PaperclipIssue[]> {
    return this.request<PaperclipIssue[]>('GET', '/api/agents/me/inbox-lite');
  }

  /**
   * Get company dashboard
   */
  async getDashboard(): Promise<{
    agents: { active: number; paused: number };
    tasks: { open: number; inProgress: number; blocked: number };
    budget: { monthSpendCents: number; monthBudgetCents: number; utilization: number };
    pendingApprovals: number;
  }> {
    return this.request('GET', `/api/companies/${this.config.companyId}/dashboard`);
  }
}

// =============================================================================
// Custom Error Class
// =============================================================================

export class PaperclipApiError extends Error {
  public readonly statusCode: number;
  public readonly apiError: ApiError;

  constructor(message: string, statusCode: number, apiError: ApiError) {
    super(message);
    this.name = 'PaperclipApiError';
    this.statusCode = statusCode;
    this.apiError = apiError;
  }

  /**
   * Check if this is a conflict error (409)
   */
  isConflict(): boolean {
    return this.statusCode === 409;
  }

  /**
   * Check if this is a not found error (404)
   */
  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  /**
   * Check if this is a forbidden error (403)
   */
  isForbidden(): boolean {
    return this.statusCode === 403;
  }

  /**
   * Check if this is an unauthorized error (401)
   */
  isUnauthorized(): boolean {
    return this.statusCode === 401;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a PaperclipClient from environment variables
 */
export function createClientFromEnv(logger?: Logger): PaperclipClient {
  const apiUrl = process.env.PAPERCLIP_API_URL;
  const apiKey = process.env.PAPERCLIP_API_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;
  const agentId = process.env.PAPERCLIP_AGENT_ID;
  const runId = process.env.PAPERCLIP_RUN_ID;

  if (!apiUrl) {
    throw new Error('PAPERCLIP_API_URL environment variable is required');
  }
  if (!apiKey) {
    throw new Error('PAPERCLIP_API_KEY environment variable is required');
  }
  if (!companyId) {
    throw new Error('PAPERCLIP_COMPANY_ID environment variable is required');
  }

  return new PaperclipClient(
    {
      apiUrl,
      apiKey,
      companyId,
      agentId,
      runId,
    },
    logger
  );
}
