/**
 * Action Executor
 *
 * Executes State Machine actions by connecting to real Paperclip API.
 * Handles event triggering, agent notifications, and rate-limiting.
 *
 * CRITICAL: This module bridges State Machine actions to actual Scrum events.
 */

import type {
  PaperclipClient,
  PaperclipIssue,
  CreateIssueParams,
} from '../api/paperclip-client';
import type { StateMachineAction } from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * Scrum Event types that can be triggered
 */
export type ScrumEventType =
  | 'sprint_planning'
  | 'backlog_refinement'
  | 'daily_standup'
  | 'sprint_review'
  | 'sprint_retrospective'
  | 'review_request';

/**
 * Agent notification target
 */
export interface NotificationTarget {
  agentId: string;
  agentName?: string;
  role?: string;
}

/**
 * Action executor configuration
 */
export interface ActionExecutorConfig {
  /** Paperclip API client */
  client: PaperclipClient;
  /** Company ID */
  companyId: string;
  /** Project ID for creating event issues */
  projectId?: string;
  /** Parent issue ID for event issues (optional) */
  parentIssueId?: string;
  /** Rate limit window in milliseconds (default: 5 minutes) */
  rateLimitWindowMs?: number;
  /** Maximum events per window (default: 1 per event type) */
  maxEventsPerWindow?: number;
  /** Emit UI notification callback */
  onNotification?: (notification: NotificationPayload) => void;
  /** Emit trigger event callback */
  onTriggerEvent?: (event: TriggerEventPayload) => void;
  /** Logger */
  logger?: Logger;
}

export interface NotificationPayload {
  level: string;
  title: string;
  body: string;
  targetAgentIds?: string[];
  actionType: string;
}

export interface TriggerEventPayload {
  event: ScrumEventType;
  priority: string;
  message: string;
  context?: Record<string, unknown>;
  issueId?: string;
  issueIdentifier?: string;
}

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

/**
 * Result of executing an action
 */
export interface ActionExecutionResult {
  success: boolean;
  actionId: string;
  actionType: string;
  issueId?: string;
  issueIdentifier?: string;
  error?: string;
  rateLimited?: boolean;
  executedAt: string;
}

/**
 * Event rate limit entry
 */
interface RateLimitEntry {
  eventType: ScrumEventType;
  triggeredAt: string;
  issueId?: string;
}

// =============================================================================
// Event Templates
// =============================================================================

/**
 * Templates for creating Scrum event issues
 */
const EVENT_TEMPLATES: Record<ScrumEventType, {
  titleTemplate: string;
  descriptionTemplate: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  labels: string[];
}> = {
  sprint_planning: {
    titleTemplate: '🗓️ Sprint Planning erforderlich',
    descriptionTemplate: `## Sprint Planning

Das System hat erkannt, dass Sprint Planning durchgeführt werden muss.

### Situation
{situation}

### Aufgaben
- [ ] Backlog-Items für den Sprint priorisieren
- [ ] Story Points schätzen
- [ ] Sprint-Ziel definieren
- [ ] Items in TODO verschieben

### Teilnehmer
- Product Owner (Priorisierung)
- Tech Lead (Schätzung)
- Scrum Master (Facilitation)
- Entwickler (Kapazitätsplanung)

### Automatisch erstellt
Dieses Issue wurde automatisch vom Scrum Team Plugin erstellt.`,
    priority: 'high',
    labels: ['scrum-event', 'sprint-planning'],
  },

  backlog_refinement: {
    titleTemplate: '🔧 Backlog Refinement erforderlich',
    descriptionTemplate: `## Backlog Refinement

Das System hat erkannt, dass Backlog Refinement durchgeführt werden muss.

### Situation
{situation}

### Aufgaben
- [ ] Neue User Stories erstellen
- [ ] Bestehende Stories verfeinern
- [ ] Akzeptanzkriterien definieren
- [ ] Story Points schätzen (grob)

### Teilnehmer
- Product Owner (neue Stories, Priorisierung)
- Tech Lead (technische Klärung)
- Entwickler (Schätzung)

### Automatisch erstellt
Dieses Issue wurde automatisch vom Scrum Team Plugin erstellt.`,
    priority: 'high',
    labels: ['scrum-event', 'backlog-refinement'],
  },

  daily_standup: {
    titleTemplate: '📢 Daily Standup',
    descriptionTemplate: `## Daily Standup

Tägliches Sync-Meeting des Scrum Teams.

### Agenda
Jeder Entwickler beantwortet:
1. Was habe ich seit dem letzten Standup erreicht?
2. Was plane ich bis zum nächsten Standup?
3. Gibt es Hindernisse?

### Automatisch erstellt
Dieses Issue wurde automatisch vom Scrum Team Plugin erstellt.`,
    priority: 'low',
    labels: ['scrum-event', 'daily-standup'],
  },

  sprint_review: {
    titleTemplate: '🎯 Sprint Review',
    descriptionTemplate: `## Sprint Review

Präsentation der Sprint-Ergebnisse an Stakeholder.

### Situation
{situation}

### Agenda
- [ ] Erledigte Items demonstrieren
- [ ] Stakeholder-Feedback sammeln
- [ ] Sprint-Metriken präsentieren
- [ ] Nächste Schritte besprechen

### Automatisch erstellt
Dieses Issue wurde automatisch vom Scrum Team Plugin erstellt.`,
    priority: 'medium',
    labels: ['scrum-event', 'sprint-review'],
  },

  sprint_retrospective: {
    titleTemplate: '🔄 Sprint Retrospective',
    descriptionTemplate: `## Sprint Retrospective

Reflexion über den vergangenen Sprint.

### Situation
{situation}

### Agenda
- Was lief gut?
- Was lief nicht so gut?
- Was können wir verbessern?
- Action Items definieren

### Automatisch erstellt
Dieses Issue wurde automatisch vom Scrum Team Plugin erstellt.`,
    priority: 'medium',
    labels: ['scrum-event', 'sprint-retrospective'],
  },

  review_request: {
    titleTemplate: '👀 Code Review erforderlich',
    descriptionTemplate: `## Code Review Request

Es gibt Tasks, die auf Review warten.

### Situation
{situation}

### Aufgaben
- [ ] Code Review durchführen
- [ ] Feedback geben
- [ ] Tasks freigeben oder Änderungen anfragen

### Automatisch erstellt
Dieses Issue wurde automatisch vom Scrum Team Plugin erstellt.`,
    priority: 'medium',
    labels: ['scrum-event', 'code-review'],
  },
};

// =============================================================================
// Default Logger
// =============================================================================

const defaultLogger: Logger = {
  debug: (msg, ...args) => console.debug(`[ActionExecutor] ${msg}`, ...args),
  info: (msg, ...args) => console.info(`[ActionExecutor] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[ActionExecutor] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ActionExecutor] ${msg}`, ...args),
};

// =============================================================================
// Action Executor Class
// =============================================================================

/**
 * Executes State Machine actions via Paperclip API
 */
export class ActionExecutor {
  private readonly config: Required<Omit<ActionExecutorConfig, 'projectId' | 'parentIssueId' | 'onNotification' | 'onTriggerEvent'>> & {
    projectId?: string;
    parentIssueId?: string;
    onNotification?: (notification: NotificationPayload) => void;
    onTriggerEvent?: (event: TriggerEventPayload) => void;
  };
  
  /** Rate limit tracking: eventType -> last trigger times */
  private rateLimitTracker: Map<ScrumEventType, RateLimitEntry[]> = new Map();

  constructor(config: ActionExecutorConfig) {
    this.config = {
      ...config,
      rateLimitWindowMs: config.rateLimitWindowMs ?? 5 * 60 * 1000, // 5 minutes
      maxEventsPerWindow: config.maxEventsPerWindow ?? 1,
      logger: config.logger ?? defaultLogger,
    };
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Execute a State Machine action
   */
  async execute(action: StateMachineAction): Promise<ActionExecutionResult> {
    const { logger } = this.config;
    logger.info(`Executing action: ${action.type} - ${action.message}`);

    try {
      switch (action.type) {
        case 'trigger_sprint_planning':
          return this.triggerScrumEvent('sprint_planning', action);

        case 'trigger_backlog_refinement':
          return this.triggerScrumEvent('backlog_refinement', action);

        case 'trigger_review_request':
          return this.triggerScrumEvent('review_request', action);

        case 'notify_developers':
          return this.notifyAgents(action, 'developers');

        case 'notify_po':
          return this.notifyAgent(action, 'product_owner');

        case 'notify_scrum_master':
          return this.notifyAgent(action, 'scrum_master');

        case 'auto_assign_task':
          return this.handleAutoAssign(action);

        case 'escalate_to_board':
          return this.escalateToBoard(action);

        case 'log_state_change':
          return this.logStateChange(action);

        default:
          logger.warn(`Unknown action type: ${action.type}`);
          return this.createResult(action, false, 'Unknown action type');
      }
    } catch (error) {
      logger.error(`Action execution failed:`, error);
      return this.createResult(
        action,
        false,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Check if an event is rate-limited
   */
  isRateLimited(eventType: ScrumEventType): boolean {
    return !this.checkRateLimit(eventType);
  }

  /**
   * Get rate limit info for an event type
   */
  getRateLimitInfo(eventType: ScrumEventType): {
    isLimited: boolean;
    lastTriggered: string | null;
    nextAllowedAt: string | null;
  } {
    const entries = this.rateLimitTracker.get(eventType) ?? [];
    const validEntries = this.getValidRateLimitEntries(entries);

    if (validEntries.length === 0) {
      return { isLimited: false, lastTriggered: null, nextAllowedAt: null };
    }

    const lastEntry = validEntries[validEntries.length - 1];
    const isLimited = validEntries.length >= this.config.maxEventsPerWindow;
    
    let nextAllowedAt: string | null = null;
    if (isLimited && validEntries.length > 0) {
      const oldestEntry = validEntries[0];
      const oldestTime = new Date(oldestEntry.triggeredAt).getTime();
      nextAllowedAt = new Date(oldestTime + this.config.rateLimitWindowMs).toISOString();
    }

    return {
      isLimited,
      lastTriggered: lastEntry.triggeredAt,
      nextAllowedAt,
    };
  }

  /**
   * Clear rate limit tracking (for testing or reset)
   */
  clearRateLimits(): void {
    this.rateLimitTracker.clear();
  }

  // ===========================================================================
  // Event Triggering
  // ===========================================================================

  /**
   * Trigger a Scrum event by creating an issue
   */
  private async triggerScrumEvent(
    eventType: ScrumEventType,
    action: StateMachineAction
  ): Promise<ActionExecutionResult> {
    const { logger, client } = this.config;

    // Check rate limit
    if (!this.checkRateLimit(eventType)) {
      const info = this.getRateLimitInfo(eventType);
      logger.warn(`Event ${eventType} is rate-limited. Next allowed at: ${info.nextAllowedAt}`);
      
      return {
        success: false,
        actionId: action.id,
        actionType: action.type,
        rateLimited: true,
        error: `Rate limited. Next allowed at: ${info.nextAllowedAt}`,
        executedAt: new Date().toISOString(),
      };
    }

    // Get event template
    const template = EVENT_TEMPLATES[eventType];
    if (!template) {
      return this.createResult(action, false, `Unknown event type: ${eventType}`);
    }

    // Build situation description from action context
    const situation = this.buildSituationDescription(action);

    // Create issue params
    const issueParams: CreateIssueParams = {
      title: template.titleTemplate,
      description: template.descriptionTemplate.replace('{situation}', situation),
      status: 'todo',
      priority: template.priority,
      labels: template.labels,
    };

    if (this.config.projectId) {
      issueParams.projectId = this.config.projectId;
    }

    if (this.config.parentIssueId) {
      issueParams.parentId = this.config.parentIssueId;
    }

    try {
      // Create the event issue
      const issue = await client.createIssue(issueParams);
      logger.info(`Created ${eventType} issue: ${issue.identifier}`);

      // Record rate limit
      this.recordRateLimitEvent(eventType, issue.id);

      // Emit UI notification
      this.emitTriggerEvent(eventType, action, issue);

      return this.createResult(action, true, undefined, issue.id, issue.identifier);
    } catch (error) {
      logger.error(`Failed to create ${eventType} issue:`, error);
      return this.createResult(
        action,
        false,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Build situation description from action context
   */
  private buildSituationDescription(action: StateMachineAction): string {
    const context = action.context ?? {};
    const parts: string[] = [action.description];

    if (context.backlogSize !== undefined) {
      parts.push(`- Backlog-Größe: ${context.backlogSize} Tasks`);
    }
    if (context.backlogPoints !== undefined) {
      parts.push(`- Backlog Story Points: ${context.backlogPoints}`);
    }
    if (context.availableTasks !== undefined) {
      parts.push(`- Verfügbare Tasks: ${context.availableTasks}`);
    }
    if (context.idleCount !== undefined) {
      parts.push(`- Idle Entwickler: ${context.idleCount}`);
    }
    if (context.unrefinedCount !== undefined) {
      parts.push(`- Nicht-refined Items: ${context.unrefinedCount}`);
    }
    if (context.readyForSprint !== undefined) {
      parts.push(`- Sprint-Ready Items: ${context.readyForSprint}`);
    }

    return parts.join('\n');
  }

  // ===========================================================================
  // Agent Notifications
  // ===========================================================================

  /**
   * Notify multiple agents (developers)
   */
  private async notifyAgents(
    action: StateMachineAction,
    _role: string
  ): Promise<ActionExecutionResult> {
    const { logger } = this.config;
    const targetIds = action.targetAgentIds ?? [];

    if (targetIds.length === 0) {
      logger.warn('No target agents for notification');
      return this.createResult(action, true); // Success but no-op
    }

    // For now, emit UI notification
    // In future: create comment on relevant issue or send direct notification
    this.emitNotification(action);

    logger.info(`Notified ${targetIds.length} developers: ${action.message}`);
    return this.createResult(action, true);
  }

  /**
   * Notify a single agent by role
   */
  private async notifyAgent(
    action: StateMachineAction,
    _role: string
  ): Promise<ActionExecutionResult> {
    const { logger } = this.config;

    // Emit UI notification
    this.emitNotification(action);

    logger.info(`Notified ${_role}: ${action.message}`);
    return this.createResult(action, true);
  }

  // ===========================================================================
  // Other Actions
  // ===========================================================================

  /**
   * Handle auto-assign suggestion
   */
  private async handleAutoAssign(action: StateMachineAction): Promise<ActionExecutionResult> {
    const { logger } = this.config;

    // Auto-assign is typically just a suggestion
    // The actual assignment happens through UI or other mechanisms
    logger.info(`Auto-assign suggested: ${action.message}`);

    this.emitNotification({
      ...action,
      type: 'auto_assign_task',
    } as StateMachineAction);

    return this.createResult(action, true);
  }

  /**
   * Escalate to board
   */
  private async escalateToBoard(action: StateMachineAction): Promise<ActionExecutionResult> {
    const { logger } = this.config;

    logger.warn(`ESCALATION: ${action.message}`);
    logger.warn(`Details: ${action.description}`);

    // Emit escalation notification to UI
    this.config.onNotification?.({
      level: action.priority,
      title: `⚠️ ESKALATION: ${action.message}`,
      body: action.description,
      actionType: 'escalate_to_board',
    });

    return this.createResult(action, true);
  }

  /**
   * Log state change (informational only)
   */
  private logStateChange(action: StateMachineAction): ActionExecutionResult {
    const { logger } = this.config;
    logger.debug(`State change logged: ${action.message}`);
    return this.createResult(action, true);
  }

  // ===========================================================================
  // Rate Limiting
  // ===========================================================================

  /**
   * Check if event can be triggered (not rate-limited)
   */
  private checkRateLimit(eventType: ScrumEventType): boolean {
    const entries = this.rateLimitTracker.get(eventType) ?? [];
    const validEntries = this.getValidRateLimitEntries(entries);

    // Update tracker with only valid entries
    if (validEntries.length !== entries.length) {
      this.rateLimitTracker.set(eventType, validEntries);
    }

    return validEntries.length < this.config.maxEventsPerWindow;
  }

  /**
   * Get entries within the rate limit window
   */
  private getValidRateLimitEntries(entries: RateLimitEntry[]): RateLimitEntry[] {
    const cutoff = Date.now() - this.config.rateLimitWindowMs;
    return entries.filter(e => new Date(e.triggeredAt).getTime() > cutoff);
  }

  /**
   * Record a triggered event for rate limiting
   */
  private recordRateLimitEvent(eventType: ScrumEventType, issueId?: string): void {
    const entries = this.rateLimitTracker.get(eventType) ?? [];
    entries.push({
      eventType,
      triggeredAt: new Date().toISOString(),
      issueId,
    });
    this.rateLimitTracker.set(eventType, entries);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Emit a notification to the UI
   */
  private emitNotification(action: StateMachineAction): void {
    this.config.onNotification?.({
      level: action.priority,
      title: action.message,
      body: action.description,
      targetAgentIds: action.targetAgentIds,
      actionType: action.type,
    });
  }

  /**
   * Emit a trigger event to the UI
   */
  private emitTriggerEvent(
    eventType: ScrumEventType,
    action: StateMachineAction,
    issue?: PaperclipIssue
  ): void {
    this.config.onTriggerEvent?.({
      event: eventType,
      priority: action.priority,
      message: action.message,
      context: action.context,
      issueId: issue?.id,
      issueIdentifier: issue?.identifier,
    });
  }

  /**
   * Create an action execution result
   */
  private createResult(
    action: StateMachineAction,
    success: boolean,
    error?: string,
    issueId?: string,
    issueIdentifier?: string
  ): ActionExecutionResult {
    return {
      success,
      actionId: action.id,
      actionType: action.type,
      error,
      issueId,
      issueIdentifier,
      executedAt: new Date().toISOString(),
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an ActionExecutor instance
 */
export function createActionExecutor(config: ActionExecutorConfig): ActionExecutor {
  return new ActionExecutor(config);
}
