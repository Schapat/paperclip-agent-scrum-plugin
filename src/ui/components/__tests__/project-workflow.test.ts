import { describe, expect, it } from 'vitest';

import { createInitialProjectOnboarding } from '../../../core/project-onboarding';
import type { ProjectOnboarding } from '../../../core/types';
import { describeProjectWorkflow, describeStall } from '../project-workflow';

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

  it('explains whether a timed-out run is already recovering or exhausted', () => {
    expect(
      describeStall({
        taskId: 'task-1',
        kind: 'run_failed',
        reason: 'The managed run timed out. One controlled recovery run was queued.',
        detectedAt: '2026-08-10T12:00:00.000Z',
        retriedAt: '2026-08-10T12:10:15.000Z',
      }, Date.parse('2026-08-10T12:11:00.000Z'))
    ).toContain('One controlled recovery run was queued.');

    expect(
      describeStall({
        taskId: 'task-1',
        kind: 'run_failed',
        reason: 'The controlled recovery run also timed out. Automatic recovery is exhausted.',
        detectedAt: '2026-08-10T12:00:00.000Z',
        retriedAt: '2026-08-10T12:20:15.000Z',
      }, Date.parse('2026-08-10T12:21:00.000Z'))
    ).toContain('Automatic recovery is exhausted.');
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

/**
 * Der Header behauptete "Technical Lead is refining backlog stories", waehrend
 * der Technical Lead nachweislich untaetig war — die Aussage kam allein aus dem
 * Phasenstatus. Ein laufender Agent ist eine Beobachtung, keine Ableitung.
 */
describe('claims about a working agent', () => {
  const refining = { unrefinedTasks: 1 };

  it('does not claim a running agent when the host reports no run', () => {
    const workflow = describeProjectWorkflow(onboarding('sprint_planning'), refining, {
      agentRunning: false,
      phaseSince: '2026-08-10T16:24:00.000Z',
      now: Date.parse('2026-08-10T16:47:00.000Z'),
    });

    expect(workflow.waitingOn).toBe('none');
    expect(workflow.title).toContain('no agent run');
    expect(workflow.detail).toContain('Waiting for 23 min');
    expect(workflow.detail).not.toContain('Running for');
  });

  it('keeps the phase claim when the host cannot be asked', () => {
    const workflow = describeProjectWorkflow(onboarding('sprint_planning'), refining, {
      phaseSince: '2026-08-10T16:24:00.000Z',
      now: Date.parse('2026-08-10T16:47:00.000Z'),
    });

    expect(workflow.waitingOn).toBe('agent');
    expect(workflow.detail).toContain('Running for 23 min');
  });

  it('names the blocker instead of pretending someone is refining', () => {
    const workflow = describeProjectWorkflow(onboarding('sprint_planning'), refining, {
      agentRunning: false,
      refinementWaits: [
        {
          taskId: 'task-18',
          blockedBy: ['TESAA-17'],
          carriedBy: null,
          since: '2026-08-10T16:24:00.000Z',
        },
      ],
      phaseSince: '2026-08-10T16:24:00.000Z',
      now: Date.parse('2026-08-10T16:47:00.000Z'),
    });

    expect(workflow.title).toContain('queued');
    expect(workflow.detail).toContain('blocked by TESAA-17');
    // Warten auf eine Lieferreihenfolge ist erklaert — und damit kein Alarm.
    expect(workflow.attentionRequired).toBe(false);
  });

  it('says when a blocked story rides along with the running refinement', () => {
    const workflow = describeProjectWorkflow(onboarding('sprint_planning'), refining, {
      agentRunning: true,
      refinementWaits: [
        {
          taskId: 'task-18',
          blockedBy: ['TESAA-17'],
          carriedBy: 'task-17',
          since: '2026-08-10T16:24:00.000Z',
        },
      ],
      now: Date.parse('2026-08-10T16:47:00.000Z'),
    });

    expect(workflow.waitingOn).toBe('agent');
    expect(workflow.detail).toContain('alongside the ticket it is working on');
  });
});
