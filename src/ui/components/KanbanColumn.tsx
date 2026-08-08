/**
 * KanbanColumn Component
 *
 * Einzelne Spalte im Kanban-Board mit:
 * - Header mit Titel und Ticket-Count
 * - WIP-Limit Anzeige (visuell hervorgehoben)
 * - Story Points Summe
 * - Drop Zone für Drag & Drop
 * - Visual Feedback für valid/invalid drops
 */

import { ReactNode, DragEvent, useState, useCallback } from 'react';
import type { TaskStatus, ScrumTask } from '../../core/types';

interface KanbanColumnProps {
  id: TaskStatus;
  displayName: string;
  color: string;
  count: number;
  wipLimit?: number;
  isOverLimit: boolean;
  isAtLimit: boolean;
  totalPoints: number;
  children: ReactNode;
  /** Enable drop zone functionality */
  enableDrop?: boolean;
  /** Callback to check if a drop is valid */
  canDrop?: (fromColumn: TaskStatus, toColumn: TaskStatus) => boolean;
  /** Callback to get validation message */
  getDropValidation?: (fromColumn: TaskStatus, toColumn: TaskStatus) => { allowed: boolean; reason: string };
  /** Callback when a task is dropped */
  onDrop?: (task: ScrumTask, fromColumn: TaskStatus, toColumn: TaskStatus) => Promise<boolean>;
}

export function KanbanColumn({
  id,
  displayName,
  color,
  count,
  wipLimit,
  isOverLimit,
  isAtLimit,
  totalPoints,
  children,
  enableDrop = true,
  canDrop,
  getDropValidation,
  onDrop,
}: KanbanColumnProps) {
  // ---------------------------------------------------------------------------
  // Drop State
  // ---------------------------------------------------------------------------

  const [isDragOver, setIsDragOver] = useState(false);
  const [isValidDrop, setIsValidDrop] = useState(false);
  const [dropMessage, setDropMessage] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Drag & Drop Handlers
  // ---------------------------------------------------------------------------

  const handleDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (!enableDrop) return;

      setIsDragOver(true);

      // Try to get source column from dataTransfer
      // Note: Can't read dataTransfer during dragEnter in some browsers
      // We rely on drag context for validation
    },
    [enableDrop]
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (!enableDrop) return;

      // Try to parse the task data to get source column
      try {
        const taskData = e.dataTransfer.getData('application/json');
        if (taskData) {
          const task = JSON.parse(taskData) as ScrumTask;
          const fromColumn = task.column;

          if (canDrop && getDropValidation) {
            const valid = canDrop(fromColumn, id);
            const validation = getDropValidation(fromColumn, id);

            setIsValidDrop(valid);
            setDropMessage(validation.reason);

            e.dataTransfer.dropEffect = valid ? 'move' : 'none';
          }
        }
      } catch {
        // Data not available during dragOver in some browsers
        // This is expected behavior
      }
    },
    [enableDrop, id, canDrop, getDropValidation]
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Only clear state if we're leaving the column (not entering a child)
    const relatedTarget = e.relatedTarget as HTMLElement;
    const currentTarget = e.currentTarget as HTMLElement;

    if (!currentTarget.contains(relatedTarget)) {
      setIsDragOver(false);
      setIsValidDrop(false);
      setDropMessage(null);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      setIsDragOver(false);
      setIsValidDrop(false);
      setDropMessage(null);

      if (!enableDrop || !onDrop) return;

      try {
        const taskData = e.dataTransfer.getData('application/json');
        if (!taskData) return;

        const task = JSON.parse(taskData) as ScrumTask;
        const fromColumn = task.column;

        // Validate the drop
        if (canDrop && !canDrop(fromColumn, id)) {
          return;
        }

        // Execute the drop
        await onDrop(task, fromColumn, id);
      } catch (error) {
        console.error('Drop failed:', error);
      }
    },
    [enableDrop, id, canDrop, onDrop]
  );

  // ---------------------------------------------------------------------------
  // CSS Classes
  // ---------------------------------------------------------------------------

  // CSS-Klassen basierend auf WIP-Status und Drag State
  const columnClasses = [
    'kanban-column',
    isOverLimit && 'kanban-column--over-limit',
    isAtLimit && !isOverLimit && 'kanban-column--at-limit',
    isDragOver && 'kanban-column--drag-over',
    isDragOver && isValidDrop && 'kanban-column--drop-valid',
    isDragOver && !isValidDrop && 'kanban-column--drop-invalid',
  ]
    .filter(Boolean)
    .join(' ');

  const countClasses = [
    'kanban-column-count',
    isOverLimit && 'kanban-column-count--over',
    isAtLimit && !isOverLimit && 'kanban-column-count--at',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={columnClasses}
      data-column-id={id}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="region"
      aria-label={`${displayName} Spalte mit ${count} Tasks`}
    >
      {/* Column Header */}
      <div className="kanban-column-header" style={{ borderTopColor: color }}>
        <div className="kanban-column-header-left">
          <h2 className="kanban-column-title">{displayName}</h2>
          {totalPoints > 0 && (
            <span className="kanban-column-points" title="Gesamte Story Points">
              {totalPoints} SP
            </span>
          )}
        </div>

        <div className="kanban-column-header-right">
          {/* Ticket Count mit WIP-Limit */}
          <span className={countClasses} title={wipLimit ? `WIP-Limit: ${wipLimit}` : undefined}>
            {count}
            {wipLimit !== undefined && (
              <span className="kanban-column-wip">
                <span className="kanban-column-wip-separator">/</span>
                <span className="kanban-column-wip-limit">{wipLimit}</span>
              </span>
            )}
          </span>
        </div>
      </div>

      {/* WIP Warning Banner */}
      {isOverLimit && (
        <div className="kanban-column-warning">
          <span className="kanban-column-warning-icon">⚠️</span>
          <span className="kanban-column-warning-text">WIP-Limit überschritten!</span>
        </div>
      )}

      {/* Drop Zone Indicator */}
      {isDragOver && dropMessage && (
        <div className={`kanban-column-drop-indicator ${isValidDrop ? 'kanban-column-drop-indicator--valid' : 'kanban-column-drop-indicator--invalid'}`}>
          <span className="kanban-column-drop-indicator-icon">{isValidDrop ? '✓' : '✕'}</span>
          <span className="kanban-column-drop-indicator-text">{dropMessage}</span>
        </div>
      )}

      {/* Column Content (scrollable) */}
      <div className="kanban-column-content">{children}</div>
    </div>
  );
}
