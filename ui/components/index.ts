/**
 * Component Exports
 */

// Legacy Components (deprecated)
export { Header } from './Header';
export { Board } from './Board';
export { Column } from './Column';
export { TaskCard } from './TaskCard';

// New Kanban Components (Phase 1.6)
export { KanbanBoard, COLUMNS } from './KanbanBoard';
export type { Column as ColumnConfig } from './KanbanBoard';
export { KanbanColumn } from './KanbanColumn';
export { KanbanCard } from './KanbanCard';

// Interactive UI Components (Phase 3.1)
export {
  DragDropProvider,
  useDragDrop,
  useDragDropOptional,
  DEFAULT_ALLOWED_TRANSITIONS,
  getValidDropTargets,
  isDraggable,
  getDragId,
} from './DragDropContext';
export type {
  DragTransition,
  DragState,
  DragDropContextValue,
  DropValidation,
} from './DragDropContext';
export { TicketDetailPanel } from './TicketDetailPanel';
export type { Comment, Decision, TicketDetailPanelProps } from './TicketDetailPanel';

// Settings Component (Phase 3.3)
export { Settings } from './Settings';
