/**
 * KanbanCard Component
 *
 * Ticket-Karte mit:
 * - Titel
 * - Priorität (visuell hervorgehoben)
 * - Story Points
 * - Assignee (Agent)
 * - Labels
 * - Drag & Drop Support
 * - Click to open Details
 * - Keyboard Navigation
 */

import { useRef, KeyboardEvent, DragEvent, MouseEvent } from 'react';
import type { ScrumTask } from '../../core/types';
import { useDragDropOptional, isDraggable, getDragId, DragDropContextValue } from './DragDropContext';

interface KanbanCardProps {
  task: ScrumTask;
  /** Callback when card is clicked to open details */
  onOpenDetails?: (task: ScrumTask) => void;
  /** Whether drag & drop is enabled */
  enableDragDrop?: boolean;
  /** Index for keyboard navigation */
  index?: number;
  /** Callback for keyboard navigation */
  onKeyboardNavigation?: (direction: 'up' | 'down' | 'left' | 'right', index: number) => void;
  /** Optionally inject the drag context (if not available via hook) */
  dragDropContext?: DragDropContextValue | null;
}

// Priorität zu Farbe Mapping
const PRIORITY_COLORS: Record<ScrumTask['priority'], { bg: string; text: string; label: string }> = {
  critical: { bg: '#dc2626', text: '#ffffff', label: 'Kritisch' },
  high: { bg: '#f97316', text: '#ffffff', label: 'Hoch' },
  medium: { bg: '#eab308', text: '#000000', label: 'Mittel' },
  low: { bg: '#6b7280', text: '#ffffff', label: 'Niedrig' },
};

// Ticket-Typ zu Kurzlabel (Spec §3: Epic, Story, Feature, Bug, Verbesserung)
const TYPE_BADGES: Record<ScrumTask['type'], { label: string; color: string }> = {
  epic: { label: 'Epic', color: '#8B5CF6' },
  story: { label: 'Story', color: '#3B82F6' },
  feature: { label: 'Feat', color: '#0EA5E9' },
  bug: { label: 'Bug', color: '#EF4444' },
  improvement: { label: 'Verb', color: '#10B981' },
  task: { label: 'Task', color: '#6B7280' },
};

// Agent Icons basierend auf Rolle
const AGENT_ICONS: Record<string, string> = {
  product_owner: '📋',
  scrum_master: '🛡️',
  technical_lead: '⚙️',
  developer: '💻',
  qa_engineer: '🔍',
  default: '🤖',
};

export function KanbanCard({
  task,
  onOpenDetails,
  enableDragDrop = true,
  index = 0,
  onKeyboardNavigation,
  dragDropContext: injectedDragContext,
}: KanbanCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const priorityStyle = PRIORITY_COLORS[task.priority];
  const typeBadge = TYPE_BADGES[task.type] ?? TYPE_BADGES.task;

  // Fortschritt der Akzeptanzkriterien — im Review der wichtigste Indikator
  const criteriaTotal = task.acceptanceCriteria.length;
  const criteriaMet = task.acceptanceCriteria.filter((c) => c.met).length;
  const shortId = task.id.slice(0, 8);

  // Drag & Drop Context - use injected context or try the hook
  const hookContext = useDragDropOptional();
  const dragContext = injectedDragContext ?? hookContext;

  const canDrag = Boolean(enableDragDrop && dragContext && isDraggable(task, dragContext.allowedTransitions));
  const isDraggingTask = Boolean(dragContext?.state.isDragging && dragContext?.state.draggedTask?.id === task.id);

  // Agent-Info extrahieren (falls vorhanden)
  const getAgentIcon = (agentId: string | null): string => {
    if (!agentId) return '';
    // Versuche Rolle aus Agent-ID zu extrahieren (vereinfacht)
    // In Produktion würde man hier den Agent-Namen nachschlagen
    for (const [role, icon] of Object.entries(AGENT_ICONS)) {
      if (agentId.toLowerCase().includes(role.replace('_', ''))) {
        return icon;
      }
    }
    return AGENT_ICONS.default;
  };

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  const handleClick = (e: MouseEvent) => {
    // Don't open details if dragging
    if (dragContext?.state.isDragging) return;

    // Call the details callback
    if (onOpenDetails) {
      e.stopPropagation();
      onOpenDetails(task);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (onOpenDetails) {
          onOpenDetails(task);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        onKeyboardNavigation?.('up', index);
        break;
      case 'ArrowDown':
        e.preventDefault();
        onKeyboardNavigation?.('down', index);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        onKeyboardNavigation?.('left', index);
        break;
      case 'ArrowRight':
        e.preventDefault();
        onKeyboardNavigation?.('right', index);
        break;
    }
  };

  // ---------------------------------------------------------------------------
  // Drag & Drop Handlers
  // ---------------------------------------------------------------------------

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (!canDrag || !dragContext) return;

    // Set drag data
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.setData('application/json', JSON.stringify(task));
    e.dataTransfer.effectAllowed = 'move';

    // Start drag in context
    dragContext.startDrag(task);

    // Add dragging class after a frame (for visual feedback)
    requestAnimationFrame(() => {
      if (cardRef.current) {
        cardRef.current.classList.add('kanban-card--dragging');
      }
    });
  };

  const handleDragEnd = () => {
    if (!dragContext) return;

    // Remove dragging class
    if (cardRef.current) {
      cardRef.current.classList.remove('kanban-card--dragging');
    }

    // End drag in context
    dragContext.endDrag();
  };

  // ---------------------------------------------------------------------------
  // CSS Classes
  // ---------------------------------------------------------------------------

  const cardClasses = [
    'kanban-card',
    canDrag && 'kanban-card--draggable',
    isDraggingTask && 'kanban-card--is-dragging',
    onOpenDetails && 'kanban-card--clickable',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={cardRef}
      className={cardClasses}
      data-task-id={task.id}
      data-priority={task.priority}
      id={getDragId(task)}
      draggable={canDrag}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={
        `${typeBadge.label}: ${task.title}. Priorität: ${priorityStyle.label}. ` +
        `${task.storyPoints} Story Points. ` +
        (criteriaTotal > 0 ? `${criteriaMet} von ${criteriaTotal} Akzeptanzkriterien erfüllt. ` : '') +
        'Drücke Enter für Details.'
      }
      aria-grabbed={isDraggingTask || undefined}
    >
      {/* Card Header: ID + Typ + Story Points */}
      <div className="kanban-card-header">
        <span className="kanban-card-id">#{shortId}</span>
        <span
          className="kanban-card-type"
          style={{ backgroundColor: typeBadge.color }}
          title={`Typ: ${typeBadge.label}`}
        >
          {typeBadge.label}
        </span>
        <div className="kanban-card-header-right">
          {/* Priorität Badge */}
          <span
            className="kanban-card-priority"
            style={{ backgroundColor: priorityStyle.bg, color: priorityStyle.text }}
            title={`Priorität: ${priorityStyle.label}`}
          >
            {priorityStyle.label}
          </span>
          {/* Story Points */}
          {task.storyPoints > 0 && (
            <span className="kanban-card-points" title="Story Points">
              {task.storyPoints} SP
            </span>
          )}
        </div>
      </div>

      {/* Titel */}
      <h3 className="kanban-card-title">{task.title}</h3>

      {/* Beschreibung (gekürzt) */}
      {task.description && <p className="kanban-card-description">{task.description}</p>}

      {/* Akzeptanzkriterien-Fortschritt */}
      {criteriaTotal > 0 && (
        <div
          className={`kanban-card-criteria ${criteriaMet === criteriaTotal ? 'is-complete' : ''}`}
          title={`${criteriaMet} von ${criteriaTotal} Akzeptanzkriterien erfüllt`}
        >
          <span aria-hidden="true">☑</span> {criteriaMet}/{criteriaTotal} AC
        </div>
      )}

      {/* Im Backlog ohne Refinement: das Ticket ist nicht sprintreif (Spec §3) */}
      {!task.refined && task.column === 'backlog' && (
        <div className="kanban-card-unrefined" title="Noch nicht verfeinert">
          <span aria-hidden="true">✎</span> Refinement offen
        </div>
      )}

      {/* Footer: Labels + Assignee */}
      <div className="kanban-card-footer">
        {/* Labels */}
        <div className="kanban-card-labels">
          {task.labels.slice(0, 3).map((label) => (
            <span key={label} className="kanban-card-label">
              {label}
            </span>
          ))}
          {task.labels.length > 3 && (
            <span className="kanban-card-label kanban-card-label--more" title={task.labels.slice(3).join(', ')}>
              +{task.labels.length - 3}
            </span>
          )}
        </div>

        {/* Assignee */}
        {task.assignedAgentId && (
          <div className="kanban-card-assignee" title={`Zugewiesen: ${task.assignedAgentId}`}>
            <span className="kanban-card-assignee-icon">{getAgentIcon(task.assignedAgentId)}</span>
          </div>
        )}
      </div>

      {/* Blocked Indicator */}
      {task.column === 'blocked' && (
        <div className="kanban-card-blocked">
          <span className="kanban-card-blocked-icon">🚫</span>
          <span className="kanban-card-blocked-text">Blockiert</span>
        </div>
      )}
    </div>
  );
}
