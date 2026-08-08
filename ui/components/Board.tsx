/**
 * Board Component
 *
 * Kanban-Board mit Drag & Drop Funktionalität.
 */

import type { ScrumTask } from '@shared/types';
import { Column } from './Column';

interface BoardProps {
  tasks: ScrumTask[];
}

// Standard Kanban Spalten
const DEFAULT_COLUMNS = [
  { id: 'backlog', name: 'Backlog', color: '#6B7280' },
  { id: 'todo', name: 'To Do', color: '#3B82F6' },
  { id: 'in_progress', name: 'In Progress', color: '#F59E0B' },
  { id: 'review', name: 'Review', color: '#8B5CF6' },
  { id: 'done', name: 'Done', color: '#10B981' },
];

export function Board({ tasks }: BoardProps) {
  // Tasks nach Spalten gruppieren
  const getTasksForColumn = (columnId: string): ScrumTask[] => {
    return tasks.filter((task) => task.column === columnId);
  };

  return (
    <div className="board">
      {DEFAULT_COLUMNS.map((column) => (
        <Column
          key={column.id}
          id={column.id}
          name={column.name}
          color={column.color}
          tasks={getTasksForColumn(column.id)}
        />
      ))}
    </div>
  );
}
