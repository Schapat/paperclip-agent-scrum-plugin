import { describe, expect, it } from 'vitest';

import { createScrumTask } from '../../../core/factories';
import { sharedBacklogSections } from '../KanbanBoard';

describe('shared backlog sections', () => {
  it('keeps blocked tickets visible in the backlog column without mixing their status', () => {
    const backlog = createScrumTask({ id: 'backlog', title: 'Backlog ticket', description: '', column: 'backlog' });
    const blocked = createScrumTask({ id: 'blocked', title: 'Blocked ticket', description: '', column: 'blocked' });
    const inProgress = createScrumTask({ id: 'active', title: 'Active ticket', description: '', column: 'in_progress' });

    expect(sharedBacklogSections([backlog, blocked, inProgress])).toEqual({
      backlog: [backlog],
      blocked: [blocked],
    });
  });
});