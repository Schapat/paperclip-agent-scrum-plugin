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

import {
  definePlugin,
  runWorker,
  type Issue,
  type PluginContext,
  type PluginEvent,
} from "@paperclipai/plugin-sdk";

import {
  MANAGED_AGENT_INSTRUCTIONS,
  heartbeatAwareInstructions,
} from "./agent-instructions";
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
  TECHNICAL_ANALYSIS_CHANGES_REQUESTED_MARKER,
  transitionProjectOnboarding,
} from "./core/project-onboarding";
import {
  projectIssueDetailTask,
  syncProjectOnboardingIssue,
  syncTaskIdentifiers,
} from "./core/project-issue-sync";
import { projectIssueProjection, projectProgress } from "./core/project-issue-projection";
import {
  fetchGitHubCommitChanges,
  parseGitHubRepositoryUrl,
} from "./core/github-repository";
import {
  PRODUCT_DECISION_REQUIRED_MARKER,
  PRODUCT_DECISION_RESOLVED_MARKER,
  hasQaReviewApproval,
  reviewOwnerForProjectIssue,
} from "./core/review-routing";
import { migrateState } from "./core/storage";
import { recalculateMetrics, createInitialMetrics, onStatusChange } from "./core/hooks";
import { collectDecisions, recordDecision, sendMessage } from "./core/communication";
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
  withScrumHeartbeatRuntimeConfig,
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
  multiCompanyConfig: true,
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

    /** Serializes access to the worker's single mutable company context. */
    let companyInvocationTail: Promise<void> = Promise.resolve();

    /** Includes the invocation currently running and any work queued behind it. */
    let pendingCompanyInvocations = 0;

    /** Shares idempotent board actions that arrive before the first invocation completes. */
    const coalescedActions = new Map<string, Promise<unknown>>();

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
        state = createEmptyState();
      }
      if (teamReady || !companyId) return;

      await initialise();
    }

    /**
     * Runs a complete host invocation without another company changing the
     * mutable board context while an awaited host call is in flight.
     */
    async function withCompanyInvocation<T>(
      scope: unknown,
      operation: () => Promise<T>
    ): Promise<T> {
      pendingCompanyInvocations += 1;
      const previousInvocation = companyInvocationTail;
      let releaseInvocation: (() => void) | undefined;
      companyInvocationTail = new Promise<void>((resolve) => {
        releaseInvocation = resolve;
      });

      await previousInvocation;
      try {
        await ensureReady(typeof scope === "string" ? scope : undefined);
        return await operation();
      } finally {
        pendingCompanyInvocations -= 1;
        releaseInvocation?.();
      }
    }

    function registerCompanyData(
      key: string,
      handler: Parameters<PluginContext["data"]["register"]>[1]
    ): void {
      ctx.data.register(key, (params) =>
        withCompanyInvocation(params.companyId, () => handler(params))
      );
    }

    function registerCompanyEvent(
      name: Parameters<PluginContext["events"]["on"]>[0],
      handler: (event: PluginEvent) => Promise<void>
    ): void {
      ctx.events.on(name, (event) => {
        const queueBusy = pendingCompanyInvocations > 0;
        const invocation = withCompanyInvocation(event.companyId, () => handler(event));
        if (!queueBusy) return invocation;

        void invocation.catch((error) => {
          ctx.logger.error("Could not process Scrum event", {
            event: name,
            eventId: event.eventId,
            companyId: event.companyId,
            error: String(error),
          });
        });
        return Promise.resolve();
      });
    }

    function registerCompanyAction(
      key: string,
      handler: Parameters<PluginContext["actions"]["register"]>[1],
      options: { coalesceByCompany?: boolean } = {}
    ): void {
      ctx.actions.register(key, (params, context) => {
        const run = () => withCompanyInvocation(context.companyId, () => handler(params, context));
        if (!options.coalesceByCompany) return run();

        const companyKey = typeof context.companyId === "string" ? context.companyId : "unknown";
        const actionKey = `${key}:${companyKey}`;
        const existing = coalescedActions.get(actionKey);
        if (existing) return existing;

        const result = run();
        coalescedActions.set(actionKey, result);
        void result.then(
          () => {
            if (coalescedActions.get(actionKey) === result) coalescedActions.delete(actionKey);
          },
          () => {
            if (coalescedActions.get(actionKey) === result) coalescedActions.delete(actionKey);
          }
        );
        return result;
      });
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
      reconcileLocalDoneTicketsWithUnmetCriteria();
      await syncOnboardingProjectIssues();
      await holdExistingUnscopedManagedIssues();
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

    /** Closes a human-requested project once every direct delivery story is done. */
    function completeProjectOnboardingIfDelivered(): boolean {
      const onboarding = state.projectOnboarding;
      if (!onboarding?.rootIssueId || onboarding.status !== "active") return false;

      const projectTasks = state.tasks.filter((task) => task.parentId === onboarding.rootIssueId);
      if (projectTasks.length === 0 || projectTasks.some((task) => task.column !== "done")) return false;

      state.projectOnboarding = transitionProjectOnboarding(onboarding, "completed");
      return true;
    }

    /** Holds managed-agent work that was created outside the human-approved project boundary. */
    async function holdUnscopedManagedIssue(event: {
      companyId: string;
      entityId?: string;
      actorId?: string;
    }): Promise<boolean> {
      if (!companyId || !event.entityId || !event.actorId) return false;

      const onboarding = state.projectOnboarding;
      const createdByManagedAgent = state.agents.some((agent) => agent.id === event.actorId);
      if (!onboarding?.rootIssueId || !onboarding.projectId || !createdByManagedAgent) return false;

      try {
        const issue = await ctx.issues.get(event.entityId, companyId);
        if (
          !issue ||
          issue.id === onboarding.rootIssueId ||
          isProjectOnboardingChildIssue(issue) ||
          issue.status === "done" ||
          issue.status === "cancelled"
        ) {
          return false;
        }

        const existingHold = (onboarding.scopeHolds ?? []).some((hold) => hold.issueId === issue.id);
        if (issue.status !== "blocked" || issue.assigneeAgentId !== null) {
          await ctx.issues.update(
            issue.id,
            { status: "blocked", assigneeAgentId: null },
            companyId
          );
        }
        if (!existingHold) {
          await ctx.issues.createComment(
            issue.id,
            "## Human scope approval required\n\nAgent Scrum held this agent-created work because it is outside the active project request. Do not plan, assign, or implement it until a human explicitly approves a new project scope.",
            companyId
          );
          state.projectOnboarding = {
            ...onboarding,
            scopeHolds: [
              ...(onboarding.scopeHolds ?? []),
              { issueId: issue.id, title: issue.title, heldAt: new Date().toISOString() },
            ],
            updatedAt: new Date().toISOString(),
          };
          await save();
        }
        ctx.logger.warn("Held agent-created work outside project scope", {
          issueId: issue.id,
          title: issue.title,
          actorId: event.actorId,
        });
        return true;
      } catch (error) {
        ctx.logger.warn("Could not hold agent-created work outside project scope", {
          issueId: event.entityId,
          error: String(error),
        });
        return false;
      }
    }

    /** Reconciles pre-existing agent-created scope drift after a worker restart or upgrade. */
    async function holdExistingUnscopedManagedIssues(): Promise<void> {
      if (!companyId || !state.projectOnboarding?.projectId || !state.projectOnboarding.rootIssueId) return;

      let offset = 0;
      const limit = 100;
      try {
        while (true) {
          const issues = await ctx.issues.list({ companyId, limit, offset });
          for (const issue of issues) {
            const creatorId = (issue as Issue & { createdByAgentId?: unknown }).createdByAgentId;
            if (
              issue.id === state.projectOnboarding.rootIssueId ||
              isProjectOnboardingChildIssue(issue) ||
              issue.status === "done" ||
              issue.status === "cancelled" ||
              typeof creatorId !== "string"
            ) {
              continue;
            }
            await holdUnscopedManagedIssue({ companyId, entityId: issue.id, actorId: creatorId });
          }
          if (issues.length < limit) return;
          offset += issues.length;
        }
      } catch (error) {
        ctx.logger.warn("Could not reconcile agent-created work outside project scope", {
          error: String(error),
        });
      }
    }

    function isProjectBackedTask(task: ScrumTask): boolean {
      return Boolean(state.projectOnboarding?.rootIssueId && task.parentId === state.projectOnboarding.rootIssueId);
    }

    /** Returns legacy local completions to QA when their recorded criteria are incomplete. */
    function reconcileLocalDoneTicketsWithUnmetCriteria(): boolean {
      const qa = state.agents.find((agent) => agent.role === "qa_engineer") ?? null;
      let changed = false;

      for (const task of state.tasks) {
        const unmetCriteria = task.acceptanceCriteria.filter((criterion) => !criterion.met);
        const hasCriteria = task.acceptanceCriteria.length > 0;
        if (
          isProjectBackedTask(task) ||
          task.column !== "done" ||
          (hasCriteria && unmetCriteria.length === 0)
        ) {
          continue;
        }

        const now = new Date().toISOString();
        task.statusHistory.push({
          from: "done",
          to: "in_review",
          timestamp: now,
          triggeredBy: qa?.id ?? null,
        });
        task.column = "in_review";
        task.assignedAgentId = qa?.id ?? task.assignedAgentId;
        task.completedAt = null;
        task.updatedAt = now;
        sendMessage(state, {
          from: null,
          to: qa ? [qa] : null,
          subject: "QA acceptance criteria verification required",
          body:
            hasCriteria
              ? "Agent Scrum returned this persisted Done ticket to QA because not every acceptance criterion is verified. " +
                `Open criteria:\n${unmetCriteria.map((criterion) => `- ${criterion.text}`).join("\n")}`
              : "Agent Scrum returned this persisted Done ticket to QA because it has no acceptance criteria.",
          taskId: task.id,
        });
        recordDecision(state, {
          task,
          type: "review_rejected",
          description: "Persisted Done ticket returned to QA review",
          reasoning: hasCriteria
            ? `${unmetCriteria.length} acceptance criterion/criteria remain unverified.`
            : "The ticket has no acceptance criteria and cannot be verified for Done.",
          madeBy: null,
        });
        changed = true;
      }

      if (changed) state.metrics = recalculateMetrics(state);
      return changed;
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
        let route = reviewOwnerForProjectIssue(issue, comments);
        if (!route) return issue;

        if (
          route.reason === "product_decision" &&
          state.projectOnboarding?.status === "active" &&
          state.currentSprint?.status === "active"
        ) {
          await ctx.issues.createComment(
            issue.id,
            [
              "## Sprint scope already approved",
              "This decision is covered by the human-approved active sprint. QA continues with the approved ticket scope; no additional human approval is required.",
              PRODUCT_DECISION_RESOLVED_MARKER,
            ].join("\n\n"),
            companyId
          );
          route = { role: "qa_engineer", reason: "technical_review" };
        }

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

      try {
        const comments = await ctx.issues.listComments(issue.id, companyId);
        const projection = projectIssueProjection({
          issueId: issue.id,
          description: issue.description ?? "",
          comments,
          agents: state.agents,
        });
        const commits = projection.commits;
        if (commits.length === 0) {
          const developer = developerForProjectRework(issue.id);
          const status = developer ? "in_progress" : "blocked";
          const returned = await ctx.issues.update(
            issue.id,
            { status, assigneeAgentId: developer?.id ?? null },
            companyId
          );
          try {
            await ctx.issues.createComment(
              returned.id,
              `## GitHub commit evidence required\n\nAgent Scrum returned this completion to Development. Add a developer comment with <!-- agent-scrum:commit:v1 {"sha":"...","url":"https://github.com/owner/repo/commit/...","message":"..."} --> before QA can complete the ticket.`,
              companyId
            );
          } catch (error) {
            ctx.logger.warn("Could not record the commit evidence gate", {
              issueId: returned.id,
              error: String(error),
            });
          }
          const wakeup = developer
            ? await requestIssueWakeup(returned.id, "project_commit_evidence")
            : { queued: false };
          ctx.logger.warn("Project completion blocked by missing GitHub commit evidence", {
            issueId: returned.id,
            developerId: developer?.id ?? null,
            queued: wakeup.queued,
          });
          return returned;
        }

        const qa = state.agents.find((agent) => agent.role === "qa_engineer");
        if (!qa) return issue;
        const incompleteAcceptanceCriteria =
          projection.refinement.acceptanceCriteria.length > 0 &&
          projection.refinement.acceptanceCriteria.some((criterion) => !criterion.met);
        if (incompleteAcceptanceCriteria) {
          const review = await ctx.issues.update(
            issue.id,
            { status: "in_review", assigneeAgentId: qa.id },
            companyId
          );
          try {
            await ctx.issues.createComment(
              review.id,
              "## QA acceptance criteria verification required\n\nAgent Scrum returned this completion to QA. Record every acceptance criterion as a checked QA checklist entry before approving Done.",
              companyId
            );
          } catch (error) {
            ctx.logger.warn("Could not record the acceptance criteria gate", {
              issueId: review.id,
              error: String(error),
            });
          }
          const wakeup = await requestIssueWakeup(review.id, "project_completion_qa");
          ctx.logger.warn("Project completion blocked by incomplete QA acceptance criteria", {
            issueId: review.id,
            qaId: qa.id,
            verifiedCriteria: projection.refinement.acceptanceCriteria.filter((criterion) => criterion.met).length,
            totalCriteria: projection.refinement.acceptanceCriteria.length,
            queued: wakeup.queued,
          });
          return review;
        }
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

    /** Keeps QA as the reviewer by handing rejected project work back to a developer. */
    async function routeProjectReworkToDeveloper(issue: Issue): Promise<Issue> {
      if (!companyId || !isProjectOnboardingChildIssue(issue) || issue.status !== "in_progress") {
        return issue;
      }

      const qa = state.agents.find((agent) => agent.role === "qa_engineer");
      if (!qa || issue.assigneeAgentId !== qa.id) return issue;

      const developer = developerForProjectRework(issue.id);
      if (!developer) {
        ctx.logger.warn("Could not route QA rework because no developer is available", {
          issueId: issue.id,
        });
        return issue;
      }

      try {
        const reassigned = await ctx.issues.update(
          issue.id,
          { assigneeAgentId: developer.id },
          companyId
        );
        try {
          await ctx.issues.createComment(
            reassigned.id,
            `## QA rework routed\n\nQA returned this ticket to Development. Assigned to ${developer.name} to implement the documented review findings before returning it to QA.`,
            companyId
          );
        } catch (error) {
          ctx.logger.warn("Could not record QA rework routing", {
            issueId: reassigned.id,
            error: String(error),
          });
        }
        const wakeup = await requestIssueWakeup(reassigned.id, "project_rework_development");
        ctx.logger.info("Project QA rework routed", {
          issueId: reassigned.id,
          developerId: developer.id,
          queued: wakeup.queued,
        });
        return reassigned;
      } catch (error) {
        ctx.logger.warn("Could not route QA rework to a developer", {
          issueId: issue.id,
          error: String(error),
        });
        return issue;
      }
    }

    function developerForProjectRework(issueId: string): WorkerState["agents"][number] | null {
      const activeColumns = new Set(["todo", "in_progress", "in_review"]);
      return state.agents
        .filter((agent) => agent.role === "developer")
        .map((agent, index) => ({
          agent,
          index,
          activeTasks: state.tasks.filter(
            (task) => task.id !== issueId && task.assignedAgentId === agent.id && activeColumns.has(task.column)
          ).length,
        }))
        .sort((left, right) => left.activeTasks - right.activeTasks || left.index - right.index)[0]?.agent ?? null;
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
          task.column !== "done" &&
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

    type ProjectRefinementResult = {
      requested: boolean;
      error: string | null;
      taskIds: string[];
    };

    let projectRefinementPromise: Promise<ProjectRefinementResult> | null = null;

    async function requestProjectRefinement(
      source: "automatic" | "manual" = "manual",
      force = false
    ): Promise<ProjectRefinementResult> {
      if (projectRefinementPromise) return projectRefinementPromise;

      const refinement = requestProjectRefinementInternal(source, force);
      projectRefinementPromise = refinement;
      try {
        return await refinement;
      } finally {
        projectRefinementPromise = null;
      }
    }

    async function requestProjectRefinementInternal(
      source: "automatic" | "manual" = "manual",
      force = false
    ): Promise<ProjectRefinementResult> {
      if (!companyId) return { requested: false, error: "No company context.", taskIds: [] as string[] };

      const requestStateChanged = reconcileProjectRefinementRequests();
      const onboarding = state.projectOnboarding;
      if (onboarding?.status === "completed") {
        if (requestStateChanged) await save();
        return {
          requested: false,
          error: "Project delivery is complete. Wait for a new human-approved project request.",
          taskIds: [] as string[],
        };
      }
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

    /** Projects the kickoff for board-side analysis and workflow inspection. */
    async function projectKickoffTask(): Promise<ScrumTask | null> {
      const rootIssueId = state.projectOnboarding?.rootIssueId;
      if (!companyId || !rootIssueId) return null;

      try {
        const issue = await ctx.issues.get(rootIssueId, companyId);
        if (!issue) return null;
        return projectIssueDetailTask(await withHostComments(issue), state.agents);
      } catch (error) {
        ctx.logger.warn("Could not project kickoff issue for board details", {
          issueId: rootIssueId,
          error: String(error),
        });
        return null;
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
            const reworkRoutedIssue = await routeProjectReworkToDeveloper(completionGatedIssue);
            const routedIssue = await routeProjectReview(reworkRoutedIssue);
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

      const projectCompleted = completeProjectOnboardingIfDelivered();
      const refinementRequestsChanged = reconcileProjectRefinementRequests();
      const agentActivityChanged = syncProjectAgentActivity();
      if (changed || projectCompleted || refinementRequestsChanged || agentActivityChanged) {
        if (changed) state.metrics = recalculateMetrics(state);
        await save();
      }
      await releaseResolvedProjectBlockers();
      return changed || projectCompleted;
    }

    /** Backfills Paperclip identifiers for legacy board tasks outside the current kickoff tree. */
    async function hydrateTaskIdentifiers(): Promise<boolean> {
      if (!companyId || !state.tasks.some((task) => !task.identifier)) return false;

      const unresolvedTaskIds = new Set(
        state.tasks.filter((task) => !task.identifier).map((task) => task.id)
      );
      const limit = 100;
      let offset = 0;
      let changed = false;

      try {
        while (unresolvedTaskIds.size > 0) {
          const issues = await ctx.issues.list({ companyId, limit, offset });
          changed ||= syncTaskIdentifiers(state.tasks, issues);
          for (const issue of issues) {
            if (issue.identifier?.trim()) unresolvedTaskIds.delete(issue.id);
          }
          if (issues.length < limit) break;
          offset += issues.length;
        }
      } catch (error) {
        ctx.logger.warn("Could not backfill Paperclip ticket identifiers", { error: String(error) });
        return false;
      }

      if (changed) await save();
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
      await upgradeManagedAgentHeartbeats(resolved);
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

    /** Applies the central event-routing and Scrum-Master watchdog runtime policy. */
    async function upgradeManagedAgentHeartbeats(
      resolved: Map<string, { agentId: string; reportsTo: string | null }>
    ): Promise<void> {
      if (!companyId) return;

      const config = await readConfig();
      const baseUrl = String(config.apiBaseUrl ?? "").trim().replace(/\/+$/, "");
      if (!baseUrl) return;

      const token = String(config.apiToken ?? "").trim();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;

      let heartbeatUpdates = 0;
      let instructionUpdates = 0;
      for (const member of TEAM) {
        const target = resolved.get(member.agentKey);
        if (!target) continue;

        try {
          const currentResponse = await fetch(`${baseUrl}/api/agents/${target.agentId}`, { headers });
          if (!currentResponse.ok) {
            ctx.logger.warn("Could not read managed agent configuration", {
              agent: member.displayName,
              status: currentResponse.status,
            });
            continue;
          }
          const current = await currentResponse.json() as { runtimeConfig?: unknown };
          const runtimeConfig = withScrumHeartbeatRuntimeConfig(
            member.agentKey,
            asRecord(current.runtimeConfig)
          );
          if (JSON.stringify(runtimeConfig) !== JSON.stringify(current.runtimeConfig ?? {})) {
            const runtimeResponse = await fetch(`${baseUrl}/api/agents/${target.agentId}`, {
              method: "PATCH",
              headers,
              body: JSON.stringify({ runtimeConfig }),
            });
            if (!runtimeResponse.ok) {
              ctx.logger.warn("Could not apply managed agent runtime policy", {
                agent: member.displayName,
                status: runtimeResponse.status,
              });
            } else {
              heartbeatUpdates += 1;
            }
          }

          const instructionsUrl = `${baseUrl}/api/agents/${target.agentId}/instructions-bundle/file?path=AGENTS.md`;
          const fileResponse = await fetch(instructionsUrl, { headers });
          const existing = fileResponse.ok
            ? readInstructionContent(await fileResponse.json())
            : null;
          const content = heartbeatAwareInstructions(member.agentKey, existing);
          if (content !== existing) {
            const instructionResponse = await fetch(`${baseUrl}/api/agents/${target.agentId}/instructions-bundle/file`, {
              method: "PUT",
              headers,
              body: JSON.stringify({
                path: "AGENTS.md",
                content,
                clearLegacyPromptTemplate: true,
              }),
            });
            if (!instructionResponse.ok) {
              ctx.logger.warn("Could not update managed agent heartbeat instructions", {
                agent: member.displayName,
                status: instructionResponse.status,
              });
            } else {
              instructionUpdates += 1;
            }
          }
        } catch (error) {
          ctx.logger.warn("Could not upgrade managed agent runtime policy", {
            agent: member.displayName,
            error: String(error),
          });
        }
      }

      if (heartbeatUpdates > 0 || instructionUpdates > 0) {
        ctx.logger.info("Managed agent runtime policy applied", {
          heartbeatUpdates,
          instructionUpdates,
        });
      }
    }

    function asRecord(value: unknown): Record<string, unknown> {
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    }

    function readInstructionContent(value: unknown): string | null {
      const record = asRecord(value);
      return typeof record.content === "string" ? record.content : null;
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

    function ceremonyContext(allowAutomaticScopeExpansion: boolean): CeremonyContext {
      return {
        state,
        allowAutomaticScopeExpansion,
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

    function runCeremony(ceremony: CeremonyType, allowAutomaticScopeExpansion: boolean): unknown {
      const record = CEREMONIES[ceremony]?.(ceremonyContext(allowAutomaticScopeExpansion));
      if (!record) return null;

      state.metrics = recalculateMetrics(state);
      ctx.logger.info("Ceremony finished", { ceremony });
      return record;
    }

    const triggers = new CeremonyTriggerEngine({
      getState: () => state,
      run: (ceremony, reason) => {
        ctx.logger.info("Ceremony triggered", { ceremony, reason });
        runCeremony(ceremony, false);
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
        const reworkRoutedIssue = await routeProjectReworkToDeveloper(completionGatedIssue);
        const routedIssue = await routeProjectReview(reworkRoutedIssue);
        const result = syncProjectOnboardingIssue(
          state.tasks,
          state.projectOnboarding,
          await withHostComments(routedIssue),
          event.actorId ?? null,
          state.agents
        );
        const projectCompleted = completeProjectOnboardingIfDelivered();
        if (!result.changed && !projectCompleted) return result.handled;

        reconcileProjectRefinementRequests();
        syncProjectAgentActivity();
        state.metrics = recalculateMetrics(state);
        await save();
        if (
          !projectCompleted &&
          (state.projectOnboarding?.status === "active" ||
            state.projectOnboarding?.status === "sprint_planning")
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

    registerCompanyEvent("issue.created", async (event) => {
      if (await holdUnscopedManagedIssue(event)) return;
      if (!(await syncOnboardingIssue(event))) await boardChanged();
    });

    registerCompanyEvent("issue.updated", async (event) => {
      if (await holdUnscopedManagedIssue(event)) return;
      if (!(await syncOnboardingIssue(event))) await boardChanged();
    });

    registerCompanyEvent("issue.comment.created", async (event) => {
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

    registerCompanyData("board", async (params) => {
      await refreshTechnicalAnalysisStatus();
      await syncOnboardingProjectIssues();
      await hydrateTaskIdentifiers();
      const rootIssueId = state.projectOnboarding?.rootIssueId;
      const kickoffTask = await projectKickoffTask();
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
        kickoffTask,
        canStartProjectOnboarding: canStartProjectOnboarding(),
        canStartProjectSprint: canStartProjectSprint(),
        projectProgress: projectProgress(projectTasks),
      };
    });

    registerCompanyData("projects", async () => {
      if (!companyId) return [];

      const projects = await ctx.projects.list({ companyId });
      return projects.map((project) => ({ id: project.id, name: project.name }));
    });

    registerCompanyData("log", async (params) => ({
      messages: state.messages,
      decisions: collectDecisions(state, Number(params.limit ?? 100)),
      learnings: state.learnings,
      skills: state.skills,
      proposedStories: state.proposedStories,
    }));

    // -------------------------------------------------------------------------
    // Actions the UI triggers
    // -------------------------------------------------------------------------

    registerCompanyAction("createTask", async (params) => {

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

    registerCompanyAction(
      "requestProjectRefinement",
      async () => requestProjectRefinement(),
      { coalesceByCompany: true }
    );

    registerCompanyAction(
      "retryProjectRefinement",
      async () => requestProjectRefinement("manual", true),
      { coalesceByCompany: true }
    );

    registerCompanyAction("startProjectOnboarding", async (params) => {
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
        skipSprintPlanning: params.skipSprintPlanning,
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

      const requiresSprint = (await projectSprintRequired()) && !parsed.value.skipSprintPlanning;
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

    registerCompanyAction("fetchTicketCommitChanges", async (params) => {
      if (!companyId) return { valid: false, error: "No company context." };

      await syncOnboardingProjectIssues();
      const taskId = typeof params.taskId === "string" ? params.taskId : "";
      const sha = typeof params.sha === "string" ? params.sha.trim().toLowerCase() : "";
      const task = state.tasks.find((entry) => entry.id === taskId);
      if (!task) return { valid: false, error: "Unknown project ticket." };
      const commit = task.commits.find((entry) => entry.sha === sha);
      if (!commit) return { valid: false, error: "The commit is not recorded for this ticket." };

      const projectId = state.projectOnboarding?.projectId;
      if (!projectId) return { valid: false, error: "The ticket is not linked to a project workspace." };
      const workspace = await ctx.projects.getPrimaryWorkspace(projectId, companyId);
      if (!workspace) return { valid: false, error: "The project has no primary workspace." };
      const repository = parseGitHubRepositoryUrl(workspace.repoUrl);
      if (!repository) return { valid: false, error: "The project workspace is not linked to a supported GitHub repository." };

      const config = await readConfig();
      const token = String(config.githubToken ?? "").trim();
      return fetchGitHubCommitChanges(repository, commit.sha, { token });
    });

    registerCompanyAction("startBacklogDiscovery", async () => {
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

      let commentError: string | null = null;
      try {
        await ctx.issues.createComment(
          onboarding.rootIssueId,
          "## Technical analysis approved\n\nA human approved the Technical Lead analysis and started Product Owner story discovery.",
          companyId
        );
      } catch (error) {
        commentError = String(error);
        ctx.logger.warn("Could not record technical analysis approval", {
          issueId: onboarding.rootIssueId,
          error: commentError,
        });
      }

      const wakeup = await requestIssueWakeup(onboarding.rootIssueId, "project_onboarding_backlog");
      return { started: true, projectOnboarding: state.projectOnboarding, wakeup, commentError };
    });

    registerCompanyAction("rejectTechnicalAnalysis", async (params) => {
      if (!companyId) return { rejected: false, error: "No company context." };

      const onboarding = state.projectOnboarding;
      if (!onboarding || onboarding.status !== "analysis_ready" || !onboarding.rootIssueId) {
        return {
          rejected: false,
          error: "Wait for a completed Technical Lead analysis before requesting changes.",
        };
      }

      const reason = typeof params.reason === "string" ? params.reason.trim() : "";
      if (!reason) {
        return { rejected: false, error: "Describe the requested analysis changes." };
      }

      const technicalLead = state.agents.find((agent) => agent.role === "technical_lead");
      if (!technicalLead) return { rejected: false, error: "The Technical Lead is not available." };

      try {
        await ctx.issues.createComment(
          onboarding.rootIssueId,
          [
            "## Technical analysis changes requested",
            "A human requested changes before Product Owner story discovery.",
            reason,
            TECHNICAL_ANALYSIS_CHANGES_REQUESTED_MARKER,
          ].join("\n\n"),
          companyId
        );
        await ctx.issues.update(
          onboarding.rootIssueId,
          { status: "todo", assigneeAgentId: technicalLead.id },
          companyId
        );
      } catch (error) {
        ctx.logger.warn("Could not return technical analysis for revision", {
          issueId: onboarding.rootIssueId,
          error: String(error),
        });
        return { rejected: false, error: String(error) };
      }

      state.projectOnboarding = transitionProjectOnboarding(onboarding, "analysis_in_progress");
      await save();
      const wakeup = await requestIssueWakeup(onboarding.rootIssueId, "project_onboarding_analysis_revision");
      return { rejected: true, projectOnboarding: state.projectOnboarding, wakeup };
    });

    registerCompanyAction("activateProjectOnboarding", async () => {
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

    registerCompanyAction("startProjectSprint", async () => {
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

    registerCompanyAction("resolveProductDecision", async (params) => {
      if (!companyId) return { resolved: false, error: "No company context." };

      const taskId = typeof params.taskId === "string" ? params.taskId : "";
      const onboarding = state.projectOnboarding;
      if (!taskId || !onboarding?.rootIssueId) {
        return { resolved: false, error: "Choose a project ticket with a pending product decision." };
      }

      try {
        const issue = await ctx.issues.get(taskId, companyId);
        if (!issue || !isProjectOnboardingChildIssue(issue)) {
          return { resolved: false, error: "This ticket is not part of the active project request." };
        }

        const comments = await ctx.issues.listComments(taskId, companyId);
        const decisionTexts = [issue.description ?? "", ...comments.map((comment) => comment.body)];
        const decisionRequired = decisionTexts.some((text) => text.includes(PRODUCT_DECISION_REQUIRED_MARKER));
        const decisionResolved = decisionTexts.some((text) => text.includes(PRODUCT_DECISION_RESOLVED_MARKER));
        if (!decisionRequired || decisionResolved) {
          return { resolved: false, error: "This ticket has no pending product decision." };
        }

        await ctx.issues.createComment(
          taskId,
          `## Human product decision approved\n\nA human approved the pending product decision from the Scrum Board.\n\n${PRODUCT_DECISION_RESOLVED_MARKER}`,
          companyId
        );
        await syncOnboardingIssue({ companyId, entityId: taskId });
        ctx.logger.info("Human product decision resolved", { issueId: taskId });
        return { resolved: true, error: null };
      } catch (error) {
        ctx.logger.warn("Could not resolve product decision from Scrum Board", {
          issueId: taskId,
          error: String(error),
        });
        return { resolved: false, error: String(error) };
      }
    });

    registerCompanyAction("approveScopeHold", async (params) => {
      if (!companyId) return { approved: false, error: "No company context." };

      const issueId = typeof params.issueId === "string" ? params.issueId : "";
      const onboarding = state.projectOnboarding;
      const hold = onboarding?.scopeHolds.find((candidate) => candidate.issueId === issueId);
      if (!issueId || !onboarding?.rootIssueId || !onboarding.projectId || !hold) {
        return { approved: false, error: "This ticket has no pending human scope approval." };
      }
      if (onboarding.status === "completed") {
        return {
          approved: false,
          error: "Project delivery is complete. Start a new project request before approving additional scope.",
        };
      }
      if (
        onboarding.status !== "backlog_in_progress" &&
        onboarding.status !== "sprint_planning" &&
        onboarding.status !== "active"
      ) {
        return {
          approved: false,
          error: "Wait for Technical Lead analysis and backlog discovery before approving additional scope.",
        };
      }

      try {
        const issue = await ctx.issues.get(issueId, companyId);
        if (!issue || issue.projectId !== onboarding.projectId) {
          return {
            approved: false,
            error: "Only tickets from the active Paperclip project can join this project request.",
          };
        }

        const approvedIssue = await ctx.issues.create({
          companyId,
          projectId: onboarding.projectId,
          parentId: onboarding.rootIssueId,
          title: issue.title,
          description: [
            issue.description?.trim(),
            `## Approved scope\n\nHuman-approved from held ticket ${issue.id}.`,
          ].filter(Boolean).join("\n\n"),
          status: "backlog",
        });
        await ctx.issues.createComment(
          approvedIssue.id,
          `## Human scope approved\n\nThis project ticket was created from held ticket ${issue.id} after human scope approval.`,
          companyId
        );
        await ctx.issues.update(
          issueId,
          { status: "cancelled", assigneeAgentId: null },
          companyId
        );
        await ctx.issues.createComment(
          issueId,
          `## Human scope approved\n\nA human approved this ticket as part of the active project request. Delivery now continues in project ticket ${approvedIssue.id}.`,
          companyId
        );
        state.projectOnboarding = {
          ...onboarding,
          scopeHolds: onboarding.scopeHolds.filter((candidate) => candidate.issueId !== issueId),
          updatedAt: new Date().toISOString(),
        };
        await syncOnboardingProjectIssues();
        await save();
        await requestProjectRefinement("automatic");
        ctx.logger.info("Human scope approval granted", {
          issueId,
          approvedIssueId: approvedIssue.id,
          rootIssueId: onboarding.rootIssueId,
        });
        return { approved: true, error: null, taskId: approvedIssue.id };
      } catch (error) {
        ctx.logger.warn("Could not approve project scope from Scrum Board", {
          issueId,
          error: String(error),
        });
        return { approved: false, error: String(error) };
      }
    });

    registerCompanyAction("startScopeHoldFollowUp", async (params) => {
      if (!companyId) return { started: false, error: "No company context." };

      const issueId = typeof params.issueId === "string" ? params.issueId : "";
      const onboarding = state.projectOnboarding;
      const hold = onboarding?.scopeHolds.find((candidate) => candidate.issueId === issueId);
      if (
        !issueId ||
        !onboarding?.projectId ||
        !onboarding.rootIssueId ||
        onboarding.status !== "completed" ||
        !hold ||
        !canStartProjectOnboarding()
      ) {
        return {
          started: false,
          error: "Finish the current project request before starting scope as a follow-up.",
        };
      }

      try {
        const project = await ctx.projects.get(onboarding.projectId, companyId);
        if (!project) return { started: false, error: "The Paperclip project is no longer available." };

        const workspace = await ctx.projects.getPrimaryWorkspace(project.id, companyId);
        if (!workspace) {
          return {
            started: false,
            error: "The follow-up project needs a primary workspace before technical analysis can start.",
          };
        }

        const technicalLead = state.agents.find((agent) => agent.role === "technical_lead");
        if (!technicalLead) return { started: false, error: "Activate the Scrum team before starting follow-up work." };

        const heldIssue = await ctx.issues.get(issueId, companyId);
        if (!heldIssue || heldIssue.projectId !== project.id) {
          return {
            started: false,
            error: "Only held tickets from this Paperclip project can start a follow-up request.",
          };
        }

        const requiresSprint = await projectSprintRequired();
        const brief = [
          `Human-approved follow-up scope: ${heldIssue.title}`,
          heldIssue.description?.trim(),
        ].filter(Boolean).join("\n\n");
        const constraints = `Follow-up created from held ticket ${heldIssue.id}.`;
        const provisionalOnboarding = startProjectOnboarding({
          input: { projectId: project.id, brief, constraints, skipSprintPlanning: false },
          projectName: project.name,
          rootIssueId: "pending",
          requiresSprint,
        });
        const rootIssue = await ctx.issues.create({
          companyId,
          projectId: project.id,
          title: `Kickoff: ${project.name} follow-up`,
          description: createTechnicalAnalysisPrompt(provisionalOnboarding),
          status: "todo",
          priority: "high",
          assigneeAgentId: technicalLead.id,
        });
        const followUpIssue = await ctx.issues.create({
          companyId,
          projectId: project.id,
          parentId: rootIssue.id,
          title: heldIssue.title,
          description: [
            heldIssue.description?.trim(),
            `## Human-approved follow-up\n\nCreated from held ticket ${heldIssue.id}.`,
          ].filter(Boolean).join("\n\n"),
          status: "backlog",
        });
        await ctx.issues.createComment(
          followUpIssue.id,
          `## Human scope approved\n\nThis follow-up ticket was created from held ticket ${heldIssue.id}.`,
          companyId
        );
        await ctx.issues.update(issueId, { status: "cancelled", assigneeAgentId: null }, companyId);
        await ctx.issues.createComment(
          issueId,
          `## Human scope approved as follow-up\n\nDelivery continues in new kickoff ${rootIssue.id} and project ticket ${followUpIssue.id}.`,
          companyId
        );

        const followUpOnboarding = startProjectOnboarding({
          input: { projectId: project.id, brief, constraints, skipSprintPlanning: false },
          projectName: project.name,
          rootIssueId: rootIssue.id,
          requiresSprint,
        });
        state.projectOnboarding = {
          ...followUpOnboarding,
          scopeHolds: onboarding.scopeHolds.filter((candidate) => candidate.issueId !== issueId),
        };
        await save();

        const wakeup = await requestIssueWakeup(rootIssue.id, "project_onboarding_analysis");
        ctx.logger.info("Human scope follow-up started", {
          heldIssueId: issueId,
          rootIssueId: rootIssue.id,
          followUpIssueId: followUpIssue.id,
          workspaceId: workspace.id,
          queued: wakeup.queued,
        });
        return {
          started: true,
          rootIssueId: rootIssue.id,
          followUpIssueId: followUpIssue.id,
          projectOnboarding: state.projectOnboarding,
          wakeup,
        };
      } catch (error) {
        ctx.logger.warn("Could not start scope follow-up from Scrum Board", {
          issueId,
          error: String(error),
        });
        return { started: false, error: String(error) };
      }
    });

    registerCompanyAction("moveTask", async (params) => {

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

    registerCompanyAction("reviewTicket", async (params) => {

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

    registerCompanyAction("runCeremony", async (params) => {

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

      const record = runCeremony(ceremony, true);
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
