import type { ScrumTask } from '../../core/types';

export function ticketDisplayId(task: Pick<ScrumTask, 'id' | 'identifier'>): string {
  return task.identifier?.trim() || `#${task.id.slice(0, 8)}`;
}