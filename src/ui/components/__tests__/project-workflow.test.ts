import { describe, expect, it } from 'vitest';

import { createInitialProjectOnboarding } from '../../../core/project-onboarding';
import type { ProjectOnboarding } from '../../../core/types';
import { describeProjectWorkflow } from '../project-workflow';

function onboarding(status: ProjectOnboarding['status']): ProjectOnboarding {
  return {
    ...createInitialProjectOnboarding('2026-08-09T12:00:00.000Z'),
    status,
    projectId: 'project-1',
    projectName: 'Website',
    rootIssueId: 'issue-1',
  };
}

describe('project workflow tracker', () => {
  it('identifies the Technical Lead analysis as work outside the board', () => {
    expect(describeProjectWorkflow(onboarding('analysis_in_progress'), { unrefinedTasks: 0 })).toMatchObject({
      phase: 'technical_analysis',
      actor: 'Technical Lead',
      attentionRequired: false,
      ticketLinkLabel: 'Open technical analysis',
    });
  });

  it('surfaces the human decision after the Technical Lead analysis', () => {
    expect(describeProjectWorkflow(onboarding('analysis_ready'), { unrefinedTasks: 0 })).toMatchObject({
      phase: 'technical_analysis_approval',
      actor: 'You',
      attentionRequired: true,
      ticketLinkLabel: 'Open approval',
    });
  });

  it('identifies Product Owner story writing and the next sprint approval', () => {
    expect(describeProjectWorkflow(onboarding('backlog_in_progress'), { unrefinedTasks: 0 })).toMatchObject({
      phase: 'product_backlog',
      actor: 'Product Owner',
      attentionRequired: false,
    });
    expect(describeProjectWorkflow(onboarding('sprint_planning'), { unrefinedTasks: 0 })).toMatchObject({
      phase: 'sprint_approval',
      actor: 'You',
      attentionRequired: true,
    });
  });

  it('identifies Technical Lead refinement before a sprint can be started', () => {
    expect(describeProjectWorkflow(onboarding('sprint_planning'), { unrefinedTasks: 2 })).toMatchObject({
      phase: 'technical_refinement',
      actor: 'Technical Lead',
      attentionRequired: false,
    });
  });
});