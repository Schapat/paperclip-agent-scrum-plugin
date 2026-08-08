/**
 * TaskCard Component
 *
 * Zeigt eine einzelne Task im Kanban-Board.
 */

import type { ScrumTask } from '@shared/types';

interface TaskCardProps {
  task: ScrumTask;
}

export function TaskCard({ task }: TaskCardProps) {
  return (
    <div className="task-card" draggable data-task-id={task.id}>
      <div className="task-header">
        <span className="task-id">#{task.id.slice(0, 8)}</span>
        {task.storyPoints > 0 && <span className="task-points">{task.storyPoints} SP</span>}
      </div>

      <h3 className="task-title">{task.title}</h3>

      {task.description && <p className="task-description">{task.description}</p>}

      <div className="task-footer">
        {task.labels.map((label) => (
          <span key={label} className="task-label">
            {label}
          </span>
        ))}

        {task.assignedAgentId && (
          <span className="task-assignee" title={task.assignedAgentId}>
            🤖
          </span>
        )}
      </div>
    </div>
  );
}
