/**
 * DragDropContext und Validation für Kanban-Board
 *
 * Implementiert:
 * - Drag & Drop nur für ERLAUBTE Übergänge
 * - Validation vor dem Drop
 * - Visual Feedback während Drag
 * - Accessible Drag & Drop (Keyboard Support)
 *
 * ERLAUBTE Übergänge:
 * - backlog → todo (PO kann zuweisen)
 * - todo → in_progress (Dev nimmt Ticket)
 * - in_progress → in_review (Dev fertig)
 * - Review → Done nur per QA-Approval (kein Drag!)
 */

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { TaskStatus, ScrumTask } from '@shared/types';

// =============================================================================
// Types
// =============================================================================

export interface DragTransition {
  from: TaskStatus;
  to: TaskStatus;
  description: string;
  requiredRole?: string;
}

export interface DragState {
  isDragging: boolean;
  draggedTask: ScrumTask | null;
  sourceColumn: TaskStatus | null;
  targetColumn: TaskStatus | null;
  isValidDrop: boolean;
}

export interface DragDropContextValue {
  state: DragState;
  allowedTransitions: DragTransition[];
  canDrop: (fromColumn: TaskStatus, toColumn: TaskStatus) => boolean;
  getDropValidation: (fromColumn: TaskStatus, toColumn: TaskStatus) => DropValidation;
  startDrag: (task: ScrumTask) => void;
  updateTarget: (column: TaskStatus | null) => void;
  endDrag: () => void;
  executeDrop: (task: ScrumTask, fromColumn: TaskStatus, toColumn: TaskStatus) => Promise<boolean>;
  onMoveTask?: (task: ScrumTask, from: TaskStatus, to: TaskStatus) => Promise<boolean>;
}

export interface DropValidation {
  allowed: boolean;
  reason: string;
  transition?: DragTransition;
}

interface DragDropProviderProps {
  children: ReactNode;
  onMoveTask?: (task: ScrumTask, from: TaskStatus, to: TaskStatus) => Promise<boolean>;
  allowedTransitions?: DragTransition[];
}

// =============================================================================
// Constants
// =============================================================================

/**
 * ERLAUBTE Drag & Drop Übergänge
 * Review → Done ist NICHT erlaubt per Drag (nur QA-Approval)
 */
export const DEFAULT_ALLOWED_TRANSITIONS: DragTransition[] = [
  {
    from: 'backlog',
    to: 'todo',
    description: 'In Sprint aufnehmen',
    requiredRole: 'product_owner',
  },
  {
    from: 'todo',
    to: 'in_progress',
    description: 'Arbeit beginnen',
    requiredRole: 'developer',
  },
  {
    from: 'in_progress',
    to: 'in_review',
    description: 'Zur Review einreichen',
    requiredRole: 'developer',
  },
  // Rückwärts-Transitions für Korrekturen
  {
    from: 'in_review',
    to: 'in_progress',
    description: 'Zurück zur Entwicklung (QA Feedback)',
    requiredRole: 'qa_engineer',
  },
  {
    from: 'in_progress',
    to: 'todo',
    description: 'Arbeit pausieren',
    requiredRole: 'developer',
  },
  // Blocked handling
  {
    from: 'in_progress',
    to: 'blocked',
    description: 'Als blockiert markieren',
  },
  {
    from: 'blocked',
    to: 'in_progress',
    description: 'Blocker aufgelöst',
  },
  {
    from: 'blocked',
    to: 'todo',
    description: 'Zurück zu TODO',
  },
];

// Nicht erlaubte Transitions mit Erklärung
const FORBIDDEN_TRANSITIONS: Record<string, string> = {
  'in_review->done': 'Review → Done erfordert QA-Approval. Kein Drag & Drop möglich.',
  'backlog->in_progress': 'Tasks müssen erst in TODO aufgenommen werden.',
  'backlog->in_review': 'Tasks können nicht direkt zur Review gehen.',
  'backlog->done': 'Tasks müssen den kompletten Workflow durchlaufen.',
  'todo->in_review': 'Tasks müssen erst in Development sein.',
  'todo->done': 'Tasks müssen den kompletten Workflow durchlaufen.',
  'done->*': 'Abgeschlossene Tasks können nicht verschoben werden.',
};

// =============================================================================
// Context
// =============================================================================

const DragDropContext = createContext<DragDropContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export function DragDropProvider({
  children,
  onMoveTask,
  allowedTransitions = DEFAULT_ALLOWED_TRANSITIONS,
}: DragDropProviderProps) {
  const [state, setState] = useState<DragState>({
    isDragging: false,
    draggedTask: null,
    sourceColumn: null,
    targetColumn: null,
    isValidDrop: false,
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const canDrop = useCallback(
    (fromColumn: TaskStatus, toColumn: TaskStatus): boolean => {
      if (fromColumn === toColumn) return false;
      return allowedTransitions.some((t) => t.from === fromColumn && t.to === toColumn);
    },
    [allowedTransitions]
  );

  const getDropValidation = useCallback(
    (fromColumn: TaskStatus, toColumn: TaskStatus): DropValidation => {
      // Same column
      if (fromColumn === toColumn) {
        return {
          allowed: false,
          reason: 'Task ist bereits in dieser Spalte',
        };
      }

      // Check allowed transitions
      const transition = allowedTransitions.find((t) => t.from === fromColumn && t.to === toColumn);
      if (transition) {
        return {
          allowed: true,
          reason: transition.description,
          transition,
        };
      }

      // Check for specific forbidden reason
      const forbiddenKey = `${fromColumn}->${toColumn}`;
      const genericForbiddenKey = `${fromColumn}->*`;
      const reason =
        FORBIDDEN_TRANSITIONS[forbiddenKey] ||
        FORBIDDEN_TRANSITIONS[genericForbiddenKey] ||
        `Übergang von ${fromColumn} zu ${toColumn} ist nicht erlaubt`;

      return {
        allowed: false,
        reason,
      };
    },
    [allowedTransitions]
  );

  // ---------------------------------------------------------------------------
  // Drag Operations
  // ---------------------------------------------------------------------------

  const startDrag = useCallback((task: ScrumTask) => {
    setState({
      isDragging: true,
      draggedTask: task,
      sourceColumn: task.column,
      targetColumn: null,
      isValidDrop: false,
    });
  }, []);

  const updateTarget = useCallback(
    (column: TaskStatus | null) => {
      setState((prev) => {
        if (!prev.isDragging || !prev.sourceColumn) return prev;

        const isValid = column ? canDrop(prev.sourceColumn, column) : false;

        return {
          ...prev,
          targetColumn: column,
          isValidDrop: isValid,
        };
      });
    },
    [canDrop]
  );

  const endDrag = useCallback(() => {
    setState({
      isDragging: false,
      draggedTask: null,
      sourceColumn: null,
      targetColumn: null,
      isValidDrop: false,
    });
  }, []);

  const executeDrop = useCallback(
    async (task: ScrumTask, fromColumn: TaskStatus, toColumn: TaskStatus): Promise<boolean> => {
      if (!canDrop(fromColumn, toColumn)) {
        return false;
      }

      if (onMoveTask) {
        try {
          const success = await onMoveTask(task, fromColumn, toColumn);
          return success;
        } catch (error) {
          console.error('Failed to move task:', error);
          return false;
        }
      }

      return true;
    },
    [canDrop, onMoveTask]
  );

  // ---------------------------------------------------------------------------
  // Context Value
  // ---------------------------------------------------------------------------

  const value: DragDropContextValue = {
    state,
    allowedTransitions,
    canDrop,
    getDropValidation,
    startDrag,
    updateTarget,
    endDrag,
    executeDrop,
    onMoveTask,
  };

  return <DragDropContext.Provider value={value}>{children}</DragDropContext.Provider>;
}

// =============================================================================
// Hooks
// =============================================================================

export function useDragDrop(): DragDropContextValue {
  const context = useContext(DragDropContext);
  if (!context) {
    throw new Error('useDragDrop must be used within a DragDropProvider');
  }
  return context;
}

/**
 * Optional version of useDragDrop that returns null if not in a provider
 * Safe to use in components that might be rendered outside of DragDropProvider
 */
export function useDragDropOptional(): DragDropContextValue | null {
  return useContext(DragDropContext);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Berechnet alle möglichen Ziel-Spalten für einen Task
 */
export function getValidDropTargets(
  task: ScrumTask,
  allowedTransitions: DragTransition[]
): TaskStatus[] {
  return allowedTransitions.filter((t) => t.from === task.column).map((t) => t.to);
}

/**
 * Prüft ob ein Task überhaupt verschiebbar ist
 */
export function isDraggable(task: ScrumTask, allowedTransitions: DragTransition[]): boolean {
  // Done Tasks sind nie verschiebbar
  if (task.column === 'done') return false;

  // Prüfe ob es überhaupt eine mögliche Transition gibt
  return allowedTransitions.some((t) => t.from === task.column);
}

/**
 * Generiert eine eindeutige Drag-ID für einen Task
 */
export function getDragId(task: ScrumTask): string {
  return `drag-task-${task.id}`;
}
