import { createTestHarness, type PluginWorkspace, type Project } from '@paperclipai/plugin-sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import manifest from '../manifest';
import plugin from '../worker';
import { TECHNICAL_ANALYSIS_COMPLETION_MARKER } from '../core/project-onboarding';
import {
  PRODUCT_DECISION_REQUIRED_MARKER,
  PRODUCT_DECISION_RESOLVED_MARKER,
  QA_REVIEW_APPROVED_MARKER,
} from '../core/review-routing';
import { DECISION_MARKER, REFINEMENT_MARKER } from '../core/project-issue-projection';
import type { CeremonyRecord, ProjectOnboarding, ScrumAgent, ScrumTask } from '../core/types';

const COMPANY_ID = 'company-bmw';
const PROJECT_ID = 'project-bmw';

interface BoardData {
  agents: ScrumAgent[];
  tasks: ScrumTask[];
  ceremonies: CeremonyRecord[];
  projectOnboarding: ProjectOnboarding;
  currentSprint: { id: string; status: string; taskIds: string[] } | null;
  canStartProjectSprint: boolean;
}

async function completeTechnicalAnalysis(
  harness: ReturnType<typeof createTestHarness>,
  rootIssueId: string
): Promise<void> {
  const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
  const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
  await harness.ctx.issues.createComment(
    rootIssueId,
    `## Technical analysis complete\n\n${TECHNICAL_ANALYSIS_COMPLETION_MARKER}`,
    COMPANY_ID,
    { authorAgentId: technicalLead?.id }
  );
  await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
}

function project(): Project {
  const now = new Date('2026-08-08T12:00:00.000Z');
  return {
    id: PROJECT_ID,
    companyId: COMPANY_ID,
    urlKey: 'bmw-website',
    goalId: null,
    goalIds: [],
    goals: [],
    name: 'BMW Website',
    description: null,
    status: 'planned',
    leadAgentId: null,
    targetDate: null,
    color: null,
    icon: null,
    env: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: {
      workspaceId: 'workspace-bmw',
      repoUrl: 'https://github.com/example/bmw-website.git',
      repoRef: 'main',
      defaultRef: 'main',
      repoName: 'bmw-website',
      localFolder: '/work/bmw-website',
      managedFolder: '/work/bmw-website',
      effectiveLocalFolder: '/work/bmw-website',
      origin: 'local_folder',
    },
    workspaces: [],
    primaryWorkspace: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function workspace(): PluginWorkspace {
  return {
    id: 'workspace-bmw',
    projectId: PROJECT_ID,
    name: 'BMW local checkout',
    path: '/work/bmw-website',
    repoUrl: 'https://github.com/example/bmw-website.git',
    repoRef: 'main',
    defaultRef: 'main',
    isPrimary: true,
    createdAt: '2026-08-08T12:00:00.000Z',
    updatedAt: '2026-08-08T12:00:00.000Z',
  };
}

describe('project onboarding worker actions', () => {
  let harness: ReturnType<typeof createTestHarness>;

  beforeEach(async () => {
    harness = createTestHarness({ manifest, config: { enableTeam: true, requireProjectSprint: false } });
    harness.seed({ projects: [project()], projectWorkspaces: [workspace()] });
    await plugin.definition.setup(harness.ctx);
  });

  it('creates a project-bound kickoff issue and queues the Technical Lead', async () => {
    const result = await harness.performAction<{
      started: boolean;
      rootIssueId?: string;
      wakeup?: { queued: boolean };
    }>(
      'startProjectOnboarding',
      {
        projectId: PROJECT_ID,
        brief: 'Build a responsive image slider.',
        constraints: 'Use the existing design system.',
      },
      { companyId: COMPANY_ID }
    );

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const rootIssue = await harness.ctx.issues.get(result.rootIssueId!, COMPANY_ID);
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');

    expect(result.started).toBe(true);
    expect(result.wakeup?.queued).toBe(true);
    expect(board.projectOnboarding).toMatchObject({
      status: 'analysis_in_progress',
      projectId: PROJECT_ID,
      rootIssueId: result.rootIssueId,
    });
    expect(rootIssue).toMatchObject({
      projectId: PROJECT_ID,
      status: 'todo',
      assigneeAgentId: technicalLead?.id,
    });
    expect(rootIssue?.description).toContain('Inspect the repository');
  });

  it('does not permit planning or refinement before backlog approval', async () => {
    await harness.performAction(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );

    await expect(
      harness.performAction('runCeremony', { ceremony: 'backlog_refinement' }, { companyId: COMPANY_ID })
    ).resolves.toEqual({
      started: false,
      error: 'Approve the project backlog before starting planning or refinement.',
    });
  });

  it('hands the same issue from analysis to story discovery and then activates delivery', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );

    await expect(
      harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID })
    ).resolves.toEqual({
      started: false,
      error: 'Wait for the Technical Lead to finish the project analysis before starting Product Owner discovery.',
    });

    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);

    const analysisReadyBoard = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(analysisReadyBoard.projectOnboarding.status).toBe('analysis_ready');

    const discovery = await harness.performAction<{
      started: boolean;
      projectOnboarding: ProjectOnboarding;
      wakeup: { queued: boolean };
    }>('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    const active = await harness.performAction<{
      activated: boolean;
      projectOnboarding: ProjectOnboarding;
    }>('activateProjectOnboarding', {}, { companyId: COMPANY_ID });
    const rootIssue = await harness.ctx.issues.get(kickoff.rootIssueId, COMPANY_ID);
    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const productOwner = board.agents.find((agent) => agent.role === 'product_owner');

    expect(discovery.started).toBe(true);
    expect(discovery.wakeup.queued).toBe(true);
    expect(rootIssue).toMatchObject({ assigneeAgentId: productOwner?.id });
    expect(rootIssue?.description).toContain('child issues');
    expect(active).toMatchObject({ activated: true, projectOnboarding: { status: 'active' } });
    expect(board.projectOnboarding.status).toBe('active');
  });

  it('requires a first sprint by default before a new project can enter delivery', async () => {
    const sprintHarness = createTestHarness({ manifest, config: { enableTeam: true } });
    sprintHarness.seed({ projects: [project()], projectWorkspaces: [workspace()] });
    await plugin.definition.setup(sprintHarness.ctx);

    const kickoff = await sprintHarness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(sprintHarness, kickoff.rootIssueId);
    await sprintHarness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    const child = await sprintHarness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Add accessible image slider',
      status: 'backlog',
    });
    await sprintHarness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    const approval = await sprintHarness.performAction<{
      activated: boolean;
      projectOnboarding: ProjectOnboarding;
    }>('activateProjectOnboarding', {}, { companyId: COMPANY_ID });
    let board = await sprintHarness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const developer = board.agents.find((agent) => agent.role === 'developer');

    expect(approval).toMatchObject({ activated: true, projectOnboarding: { status: 'sprint_planning' } });
    expect(board.currentSprint).toBeNull();
    expect(await sprintHarness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({ status: 'backlog' });

    const refinement = await sprintHarness.ctx.issues.createComment(
      child.id,
      `<!-- ${REFINEMENT_MARKER} {"storyPoints":5,"acceptanceCriteria":["Keyboard navigation works"],"technicalNotes":"Reuse the media primitives."} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await sprintHarness.emit(
      'issue.comment.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: refinement.id, entityType: 'issue_comment' }
    );

    board = await sprintHarness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(board.canStartProjectSprint).toBe(true);
    const sprint = await sprintHarness.performAction<{
      started: boolean;
      sprint: { id: string; status: string; taskIds: string[] };
      projectOnboarding: ProjectOnboarding;
    }>('startProjectSprint', {}, { companyId: COMPANY_ID });

    expect(sprint).toMatchObject({
      started: true,
      sprint: { status: 'active', taskIds: [child.id] },
      projectOnboarding: { status: 'active' },
    });
    expect(await sprintHarness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'todo',
      assigneeAgentId: developer?.id,
    });
  });

  it('mirrors Product Owner child issues without firing a local ceremony', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Add accessible image slider',
      description: 'As a visitor, I want to browse images.',
      status: 'backlog',
      priority: 'high',
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue', actorId: 'agent-product-owner' }
    );

    let board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(board.tasks).toMatchObject([
      {
        id: child.id,
        parentId: kickoff.rootIssueId,
        title: 'Add accessible image slider',
        column: 'backlog',
        priority: 'high',
      },
    ]);
    expect(board.ceremonies).toEqual([]);

    const developer = board.agents.find((agent) => agent.role === 'developer');
    await harness.ctx.issues.update(
      child.id,
      { title: 'Add keyboard-accessible image slider', status: 'todo', assigneeAgentId: developer?.id },
      COMPANY_ID
    );
    await harness.emit(
      'issue.updated',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue', actorId: 'agent-product-owner' }
    );

    board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]).toMatchObject({
      id: child.id,
      title: 'Add keyboard-accessible image slider',
      column: 'todo',
      assignedAgentId: developer?.id,
    });

    await harness.ctx.issues.update(child.id, { status: 'cancelled' }, COMPANY_ID);
    await harness.emit(
      'issue.updated',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(board.tasks).toEqual([]);
  });

  it('hydrates missed child-issue events after a worker restart', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Add image slider controls',
      status: 'backlog',
    });

    // A new worker closure reads persisted state and rehydrates the current
    // project children instead of depending on an event it never received.
    await plugin.definition.setup(harness.ctx);
    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(board.tasks).toMatchObject([{ id: child.id, parentId: kickoff.rootIssueId }]);
  });

  it('requests refinement once for an active child issue discovered after a worker restart', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Add image slider controls',
      status: 'backlog',
    });

    await plugin.definition.setup(harness.ctx);
    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(board.tasks).toMatchObject([{ id: child.id, parentId: kickoff.rootIssueId }]);
    expect(harness.logs.filter((entry) => entry.message === 'Project refinement requested')).toHaveLength(1);
  });

  it('keeps project-backed tickets host-controlled after backlog approval', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Add image slider controls',
      status: 'backlog',
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    const activation = await harness.performAction<{
      activated: boolean;
      wakeup?: { queued: boolean };
    }>('activateProjectOnboarding', {}, { companyId: COMPANY_ID });
    const move = await harness.performAction<{ moved: boolean; error?: string }>(
      'moveTask',
      { taskId: child.id, column: 'todo' },
      { companyId: COMPANY_ID }
    );
    const ceremony = await harness.performAction<{ started: boolean; error?: string }>(
      'runCeremony',
      { ceremony: 'sprint_planning' },
      { companyId: COMPANY_ID }
    );
    const comments = await harness.ctx.issues.listComments(kickoff.rootIssueId, COMPANY_ID);

    expect(activation).toMatchObject({ activated: true, wakeup: { queued: true } });
    expect(comments.at(-1)?.body).toContain('Backlog approved');
    expect(move).toEqual({
      moved: false,
      error: 'Project-backed tickets are updated through their Paperclip issue workflow.',
    });
    expect(ceremony).toEqual({
      started: false,
      error: 'Project-backed tickets are coordinated through their Paperclip issue workflow.',
    });
  });

  it('starts one host-backed refinement ceremony after the human approves a backlog', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Add accessible image slider',
      status: 'backlog',
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    const activation = await harness.performAction<{
      activated: boolean;
      refinement?: { requested: boolean; taskIds: string[] };
    }>('activateProjectOnboarding', {}, { companyId: COMPANY_ID });
    const repeatedRequest = await harness.performAction<{
      requested: boolean;
      error?: string;
    }>('requestProjectRefinement', {}, { companyId: COMPANY_ID });
    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(activation).toMatchObject({
      activated: true,
      refinement: { requested: true, taskIds: [child.id] },
    });
    expect(repeatedRequest).toEqual({
      requested: false,
      error: 'No project tickets need technical refinement.',
      taskIds: [],
    });
    expect(board.ceremonies.at(-1)).toMatchObject({
      type: 'backlog_refinement',
      taskIds: [child.id],
    });
    expect(harness.logs.filter((entry) => entry.message === 'Project refinement requested')).toHaveLength(1);
  });

  it('requests refinement for an already active project ticket missing an estimate', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Implement image slider controls',
      status: 'in_progress',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    expect(
      harness.logs.filter(
        (entry) =>
          entry.message === 'Project refinement requested' &&
          Array.isArray(entry.meta?.taskIds) &&
          entry.meta.taskIds.includes(child.id)
      )
    ).toHaveLength(1);
  });

  it('retries a previously requested project refinement only through the explicit retry action', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Implement image slider controls',
      status: 'in_progress',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    await expect(
      harness.performAction('requestProjectRefinement', {}, { companyId: COMPANY_ID })
    ).resolves.toMatchObject({ requested: false });
    await expect(
      harness.performAction('retryProjectRefinement', {}, { companyId: COMPANY_ID })
    ).resolves.toMatchObject({ requested: true, taskIds: [child.id] });
  });

  it('plans a technically refined project story in Paperclip and assigns a developer', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Add accessible image slider',
      description: 'As a visitor, I want to browse image slides.',
      status: 'backlog',
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const beforeRefinement = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = beforeRefinement.agents.find((agent) => agent.role === 'technical_lead');
    const developer = beforeRefinement.agents.find((agent) => agent.role === 'developer');
    const refinement = await harness.ctx.issues.createComment(
      child.id,
      `<!-- ${REFINEMENT_MARKER} {"storyPoints":5,"acceptanceCriteria":["Keyboard navigation works"],"technicalNotes":"Reuse the media primitives."} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await harness.emit(
      'issue.comment.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: refinement.id, entityType: 'issue_comment' }
    );

    const planned = await harness.ctx.issues.get(child.id, COMPANY_ID);
    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(planned).toMatchObject({ status: 'todo', assigneeAgentId: developer?.id });
    expect(board.tasks.find((task) => task.id === child.id)).toMatchObject({
      column: 'todo',
      assignedAgentId: developer?.id,
      refined: true,
      storyPoints: 5,
    });
    expect(board.ceremonies.at(-1)).toMatchObject({ type: 'sprint_planning', taskIds: [child.id] });
  });

  it('routes project reviews to QA by default and to the Product Owner for an explicit decision', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const productOwner = board.agents.find((agent) => agent.role === 'product_owner');

    const technicalReview = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Validate image slider implementation',
      status: 'in_review',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.updated',
      { issueId: technicalReview.id },
      { companyId: COMPANY_ID, entityId: technicalReview.id, entityType: 'issue' }
    );

    expect(await harness.ctx.issues.get(technicalReview.id, COMPANY_ID)).toMatchObject({
      status: 'in_review',
      assigneeAgentId: qa?.id,
    });

    await harness.emit(
      'issue.updated',
      { issueId: technicalReview.id },
      { companyId: COMPANY_ID, entityId: technicalReview.id, entityType: 'issue' }
    );
    expect(
      harness.logs.filter(
        (entry) =>
          entry.message === 'Project review routed' &&
          entry.meta?.issueId === technicalReview.id
      )
    ).toHaveLength(1);

    const productDecision = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Choose image slider auto-play behaviour',
      description: `Decision required\n${PRODUCT_DECISION_REQUIRED_MARKER}`,
      status: 'in_review',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.updated',
      { issueId: productDecision.id },
      { companyId: COMPANY_ID, entityId: productDecision.id, entityType: 'issue' }
    );

    expect(await harness.ctx.issues.get(productDecision.id, COMPANY_ID)).toMatchObject({
      status: 'in_review',
      assigneeAgentId: productOwner?.id,
    });

    await harness.ctx.issues.createComment(
      productDecision.id,
      `Decision: keep auto-play disabled.\n${PRODUCT_DECISION_RESOLVED_MARKER}`,
      COMPANY_ID,
      { authorAgentId: productOwner?.id }
    );
    await harness.emit(
      'issue.comment.created',
      { issueId: productDecision.id },
      { companyId: COMPANY_ID, entityId: 'comment-decision', entityType: 'issue_comment' }
    );

    expect(await harness.ctx.issues.get(productDecision.id, COMPANY_ID)).toMatchObject({
      status: 'in_review',
      assigneeAgentId: qa?.id,
    });
  });

  it('returns a direct developer completion to QA review before it can remain done', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Verify image slider completion',
      status: 'in_progress',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );
    await harness.ctx.issues.update(child.id, { status: 'done' }, COMPANY_ID);
    await harness.emit(
      'issue.updated',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue', actorId: developer?.id }
    );

    expect(await harness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'in_review',
      assigneeAgentId: qa?.id,
    });
    const after = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(after.tasks.find((task) => task.id === child.id)).toMatchObject({
      column: 'in_review',
      assignedAgentId: qa?.id,
    });
  });

  it('keeps a QA-marked completion done when project issues are hydrated', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'QA-approved image slider',
      status: 'done',
      assigneeAgentId: qa?.id,
    });
    await harness.ctx.issues.createComment(
      child.id,
      `Review approved\n${QA_REVIEW_APPROVED_MARKER}`,
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );

    await plugin.definition.setup(harness.ctx);
    const after = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(await harness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({ status: 'done' });
    expect(after.tasks.find((task) => task.id === child.id)).toMatchObject({ column: 'done' });
  });

  it('keeps a QA-owned completion done when the host event does not expose an actor', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'QA-owned image slider review',
      status: 'in_review',
      assigneeAgentId: qa?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );
    await harness.ctx.issues.update(child.id, { status: 'done' }, COMPANY_ID);
    await harness.emit(
      'issue.updated',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    expect(await harness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'done',
      assigneeAgentId: qa?.id,
    });
  });

  it('projects an active host assignment into the responsible agent status', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const before = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const developer = before.agents.find((agent) => agent.role === 'developer');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Implement image slider controls',
      status: 'in_progress',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    const after = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(after.agents.find((agent) => agent.id === developer?.id)).toMatchObject({
      status: 'working',
      currentTaskId: child.id,
    });
  });

  it('returns a blocked project ticket to todo only after every host blocker is done', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const completedBlocker = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Completed prerequisite',
      status: 'done',
    });
    await harness.ctx.issues.createComment(
      completedBlocker.id,
      `QA approved\n${QA_REVIEW_APPROVED_MARKER}`,
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );
    const openBlocker = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Open prerequisite',
      status: 'in_progress',
      assigneeAgentId: developer?.id,
    });
    const blocked = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Run QA after prerequisites',
      status: 'blocked',
      assigneeAgentId: qa?.id,
      blockedByIssueIds: [completedBlocker.id, openBlocker.id],
    });
    await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(await harness.ctx.issues.get(blocked.id, COMPANY_ID)).toMatchObject({ status: 'blocked' });

    await harness.ctx.issues.createComment(
      openBlocker.id,
      `QA approved\n${QA_REVIEW_APPROVED_MARKER}`,
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );
    await harness.ctx.issues.update(openBlocker.id, { status: 'done', assigneeAgentId: qa?.id }, COMPANY_ID);
    await harness.emit(
      'issue.updated',
      { issueId: openBlocker.id },
      { companyId: COMPANY_ID, entityId: openBlocker.id, entityType: 'issue', actorId: qa?.id }
    );

    expect(await harness.ctx.issues.get(blocked.id, COMPANY_ID)).toMatchObject({
      status: 'todo',
      assigneeAgentId: qa?.id,
    });
    const after = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(after.tasks.find((task) => task.id === blocked.id)).toMatchObject({ column: 'todo' });
  });

  it('projects host comments, refinement, and decisions into a project-backed ticket', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Add accessible image slider',
      description: '## Akzeptanzkriterien\n- [ ] Keyboard navigation works',
      status: 'backlog',
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const productOwner = board.agents.find((agent) => agent.role === 'product_owner');
    const refinement = await harness.ctx.issues.createComment(
      child.id,
      `## Technical refinement\n<!-- ${REFINEMENT_MARKER} {"storyPoints":5,"acceptanceCriteria":["Keyboard navigation works"],"technicalNotes":"Reuse the existing media primitives."} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await harness.ctx.issues.createComment(
      child.id,
      `Decision recorded\n<!-- ${DECISION_MARKER} {"type":"priority_change","description":"Prioritized keyboard support","reasoning":"Accessibility is required for launch."} -->`,
      COMPANY_ID,
      { authorAgentId: productOwner?.id }
    );
    await harness.emit(
      'issue.comment.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: refinement.id, entityType: 'issue_comment' }
    );

    const projected = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const task = projected.tasks.find((entry) => entry.id === child.id)!;
    expect(task).toMatchObject({
      storyPoints: 5,
      refined: true,
      technicalNotes: 'Reuse the existing media primitives.',
    });
    expect(task.acceptanceCriteria.map((criterion) => criterion.text)).toEqual(['Keyboard navigation works']);
    expect(task.comments).toHaveLength(2);
    expect(task.decisions).toEqual([
      expect.objectContaining({
        type: 'priority_change',
        description: 'Prioritized keyboard support',
        madeByName: 'Product Owner',
      }),
    ]);
  });

  it('rejects a project without a primary workspace before creating an issue', async () => {
    const noWorkspaceHarness = createTestHarness({ manifest, config: { enableTeam: true } });
    noWorkspaceHarness.seed({ projects: [project()] });
    await plugin.definition.setup(noWorkspaceHarness.ctx);

    const result = await noWorkspaceHarness.performAction<{ started: boolean; error?: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );

    expect(result).toEqual({
      started: false,
      error:
        'The selected project needs a primary workspace. Add its repository or local folder in Paperclip first.',
    });
    expect(await noWorkspaceHarness.ctx.issues.list({ companyId: COMPANY_ID })).toEqual([]);
  });
});