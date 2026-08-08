/**
 * TicketDetailPanel Component
 *
 * Modal-Panel für Ticket-Details mit Tabs:
 * - Overview: Titel, Beschreibung, AC, Story Points
 * - Comments: Alle Kommentare chronologisch
 * - History: Status-Änderungen mit Timestamp und Agent
 * - Decisions: Automatische Entscheidungen mit Begründung
 *
 * Features:
 * - Keyboard Navigation (Tab, Escape, Arrow Keys)
 * - Mobile-optimiert (Touch, Swipe)
 * - Accessible (ARIA, Focus Management)
 */

import { useEffect, useRef, useState, useCallback, KeyboardEvent } from 'react';
import type { AgentDecision, ScrumAgent, ScrumTask } from '../../core/types';
import { agentIcon, agentPresentation } from './agent-presentation';

// =============================================================================
// Types
// =============================================================================

export interface TicketDetailPanelProps {
  /** The task to display */
  task: ScrumTask | null;
  /** Whether the panel is open */
  isOpen: boolean;
  /** Callback when panel should close */
  onClose: () => void;
  /** Optional callback to fetch comments */
  onFetchComments?: (taskId: string) => Promise<Comment[]>;
  /** Optional callback to fetch decisions */
  onFetchDecisions?: (taskId: string) => Promise<Decision[]>;
  /**
   * Alle Tickets des Boards.
   *
   * Wird gebraucht, um Subtasks und verlinkte Tickets mit Titel statt roher ID
   * anzuzeigen (Spec §5). Fehlt die Liste, fällt die Anzeige auf die ID zurück.
   */
  allTasks?: ScrumTask[];
  /** Managed team members used to resolve audit IDs to readable names. */
  agents?: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>;
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: string;
}

export interface Decision {
  id: string;
  type: AgentDecision['type'];
  description: string;
  reasoning: string;
  madeBy: string;
  madeByRole: string;
  timestamp: string;
  relatedTaskIds?: string[];
}

type TabId = 'overview' | 'comments' | 'history' | 'decisions';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

// =============================================================================
// Constants
// =============================================================================

const TABS: Tab[] = [
  { id: 'overview', label: 'Übersicht', icon: '📋' },
  { id: 'comments', label: 'Kommentare', icon: '💬' },
  { id: 'history', label: 'History', icon: '📜' },
  { id: 'decisions', label: 'Entscheidungen', icon: '🤖' },
];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  backlog: { label: 'Backlog', color: '#6B7280' },
  todo: { label: 'TODO', color: '#3B82F6' },
  in_progress: { label: 'Development', color: '#F59E0B' },
  in_review: { label: 'Review', color: '#8B5CF6' },
  done: { label: 'Done', color: '#10B981' },
  blocked: { label: 'Blocked', color: '#EF4444' },
};

const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  critical: { label: 'Kritisch', color: '#dc2626' },
  high: { label: 'Hoch', color: '#f97316' },
  medium: { label: 'Mittel', color: '#eab308' },
  low: { label: 'Niedrig', color: '#6b7280' },
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  epic: { label: 'Epic', color: '#8B5CF6' },
  story: { label: 'Story', color: '#3B82F6' },
  feature: { label: 'Feature', color: '#0EA5E9' },
  bug: { label: 'Bug', color: '#EF4444' },
  improvement: { label: 'Verbesserung', color: '#10B981' },
  task: { label: 'Task', color: '#6B7280' },
};

const LINK_LABELS: Record<string, string> = {
  blocked_by: 'Wartet auf',
  blocks: 'Blockiert',
  relates_to: 'Verwandt mit',
  duplicates: 'Dupliziert',
};

const RISK_COLORS: Record<string, string> = {
  low: '#10B981',
  medium: '#F59E0B',
  high: '#EF4444',
};

const AGENT_ICONS: Record<string, string> = {
  product_owner: '📋',
  scrum_master: '🛡️',
  technical_lead: '⚙️',
  developer: '💻',
  qa_engineer: '🔍',
  default: '🤖',
};

// =============================================================================
// Component
// =============================================================================

export function TicketDetailPanel({
  task,
  isOpen,
  onClose,
  onFetchComments,
  onFetchDecisions,
  allTasks,
  agents = [],
}: TicketDetailPanelProps) {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [comments, setComments] = useState<Comment[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [isLoadingDecisions, setIsLoadingDecisions] = useState(false);

  // Refs for focus management
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Touch handling for swipe
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Focus trap when panel opens
  useEffect(() => {
    if (isOpen && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Fetch comments when tab switches
  useEffect(() => {
    if (activeTab !== 'comments' || !task || !onFetchComments) return;

    setIsLoadingComments(true);
    onFetchComments(task.id)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setIsLoadingComments(false));
  }, [activeTab, task?.id, task?.updatedAt, onFetchComments]);

  // Fetch decisions when tab switches
  useEffect(() => {
    if (activeTab !== 'decisions' || !task || !onFetchDecisions) return;

    setIsLoadingDecisions(true);
    onFetchDecisions(task.id)
      .then(setDecisions)
      .catch(() => setDecisions([]))
      .finally(() => setIsLoadingDecisions(false));
  }, [activeTab, task?.id, task?.updatedAt, onFetchDecisions]);

  // Reset state when task changes
  useEffect(() => {
    setComments([]);
    setDecisions([]);
    setActiveTab('overview');
  }, [task?.id]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleTabKeyboard = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const tabCount = TABS.length;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = (index + 1) % tabCount;
        tabsRef.current[nextIndex]?.focus();
        setActiveTab(TABS[nextIndex].id);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = (index - 1 + tabCount) % tabCount;
        tabsRef.current[prevIndex]?.focus();
        setActiveTab(TABS[prevIndex].id);
      } else if (e.key === 'Home') {
        e.preventDefault();
        tabsRef.current[0]?.focus();
        setActiveTab(TABS[0].id);
      } else if (e.key === 'End') {
        e.preventDefault();
        tabsRef.current[tabCount - 1]?.focus();
        setActiveTab(TABS[tabCount - 1].id);
      }
    },
    []
  );

  // Touch handlers for swipe navigation
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 50;

    if (Math.abs(diff) > minSwipeDistance) {
      const currentIndex = TABS.findIndex((t) => t.id === activeTab);
      if (diff > 0 && currentIndex < TABS.length - 1) {
        // Swipe left -> next tab
        setActiveTab(TABS[currentIndex + 1].id);
      } else if (diff < 0 && currentIndex > 0) {
        // Swipe right -> prev tab
        setActiveTab(TABS[currentIndex - 1].id);
      }
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'gerade eben';
    if (diffMins < 60) return `vor ${diffMins} Min.`;
    if (diffHours < 24) return `vor ${diffHours} Std.`;
    if (diffDays === 1) return 'gestern';
    if (diffDays < 7) return `vor ${diffDays} Tagen`;
    return formatDate(dateString);
  };

  const getAgentIcon = (agentId: string | null): string => agentIcon(agentPresentation(agentId, agents)?.role);

  // ---------------------------------------------------------------------------
  // Render Helpers
  // ---------------------------------------------------------------------------

  const renderOverviewTab = () => {
    if (!task) return null;

    const statusInfo = STATUS_LABELS[task.column] || { label: task.column, color: '#6B7280' };
    const priorityInfo = PRIORITY_LABELS[task.priority] || { label: task.priority, color: '#6B7280' };
    const typeInfo = TYPE_LABELS[task.type] || { label: task.type, color: '#6B7280' };

    /** Löst eine Ticket-ID zum Titel auf; ohne Board-Liste bleibt die Kurz-ID. */
    const titleOf = (id: string): string =>
      allTasks?.find((t) => t.id === id)?.title ?? `#${id.slice(0, 8)}`;

    const subtasks = allTasks?.filter((t) => t.parentId === task.id) ?? [];
    const metCriteria = task.acceptanceCriteria.filter((c) => c.met).length;
    const assignee = agentPresentation(task.assignedAgentId, agents);

    return (
      <div className="ticket-detail-overview">
        {/* Title, ID & Typ */}
        <div className="ticket-detail-header-info">
          <span className="ticket-detail-id">#{task.id.slice(0, 8)}</span>
          <span
            className="ticket-detail-type-badge"
            style={{ backgroundColor: typeInfo.color }}
          >
            {typeInfo.label}
          </span>
          <h2 className="ticket-detail-title">{task.title}</h2>
        </div>

        {/* Status & Priority Row */}
        <div className="ticket-detail-meta">
          <div className="ticket-detail-meta-item">
            <span className="ticket-detail-meta-label">Status</span>
            <span
              className="ticket-detail-status-badge"
              style={{ backgroundColor: statusInfo.color }}
            >
              {statusInfo.label}
            </span>
          </div>
          <div className="ticket-detail-meta-item">
            <span className="ticket-detail-meta-label">Priorität</span>
            <span
              className="ticket-detail-priority-badge"
              style={{ backgroundColor: priorityInfo.color }}
            >
              {priorityInfo.label}
            </span>
          </div>
          <div className="ticket-detail-meta-item">
            <span className="ticket-detail-meta-label">Story Points</span>
            <span className="ticket-detail-points">{task.storyPoints} SP</span>
          </div>
        </div>

        {/* Assignee */}
        {assignee && (
          <div className="ticket-detail-assignee">
            <span className="ticket-detail-meta-label">Zugewiesen an</span>
            <div className="ticket-detail-assignee-info">
              <span className="ticket-detail-assignee-icon">{agentIcon(assignee.role)}</span>
              <span className="ticket-detail-assignee-name">{assignee.name}</span>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="ticket-detail-section">
          <h3 className="ticket-detail-section-title">Beschreibung</h3>
          <div className="ticket-detail-description">
            {task.description || <em>Keine Beschreibung</em>}
          </div>
        </div>

        {/* Labels */}
        {task.labels.length > 0 && (
          <div className="ticket-detail-section">
            <h3 className="ticket-detail-section-title">Labels</h3>
            <div className="ticket-detail-labels">
              {task.labels.map((label) => (
                <span key={label} className="ticket-detail-label">
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Akzeptanzkriterien (Spec §5) — die QA hakt sie im Review ab */}
        <div className="ticket-detail-section">
          <h3 className="ticket-detail-section-title">
            Akzeptanzkriterien{' '}
            {task.acceptanceCriteria.length > 0 && (
              <span className="ticket-detail-section-count">
                {metCriteria}/{task.acceptanceCriteria.length}
              </span>
            )}
          </h3>
          {task.acceptanceCriteria.length === 0 ? (
            <p className="ticket-detail-empty">
              <em>Noch keine — das Ticket ist nicht verfeinert.</em>
            </p>
          ) : (
            <ul className="ticket-detail-criteria">
              {task.acceptanceCriteria.map((criterion) => (
                <li
                  key={criterion.id}
                  className={`ticket-detail-criterion ${criterion.met ? 'is-met' : ''}`}
                >
                  <span className="ticket-detail-criterion-mark" aria-hidden="true">
                    {criterion.met ? '☑' : '☐'}
                  </span>
                  <span className="ticket-detail-criterion-text">
                    {criterion.text}
                    {criterion.met && criterion.verifiedBy && (
                      <span className="ticket-detail-criterion-meta">
                        {' '}
                        — geprüft von {agentPresentation(criterion.verifiedBy, agents)?.name ?? criterion.verifiedBy}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Technische Hinweise aus dem Refinement */}
        {task.technicalNotes && (
          <div className="ticket-detail-section">
            <h3 className="ticket-detail-section-title">Technische Hinweise</h3>
            <div className="ticket-detail-description">{task.technicalNotes}</div>
          </div>
        )}

        {/* Subtasks (Spec §5) */}
        {subtasks.length > 0 && (
          <div className="ticket-detail-section">
            <h3 className="ticket-detail-section-title">
              Subtasks{' '}
              <span className="ticket-detail-section-count">
                {subtasks.filter((t) => t.column === 'done').length}/{subtasks.length}
              </span>
            </h3>
            <ul className="ticket-detail-links">
              {subtasks.map((sub) => (
                <li key={sub.id} className="ticket-detail-link-item">
                  <span
                    className="ticket-detail-link-status"
                    style={{ backgroundColor: STATUS_LABELS[sub.column]?.color ?? '#6B7280' }}
                  >
                    {STATUS_LABELS[sub.column]?.label ?? sub.column}
                  </span>
                  <span className="ticket-detail-link-title">{sub.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Verlinkte Tickets inkl. Abhängigkeiten (Spec §5) */}
        {task.links.length > 0 && (
          <div className="ticket-detail-section">
            <h3 className="ticket-detail-section-title">Verlinkte Tickets</h3>
            <ul className="ticket-detail-links">
              {task.links.map((link) => (
                <li key={`${link.type}-${link.taskId}`} className="ticket-detail-link-item">
                  <span className="ticket-detail-link-type">
                    {LINK_LABELS[link.type] ?? link.type}
                  </span>
                  <span className="ticket-detail-link-title">{titleOf(link.taskId)}</span>
                  {link.note && <span className="ticket-detail-link-note">{link.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Im Refinement erfasste Risiken */}
        {task.risks.length > 0 && (
          <div className="ticket-detail-section">
            <h3 className="ticket-detail-section-title">Risiken</h3>
            <ul className="ticket-detail-risks">
              {task.risks.map((risk) => (
                <li key={risk.id} className="ticket-detail-risk">
                  <span
                    className="ticket-detail-risk-badge"
                    style={{ backgroundColor: RISK_COLORS[risk.severity] ?? '#6B7280' }}
                  >
                    {risk.severity}
                  </span>
                  <span className="ticket-detail-risk-text">
                    {risk.description}
                    {risk.mitigation && (
                      <span className="ticket-detail-risk-mitigation">
                        {' '}
                        — Gegenmaßnahme: {risk.mitigation}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Timestamps */}
        <div className="ticket-detail-section ticket-detail-timestamps">
          <h3 className="ticket-detail-section-title">Zeitstempel</h3>
          <div className="ticket-detail-timestamp-grid">
            <div className="ticket-detail-timestamp">
              <span className="ticket-detail-timestamp-label">Erstellt</span>
              <span className="ticket-detail-timestamp-value">{formatDate(task.createdAt)}</span>
            </div>
            <div className="ticket-detail-timestamp">
              <span className="ticket-detail-timestamp-label">Aktualisiert</span>
              <span className="ticket-detail-timestamp-value">{formatDate(task.updatedAt)}</span>
            </div>
            {task.startedAt && (
              <div className="ticket-detail-timestamp">
                <span className="ticket-detail-timestamp-label">Gestartet</span>
                <span className="ticket-detail-timestamp-value">{formatDate(task.startedAt)}</span>
              </div>
            )}
            {task.completedAt && (
              <div className="ticket-detail-timestamp">
                <span className="ticket-detail-timestamp-label">Abgeschlossen</span>
                <span className="ticket-detail-timestamp-value">{formatDate(task.completedAt)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCommentsTab = () => {
    if (isLoadingComments) {
      return (
        <div className="ticket-detail-loading">
          <div className="ticket-detail-loading-spinner" />
          <span>Kommentare werden geladen...</span>
        </div>
      );
    }

    if (comments.length === 0) {
      return (
        <div className="ticket-detail-empty">
          <span className="ticket-detail-empty-icon">💬</span>
          <span className="ticket-detail-empty-text">Noch keine Kommentare</span>
        </div>
      );
    }

    return (
      <div className="ticket-detail-comments">
        {comments.map((comment) => (
          <div key={comment.id} className="ticket-detail-comment">
            <div className="ticket-detail-comment-header">
              <div className="ticket-detail-comment-author">
                <span className="ticket-detail-comment-icon">{getAgentIcon(comment.authorId)}</span>
                <span className="ticket-detail-comment-name">{comment.authorName}</span>
                <span className="ticket-detail-comment-role">({comment.authorRole})</span>
              </div>
              <span className="ticket-detail-comment-time" title={formatDate(comment.createdAt)}>
                {formatRelativeTime(comment.createdAt)}
              </span>
            </div>
            <div className="ticket-detail-comment-body">{comment.body}</div>
          </div>
        ))}
      </div>
    );
  };

  const renderHistoryTab = () => {
    if (!task || task.statusHistory.length === 0) {
      return (
        <div className="ticket-detail-empty">
          <span className="ticket-detail-empty-icon">📜</span>
          <span className="ticket-detail-empty-text">Keine Status-Änderungen</span>
        </div>
      );
    }

    // Sort by timestamp descending (newest first)
    const sortedHistory = [...task.statusHistory].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return (
      <div className="ticket-detail-history">
        <div className="ticket-detail-history-timeline">
          {sortedHistory.map((entry, index) => {
            const fromInfo = entry.from ? STATUS_LABELS[entry.from] : null;
            const toInfo = STATUS_LABELS[entry.to] || { label: entry.to, color: '#6B7280' };

            return (
              <div key={index} className="ticket-detail-history-item">
                <div className="ticket-detail-history-dot" style={{ backgroundColor: toInfo.color }} />
                <div className="ticket-detail-history-content">
                  <div className="ticket-detail-history-transition">
                    {fromInfo ? (
                      <>
                        <span
                          className="ticket-detail-history-status"
                          style={{ backgroundColor: fromInfo.color }}
                        >
                          {fromInfo.label}
                        </span>
                        <span className="ticket-detail-history-arrow">→</span>
                        <span
                          className="ticket-detail-history-status"
                          style={{ backgroundColor: toInfo.color }}
                        >
                          {toInfo.label}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="ticket-detail-history-created">Erstellt in</span>
                        <span
                          className="ticket-detail-history-status"
                          style={{ backgroundColor: toInfo.color }}
                        >
                          {toInfo.label}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="ticket-detail-history-meta">
                    <span className="ticket-detail-history-time" title={formatDate(entry.timestamp)}>
                      {formatRelativeTime(entry.timestamp)}
                    </span>
                    {entry.triggeredBy && (
                      <span className="ticket-detail-history-agent">
                        <span className="ticket-detail-history-agent-icon">
                          {getAgentIcon(entry.triggeredBy)}
                        </span>
                        {entry.triggeredBy}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDecisionsTab = () => {
    if (isLoadingDecisions) {
      return (
        <div className="ticket-detail-loading">
          <div className="ticket-detail-loading-spinner" />
          <span>Entscheidungen werden geladen...</span>
        </div>
      );
    }

    if (decisions.length === 0) {
      return (
        <div className="ticket-detail-empty">
          <span className="ticket-detail-empty-icon">🤖</span>
          <span className="ticket-detail-empty-text">Keine automatischen Entscheidungen</span>
        </div>
      );
    }

    const DECISION_ICONS: Record<Decision['type'], string> = {
      auto_assign: '👤',
      status_change: '🔄',
      priority_change: '⚡',
      estimation: '📊',
      refinement: '🔧',
      review_passed: '✅',
      review_rejected: '↩️',
      blocked: '🚫',
      unblocked: '✅',
      ceremony: '🧭',
    };

    return (
      <div className="ticket-detail-decisions">
        {decisions.map((decision) => (
          <div key={decision.id} className="ticket-detail-decision">
            <div className="ticket-detail-decision-header">
              <span className="ticket-detail-decision-icon">{DECISION_ICONS[decision.type]}</span>
              <span className="ticket-detail-decision-type">{decision.description}</span>
              <span className="ticket-detail-decision-time" title={formatDate(decision.timestamp)}>
                {formatRelativeTime(decision.timestamp)}
              </span>
            </div>
            <div className="ticket-detail-decision-reasoning">
              <span className="ticket-detail-decision-reasoning-label">Begründung:</span>
              <span className="ticket-detail-decision-reasoning-text">{decision.reasoning}</span>
            </div>
            <div className="ticket-detail-decision-agent">
              <span className="ticket-detail-decision-agent-icon">{getAgentIcon(decision.madeBy)}</span>
              <span className="ticket-detail-decision-agent-name">{decision.madeBy}</span>
              <span className="ticket-detail-decision-agent-role">({decision.madeByRole})</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverviewTab();
      case 'comments':
        return renderCommentsTab();
      case 'history':
        return renderHistoryTab();
      case 'decisions':
        return renderDecisionsTab();
      default:
        return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!isOpen || !task) {
    return null;
  }

  return (
    <div
      className="ticket-detail-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ticket-detail-title"
    >
      <div
        ref={panelRef}
        className="ticket-detail-panel"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Header */}
        <div className="ticket-detail-header">
          <h2 id="ticket-detail-title" className="ticket-detail-header-title">
            Ticket Details
          </h2>
          <button
            ref={closeButtonRef}
            className="ticket-detail-close"
            onClick={onClose}
            aria-label="Panel schließen"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="ticket-detail-tabs" role="tablist" aria-label="Ticket-Informationen">
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabsRef.current[index] = el;
              }}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              className={`ticket-detail-tab ${activeTab === tab.id ? 'ticket-detail-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => handleTabKeyboard(e, index)}
              tabIndex={activeTab === tab.id ? 0 : -1}
            >
              <span className="ticket-detail-tab-icon">{tab.icon}</span>
              <span className="ticket-detail-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div
          className="ticket-detail-content"
          role="tabpanel"
          id={`tabpanel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
        >
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}
