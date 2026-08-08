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
import {
  TEAM,
  describeReportingLine,
  detectReportingDrift,
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

    async function save(): Promise<void> {
      if (!companyId) return;
      await ctx.state.set(boardScope(companyId), state);
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
      const drift = detectReportingDrift(resolved);
      if (drift.length === 0) return;

      const applied = await applyReportingLine(resolved, drift);
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

        // `null` means the company lead, which the plugin does not own — it can
        // only clear a wrong superior, not point at the CEO.
        const superiorId = member.reportsTo ? resolved.get(member.reportsTo)?.agentId ?? null : null;

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
