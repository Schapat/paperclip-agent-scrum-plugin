import { describe, expect, it } from 'vitest';

import {
  canStartNewProjectOnboarding,
  canRunAutomaticDelivery,
  createProjectSprint,
  createBacklogDiscoveryPrompt,
  createInitialProjectOnboarding,
  createTechnicalAnalysisPrompt,
  isTechnicalAnalysisComplete,
  parseProjectOnboardingInput,
  startProjectOnboarding,
  TECHNICAL_ANALYSIS_COMPLETION_MARKER,
  transitionProjectOnboarding,
} from '../project-onboarding';
import { migrateState } from '../storage';

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
      })
    ).toEqual({
      valid: true,
      value: {
        projectId: 'project-bmw',
        brief: 'Build an image slider',
        constraints: 'Use the design system',
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

    expect(initial.status).toBe('not_started');
    expect(canRunAutomaticDelivery(analysis)).toBe(false);
    expect(canRunAutomaticDelivery(analysisReady)).toBe(false);
    expect(canRunAutomaticDelivery(backlog)).toBe(false);
    expect(canRunAutomaticDelivery(planning)).toBe(false);
    expect(canRunAutomaticDelivery(active)).toBe(true);
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

  it('allows a new project request on a legacy board only when it is empty', () => {
    const legacy = migrateState({}).projectOnboarding;

    expect(canStartNewProjectOnboarding(legacy, { taskCount: 0, hasCurrentSprint: false })).toBe(true);
    expect(canStartNewProjectOnboarding(legacy, { taskCount: 1, hasCurrentSprint: false })).toBe(false);
    expect(canStartNewProjectOnboarding(legacy, { taskCount: 0, hasCurrentSprint: true })).toBe(false);
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
});