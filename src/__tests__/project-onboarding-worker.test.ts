import { createTestHarness, type PluginWorkspace, type Project } from '@paperclipai/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import manifest from '../manifest';
import plugin from '../worker';
import {
  createInitialProjectOnboarding,
  TECHNICAL_ANALYSIS_CHANGES_REQUESTED_MARKER,
  TECHNICAL_ANALYSIS_COMPLETION_MARKER,
} from '../core/project-onboarding';
import {
  PRODUCT_DECISION_REQUIRED_MARKER,
  PRODUCT_DECISION_RESOLVED_MARKER,
  QA_REVIEW_APPROVED_MARKER,
  QA_REWORK_ROUTED_MARKER,
} from '../core/review-routing';
import { COMMIT_MARKER, DECISION_MARKER, REFINEMENT_MARKER } from '../core/project-issue-projection';
import { createAcceptanceCriterion, createScrumTask } from '../core/factories';
import type { CeremonyRecord, ProjectOnboarding, ScrumAgent, ScrumTask, TicketStall, WorkerState } from '../core/types';

const COMPANY_ID = 'company-bmw';
const PROJECT_ID = 'project-bmw';
const SECONDARY_COMPANY_ID = 'company-audi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function githubCommitFetch() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/repos/example/bmw-website/commits/a1b2c3d4e5f6')) {
      return jsonResponse({
        sha: 'a1b2c3d4e5f6',
        html_url: 'https://github.com/example/bmw-website/commit/a1b2c3d4e5f6',
        commit: {
          message: 'feat: deliver ticket',
          author: { date: '2026-08-09T12:05:00.000Z' },
        },
        files: [{
          filename: 'src/slider.ts',
          status: 'modified',
          additions: 4,
          deletions: 1,
          patch: '@@ -1 +1 @@\n-old\n+new',
        }],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

interface BoardData {
  agents: ScrumAgent[];
  tasks: ScrumTask[];
  kickoffTask: ScrumTask | null;
  ceremonies: CeremonyRecord[];
  projectOnboarding: ProjectOnboarding;
  currentSprint: { id: string; status: string; taskIds: string[] } | null;
  canStartProjectOnboarding: boolean;
  canStartProjectSprint: boolean;
  projectProgress: { unrefinedTasks: number; totalTasks: number };
  stalls: TicketStall[];
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

async function recordDeveloperCommit(
  harness: ReturnType<typeof createTestHarness>,
  issueId: string,
  developerId: string | undefined
): Promise<void> {
  if (!developerId) throw new Error('Developer is required for commit evidence.');

  await harness.ctx.issues.createComment(
    issueId,
    `<!-- ${COMMIT_MARKER} {"sha":"a1b2c3d4e5f6","url":"https://github.com/example/bmw-website/commit/a1b2c3d4e5f6","message":"feat: deliver ticket"} -->`,
    COMPANY_ID,
    { authorAgentId: developerId }
  );
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

function onboardingFor(projectId: string, projectName: string, rootIssueId: string): ProjectOnboarding {
  return {
    ...createInitialProjectOnboarding('2026-08-09T12:00:00.000Z'),
    status: 'analysis_in_progress',
    projectId,
    projectName,
    rootIssueId,
    requiresSprint: false,
    brief: `Deliver ${projectName}.`,
    startedAt: '2026-08-09T12:00:00.000Z',
  };
}

describe('project onboarding worker actions', () => {
  let harness: ReturnType<typeof createTestHarness>;

  beforeEach(async () => {
    vi.stubGlobal('fetch', githubCommitFetch());
    harness = createTestHarness({ manifest, config: { enableTeam: true, requireProjectSprint: false } });
    harness.seed({ projects: [project()], projectWorkspaces: [workspace()] });
    await plugin.definition.setup(harness.ctx);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('keeps concurrent company board initialization isolated', async () => {
    await harness.ctx.state.set(
      { scopeKind: 'company', scopeId: COMPANY_ID, stateKey: 'board' },
      { projectOnboarding: onboardingFor(PROJECT_ID, 'BMW Website', 'issue-bmw-kickoff') }
    );
    await harness.ctx.state.set(
      { scopeKind: 'company', scopeId: SECONDARY_COMPANY_ID, stateKey: 'board' },
      { projectOnboarding: onboardingFor('project-audi', 'Audi Website', 'issue-audi-kickoff') }
    );

    const originalStateGet = harness.ctx.state.get.bind(harness.ctx.state);
    let holdSecondaryStateRead = true;
    let signalSecondaryStateRead: (() => void) | undefined;
    let releaseSecondaryStateRead: (() => void) | undefined;
    const secondaryStateReadStarted = new Promise<void>((resolve) => {
      signalSecondaryStateRead = resolve;
    });
    const secondaryStateReadReleased = new Promise<void>((resolve) => {
      releaseSecondaryStateRead = resolve;
    });
    const stateGetSpy = vi.spyOn(harness.ctx.state, 'get').mockImplementation(async (scope) => {
      if (holdSecondaryStateRead && scope.scopeId === SECONDARY_COMPANY_ID) {
        holdSecondaryStateRead = false;
        signalSecondaryStateRead?.();
        await secondaryStateReadReleased;
      }
      return originalStateGet(scope);
    });

    try {
      const secondaryBoard = harness.getData<BoardData>('board', { companyId: SECONDARY_COMPANY_ID });
      await secondaryStateReadStarted;

      const primaryBoard = harness.getData<BoardData>('board', { companyId: COMPANY_ID });
      await Promise.resolve();
      await Promise.resolve();
      releaseSecondaryStateRead?.();

      const [secondary, primary] = await Promise.all([secondaryBoard, primaryBoard]);

      expect(primary.projectOnboarding.projectName).toBe('BMW Website');
      expect(secondary.projectOnboarding.projectName).toBe('Audi Website');
      expect((await harness.getData<BoardData>('board', { companyId: COMPANY_ID })).projectOnboarding.projectName)
        .toBe('BMW Website');
      expect((await harness.getData<BoardData>('board', { companyId: SECONDARY_COMPANY_ID })).projectOnboarding.projectName)
        .toBe('Audi Website');
    } finally {
      stateGetSpy.mockRestore();
    }
  });

  it('acknowledges host events while board initialization owns the company invocation', async () => {
    let releaseConfigRead: (() => void) | undefined;
    let signalConfigRead: (() => void) | undefined;
    const configReadStarted = new Promise<void>((resolve) => {
      signalConfigRead = resolve;
    });
    const configReadReleased = new Promise<void>((resolve) => {
      releaseConfigRead = resolve;
    });
    const configGetSpy = vi.spyOn(harness.ctx.config, 'get').mockImplementation(async () => {
      signalConfigRead?.();
      await configReadReleased;
      return { enableTeam: false };
    });

    const board = harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    await configReadStarted;

    const hostEvent = harness.emit('issue.updated', {}, { companyId: COMPANY_ID });
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const acknowledged = await Promise.race([
        hostEvent.then(() => true),
        new Promise<false>((resolve) => {
          timeout = setTimeout(() => resolve(false), 100);
        }),
      ]);

      expect(acknowledged).toBe(true);
    } finally {
      if (timeout) clearTimeout(timeout);
      releaseConfigRead?.();
      await Promise.all([board, hostEvent]);
      await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
      configGetSpy.mockRestore();
    }
  });

  it('reopens a persisted local done ticket with unverified acceptance criteria', async () => {
    const firstCriterion = createAcceptanceCriterion('Theme can be toggled');
    const secondCriterion = createAcceptanceCriterion('Theme preference persists');
    firstCriterion.met = true;
    const completedTask = createScrumTask({
      id: 'legacy-theme-toggle',
      title: 'Theme Toggle Infrastruktur implementieren',
      description: '',
      column: 'done',
      acceptanceCriteria: [firstCriterion, secondCriterion],
      completedAt: '2026-08-09T12:00:00.000Z',
    });
    await harness.ctx.state.set(
      { scopeKind: 'company', scopeId: COMPANY_ID, stateKey: 'board' },
      { tasks: [completedTask] }
    );

    await plugin.definition.setup(harness.ctx);
    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const reconciledTask = board.tasks.find((task) => task.id === completedTask.id);

    expect(reconciledTask).toMatchObject({
      column: 'in_review',
      assignedAgentId: qa?.id,
      completedAt: null,
    });
    expect(reconciledTask?.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('acceptance criteria verification required') }),
      ])
    );
  });

  it('reopens a persisted local done ticket without acceptance criteria', async () => {
    const completedTask = createScrumTask({
      id: 'legacy-unrefined-completion',
      title: 'Legacy task without refinement',
      description: '',
      column: 'done',
      completedAt: '2026-08-09T12:00:00.000Z',
    });
    await harness.ctx.state.set(
      { scopeKind: 'company', scopeId: COMPANY_ID, stateKey: 'board' },
      { tasks: [completedTask] }
    );

    await plugin.definition.setup(harness.ctx);
    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const reconciledTask = board.tasks.find((task) => task.id === completedTask.id);

    expect(reconciledTask).toMatchObject({
      column: 'in_review',
      assignedAgentId: qa?.id,
      completedAt: null,
    });
    expect(reconciledTask?.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('no acceptance criteria') }),
      ])
    );
  });

  it('keeps a persisted local done ticket with fully verified acceptance criteria', async () => {
    const firstCriterion = createAcceptanceCriterion('Theme can be toggled');
    const secondCriterion = createAcceptanceCriterion('Theme preference persists');
    firstCriterion.met = true;
    secondCriterion.met = true;
    const completedTask = createScrumTask({
      id: 'verified-local-completion',
      title: 'Verified local task',
      description: '',
      column: 'done',
      acceptanceCriteria: [firstCriterion, secondCriterion],
      completedAt: '2026-08-09T12:00:00.000Z',
    });
    await harness.ctx.state.set(
      { scopeKind: 'company', scopeId: COMPANY_ID, stateKey: 'board' },
      { tasks: [completedTask] }
    );

    await plugin.definition.setup(harness.ctx);
    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const reconciledTask = board.tasks.find((task) => task.id === completedTask.id);

    expect(reconciledTask).toMatchObject({
      column: 'done',
      completedAt: '2026-08-09T12:00:00.000Z',
    });
    expect(reconciledTask?.comments).toHaveLength(0);
  });

  it('trusts a Paperclip-linked GitHub workspace without requiring GitHub Actions', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('Onboarding must not call GitHub directly.');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await harness.performAction<{ started: boolean; error?: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );

    expect(result).toMatchObject({ started: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads GitHub file changes for a developer-recorded project commit', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Deliver image slider',
      status: 'backlog',
    });
    await recordDeveloperCommit(harness, child.id, developer?.id);

    const result = await harness.performAction<{
      valid: boolean;
      sha?: string;
      files?: Array<{ path: string; additions: number; deletions: number; patch: string | null }>;
    }>(
      'fetchTicketCommitChanges',
      { taskId: child.id, sha: 'a1b2c3d4e5f6' },
      { companyId: COMPANY_ID }
    );

    expect(result).toMatchObject({
      valid: true,
      sha: 'a1b2c3d4e5f6',
      files: [{ path: 'src/slider.ts', additions: 4, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' }],
    });
  });

  it('projects kickoff analysis and comments into board data', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    const initialBoard = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = initialBoard.agents.find((agent) => agent.role === 'technical_lead');
    await harness.ctx.issues.createComment(
      kickoff.rootIssueId,
      `## Technical analysis\n\nThe existing media primitives can be reused.\n\n${TECHNICAL_ANALYSIS_COMPLETION_MARKER}`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(board.kickoffTask).toMatchObject({
      id: kickoff.rootIssueId,
      title: 'Kickoff: BMW Website',
      type: 'epic',
    });
    expect(board.kickoffTask?.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining(TECHNICAL_ANALYSIS_COMPLETION_MARKER) }),
      ])
    );
  });

  it('returns a rejected technical analysis to the Technical Lead for revision', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);

    const rejected = await harness.performAction<{
      rejected: boolean;
      projectOnboarding: ProjectOnboarding;
      wakeup: { queued: boolean };
    }>(
      'rejectTechnicalAnalysis',
      { reason: 'Explain the data model and delivery risks before story discovery.' },
      { companyId: COMPANY_ID }
    );

    expect(rejected).toMatchObject({
      rejected: true,
      projectOnboarding: { status: 'analysis_in_progress' },
      wakeup: { queued: true },
    });

    const rootIssue = await harness.ctx.issues.get(kickoff.rootIssueId, COMPANY_ID);
    const comments = await harness.ctx.issues.listComments(kickoff.rootIssueId, COMPANY_ID);
    expect(rootIssue).toMatchObject({ status: 'todo' });
    expect(comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.stringContaining(TECHNICAL_ANALYSIS_CHANGES_REQUESTED_MARKER),
        }),
        expect.objectContaining({
          body: expect.stringContaining('Explain the data model and delivery risks'),
        }),
      ])
    );

    const stillInProgress = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(stillInProgress.projectOnboarding.status).toBe('analysis_in_progress');

    const technicalLead = stillInProgress.agents.find((agent) => agent.role === 'technical_lead');
    await harness.ctx.issues.createComment(
      kickoff.rootIssueId,
      `## Revised technical analysis\n\n${TECHNICAL_ANALYSIS_COMPLETION_MARKER}`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );

    const readyAgain = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(readyAgain.projectOnboarding.status).toBe('analysis_ready');
  });

  it('reconciles the Scrum-Master watchdog and on-demand runtime policies onto managed agents', async () => {
    await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    const developer = await harness.ctx.agents.managed.get('developer-1', COMPANY_ID);
    const scrumMaster = await harness.ctx.agents.managed.get('scrum-master', COMPANY_ID);

    expect(developer.agent).toMatchObject({
      runtimeConfig: {
        heartbeat: {
          enabled: false,
          intervalSec: 1800,
          wakeOnDemand: true,
          maxConcurrentRuns: 1,
          skipTimerWhenNoActionableWork: true,
        },
      },
    });
    expect(scrumMaster.agent).toMatchObject({
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 1800,
          wakeOnDemand: true,
          maxConcurrentRuns: 1,
          skipTimerWhenNoActionableWork: false,
        },
      },
    });
  });

  it('publishes active retrospective skills to Paperclip and assigns them to matching agents', async () => {
    const skillHarness = createTestHarness({
      manifest,
      config: { enableTeam: true, apiBaseUrl: 'http://paperclip.test' },
    });
    skillHarness.seed({ projects: [project()], projectWorkspaces: [workspace()] });
    const localSkill = {
      id: 'learning-skill-1',
      name: 'Verify acceptance criteria before review',
      description: 'Check every acceptance criterion before moving work to review.',
      category: 'quality' as const,
      roles: ['developer'],
      active: true,
      learningIds: ['learning-1'],
      reinforcementCount: 1,
      createdAt: '2026-08-09T12:00:00.000Z',
      activatedAt: '2026-08-09T12:00:00.000Z',
    };
    await skillHarness.ctx.state.set(
      { scopeKind: 'company', scopeId: COMPANY_ID, stateKey: 'board' },
      { skills: [localSkill] }
    );

    const nativeSkillKey = `company/${COMPANY_ID}/agent-scrum-learning-${localSkill.id}`;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === `http://paperclip.test/api/companies/${COMPANY_ID}/skills` && method === 'GET') {
        return jsonResponse([]);
      }
      if (url === `http://paperclip.test/api/companies/${COMPANY_ID}/skills` && method === 'POST') {
        return jsonResponse({
          id: 'native-skill-1',
          key: nativeSkillKey,
          slug: `agent-scrum-learning-${localSkill.id}`,
          name: 'Verify acceptance criteria before review',
        }, 201);
      }
      if (/^http:\/\/paperclip\.test\/api\/agents\/[^/]+\/skills$/.test(url) && method === 'GET') {
        return jsonResponse({
          desiredSkills: ['paperclipai/paperclip/paperclip'],
          entries: [],
          warnings: [],
        });
      }
      if (/^http:\/\/paperclip\.test\/api\/agents\/[^/]+\/skills\/sync$/.test(url) && method === 'POST') {
        return jsonResponse({ desiredSkills: [nativeSkillKey], entries: [], warnings: [] });
      }
      if (/^http:\/\/paperclip\.test\/api\/agents\/[^/]+\/instructions-bundle\/file/.test(url)) {
        return method === 'GET' ? jsonResponse({ content: null }) : jsonResponse({});
      }
      if (/^http:\/\/paperclip\.test\/api\/agents\/[^/]+$/.test(url)) {
        return method === 'GET' ? jsonResponse({ runtimeConfig: {} }) : jsonResponse({});
      }
      throw new Error(`Unexpected native skill sync request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await plugin.definition.setup(skillHarness.ctx);
    await skillHarness.getData<BoardData>('board', { companyId: COMPANY_ID });

    const nativeCreate = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === `http://paperclip.test/api/companies/${COMPANY_ID}/skills` && init?.method === 'POST'
    );
    expect(nativeCreate).toBeDefined();
    expect(JSON.parse(String(nativeCreate?.[1]?.body))).toMatchObject({
      name: 'Verify acceptance criteria before review',
      slug: `agent-scrum-learning-${localSkill.id}`,
    });

    const assignments = fetchMock.mock.calls.filter(([input, init]) =>
      /^http:\/\/paperclip\.test\/api\/agents\/[^/]+\/skills\/sync$/.test(String(input)) &&
      init?.method === 'POST'
    );
    expect(assignments).toHaveLength(2);
    for (const [, init] of assignments) {
      expect(JSON.parse(String(init?.body))).toEqual({
        desiredSkills: ['paperclipai/paperclip/paperclip', nativeSkillKey],
      });
    }

    const persisted = (await skillHarness.ctx.state.get({
      scopeKind: 'company',
      scopeId: COMPANY_ID,
      stateKey: 'board',
    })) as WorkerState;
    expect(persisted.skills[0]).toMatchObject({
      paperclipSkillKey: nativeSkillKey,
      paperclipSkillId: 'native-skill-1',
    });
    expect(new Set(persisted.skills[0].paperclipAssignedAgentIds)).toHaveLength(2);
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
    expect(await harness.ctx.issues.listComments(kickoff.rootIssueId, COMPANY_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('Technical analysis approved') }),
      ])
    );
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
    expect(await sprintHarness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'todo',
      assigneeAgentId: technicalLead?.id,
    });

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

  it('returns a ready ticket wrongly blocked under the Technical Lead to backlog during sprint planning', async () => {
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
    await sprintHarness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    let board = await sprintHarness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const refinement = await sprintHarness.ctx.issues.createComment(
      child.id,
      `<!-- ${REFINEMENT_MARKER} {"storyPoints":3,"acceptanceCriteria":["Keyboard navigation works"],"technicalNotes":"Reuse the media primitives."} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await sprintHarness.emit(
      'issue.comment.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: refinement.id, entityType: 'issue_comment' }
    );

    await sprintHarness.ctx.issues.update(
      child.id,
      { status: 'blocked', assigneeAgentId: technicalLead?.id },
      COMPANY_ID
    );
    await sprintHarness.emit(
      'issue.updated',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue', actorId: technicalLead?.id }
    );

    expect(await sprintHarness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'backlog',
      assigneeAgentId: null,
    });
    board = await sprintHarness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(board.canStartProjectSprint).toBe(true);

    const developer = board.agents.find((agent) => agent.role === 'developer');
    await sprintHarness.performAction('startProjectSprint', {}, { companyId: COMPANY_ID });
    expect(await sprintHarness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'todo',
      assigneeAgentId: developer?.id,
    });
  });

  it('closes the project sprint with review and retrospective before unlocking the next feature request', async () => {
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
    await sprintHarness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    let board = await sprintHarness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const refinement = await sprintHarness.ctx.issues.createComment(
      child.id,
      `<!-- ${REFINEMENT_MARKER} {"storyPoints":3,"acceptanceCriteria":["Keyboard navigation works"],"technicalNotes":"Reuse the media primitives."} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await sprintHarness.emit(
      'issue.comment.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: refinement.id, entityType: 'issue_comment' }
    );
    await sprintHarness.performAction('startProjectSprint', {}, { companyId: COMPANY_ID });
    await recordDeveloperCommit(sprintHarness, child.id, developer?.id);
    await sprintHarness.ctx.issues.createComment(
      child.id,
      `QA approved\n${QA_REVIEW_APPROVED_MARKER}`,
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );
    await sprintHarness.ctx.issues.update(
      child.id,
      { status: 'done', assigneeAgentId: qa?.id },
      COMPANY_ID
    );

    const scope = { scopeKind: 'company' as const, scopeId: COMPANY_ID, stateKey: 'board' as const };
    const persisted = (await sprintHarness.ctx.state.get(scope)) as WorkerState;
    if (!persisted?.projectOnboarding) throw new Error('Expected persisted project onboarding.');
    await sprintHarness.ctx.state.set(scope, {
      ...persisted,
      projectOnboarding: { ...persisted.projectOnboarding, status: 'completed' },
      tasks: persisted.tasks.map((task) =>
        task.id === child.id
          ? { ...task, column: 'done', assignedAgentId: qa?.id ?? null, completedAt: new Date().toISOString() }
          : task
      ),
    });
    await plugin.definition.setup(sprintHarness.ctx);

    board = await sprintHarness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(board.projectOnboarding.status).toBe('completed');
    expect(board.currentSprint).toBeNull();
    expect(board.ceremonies.map((ceremony) => ceremony.type)).toEqual(
      expect.arrayContaining(['sprint_review', 'sprint_retrospective'])
    );
    expect(board.canStartProjectOnboarding).toBe(true);

    const nextFeature = await sprintHarness.performAction<{ started: boolean; rootIssueId: string }>(
      'startProjectOnboarding',
      {
        projectId: PROJECT_ID,
        brief: 'Add a de/EN translation toggle.',
        constraints: 'Use a dedicated feature branch and preserve the existing dark mode.',
      },
      { companyId: COMPANY_ID }
    );
    const nextBoard = await sprintHarness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(nextFeature).toMatchObject({ started: true });
    expect(nextFeature.rootIssueId).not.toBe(kickoff.rootIssueId);
    expect(nextBoard.projectOnboarding).toMatchObject({
      status: 'analysis_in_progress',
      rootIssueId: nextFeature.rootIssueId,
      brief: 'Add a de/EN translation toggle.',
    });
  });

  it('allows a compact project request to skip only the separate sprint-planning gate', async () => {
    const compactHarness = createTestHarness({ manifest, config: { enableTeam: true } });
    compactHarness.seed({ projects: [project()], projectWorkspaces: [workspace()] });
    await plugin.definition.setup(compactHarness.ctx);

    const kickoff = await compactHarness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      {
        projectId: PROJECT_ID,
        brief: 'Correct a single button label.',
        skipSprintPlanning: true,
      },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(compactHarness, kickoff.rootIssueId);
    await compactHarness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const approval = await compactHarness.performAction<{
      activated: boolean;
      awaitingSprint: boolean;
      projectOnboarding: ProjectOnboarding;
    }>('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    expect(approval).toMatchObject({
      activated: true,
      awaitingSprint: false,
      projectOnboarding: { status: 'active', requiresSprint: false },
    });
    expect((await compactHarness.getData<BoardData>('board', { companyId: COMPANY_ID })).currentSprint).toBeNull();
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

  it('coalesces concurrent refinement requests for the same project tickets', async () => {
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
      title: 'Implement image slider controls',
      status: 'backlog',
    });
    await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    let notifyFirstInvocation = () => {};
    let releaseFirstInvocation = () => {};
    const firstInvocationStarted = new Promise<void>((resolve) => {
      notifyFirstInvocation = resolve;
    });
    const allowFirstInvocation = new Promise<void>((resolve) => {
      releaseFirstInvocation = resolve;
    });
    const originalRequestWakeup = harness.ctx.issues.requestWakeup.bind(harness.ctx.issues);
    let invocationCount = 0;
    const requestWakeupSpy = vi.spyOn(harness.ctx.issues, 'requestWakeup').mockImplementation(async (...wakeupArguments) => {
      invocationCount += 1;
      if (invocationCount === 1) {
        notifyFirstInvocation();
        await allowFirstInvocation;
      }
      return originalRequestWakeup(...wakeupArguments);
    });

    const firstRequest = harness.performAction('requestProjectRefinement', {}, { companyId: COMPANY_ID });
    await firstInvocationStarted;
    const secondRequest = harness.performAction('requestProjectRefinement', {}, { companyId: COMPANY_ID });
    releaseFirstInvocation();

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      { requested: true, error: null, taskIds: [child.id] },
      { requested: true, error: null, taskIds: [child.id] },
    ]);
    expect(requestWakeupSpy).toHaveBeenCalledTimes(1);
    expect(
      harness.logs.filter(
        (entry) =>
          entry.message === 'Project refinement requested' &&
          Array.isArray(entry.meta?.taskIds) &&
          entry.meta.taskIds.includes(child.id)
      )
    ).toHaveLength(1);
  });

  it('does not reassign an already active project ticket missing an estimate', async () => {
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
    ).toHaveLength(0);
    await expect(harness.ctx.issues.get(child.id, COMPANY_ID)).resolves.toMatchObject({
      status: 'in_progress',
      assigneeAgentId: developer?.id,
    });
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
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Implement image slider controls',
      status: 'backlog',
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    await expect(
      harness.performAction('requestProjectRefinement', {}, { companyId: COMPANY_ID })
    ).resolves.toMatchObject({ requested: false });
    const requestWakeupSpy = vi.spyOn(harness.ctx.issues, 'requestWakeup');
    await expect(
      harness.performAction('retryProjectRefinement', {}, { companyId: COMPANY_ID })
    ).resolves.toMatchObject({ requested: true, taskIds: [child.id] });
    expect(requestWakeupSpy).toHaveBeenCalledWith(
      child.id,
      COMPANY_ID,
      expect.objectContaining({ reason: 'project_refinement' })
    );
    await expect(harness.ctx.issues.get(child.id, COMPANY_ID)).resolves.toMatchObject({
      status: 'todo',
      assigneeAgentId: technicalLead?.id,
    });
  });

  it('returns a refined Technical Lead task to the backlog for sprint planning', async () => {
    harness.setConfig({ enableTeam: true, requireProjectSprint: true });
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Implement image slider controls',
      status: 'backlog',
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );
    const refinement = await harness.ctx.issues.createComment(
      child.id,
      `<!-- ${REFINEMENT_MARKER} {"storyPoints":3,"acceptanceCriteria":["Keyboard navigation works"],"technicalNotes":"Reuse the media primitives.","risks":[]} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await harness.emit(
      'issue.comment.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: refinement.id, entityType: 'issue_comment' }
    );

    await expect(harness.ctx.issues.get(child.id, COMPANY_ID)).resolves.toMatchObject({
      status: 'backlog',
      assigneeAgentId: null,
    });
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


  /**
   * Fehlerfaelle statt Gluecksfaelle.
   *
   * Die bestehenden Tests simulieren durchweg einen wohlerzogenen Agenten:
   * Marker korrekt, JSON gueltig, Run erfolgreich. Genau daneben lagen die
   * gemeldeten Stillstaende.
   */
  it('reports a failed agent run instead of leaving the ticket silently in progress', async () => {
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
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });
    await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    await harness.emit(
      'agent.run.failed',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(board.stalls).toEqual([
      expect.objectContaining({ taskId: child.id, kind: 'run_failed' }),
    ]);

    await harness.emit(
      'agent.run.finished',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );
    const recovered = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(recovered.stalls).toEqual([]);
  });

  it('reports a malformed refinement marker instead of leaving the ticket unplanned', async () => {
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
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    // Geliefert, aber unlesbar: ein fehlendes Anfuehrungszeichen.
    const broken = await harness.ctx.issues.createComment(
      child.id,
      `<!-- ${REFINEMENT_MARKER} {"storyPoints":5,"acceptanceCriteria":[Keyboard navigation works"]} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await harness.emit(
      'issue.comment.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: broken.id, entityType: 'issue_comment' }
    );

    const afterBrokenMarker = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(afterBrokenMarker.stalls).toEqual([
      expect.objectContaining({ taskId: child.id, kind: 'refinement_invalid' }),
    ]);
  });

  it('keeps planning ready work while another ticket is still being refined', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const ready = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Add slider controls',
      status: 'backlog',
    });
    const unrefined = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Add slider captions',
      status: 'backlog',
    });
    for (const issue of [ready, unrefined]) {
      await harness.emit(
        'issue.created',
        { issueId: issue.id },
        { companyId: COMPANY_ID, entityId: issue.id, entityType: 'issue' }
      );
    }
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const developer = board.agents.find((agent) => agent.role === 'developer');

    const refinement = await harness.ctx.issues.createComment(
      ready.id,
      `<!-- ${REFINEMENT_MARKER} {"storyPoints":3,"acceptanceCriteria":["Controls are reachable by keyboard"]} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await harness.emit(
      'issue.comment.created',
      { issueId: ready.id },
      { companyId: COMPANY_ID, entityId: refinement.id, entityType: 'issue_comment' }
    );

    // Das zweite Ticket liegt weiterhin unverfeinert beim Technical Lead. Es
    // darf die Lieferung des ersten nicht aufhalten.
    const plannedIssue = await harness.ctx.issues.get(ready.id, COMPANY_ID);
    expect(plannedIssue).toMatchObject({ status: 'todo', assigneeAgentId: developer?.id });
  });


  /**
   * Die Retrospektive lief bisher genau einmal, beim Projektabschluss — sie
   * konnte den Sprint, den sie auswertet, also nicht mehr verbessern.
   */
  it('extracts learnings while delivery is still running', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const delivered = [];
    for (const title of ['Slider markup', 'Slider controls', 'Slider captions']) {
      const issue = await harness.ctx.issues.create({
        companyId: COMPANY_ID,
        projectId: PROJECT_ID,
        parentId: kickoff.rootIssueId,
        title,
        status: 'backlog',
      });
      await harness.emit(
        'issue.created',
        { issueId: issue.id },
        { companyId: COMPANY_ID, entityId: issue.id, entityType: 'issue' }
      );
      delivered.push(issue);
    }
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const setup = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const qa = setup.agents.find((agent) => agent.role === 'qa_engineer');
    const developer = setup.agents.find((agent) => agent.role === 'developer');

    // Zwei Tickets echt durch die Qualitaetsschranke, eines offen: das Projekt
    // laeuft noch. Ein Ticket einfach auf `done` zu setzen wuerde die Schranke
    // ausloesen und es zurueckschicken — genau wie in der Praxis.
    for (const issue of delivered.slice(0, 2)) {
      await recordDeveloperCommit(harness, issue.id, developer?.id);
      await harness.ctx.issues.createComment(
        issue.id,
        `## QA approved\n\n${QA_REVIEW_APPROVED_MARKER}`,
        COMPANY_ID,
        { authorAgentId: qa?.id }
      );
      await harness.ctx.issues.update(issue.id, { status: 'done', assigneeAgentId: qa?.id }, COMPANY_ID);
      await harness.emit(
        'issue.updated',
        { issueId: issue.id },
        { companyId: COMPANY_ID, entityId: issue.id, entityType: 'issue', actorId: qa?.id }
      );
    }

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(board.projectOnboarding.status).toBe('active');
    expect(board.ceremonies.some((ceremony) => ceremony.type === 'sprint_retrospective')).toBe(true);
  });


  /**
   * Der Sprint darf erst startbar sein, wenn das technische Refinement fertig
   * ist. Vorher genuegte eine einzelne fertige Story — der Knopf stand bereit,
   * waehrend der Technical Lead noch an den uebrigen arbeitete.
   */
  it('offers the first sprint only once every story is refined', async () => {
    // Eigener Harness: die Standard-Fixture liefert direkt aus, dieser Fall
    // braucht die Sprint-Schranke.
    const harness = createTestHarness({ manifest, config: { enableTeam: true } });
    harness.seed({ projects: [project()], projectWorkspaces: [workspace()] });
    await plugin.definition.setup(harness.ctx);

    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const children = [];
    for (const title of ['Slider markup', 'Slider controls']) {
      const issue = await harness.ctx.issues.create({
        companyId: COMPANY_ID,
        projectId: PROJECT_ID,
        parentId: kickoff.rootIssueId,
        title,
        status: 'backlog',
      });
      await harness.emit(
        'issue.created',
        { issueId: issue.id },
        { companyId: COMPANY_ID, entityId: issue.id, entityType: 'issue' }
      );
      children.push(issue);
    }
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');

    async function refine(issueId: string, points: number) {
      const comment = await harness.ctx.issues.createComment(
        issueId,
        `<!-- ${REFINEMENT_MARKER} {"storyPoints":${points},"acceptanceCriteria":["Works"]} -->`,
        COMPANY_ID,
        { authorAgentId: technicalLead?.id }
      );
      await harness.emit(
        'issue.comment.created',
        { issueId },
        { companyId: COMPANY_ID, entityId: comment.id, entityType: 'issue_comment' }
      );
    }

    await refine(children[0].id, 3);
    const halfway = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(halfway.projectOnboarding.status).toBe('sprint_planning');
    expect(halfway.projectProgress.unrefinedTasks).toBe(1);
    expect(halfway.canStartProjectSprint).toBe(false);

    await refine(children[1].id, 5);
    const ready = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(ready.projectOnboarding.status).toBe('sprint_planning');
    expect(ready.projectProgress.unrefinedTasks).toBe(0);
    expect(ready.canStartProjectSprint).toBe(true);
  });


  /**
   * Nach dem ersten fertigen Ticket blieb der Fluss stehen.
   *
   * Ein Ticket in TODO *ohne* Assignee — etwa nach einer Blocker-Freigabe —
   * galt der Planung als laufende Arbeit. Sie brach deshalb ab, wies das
   * Ticket nie zu, und ohne Assignee gab es niemanden zu wecken. Beide
   * Developer blieben idle, waehrend zwei Tickets bereitlagen.
   */
  it('adopts an unassigned TODO ticket instead of stalling behind it', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const orphan = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Released from a blocker',
      status: 'backlog',
    });
    await harness.emit(
      'issue.created',
      { issueId: orphan.id },
      { companyId: COMPANY_ID, entityId: orphan.id, entityType: 'issue' }
    );
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const refinement = await harness.ctx.issues.createComment(
      orphan.id,
      `<!-- ${REFINEMENT_MARKER} {"storyPoints":3,"acceptanceCriteria":["Works"]} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await harness.emit(
      'issue.comment.created',
      { issueId: orphan.id },
      { companyId: COMPANY_ID, entityId: refinement.id, entityType: 'issue_comment' }
    );

    // Genau der Zustand aus der Blocker-Freigabe: TODO, aber ohne Assignee.
    await harness.ctx.issues.update(orphan.id, { status: 'todo', assigneeAgentId: null }, COMPANY_ID);
    await harness.emit(
      'issue.updated',
      { issueId: orphan.id },
      { companyId: COMPANY_ID, entityId: orphan.id, entityType: 'issue' }
    );

    const adopted = await harness.ctx.issues.get(orphan.id, COMPANY_ID);
    expect(adopted?.status).toBe('todo');
    expect(adopted?.assigneeAgentId, 'an unassigned TODO must be adopted, not stepped over').not.toBeNull();
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

  it('routes a pending product decision to QA after a human-approved sprint starts', async () => {
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

    const productDecision = await sprintHarness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Choose image slider auto-play behaviour',
      description: `Decision required\n${PRODUCT_DECISION_REQUIRED_MARKER}`,
      status: 'backlog',
    });
    await sprintHarness.emit(
      'issue.created',
      { issueId: productDecision.id },
      { companyId: COMPANY_ID, entityId: productDecision.id, entityType: 'issue' }
    );
    await sprintHarness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    let board = await sprintHarness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const refinement = await sprintHarness.ctx.issues.createComment(
      productDecision.id,
      `<!-- ${REFINEMENT_MARKER} {"storyPoints":2,"acceptanceCriteria":["Auto-play respects the approved setting"],"technicalNotes":"Use the existing slider primitive."} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await sprintHarness.emit(
      'issue.comment.created',
      { issueId: productDecision.id },
      { companyId: COMPANY_ID, entityId: refinement.id, entityType: 'issue_comment' }
    );
    await sprintHarness.performAction('startProjectSprint', {}, { companyId: COMPANY_ID });

    await sprintHarness.ctx.issues.update(
      productDecision.id,
      { status: 'in_review', assigneeAgentId: developer?.id },
      COMPANY_ID
    );
    await sprintHarness.emit(
      'issue.updated',
      { issueId: productDecision.id },
      { companyId: COMPANY_ID, entityId: productDecision.id, entityType: 'issue' }
    );

    expect(await sprintHarness.ctx.issues.get(productDecision.id, COMPANY_ID)).toMatchObject({
      status: 'in_review',
      assigneeAgentId: qa?.id,
    });
    expect(await sprintHarness.ctx.issues.listComments(productDecision.id, COMPANY_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining(PRODUCT_DECISION_RESOLVED_MARKER) }),
      ])
    );
  });

  it('resolves a product decision from the Scrum Board and returns it to QA', async () => {
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

    const resolution = await harness.performAction<{ resolved: boolean; error?: string }>(
      'resolveProductDecision',
      { taskId: productDecision.id },
      { companyId: COMPANY_ID }
    );

    expect(resolution).toMatchObject({ resolved: true });
    expect(await harness.ctx.issues.listComments(productDecision.id, COMPANY_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining(PRODUCT_DECISION_RESOLVED_MARKER) }),
      ])
    );
    expect(await harness.ctx.issues.get(productDecision.id, COMPANY_ID)).toMatchObject({
      status: 'in_review',
      assigneeAgentId: qa?.id,
    });
  });

  it('hands QA-returned project work to a developer for the repair', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Repair the image slider after QA findings',
      status: 'in_review',
      assigneeAgentId: qa?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue' }
    );

    await harness.ctx.issues.update(child.id, { status: 'in_progress' }, COMPANY_ID);
    await harness.emit(
      'issue.updated',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue', actorId: qa?.id }
    );

    expect(await harness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'in_progress',
      assigneeAgentId: developer?.id,
    });
    expect(await harness.ctx.issues.listComments(child.id, COMPANY_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('QA rework routed') }),
      ])
    );
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
    await recordDeveloperCommit(harness, child.id, developer?.id);
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

  it('keeps a final QA-approved completion done when checklist wording differs from refinement criteria', async () => {
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
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Deliver a dark mode theme toggle',
      status: 'done',
      assigneeAgentId: qa?.id,
    });
    await harness.ctx.issues.createComment(
      child.id,
      `<!-- ${REFINEMENT_MARKER} {"storyPoints":3,"acceptanceCriteria":["Toggle is visible in desktop and mobile navigation","Theme changes without a reload","Theme choice persists locally"],"technicalNotes":"Use the existing header primitives."} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await recordDeveloperCommit(harness, child.id, developer?.id);
    await harness.ctx.issues.createComment(
      child.id,
      [
        '## Review Approved',
        '- [x] Current mode icon is visible in both header layouts',
        '- [x] Theme switch is immediate',
        '- [x] Preference survives a browser restart',
        QA_REVIEW_APPROVED_MARKER,
      ].join('\n'),
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );

    await plugin.definition.setup(harness.ctx);

    expect(await harness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'done',
      assigneeAgentId: qa?.id,
    });
    const after = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(after.tasks.find((task) => task.id === child.id)).toMatchObject({
      column: 'done',
      acceptanceCriteria: [
        expect.objectContaining({ met: true, verifiedBy: qa?.id }),
        expect.objectContaining({ met: true, verifiedBy: qa?.id }),
        expect.objectContaining({ met: true, verifiedBy: qa?.id }),
      ],
    });
  });

  it('recovers a final QA-approved review that was previously returned from done', async () => {
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
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Recover a completed dark mode theme toggle',
      status: 'in_review',
      assigneeAgentId: qa?.id,
    });
    await harness.ctx.issues.createComment(
      child.id,
      `<!-- ${REFINEMENT_MARKER} {"storyPoints":3,"acceptanceCriteria":["Toggle is visible in desktop and mobile navigation","Theme changes without a reload","Theme choice persists locally"],"technicalNotes":"Use the existing header primitives."} -->`,
      COMPANY_ID,
      { authorAgentId: technicalLead?.id }
    );
    await recordDeveloperCommit(harness, child.id, developer?.id);
    await harness.ctx.issues.createComment(
      child.id,
      [
        '## Review Approved',
        '- [x] Current mode icon is visible in both header layouts',
        '- [x] Theme switch is immediate',
        '- [x] Preference survives a browser restart',
        QA_REVIEW_APPROVED_MARKER,
      ].join('\n'),
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );
    await plugin.definition.setup(harness.ctx);
    const after = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(await harness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'done',
      assigneeAgentId: qa?.id,
    });
    expect(after.tasks.find((task) => task.id === child.id)).toMatchObject({ column: 'done' });
  });

  it('recovers a final QA-approved ticket that was previously returned to development', async () => {
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
      title: 'Recover a completed dark mode migration',
      status: 'in_progress',
      assigneeAgentId: developer?.id,
    });
    await recordDeveloperCommit(harness, child.id, developer?.id);
    await harness.ctx.issues.createComment(
      child.id,
      `## Review Approved\n${QA_REVIEW_APPROVED_MARKER}`,
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );
    await harness.ctx.issues.createComment(child.id, QA_REWORK_ROUTED_MARKER, COMPANY_ID);
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue', actorId: qa?.id }
    );

    expect(await harness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'done',
      assigneeAgentId: qa?.id,
    });
  });

  it('returns a completion with incomplete acceptance criteria to review without final QA approval', async () => {
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
        title: 'Verify all image slider acceptance criteria',
        description: [
          '## Akzeptanzkriterien',
          '- [ ] Slider supports keyboard navigation',
          '- [ ] Slider images have alternative text',
        ].join('\n'),
        status: 'done',
        assigneeAgentId: qa?.id,
      });
      await recordDeveloperCommit(harness, child.id, developer?.id);
      await harness.ctx.issues.createComment(
        child.id,
        [
          '## QA approved',
          '- [x] Slider supports keyboard navigation',
        ].join('\n'),
        COMPANY_ID,
        { authorAgentId: qa?.id }
      );
      await harness.emit(
        'issue.created',
        { issueId: child.id },
        { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue', actorId: qa?.id }
      );

      expect(await harness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
        status: 'in_review',
        assigneeAgentId: qa?.id,
      });
      expect(await harness.ctx.issues.listComments(child.id, COMPANY_ID)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ body: expect.stringContaining('acceptance criteria verification required') }),
        ])
      );
    });

  it('returns a QA-approved completion without a developer commit to Development', async () => {
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
      title: 'Verify commit evidence',
      status: 'done',
      assigneeAgentId: qa?.id,
    });
    await harness.ctx.issues.createComment(
      child.id,
      `QA approved\n${QA_REVIEW_APPROVED_MARKER}`,
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue', actorId: qa?.id }
    );

    expect(await harness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'in_progress',
      assigneeAgentId: developer?.id,
    });
    expect(await harness.ctx.issues.listComments(child.id, COMPANY_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('GitHub commit evidence required') }),
      ])
    );
  });

  it('completes a delivered project instead of asking for further refinement', async () => {
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
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Delivered image slider',
      status: 'done',
      assigneeAgentId: qa?.id,
    });
    await recordDeveloperCommit(harness, child.id, developer?.id);
    await harness.ctx.issues.createComment(
      child.id,
      `QA approved\n${QA_REVIEW_APPROVED_MARKER}`,
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );
    await harness.emit(
      'issue.created',
      { issueId: child.id },
      { companyId: COMPANY_ID, entityId: child.id, entityType: 'issue', actorId: qa?.id }
    );

    const completed = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    expect(completed.projectOnboarding.status).toBe('completed');
    expect(
      await harness.performAction<{ requested: boolean }>('requestProjectRefinement', {}, { companyId: COMPANY_ID })
    ).toMatchObject({ requested: false });
  });

  it('holds agent-created work outside an active project for human scope approval', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const productOwner = board.agents.find((agent) => agent.role === 'product_owner');
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const unscoped = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      title: 'Invented product feature',
      status: 'todo',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: unscoped.id },
      { companyId: COMPANY_ID, entityId: unscoped.id, entityType: 'issue', actorId: productOwner?.id }
    );

    expect(await harness.ctx.issues.get(unscoped.id, COMPANY_ID)).toMatchObject({
      status: 'blocked',
      assigneeAgentId: null,
    });
    expect(await harness.ctx.issues.listComments(unscoped.id, COMPANY_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('Human scope approval required') }),
      ])
    );
  });

  it('approves a scope-held issue from the Scrum Board into the active project', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const productOwner = board.agents.find((agent) => agent.role === 'product_owner');
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const technicalLead = board.agents.find((agent) => agent.role === 'technical_lead');
    const unscoped = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      title: 'Approved product addition',
      status: 'todo',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: unscoped.id },
      { companyId: COMPANY_ID, entityId: unscoped.id, entityType: 'issue', actorId: productOwner?.id }
    );

    const approval = await harness.performAction<{ approved: boolean; error?: string; taskId?: string }>(
      'approveScopeHold',
      { issueId: unscoped.id },
      { companyId: COMPANY_ID }
    );
    const approvedIssue = await harness.ctx.issues.get(unscoped.id, COMPANY_ID);
    const refreshedBoard = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(approval).toMatchObject({ approved: true });
    expect(approvedIssue).toMatchObject({
      status: 'cancelled',
      assigneeAgentId: null,
    });
    expect(await harness.ctx.issues.listComments(unscoped.id, COMPANY_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('Human scope approved') }),
      ])
    );
    expect(refreshedBoard.projectOnboarding.scopeHolds).not.toContainEqual(
      expect.objectContaining({ issueId: unscoped.id })
    );
    const approvedTask = refreshedBoard.tasks.find((task) => task.id === approval.taskId);
    expect(approvedTask).toMatchObject({
      parentId: kickoff.rootIssueId,
      column: 'todo',
      assignedAgentId: technicalLead?.id,
    });
    expect(approvedTask?.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('Human scope approved') }),
      ])
    );
  });

  it('does not approve held scope after the project request is complete', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const productOwner = board.agents.find((agent) => agent.role === 'product_owner');
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const heldIssue = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      title: 'Deferred product addition',
      status: 'todo',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: heldIssue.id },
      { companyId: COMPANY_ID, entityId: heldIssue.id, entityType: 'issue', actorId: productOwner?.id }
    );

    const completedChild = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Completed delivery',
      status: 'done',
      assigneeAgentId: qa?.id,
    });
    await recordDeveloperCommit(harness, completedChild.id, developer?.id);
    await harness.ctx.issues.createComment(
      completedChild.id,
      `QA approved\n${QA_REVIEW_APPROVED_MARKER}`,
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );
    await harness.emit(
      'issue.created',
      { issueId: completedChild.id },
      { companyId: COMPANY_ID, entityId: completedChild.id, entityType: 'issue', actorId: qa?.id }
    );

    const approval = await harness.performAction<{ approved: boolean; error?: string }>(
      'approveScopeHold',
      { issueId: heldIssue.id },
      { companyId: COMPANY_ID }
    );

    expect(approval).toEqual({
      approved: false,
      error: 'Project delivery is complete. Start a new project request before approving additional scope.',
    });
    expect(await harness.ctx.issues.get(heldIssue.id, COMPANY_ID)).toMatchObject({ status: 'blocked' });
  });

  it('dismisses held scope after project completion without starting a follow-up', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const productOwner = board.agents.find((agent) => agent.role === 'product_owner');
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const heldIssue = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      title: 'Resolve stale execution run',
      status: 'todo',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: heldIssue.id },
      { companyId: COMPANY_ID, entityId: heldIssue.id, entityType: 'issue', actorId: productOwner?.id }
    );

    const completedChild = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Completed delivery',
      status: 'done',
      assigneeAgentId: qa?.id,
    });
    await recordDeveloperCommit(harness, completedChild.id, developer?.id);
    await harness.ctx.issues.createComment(
      completedChild.id,
      `QA approved\n${QA_REVIEW_APPROVED_MARKER}`,
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );
    await harness.emit(
      'issue.created',
      { issueId: completedChild.id },
      { companyId: COMPANY_ID, entityId: completedChild.id, entityType: 'issue', actorId: qa?.id }
    );

    const dismissed = await harness.performAction<{ dismissed: boolean; error?: string }>(
      'dismissScopeHold',
      { issueId: heldIssue.id },
      { companyId: COMPANY_ID }
    );
    const refreshedBoard = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(dismissed).toMatchObject({ dismissed: true });
    expect(await harness.ctx.issues.get(heldIssue.id, COMPANY_ID)).toMatchObject({
      status: 'cancelled',
      assigneeAgentId: null,
    });
    expect(await harness.ctx.issues.listComments(heldIssue.id, COMPANY_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('Human scope dismissed') }),
      ])
    );
    expect(refreshedBoard.projectOnboarding).toMatchObject({
      status: 'completed',
      rootIssueId: kickoff.rootIssueId,
      scopeHolds: [],
    });
  });

  it('starts a follow-up project request from held scope after project completion', async () => {
    const kickoff = await harness.performAction<{ rootIssueId: string }>(
      'startProjectOnboarding',
      { projectId: PROJECT_ID, brief: 'Build a responsive image slider.' },
      { companyId: COMPANY_ID }
    );
    await completeTechnicalAnalysis(harness, kickoff.rootIssueId);
    await harness.performAction('startBacklogDiscovery', {}, { companyId: COMPANY_ID });
    await harness.performAction('activateProjectOnboarding', {}, { companyId: COMPANY_ID });

    const board = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const productOwner = board.agents.find((agent) => agent.role === 'product_owner');
    const qa = board.agents.find((agent) => agent.role === 'qa_engineer');
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const heldIssue = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      title: 'Deferred product addition',
      description: 'Add a customer-requested analytics dashboard.',
      status: 'todo',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: heldIssue.id },
      { companyId: COMPANY_ID, entityId: heldIssue.id, entityType: 'issue', actorId: productOwner?.id }
    );
    const remainingHeldIssue = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      title: 'Another deferred product addition',
      status: 'todo',
      assigneeAgentId: developer?.id,
    });
    await harness.emit(
      'issue.created',
      { issueId: remainingHeldIssue.id },
      { companyId: COMPANY_ID, entityId: remainingHeldIssue.id, entityType: 'issue', actorId: productOwner?.id }
    );

    const completedChild = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Completed delivery',
      status: 'done',
      assigneeAgentId: qa?.id,
    });
    await recordDeveloperCommit(harness, completedChild.id, developer?.id);
    await harness.ctx.issues.createComment(
      completedChild.id,
      `QA approved\n${QA_REVIEW_APPROVED_MARKER}`,
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );
    await harness.emit(
      'issue.created',
      { issueId: completedChild.id },
      { companyId: COMPANY_ID, entityId: completedChild.id, entityType: 'issue', actorId: qa?.id }
    );

    const followUp = await harness.performAction<{
      started: boolean;
      rootIssueId?: string;
      followUpIssueId?: string;
      wakeup?: { queued: boolean };
    }>('startScopeHoldFollowUp', { issueId: heldIssue.id }, { companyId: COMPANY_ID });
    const nextBoard = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });
    const followUpKickoff = await harness.ctx.issues.get(followUp.rootIssueId!, COMPANY_ID);
    const followUpIssue = await harness.ctx.issues.get(followUp.followUpIssueId!, COMPANY_ID);

    expect(followUp).toMatchObject({ started: true, wakeup: { queued: true } });
    expect(followUpKickoff).toMatchObject({
      projectId: PROJECT_ID,
      title: 'Kickoff: BMW Website follow-up',
      status: 'todo',
    });
    expect(followUpIssue).toMatchObject({
      parentId: followUp.rootIssueId,
      title: 'Deferred product addition',
      status: 'backlog',
    });
    expect(await harness.ctx.issues.get(heldIssue.id, COMPANY_ID)).toMatchObject({ status: 'cancelled' });
    expect(nextBoard.projectOnboarding).toMatchObject({
      status: 'analysis_in_progress',
      rootIssueId: followUp.rootIssueId,
      projectId: PROJECT_ID,
    });
    expect(nextBoard.projectOnboarding.scopeHolds).toEqual([
      expect.objectContaining({ issueId: remainingHeldIssue.id }),
    ]);
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
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'QA-approved image slider',
      status: 'done',
      assigneeAgentId: qa?.id,
    });
    await recordDeveloperCommit(harness, child.id, developer?.id);
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
    expect(after.projectOnboarding.status).toBe('completed');
  });

  it('returns a hydrated completion with incomplete acceptance criteria to review without final QA approval', async () => {
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
    const developer = board.agents.find((agent) => agent.role === 'developer');
    const child = await harness.ctx.issues.create({
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      parentId: kickoff.rootIssueId,
      title: 'Hydrated incomplete QA verification',
      description: [
        '## Akzeptanzkriterien',
        '- [ ] Slider supports keyboard navigation',
        '- [ ] Slider images have alternative text',
      ].join('\n'),
      status: 'done',
      assigneeAgentId: qa?.id,
    });
    await recordDeveloperCommit(harness, child.id, developer?.id);
    await harness.ctx.issues.createComment(
      child.id,
      [
        '## QA approved',
        '- [x] Slider supports keyboard navigation',
      ].join('\n'),
      COMPANY_ID,
      { authorAgentId: qa?.id }
    );

    await plugin.definition.setup(harness.ctx);
    const after = await harness.getData<BoardData>('board', { companyId: COMPANY_ID });

    expect(await harness.ctx.issues.get(child.id, COMPANY_ID)).toMatchObject({
      status: 'in_review',
      assigneeAgentId: qa?.id,
    });
    expect(after.tasks.find((task) => task.id === child.id)).toMatchObject({ column: 'in_review' });
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
    const developer = board.agents.find((agent) => agent.role === 'developer');
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
    await recordDeveloperCommit(harness, child.id, developer?.id);
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
    await recordDeveloperCommit(harness, completedBlocker.id, developer?.id);
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

    await recordDeveloperCommit(harness, openBlocker.id, developer?.id);
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