import { describe, expect, it } from 'vitest';

import {
  canStartNewProjectOnboarding,
  canRouteDelivery,
  canRunAutomaticDelivery,
  createProjectSprint,
  createBacklogDiscoveryPrompt,
  createInitialProjectOnboarding,
  createTechnicalAnalysisPrompt,
  isPreDeliveryGate,
  isTechnicalAnalysisComplete,
  normalizeBranchName,
  parseProjectOnboardingInput,
  suggestDeliveryBranch,
  startProjectOnboarding,
  TECHNICAL_ANALYSIS_COMPLETION_MARKER,
  transitionProjectOnboarding,
} from '../project-onboarding';
import { migrateState } from '../storage';
import type { ProjectOnboarding } from '../types';

describe('project onboarding', () => {
  it('requires a project and a concrete work request', () => {
    expect(parseProjectOnboardingInput({ brief: 'Build a slider' })).toEqual({
      valid: false,
      error: 'Choose a Paperclip project first.',
    });

    expect(parseProjectOnboardingInput({ projectId: 'project-bmw', brief: '   ' })).toEqual({
      valid: false,
      error: 'Describe the work to start.',
    });
  });

  it('normalizes a brief and optional constraints', () => {
    expect(
      parseProjectOnboardingInput({
        projectId: ' project-bmw ',
        brief: ' Build an image slider ',
        constraints: ' Use the design system ',
        skipSprintPlanning: true,
      })
    ).toEqual({
      valid: true,
      value: {
        projectId: 'project-bmw',
        brief: 'Build an image slider',
        constraints: 'Use the design system',
        skipSprintPlanning: true,
      },
    });
  });

  it('requires human-approved transitions before automatic delivery starts', () => {
    const input = parseProjectOnboardingInput({
      projectId: 'project-bmw',
      brief: 'Build an image slider.',
    });
    if (!input.valid) throw new Error(input.error);

    const initial = createInitialProjectOnboarding('2026-08-08T12:00:00.000Z');
    const analysis = startProjectOnboarding({
      input: input.value,
      projectName: 'BMW Website',
      rootIssueId: 'issue-kickoff',
      now: '2026-08-08T12:01:00.000Z',
    });
    const analysisReady = transitionProjectOnboarding(
      analysis,
      'analysis_ready',
      '2026-08-08T12:02:00.000Z'
    );
    const backlog = transitionProjectOnboarding(
      analysisReady,
      'backlog_in_progress',
      '2026-08-08T12:03:00.000Z'
    );
    const planning = transitionProjectOnboarding(backlog, 'sprint_planning', '2026-08-08T12:04:00.000Z');
    const active = transitionProjectOnboarding(planning, 'active', '2026-08-08T12:05:00.000Z');
    const completed = transitionProjectOnboarding(active, 'completed', '2026-08-08T12:06:00.000Z');

    expect(initial.status).toBe('not_started');
    expect(canRunAutomaticDelivery(analysis)).toBe(false);
    expect(canRunAutomaticDelivery(analysisReady)).toBe(false);
    expect(canRunAutomaticDelivery(backlog)).toBe(false);
    expect(canRunAutomaticDelivery(planning)).toBe(false);
    expect(canRunAutomaticDelivery(active)).toBe(true);
    expect(canRunAutomaticDelivery(completed)).toBe(false);
    expect(completed.status).toBe('completed');
    expect(() => transitionProjectOnboarding(initial, 'active')).toThrow(
      'Cannot transition project onboarding from not_started to active.'
    );
  });

  it('creates an active project sprint only from the sprint-planning gate', () => {
    const onboarding = {
      ...createInitialProjectOnboarding('2026-08-08T12:00:00.000Z'),
      status: 'sprint_planning' as const,
      projectName: 'BMW Website',
      brief: 'Build an image slider.',
    };

    expect(
      createProjectSprint({
        onboarding,
        id: 'sprint-1',
        sprintNumber: 1,
        lengthWeeks: 2,
        now: '2026-08-08T12:00:00.000Z',
      })
    ).toMatchObject({
      id: 'sprint-1',
      name: 'Sprint 1: BMW Website',
      status: 'active',
      goal: 'Build an image slider.',
      startDate: '2026-08-08T12:00:00.000Z',
      endDate: '2026-08-22T12:00:00.000Z',
    });
  });

  it('gives the Technical Lead and Product Owner their distinct kickoff work', () => {
    const input = parseProjectOnboardingInput({
      projectId: 'project-bmw',
      brief: 'Create a responsive image slider.',
      constraints: 'Use the existing design system.',
    });
    if (!input.valid) throw new Error(input.error);

    const onboarding = startProjectOnboarding({
      input: input.value,
      projectName: 'BMW Website',
      rootIssueId: 'issue-kickoff',
    });

    expect(createTechnicalAnalysisPrompt(onboarding)).toContain('Inspect the repository');
    expect(createTechnicalAnalysisPrompt(onboarding)).toContain('Do not implement code');
    expect(createTechnicalAnalysisPrompt(onboarding)).toContain(TECHNICAL_ANALYSIS_COMPLETION_MARKER);
    expect(createBacklogDiscoveryPrompt(onboarding)).toContain('child issues');
    expect(createBacklogDiscoveryPrompt(onboarding)).toContain('acceptance criteria');
  });

  it('keeps automation enabled for a state saved before project onboarding existed', () => {
    expect(migrateState({}).projectOnboarding?.status).toBe('active');
  });

  it('preserves only valid timeout-recovery budgets across a worker restart', () => {
    const migrated = migrateState(
      {
        timeoutRecoveries: {
          'ticket-1': {
            sourceRunId: 'run-timeout',
            sourceRunCreatedAt: '2026-08-10T12:00:00.000Z',
            attemptedAt: '2026-08-10T12:10:15.000Z',
            queued: true,
            recoveryRunId: 'run-recovery',
          },
          malformed: { sourceRunId: 'missing-required-fields' },
        },
      } as unknown as Parameters<typeof migrateState>[0]
    );

    expect(migrated.timeoutRecoveries).toEqual({
      'ticket-1': {
        sourceRunId: 'run-timeout',
        sourceRunCreatedAt: '2026-08-10T12:00:00.000Z',
        attemptedAt: '2026-08-10T12:10:15.000Z',
        queued: true,
        recoveryRunId: 'run-recovery',
      },
    });
  });

  it('allows a new project request on a legacy board only when it is empty', () => {
    const legacy = migrateState({}).projectOnboarding;

    expect(canStartNewProjectOnboarding(legacy, { taskCount: 0, hasCurrentSprint: false })).toBe(true);
    expect(canStartNewProjectOnboarding(legacy, { taskCount: 1, hasCurrentSprint: false })).toBe(false);
    expect(canStartNewProjectOnboarding(legacy, { taskCount: 0, hasCurrentSprint: true })).toBe(false);
  });

  it('allows a human to start a new project after a completed request', () => {
    const completed = {
      ...createInitialProjectOnboarding('2026-08-08T12:00:00.000Z'),
      status: 'completed' as const,
      projectId: 'project-finished',
      rootIssueId: 'issue-finished',
    };

    expect(canStartNewProjectOnboarding(completed, { taskCount: 6, hasCurrentSprint: false })).toBe(true);
    expect(canStartNewProjectOnboarding(completed, { taskCount: 6, hasCurrentSprint: true })).toBe(false);
  });

  it('requires the Technical Lead completion marker before analysis is considered complete', () => {
    expect(
      isTechnicalAnalysisComplete(
        [{ authorAgentId: 'technical-lead', body: '## Technical analysis complete' }],
        'technical-lead'
      )
    ).toBe(false);
    expect(
      isTechnicalAnalysisComplete(
        [{ authorAgentId: 'product-owner', body: TECHNICAL_ANALYSIS_COMPLETION_MARKER }],
        'technical-lead'
      )
    ).toBe(false);
    expect(
      isTechnicalAnalysisComplete(
        [{ authorAgentId: 'technical-lead', body: `Findings\n${TECHNICAL_ANALYSIS_COMPLETION_MARKER}` }],
        'technical-lead'
      )
    ).toBe(true);
  });

  it('requires a new Technical Lead completion after human-requested analysis changes', () => {
    expect(
      isTechnicalAnalysisComplete(
        [
          {
            authorAgentId: 'technical-lead',
            body: TECHNICAL_ANALYSIS_COMPLETION_MARKER,
            createdAt: '2026-08-09T10:00:00.000Z',
          },
          {
            authorAgentId: null,
            body: '<!-- agent-scrum:technical-analysis-changes-requested -->',
            createdAt: '2026-08-09T10:01:00.000Z',
          },
        ],
        'technical-lead'
      )
    ).toBe(false);
    expect(
      isTechnicalAnalysisComplete(
        [
          {
            authorAgentId: null,
            body: '<!-- agent-scrum:technical-analysis-changes-requested -->',
            createdAt: '2026-08-09T10:01:00.000Z',
          },
          {
            authorAgentId: 'technical-lead',
            body: TECHNICAL_ANALYSIS_COMPLETION_MARKER,
            createdAt: '2026-08-09T10:02:00.000Z',
          },
        ],
        'technical-lead'
      )
    ).toBe(true);
  });
});
/**
 * Vor dem Sprintstart darf das Plugin ein Ticket verfeinern lassen — aber nicht
 * liefern. Ein Agent, der sich selbst ein Ticket greift, hat den Sprint sonst
 * schon gestartet, bevor der Human ihn freigegeben hat.
 */
describe('the delivery gate', () => {
  const gate = (status: ProjectOnboarding['status']): ProjectOnboarding => ({
    ...createInitialProjectOnboarding('2026-08-10T12:00:00.000Z'),
    status,
  });

  it('routes delivery only in an approved sprint', () => {
    expect(canRouteDelivery(gate('active'))).toBe(true);
    expect(canRouteDelivery(gate('sprint_planning'))).toBe(false);
    expect(canRouteDelivery(gate('backlog_in_progress'))).toBe(false);
    expect(canRouteDelivery(undefined)).toBe(false);
  });

  it('recognises the phases in which started work belongs back in the backlog', () => {
    expect(isPreDeliveryGate(gate('backlog_in_progress'))).toBe(true);
    expect(isPreDeliveryGate(gate('sprint_planning'))).toBe(true);
    expect(isPreDeliveryGate(gate('active'))).toBe(false);
    expect(isPreDeliveryGate(gate('analysis_in_progress'))).toBe(false);
  });
});

/**
 * Der Lieferbranch ist eine Sprintentscheidung des Humans. Was er eintippt,
 * muss Git akzeptieren — ein Branch mit Leerzeichen bricht jeden Push.
 */
describe('the delivery branch', () => {
  it('keeps a usable branch name and repairs an awkward one', () => {
    expect(normalizeBranchName('feature/dev-script')).toBe('feature/dev-script');
    expect(normalizeBranchName('  feature/dev script ')).toBe('feature/dev-script');
    expect(normalizeBranchName('feature//nested///name')).toBe('feature/nested/name');
    expect(normalizeBranchName('/feature/trailing/')).toBe('feature/trailing');
  });

  it('rejects what Git will not take', () => {
    expect(normalizeBranchName('')).toBeNull();
    expect(normalizeBranchName('   ')).toBeNull();
    expect(normalizeBranchName('feature/../escape')).toBeNull();
    expect(normalizeBranchName('feature/branch.lock')).toBeNull();
    expect(normalizeBranchName(42)).toBeNull();
  });

  it('suggests a branch that names the project and the sprint', () => {
    expect(
      suggestDeliveryBranch({ projectName: 'BMW Website', brief: null }, 2)
    ).toBe('feature/bmw-website-sprint-2');
    expect(suggestDeliveryBranch({ projectName: null, brief: null })).toBe('feature/delivery-sprint-1');
  });

  it('carries the human decision into the sprint', () => {
    const sprint = createProjectSprint({
      onboarding: {
        ...createInitialProjectOnboarding('2026-08-10T12:00:00.000Z'),
        status: 'sprint_planning',
        projectName: 'Website',
        deliveryBranch: 'feature/website-sprint-1',
      },
      id: 'sprint-1',
      sprintNumber: 1,
      lengthWeeks: 2,
      now: '2026-08-10T12:00:00.000Z',
    });

    expect(sprint.deliveryBranch).toBe('feature/website-sprint-1');
  });
});
