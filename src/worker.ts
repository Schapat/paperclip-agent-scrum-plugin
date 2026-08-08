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

import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";

import type { CeremonyType, ScrumTask, TaskStatus, WorkerState } from "./core/types";
import { createDefaultSettings } from "./core/types";
import { createScrumTask } from "./core/factories";
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
import { collectInstructionUpdates, type InstructionUpdate } from "./core/learning";

/** Where the board lives in plugin state. */
const STATE_SCOPE = { scopeKind: "instance", stateKey: "board" } as const;

/**
 * Creates an empty board.
 */
function createEmptyState(): WorkerState {
  return {
    initialized: true,
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
     * Loads the board.
     *
     * Plugin state is not company-scoped, so this part is safe to do at
     * startup. Persisted state may come from an older plugin version and is
     * migrated — otherwise a missing array would throw on the first ceremony.
     */
    async function load(): Promise<void> {
      const stored = await ctx.state.get(STATE_SCOPE);
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
      if (scope && scope !== companyId) {
        companyId = scope;
        teamReady = false;
      }
      if (teamReady || !companyId) return;

      await reconcileTeam();
      teamReady = true;
    }

    async function save(): Promise<void> {
      await ctx.state.set(STATE_SCOPE, state);
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

      const team: WorkerState["agents"] = [];

      for (const declared of ctx.manifest.agents ?? []) {
        try {
          const resolution = await ctx.agents.managed.reconcile(declared.agentKey, companyId);
          const agent = resolution.agent;
          if (!agent || !resolution.agentId) continue;

          // Keep whatever the board already knew about this agent (current
          // ticket, status) so a reconcile does not reset live assignment.
          const existing = state.agents.find((a) => a.id === resolution.agentId);

          team.push({
            id: resolution.agentId,
            name: agent.name ?? declared.displayName,
            // The declared role is authoritative: assignment and ceremonies
            // match on it, and the host may store a different one.
            role: declared.role ?? agent.role ?? "developer",
            status: existing?.status ?? "idle",
            currentTaskId: existing?.currentTaskId ?? null,
            capabilities: existing?.capabilities ?? [],
            skills: existing?.skills,
          });
        } catch (error) {
          ctx.logger.warn("Could not reconcile managed agent", {
            agentKey: declared.agentKey,
            error: String(error),
          });
        }
      }

      if (team.length > 0) {
        state.agents = team;
        ctx.logger.info("Scrum team ready", {
          agents: team.length,
          roles: team.map((a) => a.role).join(", "),
        });
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

    // -------------------------------------------------------------------------
    // Host events → board
    // -------------------------------------------------------------------------

    ctx.events.on("issue.created", async (event) => {
      await ensureReady(event.companyId);
      await boardChanged();
    });

    ctx.events.on("issue.updated", async (event) => {
      await ensureReady(event.companyId);
      await boardChanged();
    });

    // -------------------------------------------------------------------------
    // Data the UI reads
    // -------------------------------------------------------------------------

    ctx.data.register("board", async (params) => {
      await ensureReady(params.companyId as string | undefined);
      return {
        tasks: state.tasks,
        agents: state.agents,
        currentSprint: state.currentSprint,
        metrics: state.metrics,
        ceremonies: state.ceremonies,
        settings: state.settings,
      };
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

    ctx.actions.register("moveTask", async (params, context) => {
      await ensureReady(context.companyId);

      const task = state.tasks.find((t) => t.id === params.taskId);
      if (!task) return { moved: false, error: "Unknown ticket" };

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

      const record = runCeremony(ceremony);
      await dispatchWork();
      await save();
      return { started: true, record };
    });

    await load();

    ctx.logger.info("Agent Scrum loaded", {
      tickets: state.tasks.length,
      skills: state.skills.length,
      note: "team is reconciled on the first company-scoped request",
    });
  },

  async onHealth() {
    return { status: "ok", message: "Agent Scrum worker is running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

export type { PluginContext };
