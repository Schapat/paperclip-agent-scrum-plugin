/**
 * KanbanBoard Component
 *
 * Interaktives Kanban-Board mit:
 * - 5 Spalten: Backlog, TODO, Development, Review, Done
 * - WIP-Limit Anzeige
 * - Polling für Echtzeit-Updates (5s Intervall)
 * - Responsive Design
 * - Loading States und Error Handling
 * - Drag & Drop für erlaubte Übergänge
 * - Ticket-Detail-Panel (Click to open)
 * - Keyboard Navigation
 * - Mobile-optimiert
 */

import { useEffect, useState, useCallback } from 'react';
import type { ScrumTask, TaskStatus } from '../../core/types';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { DragDropProvider, useDragDrop, DEFAULT_ALLOWED_TRANSITIONS } from './DragDropContext';
import { TicketDetailPanel, Comment, Decision } from './TicketDetailPanel';

// =============================================================================
// Types
// =============================================================================

export interface Column {
  id: TaskStatus;
  displayName: string;
  color: string;
  wipLimit?: number;
}

interface KanbanBoardProps {
  /** Initial tasks to display */
  initialTasks?: ScrumTask[];
  /** Polling interval in ms (default: 5000) */
  pollingInterval?: number;
  /** Callback to fetch tasks from API */
  onFetchTasks?: () => Promise<ScrumTask[]>;
  /** Show loading skeleton while fetching */
  showLoadingSkeleton?: boolean;
  /** Callback when a task is moved via drag & drop */
  onMoveTask?: (task: ScrumTask, from: TaskStatus, to: TaskStatus) => Promise<boolean>;
  /** Enable drag & drop functionality */
  enableDragDrop?: boolean;
  /** Callback to fetch comments for a task */
  onFetchComments?: (taskId: string) => Promise<Comment[]>;
  /** Callback to fetch decisions for a task */
  onFetchDecisions?: (taskId: string) => Promise<Decision[]>;
}

interface BoardState {
  tasks: ScrumTask[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  selectedTask: ScrumTask | null;
  isDetailPanelOpen: boolean;
}

// =============================================================================
// Constants
// =============================================================================

export const COLUMNS: Column[] = [
  { id: 'backlog', displayName: 'Backlog', color: '#6B7280' },
  { id: 'todo', displayName: 'TODO', color: '#3B82F6', wipLimit: 10 },
  { id: 'in_progress', displayName: 'Development', color: '#F59E0B', wipLimit: 4 },
  { id: 'in_review', displayName: 'Review', color: '#8B5CF6', wipLimit: 3 },
  { id: 'done', displayName: 'Done', color: '#10B981' },
];

// =============================================================================
// Component
// =============================================================================

// =============================================================================
// Inner Component (with DragDrop context access)
// =============================================================================

function KanbanBoardInner({
  initialTasks = [],
  pollingInterval = 5000,
  onFetchTasks,
  showLoadingSkeleton = true,
  onMoveTask,
  enableDragDrop = true,
  onFetchComments,
  onFetchDecisions,
}: KanbanBoardProps) {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const [state, setState] = useState<BoardState>({
    tasks: initialTasks,
    isLoading: initialTasks.length === 0,
    error: null,
    lastUpdated: initialTasks.length > 0 ? new Date() : null,
    selectedTask: null,
    isDetailPanelOpen: false,
  });

  // Drag & Drop context
  const dragContext = useDragDrop();

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  const fetchTasks = useCallback(async () => {
    if (!onFetchTasks) return;

    try {
      const tasks = await onFetchTasks();
      setState((prev) => ({
        ...prev,
        tasks,
        isLoading: false,
        error: null,
        lastUpdated: new Date(),
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Fehler beim Laden der Tasks',
      }));
    }
  }, [onFetchTasks]);

  // Initial fetch
  useEffect(() => {
    if (onFetchTasks && initialTasks.length === 0) {
      fetchTasks();
    }
  }, [onFetchTasks, initialTasks.length, fetchTasks]);

  // Polling für Echtzeit-Updates (5s Intervall)
  useEffect(() => {
    if (!onFetchTasks || pollingInterval <= 0) return;

    const intervalId = setInterval(() => {
      fetchTasks();
    }, pollingInterval);

    return () => clearInterval(intervalId);
  }, [onFetchTasks, pollingInterval, fetchTasks]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const getTasksForColumn = (columnId: TaskStatus): ScrumTask[] => {
    return state.tasks.filter((task) => task.column === columnId);
  };

  const getColumnStats = (columnId: TaskStatus) => {
    const tasks = getTasksForColumn(columnId);
    const column = COLUMNS.find((c) => c.id === columnId);
    const wipLimit = column?.wipLimit;
    const isOverLimit = wipLimit !== undefined && tasks.length > wipLimit;
    const isAtLimit = wipLimit !== undefined && tasks.length === wipLimit;

    return {
      count: tasks.length,
      wipLimit,
      isOverLimit,
      isAtLimit,
      totalPoints: tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0),
    };
  };

  // ---------------------------------------------------------------------------
  // Task Operations
  // ---------------------------------------------------------------------------

  const handleOpenDetails = useCallback((task: ScrumTask) => {
    setState((prev) => ({
      ...prev,
      selectedTask: task,
      isDetailPanelOpen: true,
    }));
  }, []);

  const handleCloseDetails = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isDetailPanelOpen: false,
    }));
  }, []);

  const handleMoveTask = useCallback(
    async (task: ScrumTask, from: TaskStatus, to: TaskStatus): Promise<boolean> => {
      // Optimistic update
      setState((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                column: to,
                statusHistory: [
                  ...t.statusHistory,
                  {
                    from,
                    to,
                    timestamp: new Date().toISOString(),
                    triggeredBy: 'user',
                  },
                ],
              }
            : t
        ),
      }));

      // Call external handler if provided
      if (onMoveTask) {
        try {
          const success = await onMoveTask(task, from, to);
          if (!success) {
            // Revert on failure
            setState((prev) => ({
              ...prev,
              tasks: prev.tasks.map((t) => (t.id === task.id ? { ...t, column: from } : t)),
            }));
            return false;
          }
        } catch (error) {
          // Revert on error
          setState((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === task.id ? { ...t, column: from } : t)),
          }));
          console.error('Failed to move task:', error);
          return false;
        }
      }

      return true;
    },
    [onMoveTask]
  );

  // ---------------------------------------------------------------------------
  // Keyboard Navigation
  // ---------------------------------------------------------------------------

  const handleKeyboardNavigation = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right', taskIndex: number) => {
      // Get current column of focused task
      const allTasks = state.tasks;
      const currentColumnIndex = COLUMNS.findIndex((col) =>
        allTasks.some((t, i) => i === taskIndex && t.column === col.id)
      );

      switch (direction) {
        case 'up':
          // Move to previous task in same column
          // This is handled by the browser's default tabbing
          break;
        case 'down':
          // Move to next task in same column
          break;
        case 'left':
          // Move focus to previous column
          if (currentColumnIndex > 0) {
            const prevColumn = COLUMNS[currentColumnIndex - 1];
            const prevColumnTasks = getTasksForColumn(prevColumn.id);
            if (prevColumnTasks.length > 0) {
              const taskElement = document.querySelector(
                `[data-column-id="${prevColumn.id}"] .kanban-card`
              ) as HTMLElement;
              taskElement?.focus();
            }
          }
          break;
        case 'right':
          // Move focus to next column
          if (currentColumnIndex < COLUMNS.length - 1) {
            const nextColumn = COLUMNS[currentColumnIndex + 1];
            const nextColumnTasks = getTasksForColumn(nextColumn.id);
            if (nextColumnTasks.length > 0) {
              const taskElement = document.querySelector(
                `[data-column-id="${nextColumn.id}"] .kanban-card`
              ) as HTMLElement;
              taskElement?.focus();
            }
          }
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.tasks]
  );

  // ---------------------------------------------------------------------------
  // Render: Error State
  // ---------------------------------------------------------------------------

  if (state.error && state.tasks.length === 0) {
    return (
      <div className="kanban-error">
        <div className="kanban-error-icon">⚠️</div>
        <h3 className="kanban-error-title">Fehler beim Laden</h3>
        <p className="kanban-error-message">{state.error}</p>
        <button className="kanban-error-retry" onClick={fetchTasks}>
          Erneut versuchen
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Loading State
  // ---------------------------------------------------------------------------

  if (state.isLoading && showLoadingSkeleton) {
    return (
      <div className="kanban-board kanban-board--loading">
        {COLUMNS.map((column) => (
          <div key={column.id} className="kanban-column kanban-column--skeleton">
            <div className="kanban-column-header" style={{ borderTopColor: column.color }}>
              <div className="kanban-column-header-left">
                <span className="kanban-column-title">{column.displayName}</span>
              </div>
              <div className="kanban-column-header-right">
                <span className="kanban-column-count kanban-column-count--skeleton" />
              </div>
            </div>
            <div className="kanban-column-content">
              {[1, 2, 3].map((i) => (
                <div key={i} className="kanban-card kanban-card--skeleton">
                  <div className="kanban-card-skeleton-line kanban-card-skeleton-line--short" />
                  <div className="kanban-card-skeleton-line kanban-card-skeleton-line--long" />
                  <div className="kanban-card-skeleton-line kanban-card-skeleton-line--medium" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Board
  // ---------------------------------------------------------------------------

  return (
    <div className="kanban-board" role="application" aria-label="Kanban Board">
      {/* Status Bar */}
      <div className="kanban-status-bar">
        {state.lastUpdated && (
          <span className="kanban-status-updated">
            Zuletzt aktualisiert: {state.lastUpdated.toLocaleTimeString('de-DE')}
          </span>
        )}
        {state.error && (
          <span className="kanban-status-error">
            ⚠️ Verbindungsfehler - Retry in {Math.round(pollingInterval / 1000)}s
          </span>
        )}
        <span className="kanban-status-total">Gesamt: {state.tasks.length} Tasks</span>
        {enableDragDrop && (
          <span className="kanban-status-hint">
            💡 Drag & Drop zum Verschieben • Klicken für Details
          </span>
        )}
      </div>

      {/* Columns */}
      <div className="kanban-columns">
        {COLUMNS.map((column) => {
          const tasks = getTasksForColumn(column.id);
          const stats = getColumnStats(column.id);

          return (
            <KanbanColumn
              key={column.id}
              id={column.id}
              displayName={column.displayName}
              color={column.color}
              count={stats.count}
              wipLimit={stats.wipLimit}
              isOverLimit={stats.isOverLimit}
              isAtLimit={stats.isAtLimit}
              totalPoints={stats.totalPoints}
              enableDrop={enableDragDrop}
              canDrop={dragContext.canDrop}
              getDropValidation={dragContext.getDropValidation}
              onDrop={handleMoveTask}
            >
              {tasks.length === 0 ? (
                <div className="kanban-column-empty">Keine Tasks</div>
              ) : (
                tasks.map((task, index) => (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    onOpenDetails={handleOpenDetails}
                    enableDragDrop={enableDragDrop}
                    index={index}
                    onKeyboardNavigation={handleKeyboardNavigation}
                  />
                ))
              )}
            </KanbanColumn>
          );
        })}
      </div>

      {/* Ticket Detail Panel */}
      <TicketDetailPanel
        task={state.selectedTask}
        isOpen={state.isDetailPanelOpen}
        onClose={handleCloseDetails}
        onFetchComments={onFetchComments}
        onFetchDecisions={onFetchDecisions}
        // Damit das Panel Subtasks und verlinkte Tickets mit Titel auflösen kann
        allTasks={state.tasks}
      />
    </div>
  );
}

// =============================================================================
// Main Component (with DragDrop Provider wrapper)
// =============================================================================

export function KanbanBoard(props: KanbanBoardProps) {
  const { onMoveTask, enableDragDrop = true } = props;

  // Wrap in DragDropProvider if drag & drop is enabled
  if (enableDragDrop) {
    return (
      <DragDropProvider onMoveTask={onMoveTask} allowedTransitions={DEFAULT_ALLOWED_TRANSITIONS}>
        <KanbanBoardInner {...props} />
      </DragDropProvider>
    );
  }

  // Render without provider if drag & drop is disabled
  return <KanbanBoardInner {...props} />;
}
