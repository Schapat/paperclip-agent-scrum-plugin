/**
 * Column Component
 *
 * Eine Spalte im Kanban-Board.
 */

import type { ScrumTask } from '@shared/types';
import { TaskCard } from './TaskCard';

interface ColumnProps {
  id: string;
  name: string;
  color: string;
  tasks: ScrumTask[];
}

export function Column({ id, name, color, tasks }: ColumnProps) {
  return (
    <div className="column" data-column-id={id}>
      <div className="column-header" style={{ borderTopColor: color }}>
        <h2 className="column-title">{name}</h2>
        <span className="column-count">{tasks.length}</span>
      </div>

      <div className="column-content">
        {tasks.length === 0 ? (
          <div className="column-empty">Keine Tasks</div>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} task={task} />)
        )}
      </div>

      <button className="column-add-btn" onClick={() => {}}>
        + Task hinzufügen
      </button>
    </div>
  );
}
