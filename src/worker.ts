/**
 * Plugin worker entrypoint.
 *
 * Everything the Scrum process needs lives in `src/core/` as plain functions
 * over a `WorkerState` value. This file is the thin shell that connects that
 * logic to the host: it loads state, exposes board data and actions to the UI,
 * and re-evaluates the ceremony triggers whenever the board changes.
 *
 * Ceremonies are never scheduled. They fire from board state — see
 * `src/core/triggers/ceremony-triggers.ts`.
 */

import { definePlugin, runWorker, type Issue, type PluginContext } from "@paperclipai/plugin-sdk";

import type { CeremonyType, ScrumTask, TaskStatus, WorkerState } from "./core/types";
import { createDefaultSettings } from "./core/types";
import { createCeremonyRecord, createId, createScrumTask } from "./core/factories";
import {
  canStartNewProjectOnboarding,
  canRunAutomaticDelivery,
  createBacklogDiscoveryPrompt,
  createInitialProjectOnboarding,
  createProjectSprint,
  createTechnicalAnalysisPrompt,
  isTechnicalAnalysisComplete,
  parseProjectOnboardingInput,
  startProjectOnboarding,
  transitionProjectOnboarding,
} from "./core/project-onboarding";
import { syncProjectOnboardingIssue } from "./core/project-issue-sync";
import { projectProgress } from "./core/project-issue-projection";
import { hasQaReviewApproval, reviewOwnerForProjectIssue } from "./core/review-routing";
import { migrateState } from "./core/storage";
import { recalculateMetrics, createInitialMetrics, onStatusChange } from "./core/hooks";
import { collectDecisions } from "./core/communication";
import { CeremonyTriggerEngine } from "./core/triggers";
import {
  runSprintPlanning,
  runBacklogRefinement,
  runImpedimentResolution,
  runSprintReview,
  runRetrospective,
  reviewTicket,
  type AgentWorkRequest,
  type CeremonyContext,
} from "./core/ceremonies";
import { byBusinessValue, isReady } from "./core/ceremonies/types";
import { collectInstructionUpdates, type InstructionUpdate } from "./core/learning";
import {
  TEAM,
  describeReportingLine,
  detectReportingDrift,
  expectedSuperiorId,
  type ReportingDrift,
} from "./team";

/**
 * Where a company's board lives in plugin state.
 *
 * Scoped per company, not per instance: two organisations using this plugin
 * each get their own board. An instance-wide key would have them share one,
 * and switching organisation would overwrite the other's tickets.
 */
function boardScope(companyId: string) {
  return { scopeKind: "company", scopeId: companyId, stateKey: "board" } as const;
}

/**
 * Creates an empty board.
 */
function createEmptyState(): WorkerState {
  return {
    initialized: true,
    projectOnboarding: createInitialProjectOnboarding(),
    currentSprint: null,
    tasks: [],
    agents: [],
    settings: createDefaultSettings(),
    metrics: createInitialMetrics(),
    messages: [],
    ceremonies: [],
    completedSprints: [],
    learnings: [],
    skills: [],
    proposedStories: [],
    agentInstructions: {},
  };
}

const plugin = definePlugin({
  async setup(ctx) {
    // -------------------------------------------------------------------------
    // Board state
    // -------------------------------------------------------------------------

    let state = createEmptyState();

    /**
     * Company the board belongs to.
     *
     * Deliberately not resolved at startup. The host only grants company scope
     * inside an invocation it initiated (event, action, getData); a call made
     * from `setup()` carries no invocation id and is rejected with
     * "company context is required". So the company arrives with the first
     * request instead — which is also the *correct* company, rather than
     * whichever one happened to be listed first.
     */
    let companyId: string | null = null;

    /** True once the team has been reconciled for `companyId`. */
    let teamReady = false;

    /**
     * In-flight initialisation, shared by concurrent callers.
     *
     * The host issues several `getData` requests at once when a page mounts.
     * Without this, each one started its own reconcile: the parallel runs
     * collided on the host's managed-resource inserts, and each overwrote
     * `state.agents` with its own partial result — which is why the team showed
     * up as two or four agents instead of six.
     */
    let readyPromise: Promise<void> | null = null;

    /**
     * Loads this company's board from plugin state.
     *
     * Persisted data may come from an older plugin version and is migrated —
     * otherwise a missing array would throw on the first ceremony.
     */
    async function load(): Promise<void> {
      if (!companyId) return;

      const stored = await ctx.state.get(boardScope(companyId));
      if (stored && typeof stored === "object") {
        state = { ...state, ...migrateState(stored as Partial<WorkerState>) };
        state.metrics = recalculateMetrics(state);
      }
    }

    /**
     * Binds the board to a company and prepares the team.
     *
     * Called from every host-initiated entry point, because that is the only
     * context in which company-scoped calls are permitted. Cheap after the
     * first run.
     */
    async function ensureReady(scope: string | null | undefined): Promise<void> {
      // Switching organisation means a different board and a different team.
      if (scope && scope !== companyId) {
        companyId = scope;
        teamReady = false;
        readyPromise = null;
        state = createEmptyState();
      }
      if (teamReady || !companyId) return;

      // Concurrent callers wait on the same run instead of starting their own.
      readyPromise ??= initialise().finally(() => {
        readyPromise = null;
      });

      await readyPromise;
    }

    /**
     * Loads this company's board and, if activated, creates the team.
     */
    async function initialise(): Promise<void> {
      await load();
      await applyConfiguredSettings();

      // Creating six agents is a visible, budget-relevant change to someone
      // else's organisation. It only happens on an explicit opt-in — installing
      // the plugin is not consent to populate the company.
      if (!(await teamEnabled())) {
        ctx.logger.info("Scrum team not activated for this organisation", {
          companyId,
          hint: "Enable 'Activate the Scrum team' in the plugin settings.",
        });
        return;
      }

      await reconcileTeam();
      await syncOnboardingProjectIssues();
      await requestProjectRefinement("automatic");
      await requestProjectPlanning();
      teamReady = true;
      await save();
    }

    /**
     * Reads the organisation's opt-in.
     *
     * Defaults to *off*: if the setting cannot be read, the plugin does not
     * create anything. Failing closed is the only safe direction here.
     */
    async function teamEnabled(): Promise<boolean> {
      if (!companyId) return false;

      const config = await readConfig();
      return config.enableTeam === true;
    }

    /** Captures the organisation setting when a new project request begins. */
    async function projectSprintRequired(): Promise<boolean> {
      const config = await readConfig();
      return config.requireProjectSprint !== false;
    }

    /** Mirrors declared organisation settings into the persisted board controls. */
    async function applyConfiguredSettings(): Promise<void> {
      const config = await readConfig();
      const configuredNumber = (key: string, fallback: number, minimum: number, maximum: number) => {
        const value = Number(config[key]);
        return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
      };
      const configuredBoolean = (key: string, fallback: boolean) =>
        typeof config[key] === "boolean" ? config[key] : fallback;

      state.settings = {
        ...state.settings,
        teamSize: {
          ...state.settings.teamSize,
          developerCount: configuredNumber("developerCount", state.settings.teamSize.developerCount, 1, 5),
        },
        wipLimits: {
          ...state.settings.wipLimits,
          development: configuredNumber("wipLimitDevelopment", state.settings.wipLimits.development, 1, 50),
          review: configuredNumber("wipLimitReview", state.settings.wipLimits.review, 1, 50),
        },
        events: {
          ...state.settings.events,
          enableAutoPlanning: configuredBoolean("enableAutoPlanning", state.settings.events.enableAutoPlanning),
          enableAutoRefinement: configuredBoolean("enableAutoRefinement", state.settings.events.enableAutoRefinement),
          enableAutoImpediments: configuredBoolean("enableAutoImpediments", state.settings.events.enableAutoImpediments),
          enableAutoReview: configuredBoolean("enableAutoReview", state.settings.events.enableAutoReview),
        },
      };
    }

    async function save(): Promise<void> {
      if (!companyId) return;
      await ctx.state.set(boardScope(companyId), state);
    }

    /** Der Worker unterstutzt zunachst einen aktiven Projektauftrag je Organisation. */
    function canStartProjectOnboarding(): boolean {
      return canStartNewProjectOnboarding(state.projectOnboarding, {
        taskCount: state.tasks.length,
        hasCurrentSprint: state.currentSprint !== null,
      });
    }

    function canStartProjectSprint(): boolean {
      const onboarding = state.projectOnboarding;
      return Boolean(
        onboarding?.status === "sprint_planning" &&
          onboarding.rootIssueId &&
          state.tasks.some(
            (task) => task.parentId === onboarding.rootIssueId && task.column === "backlog" && isReady(task)
          )
      );
    }

    async function requestIssueWakeup(issueId: string, reason: string) {
      if (!companyId) return { queued: false, error: "No company context." };

      try {
        const wakeup = await ctx.issues.requestWakeup(issueId, companyId, {
          reason,
          contextSource: "agent-scrum.project-onboarding",
          idempotencyKey: `agent-scrum:${issueId}:${reason}`,
        });
        return { queued: wakeup.queued, runId: wakeup.runId, error: null };
      } catch (error) {
        ctx.logger.warn("Could not queue project onboarding work", {
          issueId,
          reason,
          error: String(error),
        });
        return { queued: false, error: String(error) };
      }
    }

    /**
     * Observes the root issue for a completed Technical-Lead analysis.
     *
     * The marker belongs to the agent prompt rather than a guessed timestamp:
     * a comment in progress must not let the PO create stories prematurely.
     */
    async function refreshTechnicalAnalysisStatus(): Promise<boolean> {
      const onboarding = state.projectOnboarding;
      if (
        !companyId ||
        !onboarding?.rootIssueId ||
        onboarding.status !== "analysis_in_progress"
      ) {
        return false;
      }

      const technicalLead = state.agents.find((agent) => agent.role === "technical_lead");
      if (!technicalLead) return false;

      try {
        const comments = await ctx.issues.listComments(onboarding.rootIssueId, companyId);
        if (!isTechnicalAnalysisComplete(comments, technicalLead.id)) return false;

        state.projectOnboarding = transitionProjectOnboarding(onboarding, "analysis_ready");
        await save();
        ctx.logger.info("Technical analysis completed", {
          rootIssueId: onboarding.rootIssueId,
          technicalLeadId: technicalLead.id,
        });
        return true;
      } catch (error) {
        ctx.logger.warn("Could not inspect technical analysis status", {
          rootIssueId: onboarding.rootIssueId,
          error: String(error),
        });
        return false;
      }
    }

    /** True, wenn das Board aktuell Paperclip-Child-Issues eines Kickoffs zeigt. */
    function hasProjectBackedTasks(): boolean {
      const rootIssueId = state.projectOnboarding?.rootIssueId;
      return Boolean(rootIssueId && state.tasks.some((task) => task.parentId === rootIssueId));
    }

    function isProjectBackedTask(task: ScrumTask): boolean {
      return Boolean(state.projectOnboarding?.rootIssueId && task.parentId === state.projectOnboarding.rootIssueId);
    }

    /** Mirrors active project work onto the compact team status shown by the board. */
    function syncProjectAgentActivity(): boolean {
      const rootIssueId = state.projectOnboarding?.rootIssueId;
      if (!rootIssueId) return false;

      const projectTasks = state.tasks.filter((task) => task.parentId === rootIssueId);
      const projectTaskIds = new Set(projectTasks.map((task) => task.id));
      let changed = false;
      const agents = state.agents.map((agent) => {
        const activeTask = projectTasks.find(
          (task) => task.assignedAgentId === agent.id && task.column === "in_progress"
        ) ?? projectTasks.find(
          (task) => task.assignedAgentId === agent.id && task.column === "in_review"
        );
        const blockedTask = projectTasks.find(
          (task) => task.assignedAgentId === agent.id && task.column === "blocked"
        );
        const next = activeTask
          ? { ...agent, status: "working" as const, currentTaskId: activeTask.id }
          : blockedTask
            ? { ...agent, status: "blocked" as const, currentTaskId: blockedTask.id }
            : agent.currentTaskId && projectTaskIds.has(agent.currentTaskId)
              ? { ...agent, status: "idle" as const, currentTaskId: null }
              : agent;

        if (next !== agent) changed = true;
        return next;
      });

      if (changed) state.agents = agents;
      return changed;
    }

    function isProjectOnboardingChildIssue(issue: Pick<Issue, "id" | "parentId" | "projectId">): boolean {
      const onboarding = state.projectOnboarding;
      return Boolean(
        onboarding?.rootIssueId &&
          onboarding.projectId &&
          issue.id !== onboarding.rootIssueId &&
          issue.parentId === onboarding.rootIssueId &&
          issue.projectId === onboarding.projectId
      );
    }

    /**
     * Gibt ein technisches Review an QA oder eine ausdrücklich markierte
     * Produktentscheidung an den Product Owner weiter.
     */
    async function routeProjectReview(issue: Issue): Promise<Issue> {
      if (!companyId || !isProjectOnboardingChildIssue(issue) || issue.status !== "in_review") {
        return issue;
      }

      const qa = state.agents.find((agent) => agent.role === "qa_engineer");
      const productOwner = state.agents.find((agent) => agent.role === "product_owner");
      if (!qa || !productOwner) return issue;

      try {
        const comments = await ctx.issues.listComments(issue.id, companyId);
        const route = reviewOwnerForProjectIssue(issue, comments);
        if (!route) return issue;

        const reviewer = route.role === "qa_engineer" ? qa : productOwner;
        if (issue.assigneeAgentId === reviewer.id) return issue;

        const reassigned = await ctx.issues.update(
          issue.id,
          { assigneeAgentId: reviewer.id },
          companyId
        );
        const wakeup = await requestIssueWakeup(
          reassigned.id,
          route.reason === "technical_review" ? "project_review_qa" : "project_review_product_decision"
        );
        ctx.logger.info("Project review routed", {
          issueId: reassigned.id,
          reviewer: reviewer.name,
          reason: route.reason,
          queued: wakeup.queued,
        });
        return reassigned;
      } catch (error) {
        ctx.logger.warn("Could not route project review", {
          issueId: issue.id,
          error: String(error),
        });
        return issue;
      }
    }

    /**
     * Host agents can technically set an issue straight to done. Project work
     * is stricter: a completion must pass through the assigned QA reviewer.
     */
    async function routeProjectCompletionToQa(
      issue: Issue,
      actorId: string | null | undefined
    ): Promise<Issue> {
      if (!companyId || !isProjectOnboardingChildIssue(issue) || issue.status !== "done") {
        return issue;
      }

      const qa = state.agents.find((agent) => agent.role === "qa_engineer");
      if (!qa) return issue;

      try {
        const comments = await ctx.issues.listComments(issue.id, companyId);
        if (
          actorId === qa.id ||
          issue.assigneeAgentId === qa.id ||
          hasQaReviewApproval(comments, qa.id)
        ) {
          return issue;
        }

        const review = await ctx.issues.update(
          issue.id,
          { status: "in_review", assigneeAgentId: qa.id },
          companyId
        );
        try {
          await ctx.issues.createComment(
            review.id,
            "## QA review required\n\nAgent Scrum returned this direct completion to QA. Verify all acceptance criteria and tests before approving Done.",
            companyId
          );
        } catch (error) {
          ctx.logger.warn("Could not record the QA review gate", {
            issueId: review.id,
            error: String(error),
          });
        }
        const wakeup = await requestIssueWakeup(review.id, "project_completion_qa");
        ctx.logger.info("Project completion returned to QA", {
          issueId: review.id,
          qaId: qa.id,
          actorId: actorId ?? null,
          queued: wakeup.queued,
        });
        return review;
      } catch (error) {
        ctx.logger.warn("Could not route direct project completion to QA", {
          issueId: issue.id,
          error: String(error),
        });
        return issue;
      }
    }

    /** Re-evaluates open reviews after a comment or when the board is refreshed. */
    async function routeOpenProjectReviews(): Promise<void> {
      const onboarding = state.projectOnboarding;
      if (!companyId || !onboarding?.projectId || !onboarding.rootIssueId) return;

      let offset = 0;
      const limit = 100;
      try {
        while (true) {
          const issues = await ctx.issues.list({
            companyId,
            projectId: onboarding.projectId,
            status: "in_review",
            limit,
            offset,
          });
          for (const issue of issues) {
            await routeProjectReview(issue);
          }
          if (issues.length < limit) return;
          offset += issues.length;
        }
      } catch (error) {
        ctx.logger.warn("Could not inspect project reviews", { error: String(error) });
      }
    }

    let blockerResolutionPromise: Promise<void> | null = null;

    async function releaseResolvedProjectBlockers(): Promise<void> {
      if (blockerResolutionPromise) return;

      blockerResolutionPromise = resolveProjectBlockers().finally(() => {
        blockerResolutionPromise = null;
      });
      await blockerResolutionPromise;
    }

    /** Returns blocked child issues to TODO only after every native blocker is done. */
    async function resolveProjectBlockers(): Promise<void> {
      const onboarding = state.projectOnboarding;
      if (
        !companyId ||
        !onboarding?.projectId ||
        !onboarding.rootIssueId ||
        onboarding.status !== "active"
      ) {
        return;
      }

      try {
        const issues = await ctx.issues.list({
          companyId,
          projectId: onboarding.projectId,
          status: "blocked",
          limit: 100,
          offset: 0,
        });
        const releasedTaskIds: string[] = [];

        for (const issue of issues) {
          if (!isProjectOnboardingChildIssue(issue)) continue;

          const relations = await ctx.issues.relations.get(issue.id, companyId);
          if (
            relations.blockedBy.length === 0 ||
            relations.blockedBy.some((blocker) => blocker.status !== "done")
          ) {
            continue;
          }

          const todo = await ctx.issues.update(issue.id, { status: "todo" }, companyId);
          try {
            await ctx.issues.createComment(
              todo.id,
              "## Blocker resolved\n\nAll linked blocker issues are done. Agent Scrum returned this ticket to TODO.",
              companyId
            );
          } catch (error) {
            ctx.logger.warn("Could not record resolved project blockers", {
              issueId: todo.id,
              error: String(error),
            });
          }
          const result = syncProjectOnboardingIssue(
            state.tasks,
            state.projectOnboarding,
            await withHostComments(todo),
            null,
            state.agents
          );
          if (result.changed) releasedTaskIds.push(todo.id);
          await requestIssueWakeup(todo.id, "project_blocker_resolved");
        }

        const agentActivityChanged = syncProjectAgentActivity();
        if (releasedTaskIds.length === 0 && !agentActivityChanged) return;

        if (releasedTaskIds.length > 0) {
          state.metrics = recalculateMetrics(state);
          state.ceremonies.push(
            createCeremonyRecord(
              "impediment_resolution",
              state.currentSprint?.id ?? null,
              `Paperclip resolved blockers for ${releasedTaskIds.length} ticket(s).`,
              { taskIds: releasedTaskIds }
            )
          );
        }
        await save();
        if (releasedTaskIds.length > 0) {
          ctx.logger.info("Project blockers resolved", { taskIds: releasedTaskIds });
        }
      } catch (error) {
        ctx.logger.warn("Could not resolve project blockers", { error: String(error) });
      }
    }

    function refinementCandidates(): ScrumTask[] {
      const rootIssueId = state.projectOnboarding?.rootIssueId;
      if (!rootIssueId) return [];

      return state.tasks.filter(
        (task) =>
          task.parentId === rootIssueId &&
          !task.refined
      );
    }

    function reconcileProjectRefinementRequests(): boolean {
      const onboarding = state.projectOnboarding;
      if (!onboarding) return false;

      const candidates = new Set(refinementCandidates().map((task) => task.id));
      const requested = onboarding.refinementRequestedTaskIds ?? [];
      const next = requested.filter((taskId) => candidates.has(taskId));
      if (next.length === requested.length) return false;

      state.projectOnboarding = {
        ...onboarding,
        refinementRequestedTaskIds: next,
        updatedAt: new Date().toISOString(),
      };
      return true;
    }

    async function requestProjectRefinement(
      source: "automatic" | "manual" = "manual",
      force = false
    ) {
      if (!companyId) return { requested: false, error: "No company context.", taskIds: [] as string[] };

      const requestStateChanged = reconcileProjectRefinementRequests();
      const onboarding = state.projectOnboarding;
      if (onboarding?.status !== "active" && onboarding?.status !== "sprint_planning") {
        if (requestStateChanged) await save();
        return {
          requested: false,
          error: "Approve the project backlog before requesting technical refinement.",
          taskIds: [] as string[],
        };
      }

      const technicalLead = state.agents.find((agent) => agent.role === "technical_lead");
      const rootIssueId = onboarding.rootIssueId;
      if (!technicalLead || !rootIssueId) {
        if (requestStateChanged) await save();
        return {
          requested: false,
          error: "The Technical Lead or project kickoff is not available.",
          taskIds: [] as string[],
        };
      }

      const requestedTaskIds = new Set(onboarding.refinementRequestedTaskIds ?? []);
      const taskIds = refinementCandidates()
        .filter((task) => force || !requestedTaskIds.has(task.id))
        .map((task) => task.id);
      if (taskIds.length === 0) {
        if (requestStateChanged) await save();
        return { requested: false, error: "No project tickets need technical refinement.", taskIds };
      }

      try {
        await ctx.agents.invoke(technicalLead.id, companyId, {
          reason: "Agent Scrum: project refinement",
          prompt: [
            "Refine the following Paperclip project issues:",
            taskIds.map((taskId) => `- ${taskId}`).join("\n"),
            "Some issues may already be in delivery, review, blocked, or done. Read each issue and the project workspace; do not change issue status or assignee.",
            "For every issue, add a Technical Refinement comment that ends with exactly:",
            '<!-- agent-scrum:refinement:v1 {"storyPoints":5,"acceptanceCriteria":["..."],"technicalNotes":"...","risks":[]} -->',
            "Use a realistic Fibonacci story-point estimate and concrete acceptance criteria.",
          ].join("\n\n"),
        });
        state.projectOnboarding = {
          ...onboarding,
          refinementRequestedTaskIds: [...new Set([...requestedTaskIds, ...taskIds])],
          updatedAt: new Date().toISOString(),
        };
        state.ceremonies.push(
          createCeremonyRecord(
            "backlog_refinement",
            state.currentSprint?.id ?? null,
            `Paperclip refinement requested for ${taskIds.length} ticket(s).`,
            { taskIds }
          )
        );
        await save();
        ctx.logger.info("Project refinement requested", { taskIds, technicalLeadId: technicalLead.id, source });
        return { requested: true, error: null, taskIds };
      } catch (error) {
        ctx.logger.warn("Could not request project refinement", {
          taskIds,
          error: String(error),
        });
        return { requested: false, error: String(error), taskIds };
      }
    }

    let projectPlanningPromise: Promise<void> | null = null;

    async function requestProjectPlanning(): Promise<void> {
      if (projectPlanningPromise) return;

      projectPlanningPromise = planProjectBacklog().finally(() => {
        projectPlanningPromise = null;
      });
      return projectPlanningPromise;
    }

    /** Plans ready child issues through Paperclip instead of mutating local board state. */
    async function planProjectBacklog(): Promise<void> {
      const onboarding = state.projectOnboarding;
      if (
        !companyId ||
        !onboarding?.rootIssueId ||
        onboarding.status !== "active" ||
        state.settings.events.enableAutoPlanning === false
      ) {
        return;
      }

      const rootIssueId = onboarding.rootIssueId;
      const hasTodo = state.tasks.some(
        (task) => task.parentId === rootIssueId && task.column === "todo"
      );
      if (hasTodo) return;

      const currentTodo = state.tasks.filter((task) => task.column === "todo").length;
      const todoSlots = Math.max(0, state.settings.wipLimits.todo - currentTodo);
      if (todoSlots === 0) return;

      const availableDevelopers = state.agents.filter(
        (agent) =>
          agent.role === "developer" &&
          !state.tasks.some(
            (task) =>
              task.assignedAgentId === agent.id &&
              (task.column === "todo" || task.column === "in_progress" || task.column === "in_review")
          )
      );
      const readyBacklog = state.tasks
        .filter(
          (task) => task.parentId === rootIssueId && task.column === "backlog" && isReady(task)
        )
        .sort(byBusinessValue);
      const planned = readyBacklog.slice(0, Math.min(todoSlots, availableDevelopers.length));
      if (planned.length === 0) return;

      const productOwner = state.agents.find((agent) => agent.role === "product_owner");
      const plannedTaskIds: string[] = [];

      for (const [index, task] of planned.entries()) {
        const developer = availableDevelopers[index];
        try {
          const updated = await ctx.issues.update(
            task.id,
            { status: "todo", assigneeAgentId: developer.id },
            companyId
          );
          syncProjectOnboardingIssue(
            state.tasks,
            state.projectOnboarding,
            await withHostComments(updated),
            productOwner?.id ?? null,
            state.agents
          );
          const plannedTask = state.tasks.find((entry) => entry.id === task.id);
          if (state.currentSprint && plannedTask) {
            plannedTask.sprintId = state.currentSprint.id;
            if (!state.currentSprint.taskIds.includes(plannedTask.id)) {
              state.currentSprint.taskIds.push(plannedTask.id);
            }
            state.currentSprint.updatedAt = new Date().toISOString();
          }
          plannedTaskIds.push(task.id);
          await requestIssueWakeup(task.id, "project_sprint_planning");
        } catch (error) {
          ctx.logger.warn("Could not plan project issue in Paperclip", {
            issueId: task.id,
            developerId: developer.id,
            error: String(error),
          });
        }
      }

      if (plannedTaskIds.length === 0) return;

      state.metrics = recalculateMetrics(state);
      state.ceremonies.push(
        createCeremonyRecord(
          "sprint_planning",
          state.currentSprint?.id ?? null,
          `Paperclip sprint planning moved ${plannedTaskIds.length} ready ticket(s) to TODO.`,
          { taskIds: plannedTaskIds }
        )
      );
      await save();
      ctx.logger.info("Project sprint planned", { taskIds: plannedTaskIds });
    }

    /** Loads host comments so ticket details stay a projection of Paperclip. */
    async function withHostComments(issue: Issue) {
      if (!companyId) return { ...issue, comments: [] };

      try {
        return { ...issue, comments: await ctx.issues.listComments(issue.id, companyId) };
      } catch (error) {
        ctx.logger.warn("Could not load project issue comments", {
          issueId: issue.id,
          error: String(error),
        });
        return { ...issue, comments: [] };
      }
    }

    function issueIdFromEvent(event: {
      entityId?: string;
      entityType?: string;
      payload?: unknown;
    }): string | null {
      if (event.entityType === "issue" && event.entityId) return event.entityId;
      const payload = event.payload as { issueId?: unknown } | null;
      return typeof payload?.issueId === "string" ? payload.issueId : null;
    }

    /**
     * Heilt verpasste Events nach einem Worker-Neustart.
     *
     * Das Host-Issue bleibt die Quelle der Wahrheit. Daher aktualisiert diese
     * Funktion nur das lokale Materialisat und startet keine Zeremonie.
     */
    async function syncOnboardingProjectIssues(): Promise<boolean> {
      const onboarding = state.projectOnboarding;
      if (
        !companyId ||
        !onboarding?.projectId ||
        !onboarding.rootIssueId ||
        (
          onboarding.status !== "backlog_in_progress" &&
          onboarding.status !== "sprint_planning" &&
          onboarding.status !== "active"
        )
      ) {
        return false;
      }

      let changed = false;
      let offset = 0;
      const limit = 100;

      try {
        while (true) {
          const issues = await ctx.issues.list({
            companyId,
            projectId: onboarding.projectId,
            limit,
            offset,
          });
          for (const issue of issues) {
            const completionGatedIssue = await routeProjectCompletionToQa(issue, null);
            const routedIssue = await routeProjectReview(completionGatedIssue);
            const result = syncProjectOnboardingIssue(
              state.tasks,
              onboarding,
              await withHostComments(routedIssue),
              null,
              state.agents
            );
            changed ||= result.changed;
          }

          if (issues.length < limit) break;
          offset += issues.length;
        }
      } catch (error) {
        ctx.logger.warn("Could not hydrate project issues", { error: String(error) });
        return false;
      }

      const refinementRequestsChanged = reconcileProjectRefinementRequests();
      const agentActivityChanged = syncProjectAgentActivity();
      if (changed || refinementRequestsChanged || agentActivityChanged) {
        if (changed) state.metrics = recalculateMetrics(state);
        await save();
      }
      await releaseResolvedProjectBlockers();
      return changed;
    }

    /**
     * Finds the company lead the Scrum roles report to.
     *
     * The lead is an ordinary agent with role `ceo`. Without it the roles would
     * sit beside the CEO in the org chart rather than underneath, because an
     * empty `reportsTo` means "top level", not "reports to the lead".
     */
    async function findCompanyLead(): Promise<string | null> {
      if (!companyId) return null;

      try {
        const agents = await ctx.agents.list({ companyId });
        return agents.find((a) => a.role === "ceo")?.id ?? null;
      } catch (error) {
        ctx.logger.warn("Could not look up the company lead", { error: String(error) });
        return null;
      }
    }

    /**
     * Creates the Scrum team from the manifest declarations and adopts it.
     *
     * Declaring managed agents is not enough — the host only materialises them
     * when the plugin reconciles each key. Reconciling is idempotent, so this
     * runs whenever the company changes and repairs drift without creating
     * duplicates.
     *
     * The board is built from the resolutions rather than from
     * `ctx.agents.list()`: a company usually has agents this plugin does not
     * own (a CEO, other teams). Listing them all would put strangers on the
     * Scrum board and offer them for assignment.
     */
    async function reconcileTeam(): Promise<void> {
      if (!companyId) return;

      const companyLeadId = await findCompanyLead();
      const team: WorkerState["agents"] = [];
      const resolved = new Map<string, { agentId: string; reportsTo: string | null }>();

      for (const member of TEAM) {
        try {
          const resolution = await ctx.agents.managed.reconcile(member.agentKey, companyId);
          const agent = resolution.agent;
          if (!agent || !resolution.agentId) continue;

          resolved.set(member.agentKey, {
            agentId: resolution.agentId,
            reportsTo: (agent as { reportsTo?: string | null }).reportsTo ?? null,
          });

          // Keep whatever the board already knew about this agent (current
          // ticket, status) so a reconcile does not reset live assignment.
          const existing = state.agents.find((a) => a.id === resolution.agentId);

          team.push({
            id: resolution.agentId,
            name: agent.name ?? member.displayName,
            // The declared role is authoritative: assignment and ceremonies
            // match on it, and the host may store a different one.
            role: member.role,
            status: existing?.status ?? "idle",
            currentTaskId: existing?.currentTaskId ?? null,
            capabilities: existing?.capabilities ?? [],
            skills: existing?.skills,
          });
        } catch (error) {
          ctx.logger.warn("Could not reconcile managed agent", {
            agentKey: member.agentKey,
            error: String(error),
          });
        }
      }

      if (team.length === 0) return;

      state.agents = team;
      ctx.logger.info("Scrum team ready", {
        agents: team.length,
        roles: team.map((a) => a.role).join(", "),
      });

      // Managed agents are always created without a superior, and the plugin
      // API has no way to give them one. If the operator supplied credentials
      // we set the reporting line over the host's REST API; otherwise we can
      // only surface the gap.
      const drift = detectReportingDrift(resolved, companyLeadId);
      if (drift.length === 0) return;

      const applied = await applyReportingLine(resolved, drift, companyLeadId);
      if (!applied) {
        ctx.logger.warn("Reporting line differs from the intended hierarchy", {
          agents: drift.map((d) => `${d.displayName} should report to ${d.expected}`),
          intended: describeReportingLine(),
          hint: "Set 'API token for hierarchy setup' in the plugin settings to have this applied automatically.",
        });
      }
    }

    /**
     * Sets each agent's superior over the host's REST API.
     *
     * `PATCH /api/agents/:id` accepts `reportsTo` — `updateAgentSchema` inherits
     * it from `createAgentSchema` and the handler passes the body straight to
     * `svc.update`. The plugin API offers no equivalent, which is the only
     * reason this reaches for HTTP at all.
     *
     * Returns false when no credentials are configured, so the caller can fall
     * back to reporting the drift.
     */
    async function applyReportingLine(
      resolved: Map<string, { agentId: string; reportsTo: string | null }>,
      drift: ReportingDrift[],
      companyLeadId: string | null,
    ): Promise<boolean> {
      if (!companyId) return false;

      const config = await readConfig();
      const baseUrl = String(config.apiBaseUrl ?? "").trim().replace(/\/+$/, "");
      if (!baseUrl) return false;

      // The token is optional: an instance running in `local_trusted` mode
      // accepts the call without one. On a protected instance the request comes
      // back 401 and is reported like any other failure.
      const token = String(config.apiToken ?? "").trim();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;

      let changed = 0;
      for (const entry of drift) {
        const member = TEAM.find((m) => m.agentKey === entry.agentKey);
        const target = resolved.get(entry.agentKey);
        if (!member || !target) continue;

        const superiorId = expectedSuperiorId(member, resolved, companyLeadId);

        try {
          // Node's global fetch, not `ctx.http.fetch`. The host client applies
          // SSRF protection and blocks private IPs, so it can never reach the
          // Paperclip instance itself — which is the only host this call ever
          // targets. The SDK explicitly allows plugins to use fetch directly.
          const response = await fetch(`${baseUrl}/api/agents/${target.agentId}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ reportsTo: superiorId }),
          });

          if (!response.ok) {
            ctx.logger.warn("Could not set reporting line", {
              agent: entry.displayName,
              status: response.status,
            });
            continue;
          }
          changed += 1;
        } catch (error) {
          ctx.logger.warn("Could not reach the API to set the reporting line", {
            agent: entry.displayName,
            error: String(error),
          });
        }
      }

      if (changed > 0) {
        ctx.logger.info("Reporting line applied", {
          updated: changed,
          intended: describeReportingLine(),
        });
      }

      // Reported as handled only if every drifting agent was fixed; a partial
      // run should still show the operator what is left.
      return changed === drift.length;
    }

    /** Reads the plugin config, tolerating a host that cannot supply it. */
    async function readConfig(): Promise<Record<string, unknown>> {
      if (!companyId) return {};
      try {
        return await ctx.config.get(companyId);
      } catch {
        return {};
      }
    }

    // -------------------------------------------------------------------------
    // Ceremonies
    // -------------------------------------------------------------------------

    const pendingInstructionUpdates: InstructionUpdate[] = [];
    const pendingWork: AgentWorkRequest[] = [];

    function ceremonyContext(): CeremonyContext {
      return {
        state,
        requestAgentWork: (request: AgentWorkRequest) => {
          // The plugin orchestrates; the *content* — user stories, acceptance
          // criteria, estimates — comes from the agents themselves.
          pendingWork.push(request);
        },
        updateAgentInstructions: (update) => {
          pendingInstructionUpdates.push(update);
        },
      };
    }

    const CEREMONIES: Record<CeremonyType, (c: CeremonyContext) => unknown> = {
      sprint_planning: runSprintPlanning,
      backlog_refinement: runBacklogRefinement,
      impediment_resolution: runImpedimentResolution,
      sprint_review: runSprintReview,
      sprint_retrospective: runRetrospective,
    };

    function runCeremony(ceremony: CeremonyType): unknown {
      const record = CEREMONIES[ceremony]?.(ceremonyContext());
      if (!record) return null;

      state.metrics = recalculateMetrics(state);
      ctx.logger.info("Ceremony finished", { ceremony });
      return record;
    }

    const triggers = new CeremonyTriggerEngine({
      getState: () => state,
      run: (ceremony, reason) => {
        ctx.logger.info("Ceremony triggered", { ceremony, reason });
        runCeremony(ceremony);
      },
    });

    /**
     * Re-evaluates the triggers after a board change and persists the result.
     *
     * There is no timer anywhere in this plugin — this is the only path that
     * starts a ceremony automatically.
     */
    async function boardChanged(): Promise<void> {
      // Der Host ist fur projektgebundene Child-Issues die Quelle der Wahrheit.
      // Lokale Zeremonien wurden Status und Zuweisungen nur im Plugin-State
      // andern und beim nachsten Host-Event wieder auseinanderlaufen.
      if (hasProjectBackedTasks()) {
        await save();
        return;
      }

      triggers.evaluate();
      await dispatchWork();
      await save();
    }

    /**
     * Hands queued work to the agents, with their learned skills as context.
     *
     * The host has no API to rewrite a managed agent's instructions — managed
     * agents are reconciled from the manifest. So learned skills travel with
     * the work instead: every wake-up carries the active skills for that role,
     * which is what actually changes how the agent does the next task.
     */
    async function dispatchWork(): Promise<void> {
      // Skill blocks are rebuilt from state, so a failed dispatch simply
      // repeats on the next ceremony rather than losing the learning.
      const skillContext = new Map<string, string>();
      for (const update of pendingInstructionUpdates.splice(0)) {
        skillContext.set(update.role, update.instructions);
      }

      if (!companyId) {
        pendingWork.length = 0;
        return;
      }

      for (const request of pendingWork.splice(0)) {
        const agents = state.agents.filter((a) => a.role === request.role);
        const skills = skillContext.get(request.role);

        for (const agent of agents) {
          try {
            await ctx.agents.invoke(agent.id, companyId, {
              prompt: skills
                ? `${request.instruction}\n\n---\n\n${skills}`
                : request.instruction,
              reason: `Agent Scrum: ${request.ceremony}`,
            });
            ctx.logger.info("Agent invoked", {
              agent: agent.name,
              ceremony: request.ceremony,
              withSkills: Boolean(skills),
            });
          } catch (error) {
            ctx.logger.warn("Could not invoke agent", {
              agent: agent.name,
              error: String(error),
            });
          }
        }
      }
    }

    /**
     * Spiegelt einen kanonischen Host-Issue in das lokale Board.
     *
     * Nur direkte Child-Issues des aktiven Kickoff-Issues gelten als
     * projektgebundene Stories. Diese Synchronisation speichert bewusst ohne
     * `boardChanged()`: ein Host-Event soll keine lokale Zeremonie auslosen.
     */
    async function syncOnboardingIssue(event: {
      companyId: string;
      entityId?: string;
      actorId?: string;
    }): Promise<boolean> {
      if (!companyId || !event.entityId) return false;

      try {
        const issue = await ctx.issues.get(event.entityId, companyId);
        if (!issue) return false;

        const completionGatedIssue = await routeProjectCompletionToQa(issue, event.actorId ?? null);
        const routedIssue = await routeProjectReview(completionGatedIssue);
        const result = syncProjectOnboardingIssue(
          state.tasks,
          state.projectOnboarding,
          await withHostComments(routedIssue),
          event.actorId ?? null,
          state.agents
        );
        if (!result.changed) return result.handled;

        reconcileProjectRefinementRequests();
        syncProjectAgentActivity();
        state.metrics = recalculateMetrics(state);
        await save();
        if (
          state.projectOnboarding?.status === "active" ||
          state.projectOnboarding?.status === "sprint_planning"
        ) {
          await requestProjectRefinement("automatic");
          if (state.projectOnboarding.status === "active") {
            await requestProjectPlanning();
            await releaseResolvedProjectBlockers();
          }
        }
        ctx.logger.info("Project issue synchronized", {
          issueId: issue.id,
          action: result.action,
        });
        return true;
      } catch (error) {
        ctx.logger.warn("Could not synchronize project issue", {
          issueId: event.entityId,
          error: String(error),
        });
        return false;
      }
    }

    // -------------------------------------------------------------------------
    // Host events → board
    // -------------------------------------------------------------------------

    ctx.events.on("issue.created", async (event) => {
      await ensureReady(event.companyId);
      if (!(await syncOnboardingIssue(event))) await boardChanged();
    });

    ctx.events.on("issue.updated", async (event) => {
      await ensureReady(event.companyId);
      if (!(await syncOnboardingIssue(event))) await boardChanged();
    });

    ctx.events.on("issue.comment.created", async (event) => {
      await ensureReady(event.companyId);
      const issueId = issueIdFromEvent(event);
      if (issueId) {
        await syncOnboardingIssue({
          companyId: event.companyId,
          entityId: issueId,
          actorId: event.actorId,
        });
      }
      await refreshTechnicalAnalysisStatus();
      await routeOpenProjectReviews();
    });

    // -------------------------------------------------------------------------
    // Data the UI reads
    // -------------------------------------------------------------------------

    ctx.data.register("board", async (params) => {
      await ensureReady(params.companyId as string | undefined);
      await refreshTechnicalAnalysisStatus();
      await syncOnboardingProjectIssues();
      const rootIssueId = state.projectOnboarding?.rootIssueId;
      const projectTasks = rootIssueId
        ? state.tasks.filter((task) => task.parentId === rootIssueId)
        : [];
      return {
        tasks: state.tasks,
        agents: state.agents,
        currentSprint: state.currentSprint,
        metrics: state.metrics,
        ceremonies: state.ceremonies,
        settings: state.settings,
        projectOnboarding: state.projectOnboarding ?? createInitialProjectOnboarding(),
        canStartProjectOnboarding: canStartProjectOnboarding(),
        canStartProjectSprint: canStartProjectSprint(),
        projectProgress: projectProgress(projectTasks),
      };
    });

    ctx.data.register("projects", async (params) => {
      await ensureReady(params.companyId as string | undefined);
      if (!companyId) return [];

      const projects = await ctx.projects.list({ companyId });
      return projects.map((project) => ({ id: project.id, name: project.name }));
    });

    ctx.data.register("log", async (params) => ({
      messages: state.messages,
      decisions: collectDecisions(state, Number(params.limit ?? 100)),
      learnings: state.learnings,
      skills: state.skills,
      proposedStories: state.proposedStories,
    }));

    // -------------------------------------------------------------------------
    // Actions the UI triggers
    // -------------------------------------------------------------------------

    ctx.actions.register("createTask", async (params, context) => {
      await ensureReady(context.companyId);

      const task = createScrumTask({
        title: String(params.title ?? "Untitled"),
        description: String(params.description ?? ""),
        type: params.type as ScrumTask["type"],
        priority: params.priority as ScrumTask["priority"],
        storyPoints: Number(params.storyPoints ?? 0),
        labels: (params.labels as string[]) ?? [],
      });
      state.tasks.push(task);

      await boardChanged();
      return { task };
    });

    ctx.actions.register("requestProjectRefinement", async (_params, context) => {
      await ensureReady(context.companyId);
      return requestProjectRefinement();
    });

    ctx.actions.register("retryProjectRefinement", async (_params, context) => {
      await ensureReady(context.companyId);
      return requestProjectRefinement("manual", true);
    });

    ctx.actions.register("startProjectOnboarding", async (params, context) => {
      await ensureReady(context.companyId);
      if (!companyId) return { started: false, error: "No company context." };
      if (!canStartProjectOnboarding()) {
        return {
          started: false,
          error: "Finish or reset the active project onboarding before starting another one.",
        };
      }

      const parsed = parseProjectOnboardingInput({
        projectId: params.projectId,
        brief: params.brief,
        constraints: params.constraints,
      });
      if (!parsed.valid) return { started: false, error: parsed.error };

      const project = await ctx.projects.get(parsed.value.projectId, companyId);
      if (!project) return { started: false, error: "The selected Paperclip project no longer exists." };

      const workspace = await ctx.projects.getPrimaryWorkspace(project.id, companyId);
      if (!workspace) {
        return {
          started: false,
          error:
            "The selected project needs a primary workspace. Add its repository or local folder in Paperclip first.",
        };
      }

      const technicalLead = state.agents.find((agent) => agent.role === "technical_lead");
      if (!technicalLead) {
        return {
          started: false,
          error: "Activate the Scrum team before starting project work.",
        };
      }

      const requiresSprint = await projectSprintRequired();
      const provisionalOnboarding = startProjectOnboarding({
        input: parsed.value,
        projectName: project.name,
        rootIssueId: "pending",
        requiresSprint,
      });
      const rootIssue = await ctx.issues.create({
        companyId,
        projectId: project.id,
        title: `Kickoff: ${project.name}`,
        description: createTechnicalAnalysisPrompt(provisionalOnboarding),
        status: "todo",
        priority: "high",
        assigneeAgentId: technicalLead.id,
      });

      state.projectOnboarding = startProjectOnboarding({
        input: parsed.value,
        projectName: project.name,
        rootIssueId: rootIssue.id,
        requiresSprint,
      });
      await save();

      const wakeup = await requestIssueWakeup(rootIssue.id, "project_onboarding_analysis");
      ctx.logger.info("Project onboarding analysis started", {
        projectId: project.id,
        rootIssueId: rootIssue.id,
        workspaceId: workspace.id,
        queued: wakeup.queued,
      });

      return {
        started: true,
        rootIssueId: rootIssue.id,
        projectOnboarding: state.projectOnboarding,
        wakeup,
      };
    });

    ctx.actions.register("startBacklogDiscovery", async (_params, context) => {
      await ensureReady(context.companyId);
      if (!companyId) return { started: false, error: "No company context." };

      await refreshTechnicalAnalysisStatus();

      const onboarding = state.projectOnboarding;
      if (
        !onboarding ||
        onboarding.status !== "analysis_ready" ||
        !onboarding.rootIssueId
      ) {
        return {
          started: false,
          error: "Wait for the Technical Lead to finish the project analysis before starting Product Owner discovery.",
        };
      }

      const productOwner = state.agents.find((agent) => agent.role === "product_owner");
      if (!productOwner) return { started: false, error: "The Product Owner is not available." };

      const next = transitionProjectOnboarding(onboarding, "backlog_in_progress");
      await ctx.issues.update(
        onboarding.rootIssueId,
        {
          description: createBacklogDiscoveryPrompt(next),
          status: "todo",
          assigneeAgentId: productOwner.id,
        },
        companyId
      );
      state.projectOnboarding = next;
      await save();

      const wakeup = await requestIssueWakeup(onboarding.rootIssueId, "project_onboarding_backlog");
      return { started: true, projectOnboarding: state.projectOnboarding, wakeup };
    });

    ctx.actions.register("activateProjectOnboarding", async (_params, context) => {
      await ensureReady(context.companyId);
      if (!companyId) return { activated: false, error: "No company context." };

      const onboarding = state.projectOnboarding;
      if (!onboarding || onboarding.status !== "backlog_in_progress" || !onboarding.rootIssueId) {
        return {
          activated: false,
          error: "Start Product Owner discovery before approving the backlog.",
        };
      }
      const rootIssueId = onboarding.rootIssueId;
      const nextStatus = onboarding.requiresSprint ? "sprint_planning" : "active";

      state.projectOnboarding = transitionProjectOnboarding(onboarding, nextStatus);
      await syncOnboardingProjectIssues();
      await save();

      let commentError: string | null = null;
      try {
        await ctx.issues.createComment(
          rootIssueId,
          onboarding.requiresSprint
            ? "## Backlog approved\n\nThe human approved the initial backlog. Technical refinement must finish before the human starts the first sprint; do not advance child issues into delivery yet."
            : "## Backlog approved\n\nThe human approved the initial backlog. Assign and advance the approved child issues through the Paperclip issue workflow.",
          companyId
        );
      } catch (error) {
        commentError = String(error);
        ctx.logger.warn("Could not record project backlog approval", {
          issueId: onboarding.rootIssueId,
          error: commentError,
        });
      }

      const wakeup = await requestIssueWakeup(
        rootIssueId,
        onboarding.requiresSprint ? "project_onboarding_sprint_planning" : "project_onboarding_delivery"
      );
      const refinement = await requestProjectRefinement("automatic");
      if (!onboarding.requiresSprint) await requestProjectPlanning();
      return {
        activated: true,
        awaitingSprint: onboarding.requiresSprint,
        projectOnboarding: state.projectOnboarding,
        wakeup,
        commentError,
        refinement,
      };
    });

    ctx.actions.register("startProjectSprint", async (_params, context) => {
      await ensureReady(context.companyId);
      if (!companyId) return { started: false, error: "No company context." };

      await syncOnboardingProjectIssues();
      const onboarding = state.projectOnboarding;
      if (!onboarding || onboarding.status !== "sprint_planning" || !onboarding.rootIssueId) {
        return {
          started: false,
          error: "Approve a backlog that requires sprint planning before starting a project sprint.",
        };
      }
      if (!canStartProjectSprint()) {
        return {
          started: false,
          error: "Refine and estimate at least one backlog ticket before starting the sprint.",
        };
      }

      const sprint = createProjectSprint({
        onboarding,
        id: createId(),
        sprintNumber: state.completedSprints.length + 1,
        lengthWeeks: state.settings.sprint.lengthWeeks,
      });
      state.currentSprint = sprint;
      state.projectOnboarding = transitionProjectOnboarding(onboarding, "active");
      await save();

      try {
        await ctx.issues.createComment(
          onboarding.rootIssueId,
          `## ${sprint.name} started\n\nThe human approved the first sprint. Agent Scrum will plan refined backlog issues through the Paperclip workflow.`,
          companyId
        );
      } catch (error) {
        ctx.logger.warn("Could not record project sprint start", {
          issueId: onboarding.rootIssueId,
          error: String(error),
        });
      }

      await requestProjectPlanning();
      return {
        started: true,
        sprint: state.currentSprint,
        projectOnboarding: state.projectOnboarding,
      };
    });

    ctx.actions.register("moveTask", async (params, context) => {
      await ensureReady(context.companyId);

      const task = state.tasks.find((t) => t.id === params.taskId);
      if (!task) return { moved: false, error: "Unknown ticket" };
      if (isProjectBackedTask(task)) {
        return {
          moved: false,
          error: "Project-backed tickets are updated through their Paperclip issue workflow.",
        };
      }

      const target = params.column as TaskStatus;
      const result = await onStatusChange(task, task.column, target, {
        state,
        currentAgent: null,
        emit: () => undefined,
        updateState: () => undefined,
        saveState: async () => undefined,
      });

      if (!result.success) return { moved: false, error: result.error };

      await boardChanged();
      return { moved: true, task };
    });

    ctx.actions.register("reviewTicket", async (params, context) => {
      await ensureReady(context.companyId);

      const task = state.tasks.find((entry) => entry.id === String(params.taskId));
      if (task && isProjectBackedTask(task)) {
        return {
          reviewed: false,
          error: "Project-backed tickets are reviewed through their Paperclip issue workflow.",
        };
      }

      const result = reviewTicket(state, String(params.taskId), {
        metCriterionIds: params.metCriterionIds as string[] | undefined,
        notes: params.notes as string | undefined,
      });

      if (!result) return { reviewed: false, error: "Ticket is not in review" };

      await boardChanged();
      return { reviewed: true, passed: result.passed, unmetCriteria: result.unmetCriteria };
    });

    ctx.actions.register("runCeremony", async (params, context) => {
      await ensureReady(context.companyId);

      const ceremony = params.ceremony as CeremonyType;
      if (!CEREMONIES[ceremony]) return { started: false, error: `Unknown ceremony: ${ceremony}` };
      if (hasProjectBackedTasks()) {
        return {
          started: false,
          error: "Project-backed tickets are coordinated through their Paperclip issue workflow.",
        };
      }
      if (
        (ceremony === "sprint_planning" || ceremony === "backlog_refinement") &&
        state.projectOnboarding &&
        !canRunAutomaticDelivery(state.projectOnboarding)
      ) {
        return {
          started: false,
          error: "Approve the project backlog before starting planning or refinement.",
        };
      }

      const record = runCeremony(ceremony);
      await dispatchWork();
      await save();
      return { started: true, record };
    });

    ctx.logger.info("Agent Scrum loaded", {
      note: "board and team are loaded on the first company-scoped request",
    });
  },

  async onHealth() {
    return { status: "ok", message: "Agent Scrum worker is running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

export type { PluginContext };
