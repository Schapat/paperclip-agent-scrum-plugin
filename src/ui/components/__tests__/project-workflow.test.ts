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
/**
 * Der Header muss die Frage "arbeitet gerade jemand daran?" beantworten.
 *
 * Sie stand bisher nur im Fliesstext — eine laufende Agentenphase sah aus wie
 * eine wartende.
 */
describe('who holds the turn', () => {
  it('marks agent phases as running and human gates as waiting', () => {
    expect(describeProjectWorkflow(onboarding('backlog_in_progress'), { unrefinedTasks: 0 }).waitingOn)
      .toBe('agent');
    expect(describeProjectWorkflow(onboarding('analysis_in_progress'), { unrefinedTasks: 0 }).waitingOn)
      .toBe('agent');
    expect(describeProjectWorkflow(onboarding('sprint_planning'), { unrefinedTasks: 2 }).waitingOn)
      .toBe('agent');

    expect(describeProjectWorkflow(onboarding('analysis_ready'), { unrefinedTasks: 0 }).waitingOn)
      .toBe('human');
    expect(describeProjectWorkflow(onboarding('sprint_planning'), { unrefinedTasks: 0 }).waitingOn)
      .toBe('human');
  });

  it('hands the turn back to a person as soon as something is blocked', () => {
    const workflow = describeProjectWorkflow(onboarding('backlog_in_progress'), { unrefinedTasks: 0 }, {
      stalls: [
        {
          taskId: 'task-1',
          kind: 'run_failed',
          reason: 'The agent run failed.',
          detectedAt: '2026-08-10T12:00:00.000Z',
        },
      ],
      now: Date.parse('2026-08-10T12:05:00.000Z'),
    });

    expect(workflow.waitingOn).toBe('human');
    expect(workflow.attentionRequired).toBe(true);
  });

  it('never phrases a fresh phase as "running for just now"', () => {
    const workflow = describeProjectWorkflow(onboarding('backlog_in_progress'), { unrefinedTasks: 0 }, {
      phaseSince: '2026-08-10T12:00:00.000Z',
      now: Date.parse('2026-08-10T12:00:20.000Z'),
    });

    expect(workflow.detail).toContain('Running for less than a minute');
    expect(workflow.detail).not.toContain('just now');
  });
});
