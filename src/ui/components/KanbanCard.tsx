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
import type { ScrumAgent, ScrumTask } from '../../core/types';
import { useDragDropOptional, isDraggable, getDragId, DragDropContextValue } from './DragDropContext';
import { agentIcon, agentPresentation } from './agent-presentation';
import { ticketDisplayId } from './ticket-display-id';
import { isAgentWorkOrderTicket } from '../../core/meta-ticket';

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
  /** Managed team members used to render the assignee by name rather than UUID. */
  agents?: Array<Pick<ScrumAgent, 'id' | 'name' | 'role'>>;
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
  agents = [],
}: KanbanCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const priorityStyle = PRIORITY_COLORS[task.priority];
  const typeBadge = TYPE_BADGES[task.type] ?? TYPE_BADGES.task;

  // Fortschritt der Akzeptanzkriterien — im Review der wichtigste Indikator
  const criteriaTotal = task.acceptanceCriteria.length;
  const criteriaMet = task.acceptanceCriteria.filter((c) => c.met).length;
  const displayId = ticketDisplayId(task);
  const assignee = agentPresentation(task.assignedAgentId, agents);

  // Drag & Drop Context - use injected context or try the hook
  const hookContext = useDragDropOptional();
  const dragContext = injectedDragContext ?? hookContext;

  const canDrag = Boolean(enableDragDrop && dragContext && isDraggable(task, dragContext.allowedTransitions));
  const isDraggingTask = Boolean(dragContext?.state.isDragging && dragContext?.state.draggedTask?.id === task.id);

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

  // Ein Agenten-Arbeitsauftrag ist keine Story: er wird nie verfeinert und
  // zaehlt nicht in die Sprintreife. Sichtbar bleibt er trotzdem — verstecken
  // hiesse wieder, Arbeit zu verschweigen.
  const isWorkOrder = isAgentWorkOrderTicket(task);

  // Was genau fehlt: die Schaetzung, die Kriterien, oder beides.
  const unrefinedReason =
    task.storyPoints > 0 && criteriaTotal === 0
      ? 'Akzeptanzkriterien fehlen'
      : criteriaTotal > 0 && task.storyPoints === 0
        ? 'Schätzung fehlt'
        : 'Refinement offen';

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
        <span className="kanban-card-id">{displayId}</span>
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

      {/* Im Backlog ohne Refinement: das Ticket ist nicht sprintreif (Spec §3).
          Welche Haelfte fehlt, gehoert dazu — "Refinement offen" an einem
          Ticket mit sichtbaren 3 SP liest sich sonst wie ein Widerspruch. */}
      {isWorkOrder ? (
        <div className="kanban-card-work-order" title="Arbeitsauftrag eines Agenten, kein Backlog-Item">
          <span aria-hidden="true">◷</span> Arbeitsauftrag — zählt nicht zum Sprint
        </div>
      ) : (
        !task.refined && task.column === 'backlog' && (
          <div className="kanban-card-unrefined" title={unrefinedReason}>
            <span aria-hidden="true">✎</span> {unrefinedReason}
          </div>
        )
      )}

      {/* Wohin dieses Ticket liefert — sonst steht der Branch nur in einem
          Kommentar, und der Human muss das Ticket oeffnen, um ihn zu finden. */}
      {task.deliveryBranch && (
        <div className="kanban-card-branch" title={`Lieferbranch: ${task.deliveryBranch}`}>
          <span aria-hidden="true">⑂</span> {task.deliveryBranch}
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
        {assignee && (
          <div className="kanban-card-assignee" title={`Zugewiesen: ${assignee.name}`}>
            <span className="kanban-card-assignee-icon">{agentIcon(assignee.role)}</span>
            <span className="kanban-card-assignee-name">{assignee.name}</span>
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
