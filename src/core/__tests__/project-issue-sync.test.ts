import { describe, expect, it } from 'vitest';

import {
  syncProjectOnboardingIssue,
  syncTaskIdentifiers,
  type ProjectIssueSnapshot,
} from '../project-issue-sync';
import { createScrumTask } from '../factories';
import { startProjectOnboarding, parseProjectOnboardingInput } from '../project-onboarding';
import type { ScrumTask } from '../types';

function onboarding() {
  const input = parseProjectOnboardingInput({
    projectId: 'project-bmw',
    brief: 'Build an image slider.',
  });
  if (!input.valid) throw new Error(input.error);

  return {
    ...startProjectOnboarding({
      input: input.value,
      projectName: 'BMW Website',
      rootIssueId: 'issue-kickoff',
    }),
    status: 'backlog_in_progress' as const,
  };
}

function issue(overrides: Partial<ProjectIssueSnapshot> = {}): ProjectIssueSnapshot {
  const now = new Date('2026-08-08T12:00:00.000Z');
  return {
    id: 'issue-slider',
    identifier: 'BMW-42',
    projectId: 'project-bmw',
    parentId: 'issue-kickoff',
    title: 'Add image slider',
    description: 'As a visitor, I want to browse images.',
    status: 'backlog',
    priority: 'high',
    assigneeAgentId: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('project issue synchronization', () => {
  it('backfills Paperclip identifiers onto legacy board tasks', () => {
    const tasks = [
      createScrumTask({
        id: 'issue-slider',
        title: 'Add image slider',
        description: '',
        identifier: null,
      }),
    ];

    expect(syncTaskIdentifiers(tasks, [{ id: 'issue-slider', identifier: 'BMW-42' }])).toBe(true);
    expect(tasks[0]).toMatchObject({ id: 'issue-slider', identifier: 'BMW-42' });
  });

  it('creates a local task only for a direct kickoff child', () => {
    const tasks: ScrumTask[] = [];

    const result = syncProjectOnboardingIssue(tasks, onboarding(), issue(), 'agent-po');

    expect(result).toEqual({ handled: true, changed: true, action: 'created', taskId: 'issue-slider' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'issue-slider',
      identifier: 'BMW-42',
      parentId: 'issue-kickoff',
      column: 'backlog',
      priority: 'high',
    });
    expect(tasks[0].statusHistory).toEqual([
      {
        from: null,
        to: 'backlog',
        timestamp: '2026-08-08T12:00:00.000Z',
        triggeredBy: 'agent-po',
      },
    ]);
  });

  it('replaces local refinement with the authoritative host refinement and comments', () => {
    const tasks: ScrumTask[] = [];
    syncProjectOnboardingIssue(tasks, onboarding(), issue());
    tasks[0].refined = true;
    tasks[0].storyPoints = 13;
    tasks[0].technicalNotes = 'Stale local refinement.';

    const result = syncProjectOnboardingIssue(
      tasks,
      onboarding(),
      issue({
        title: 'Add accessible image slider',
        status: 'todo',
        assigneeAgentId: 'developer-1',
        updatedAt: new Date('2026-08-08T12:10:00.000Z'),
        comments: [
          {
            id: 'comment-refinement',
            authorAgentId: 'id-tl',
            authorUserId: null,
            authorType: 'agent',
            createdAt: '2026-08-08T12:09:00.000Z',
            body:
              '## Technical refinement\n<!-- agent-scrum:refinement:v1 ' +
              '{"storyPoints":5,"acceptanceCriteria":["Keyboard controls work"],"technicalNotes":"Use the existing media primitives."} -->',
          },
        ],
      }),
      'agent-po',
      [{ id: 'id-tl', name: 'Technical Lead', role: 'technical_lead' }]
    );

    expect(result).toEqual({ handled: true, changed: true, action: 'updated', taskId: 'issue-slider' });
    expect(tasks[0]).toMatchObject({
      title: 'Add accessible image slider',
      column: 'todo',
      assignedAgentId: 'developer-1',
      refined: true,
      storyPoints: 5,
      technicalNotes: 'Use the existing media primitives.',
    });
    expect(tasks[0].acceptanceCriteria.map((criterion) => criterion.text)).toEqual(['Keyboard controls work']);
    expect(tasks[0].comments).toEqual([
      expect.objectContaining({ id: 'comment-refinement', authorName: 'Technical Lead' }),
    ]);
    expect(tasks[0].statusHistory.at(-1)).toEqual({
      from: 'backlog',
      to: 'todo',
      timestamp: '2026-08-08T12:10:00.000Z',
      triggeredBy: 'agent-po',
    });
  });

  it('keeps developer GitHub commit evidence on a completed project ticket', () => {
    const tasks: ScrumTask[] = [];

    syncProjectOnboardingIssue(
      tasks,
      onboarding(),
      issue({
        status: 'done',
        comments: [
          {
            id: 'comment-developer-commit',
            authorAgentId: 'id-dev',
            authorUserId: null,
            authorType: 'agent',
            createdAt: '2026-08-08T12:09:00.000Z',
            body:
              '## Ready for Review\n<!-- agent-scrum:commit:v1 ' +
              '{"sha":"a1b2c3d4e5f6","url":"https://github.com/acme/customer-portal/commit/a1b2c3d4e5f6","message":"feat: add accessible slider"} -->',
          },
        ],
      }),
      null,
      [{ id: 'id-dev', name: 'Developer 1', role: 'developer' }]
    );

    expect(tasks[0].commits).toEqual([
      expect.objectContaining({
        sha: 'a1b2c3d4e5f6',
        url: 'https://github.com/acme/customer-portal/commit/a1b2c3d4e5f6',
        message: 'feat: add accessible slider',
      }),
    ]);
  });

  it('removes a mirrored task when its host issue is cancelled or leaves the kickoff', () => {
    const tasks: ScrumTask[] = [];
    syncProjectOnboardingIssue(tasks, onboarding(), issue());

    expect(syncProjectOnboardingIssue(tasks, onboarding(), issue({ status: 'cancelled' }))).toMatchObject({
      handled: true,
      changed: true,
      action: 'removed',
    });
    expect(tasks).toEqual([]);

    syncProjectOnboardingIssue(tasks, onboarding(), issue());
    expect(
      syncProjectOnboardingIssue(tasks, onboarding(), issue({ parentId: 'another-parent' }))
    ).toMatchObject({ handled: true, changed: true, action: 'removed' });
    expect(tasks).toEqual([]);
  });

  it('ignores project siblings and the kickoff issue itself', () => {
    const tasks: ScrumTask[] = [];

    expect(
      syncProjectOnboardingIssue(tasks, onboarding(), issue({ parentId: null, id: 'issue-unrelated' }))
    ).toEqual({ handled: false, changed: false, action: 'ignored' });
    expect(syncProjectOnboardingIssue(tasks, onboarding(), issue({ id: 'issue-kickoff' }))).toEqual({
      handled: true,
      changed: false,
      action: 'unchanged',
      taskId: 'issue-kickoff',
    });
    expect(tasks).toEqual([]);
  });
});
/**
 * Der Product Owner hatte sieben Stories geschrieben, waehrend die Analyse noch
 * auf die Freigabe wartete. Das Board hat sie verschwiegen — der Backlog stand
 * leer neben sieben existierenden Tickets. Unsichtbare Arbeit ist die teuerste
 * Sorte: der Human sieht nichts und kann nichts entscheiden.
 */
describe('stories written before the gate', () => {
  it('mirrors a child issue even while the analysis awaits approval', () => {
    const tasks: ScrumTask[] = [];
    const result = syncProjectOnboardingIssue(
      tasks,
      { ...onboarding(), status: 'analysis_ready' as const },
      issue({ id: 'child-1', title: 'Tetris Core Game Loop' })
    );

    expect(result).toMatchObject({ handled: true, changed: true, action: 'created' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: 'child-1', column: 'backlog' });
  });

  it('mirrors it during the analysis itself', () => {
    const tasks: ScrumTask[] = [];
    syncProjectOnboardingIssue(
      tasks,
      { ...onboarding(), status: 'analysis_in_progress' as const },
      issue({ id: 'child-1' })
    );

    expect(tasks).toHaveLength(1);
  });

  it('still ignores an issue that belongs to another kickoff', () => {
    const tasks: ScrumTask[] = [];
    const result = syncProjectOnboardingIssue(
      tasks,
      { ...onboarding(), status: 'analysis_ready' as const },
      issue({ id: 'child-1', parentId: 'some-other-kickoff' })
    );

    expect(result.handled).toBe(false);
    expect(tasks).toEqual([]);
  });
});
