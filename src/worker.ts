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
  type IssueComment,
  type ToolRunContext,
  type PluginContext,
  type PluginEvent,
} from "@paperclipai/plugin-sdk";

import {
  MANAGED_AGENT_INSTRUCTIONS,
  heartbeatAwareInstructions,
} from "./agent-instructions";
import manifest from "./manifest";
import type {
  CeremonyType,
  ProjectRefinementWait,
  ScrumTask,
  TaskStatus,
  TicketStall,
  WorkerState,
} from "./core/types";
import { createDefaultSettings } from "./core/types";
import { createCeremonyRecord, createId, createScrumTask } from "./core/factories";
import {
  canResetProjectWorkflow,
  canStartNewProjectOnboarding,
  canRouteDelivery,
  canRunAutomaticDelivery,
  createBacklogDiscoveryPrompt,
  createInitialProjectOnboarding,
  createProjectSprint,
  createTechnicalAnalysisPrompt,
  isPreDeliveryGate,
  isTechnicalAnalysisComplete,
  normalizeBranchName,
  parseProjectOnboardingInput,
  resetProjectOnboarding,
  startProjectOnboarding,
  suggestDeliveryBranch,
  TECHNICAL_ANALYSIS_CHANGES_REQUESTED_MARKER,
  transitionProjectOnboarding,
  type ProjectWorkflowResetTarget,
} from "./core/project-onboarding";
import {
  projectIssueDetailTask,
  syncProjectOnboardingIssue,
  syncTaskIdentifiers,
} from "./core/project-issue-sync";
import {
  REFINEMENT_MARKER,
  malformedMarkers,
  projectIssueProjection,
  projectProgress,
} from "./core/project-issue-projection";
import {
  fetchGitHubBranches,
  fetchGitHubCommitChanges,
  parseGitHubRepositoryUrl,
} from "./core/github-repository";
import {
  PRODUCT_DECISION_REQUIRED_MARKER,
  PRODUCT_DECISION_RESOLVED_MARKER,
  SPRINT_SCOPE_RESOLUTION_MARKER,
  hasQaReviewApproval,
  isQaReviewRejection,
  hasSprintScopeResolution,
  isPluginAuthoredNotice,
  reviewOwnerForProjectIssue,
} from "./core/review-routing";
import {
  GET_WATCHDOG_AGENDA_TOOL,
  SUBMIT_WATCHDOG_REPORT_TOOL,
  validateWatchdogReport,
  watchdogAgenda,
  watchdogReportSummary,
} from "./core/watchdog";
import {
  RECORD_COMMIT_TOOL,
  SUBMIT_FOR_REVIEW_TOOL,
  SUBMIT_QA_VERDICT_TOOL,
  SUBMIT_REFINEMENT_BATCH_TOOL,
  SUBMIT_REFINEMENT_TOOL,
  commitComment,
  qaVerdictComment,
  refinementComment,
  reviewSubmissionComment,
  validateCommit,
  validateRefinementBatch,
  validateReviewSubmission,
  validateQaVerdict,
  validateRefinement,
} from "./core/agent-tools";
import {
  LIVE_RUN_STALL_AFTER_MS,
  mergeStalls,
  liveRunsFromOrchestration,
  stallsFromOrchestration,
  timedOutRunsAwaitingRecovery,
  type OrchestrationSnapshot,
} from "./core/project-orchestration";
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
  pickAssignee,
  type AgentWorkRequest,
  type CeremonyContext,
} from "./core/ceremonies";
import { byBusinessValue, isReady } from "./core/ceremonies/types";
import {
  assignSkillsToAgent,
  collectInstructionUpdates,
  ensureLibrarySkills,
  type InstructionUpdate,
  type SkillSyncClient,
} from "./core/learning";
import {
  TEAM,
  describeReportingLine,
  detectReportingDrift,
  expectedSuperiorId,
  scrumRunTimeoutAdapterConfigPatch,
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
    timeoutRecoveries: {},
    stalls: [],
  };
}

/**
 * Zerlegt die deklarierte Faehigkeitsbeschreibung einer Rolle in Einzelbegriffe.
 *
 * `team.ts` beschreibt Faehigkeiten als Fliesstext ("Feature development, bug
 * fixing, unit tests, ..."). Die Zuweisung vergleicht Einzelbegriffe, also wird
 * hier genau einmal zerlegt statt an jeder Vergleichsstelle.
 */
function declaredCapabilities(description: string): string[] {
  return description
    .split(/[,;]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 1);
}

/**
 * Wie oft der Worker ein Refinement fuer dasselbe Ticket erneut anfordert,
 * bevor er es als menschliche Entscheidung meldet.
 */
const MAX_REFINEMENT_ATTEMPTS = 3;

/**
 * Wartezeit vor einem automatischen Refinement-Wiederanlauf.
 *
 * Ein Wiederanlauf ist nur dann eine Reparatur, wenn der vorherige Versuch
 * Gelegenheit hatte, zu liefern. Ohne diese Frist wuerde jedes eingehende
 * Host-Event denselben Auftrag erneut stellen.
 */
const REFINEMENT_RETRY_AFTER_MS = 15 * 60 * 1000;

/**
 * Wie lange die Branch-Liste wiederverwendet wird.
 *
 * Die Ansicht pollt alle 20 Sekunden; Branches entstehen nicht in dieser
 * Taktung, und jeder Abruf ist ein GitHub-Aufruf.
 */
const BRANCH_OPTIONS_TTL_MS = 2 * 60 * 1000;

/**
 * Der Auftrag, den ein Refinement-Weckruf mitbringt.
 *
 * `requestWakeup` uebertraegt nur einen Grund-Code. Das erwartete Ergebnis —
 * und vor allem sein exaktes Format — stand bisher ausschliesslich in der
 * statischen AGENTS.md zwischen mehreren konkurrierenden Regelbloecken. Das
 * Format ist aber die Bedingung dafuer, dass das Ticket ueberhaupt planbar
 * wird, also gehoert es an die Stelle, an der die Arbeit beauftragt wird.
 */
function refinementBriefComment(previousAttempts: number): string {
  const retryHint =
    previousAttempts > 0
      ? `\n\n**Hinweis:** Das ist Versuch ${previousAttempts + 1}. Ein vorheriger Lauf hat keinen gueltigen Marker hinterlassen — ohne ihn bleibt das Ticket ungeplant.`
      : "";

  return [
    "## Technical refinement requested",
    "Ergaenze dieses Ticket um Schaetzung, Akzeptanzkriterien, technische Hinweise und Risiken.",
    "Schliesse deinen Kommentar mit genau einem Marker ab. Er ist maschinenlesbar: ohne ihn wird das Ticket weder eingeplant noch zugewiesen.",
    '```html\n<!-- agent-scrum:refinement:v1 {"storyPoints":5,"acceptanceCriteria":["..."],"technicalNotes":"...","risks":[],"labels":["testing","documentation"]} -->\n```',
    "- `storyPoints`: Ganzzahl zwischen 1 und 100.\n- `acceptanceCriteria`: nicht-leere Liste pruefbarer Kriterien.\n- `labels`: optionale technische Domaenen des Tickets. Die Sprint-Planung waehlt darueber den passenden Developer aus; ohne Labels entscheidet allein die Auslastung.\n- Der Marker muss gueltiges JSON enthalten und von dir als Technical Lead stammen.",
  ].join("\n\n") + retryHint;
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
        // Eine Host-Invocation ist genau ein konsistenter Lesezeitpunkt. Der
        // Kommentar-Zwischenspeicher darf nie darueber hinaus gelten.
        beginSyncPass();
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

    /**
     * Darf der Mensch den ersten Sprint starten?
     *
     * Erst wenn das technische Refinement *abgeschlossen* ist — nicht schon,
     * wenn eine einzelne Story fertig ist. Vorher genuegte ein `some()`: der
     * Knopf stand bereit, waehrend der Technical Lead noch an den uebrigen
     * Stories arbeitete, und ein Sprintstart haette sie ungeschaetzt
     * zurueckgelassen.
     */
    function canStartProjectSprint(): boolean {
      const onboarding = state.projectOnboarding;
      if (onboarding?.status !== "sprint_planning" || !onboarding.rootIssueId) return false;

      const projectTasks = state.tasks.filter((task) => task.parentId === onboarding.rootIssueId);
      if (projectTasks.length === 0) return false;

      const everythingRefined = projectTasks.every((task) => task.refined);
      const hasPlannableWork = projectTasks.some(
        (task) => task.column === "backlog" && isReady(task)
      );
      return everythingRefined && hasPlannableWork;
    }

    /** Die Branch-Auswahl, die der Human vor dem Sprintstart trifft. */
    interface DeliveryBranchOptions {
      /** Aktuell gewaehlter Branch, sonst `null`. */
      selected: string | null;
      /** Vorschlag, solange nichts gewaehlt ist. */
      suggestion: string;
      /** Branches des verknuepften Repositories, aelteste Seite zuerst. */
      branches: string[];
      defaultBranch: string | null;
      /** Warum die Liste leer ist — ein leeres Dropdown erklaert sich sonst nicht. */
      error: string | null;
    }

    const branchOptionsCache = new Map<string, { at: number; value: DeliveryBranchOptions }>();

    /** Liefert die Branches eines Projekts, gedrosselt und pro Projekt gecacht. */
    async function branchOptionsForProject(
      projectId: string,
      selected: string | null,
      suggestion: string
    ): Promise<DeliveryBranchOptions> {
      const cached = branchOptionsCache.get(projectId);
      if (cached && Date.now() - cached.at < BRANCH_OPTIONS_TTL_MS) {
        return { ...cached.value, selected, suggestion };
      }

      const value = await loadDeliveryBranchOptions(projectId, selected, suggestion);
      branchOptionsCache.set(projectId, { at: Date.now(), value });
      return value;
    }

    /**
     * Liefert der Host einen lesbaren Orchestrierungs-Snapshot?
     *
     * Der Unterschied zwischen "kein Lauf" und "keine Information" entscheidet,
     * ob die Ansicht "no agent run" schreiben darf. Ohne ihn wuerde ein
     * fehlendes Recht als untaetiger Agent erscheinen.
     */
    let orchestrationReadable = false;

    /**
     * Liefert die waehlbaren Lieferbranches.
     *
     * Der GitHub-Aufruf haengt an einer Ansicht, die alle 20 Sekunden pollt —
     * deshalb ein kurzer Cache. Ohne verknuepftes Repository bleibt der
     * Vorschlag uebrig; eintippen kann der Human ihn immer.
     */
    async function deliveryBranchOptions(): Promise<DeliveryBranchOptions> {
      const onboarding = state.projectOnboarding;
      const selected = onboarding?.deliveryBranch ?? state.currentSprint?.deliveryBranch ?? null;
      const suggestion = onboarding
        ? suggestDeliveryBranch(onboarding, state.completedSprints.length + 1)
        : "feature/delivery-sprint-1";

      // Am Sprint-Gate stellt sich die Frage zuletzt. Fuer das Startformular
      // laedt die Ansicht die Branches gezielt zum gewaehlten Projekt — dort
      // steht das Projekt noch gar nicht im Onboarding.
      if (!companyId || onboarding?.status !== "sprint_planning" || !onboarding.projectId) {
        return { selected, suggestion, branches: [], defaultBranch: null, error: null };
      }

      return branchOptionsForProject(onboarding.projectId, selected, suggestion);
    }

    async function loadDeliveryBranchOptions(
      projectId: string,
      selected: string | null,
      suggestion: string
    ): Promise<DeliveryBranchOptions> {
      const empty = { selected, suggestion, branches: [], defaultBranch: null };
      if (!companyId) return { ...empty, error: null };

      try {
        const workspace = await ctx.projects.getPrimaryWorkspace(projectId, companyId);
        const repository = parseGitHubRepositoryUrl(workspace?.repoUrl);
        if (!repository) {
          return {
            ...empty,
            error: "The project workspace is not linked to a GitHub repository. Type the branch name instead.",
          };
        }

        const config = await readConfig();
        const result = await fetchGitHubBranches(repository, {
          token: String(config.githubToken ?? "").trim(),
        });
        if (!result.valid) return { ...empty, error: result.error };

        return {
          selected,
          suggestion,
          branches: result.branches,
          defaultBranch: result.defaultBranch,
          error: null,
        };
      } catch (error) {
        return { ...empty, error: `Could not read the project branches: ${String(error)}` };
      }
    }

    /**
     * Kommentare eines Issues innerhalb *eines* Durchlaufs.
     *
     * Ein einzelner Sync liess bis zu sechs `listComments` je Issue laufen —
     * fuenf Routing-Regeln plus die Projektion, jede mit eigenem Abruf. Bei
     * einem Board mit zwanzig Issues sind das 120 Host-Aufrufe fuer eine
     * Ansicht, die sich nicht geaendert hat.
     */
    let commentCache = new Map<string, IssueComment[]>();

    async function readComments(issueId: string): Promise<IssueComment[]> {
      if (!companyId) return [];

      const cached = commentCache.get(issueId);
      if (cached) return cached;

      const comments = await ctx.issues.listComments(issueId, companyId);
      commentCache.set(issueId, comments);
      return comments;
    }

    /** Nach jedem eigenen Kommentar ist der Zwischenspeicher fuer dieses Issue ueberholt. */
    function invalidateComments(issueId: string): void {
      commentCache.delete(issueId);
    }

    /** Schreibt einen Kommentar und haelt den Zwischenspeicher konsistent. */
    async function createIssueComment(
      issueId: string,
      body: string,
      scopeId: string,
      options?: { authorAgentId?: string }
    ): Promise<unknown> {
      const created = await ctx.issues.createComment(issueId, body, scopeId, options);
      invalidateComments(issueId);
      return created;
    }

    /** Beginnt einen neuen Durchlauf; der Zwischenspeicher gilt nie ueber Durchlaeufe hinweg. */
    function beginSyncPass(): void {
      commentCache = new Map();
    }

    /**
     * Haelt fest, dass ein Ticket nicht mehr weiterlaeuft.
     *
     * Der Unterschied zwischen "arbeitet noch" und "steht" war bisher nicht
     * darstellbar: ein abgestuerzter Agent-Run sah auf dem Board genauso aus
     * wie ein laufender. Beides ist `in_progress`.
     */
    function recordStall(taskId: string, reason: string, kind: TicketStall["kind"] = "wakeup_failed"): void {
      const stalls = (state.stalls ??= []);
      const existing = stalls.find((entry) => entry.taskId === taskId);
      if (existing && existing.reason === reason) return;

      const stall: TicketStall = {
        taskId,
        reason,
        kind,
        detectedAt: new Date().toISOString(),
        retriedAt: null,
      };
      if (existing) Object.assign(existing, stall);
      else stalls.push(stall);
    }

    /** Loescht den Stillstand, sobald sich das Ticket nachweislich wieder bewegt. */
    function clearStall(taskId: string): void {
      if (!state.stalls?.length) return;
      state.stalls = state.stalls.filter((entry) => entry.taskId !== taskId);
    }

    /**
     * Schutzschalter gegen selbstverstaerkende Schreibschleifen.
     *
     * Jede Notiz des Workers loest ein Host-Event aus, das ihn erneut aufruft.
     * Die fachlichen Idempotenz-Pruefungen sitzen an der jeweiligen Regel; das
     * hier ist die letzte Verteidigungslinie, damit ein kuenftiger Routing-
     * Fehler im Ticket des Nutzers nicht mehr als Kommentarflut ankommt.
     */
    const noticeBudget = new Map<string, { count: number; windowStart: number }>();
    const NOTICE_WINDOW_MS = 10 * 60 * 1000;
    const NOTICE_LIMIT_PER_WINDOW = 3;

    async function postIssueNotice(
      issueId: string,
      noticeKey: string,
      body: string
    ): Promise<boolean> {
      if (!companyId) return false;

      const budgetKey = `${issueId}:${noticeKey}`;
      const now = Date.now();
      const budget = noticeBudget.get(budgetKey);
      if (!budget || now - budget.windowStart > NOTICE_WINDOW_MS) {
        noticeBudget.set(budgetKey, { count: 1, windowStart: now });
      } else if (budget.count >= NOTICE_LIMIT_PER_WINDOW) {
        ctx.logger.error("Suppressed a repeating Agent Scrum notice", {
          issueId,
          noticeKey,
          count: budget.count,
          hint: "A routing rule is re-deciding the same question. This is a bug, not a state.",
        });
        return false;
      } else {
        budget.count += 1;
      }

      try {
        await createIssueComment(issueId, body, companyId);
        invalidateComments(issueId);
        return true;
      } catch (error) {
        ctx.logger.warn("Could not record an Agent Scrum notice", {
          issueId,
          noticeKey,
          error: String(error),
        });
        return false;
      }
    }

    /**
     * Weckt die zustaendige Rolle fuer ein Issue.
     *
     * Der Idempotenz-Schluessel traegt den Versuchszaehler: derselbe Grund tritt
     * im Lebenslauf eines Tickets mehrfach auf — ein Review nach einem Rework
     * ist ein neuer Weckruf, kein Duplikat des ersten. Ein konstanter Schluessel
     * laesst den zweiten Durchlauf still verschwinden.
     */
    const wakeupAttempts = new Map<string, number>();

    async function requestIssueWakeup(issueId: string, reason: string) {
      if (!companyId) return { queued: false, error: "No company context." };

      const attemptKey = `${issueId}:${reason}`;
      const attempt = (wakeupAttempts.get(attemptKey) ?? 0) + 1;
      wakeupAttempts.set(attemptKey, attempt);

      try {
        const wakeup = await ctx.issues.requestWakeup(issueId, companyId, {
          reason,
          contextSource: "agent-scrum.project-onboarding",
          idempotencyKey: `agent-scrum:${issueId}:${reason}:${attempt}`,
        });
        if (!wakeup.queued) {
          // `queued: false` heisst nicht "fehlgeschlagen". Der Host meldet es
          // auch, wenn fuer dieses Issue bereits ein Lauf eingereiht ist — der
          // haeufigste Fall, wenn der Worker kurz hintereinander weckt. Das als
          // Stillstand zu melden hat gesunde Boards Sekunden nach dem Start als
          // "blocked" ausgewiesen.
          ctx.logger.info("Issue wake-up was not queued; a run is likely already pending", {
            issueId,
            reason,
            attempt,
          });
        } else {
          clearStall(issueId);
        }
        return { queued: wakeup.queued, runId: wakeup.runId, error: null };
      } catch (error) {
        // Ein Weckruf, den der Host wegen einer offenen Abhaengigkeit ablehnt,
        // ist kein Stillstand, sondern die Lieferreihenfolge des Product
        // Owners. Das Refinement behandelt das laengst so; die Planung hat
        // daraus einen "blocked"-Header gemacht, der nach dem Blocker von
        // selbst verschwinden muesste — und es nie tat.
        if (String(error).includes("blocked by unresolved blockers")) {
          ctx.logger.info("Wake-up deferred until the blocking ticket is done", { issueId, reason });
          return { queued: false, error: null };
        }
        recordStall(issueId, `Wake-up "${reason}" failed: ${String(error)}`);
        ctx.logger.error("Could not queue project onboarding work", {
          issueId,
          reason,
          attempt,
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

    /** Runs the required sprint-close ceremonies before closing a delivered project request. */
    function closeDeliveredProjectSprint(projectTasks: ScrumTask[]): void {
      const sprint = state.currentSprint;
      if (!sprint) return;

      const projectTaskIds = new Set(projectTasks.map((task) => task.id));
      const sprintContainsProjectWork =
        sprint.taskIds.some((taskId) => projectTaskIds.has(taskId)) ||
        projectTasks.some((task) => task.sprintId === sprint.id);
      if (!sprintContainsProjectWork) return;

      const queuedWorkCount = pendingWork.length;
      const queuedInstructionCount = pendingInstructionUpdates.length;
      try {
        const hasReview = state.ceremonies.some(
          (ceremony) => ceremony.type === "sprint_review" && ceremony.sprintId === sprint.id
        );
        if (sprint.status === "active" && !hasReview) {
          runCeremony("sprint_review", false);
        }

        const currentSprint = state.currentSprint;
        if (!currentSprint || currentSprint.id !== sprint.id || currentSprint.status !== "completed") return;

        const hasRetrospective = state.ceremonies.some(
          (ceremony) => ceremony.type === "sprint_retrospective" && ceremony.sprintId === sprint.id
        );
        if (!hasRetrospective) {
          runCeremony("sprint_retrospective", false);
        }

        if (
          state.ceremonies.some(
            (ceremony) => ceremony.type === "sprint_retrospective" && ceremony.sprintId === sprint.id
          )
        ) {
          state.currentSprint = null;
        }
      } finally {
        // Review findings remain visible in state, but cannot autonomously create new scope.
        pendingWork.splice(queuedWorkCount);
        pendingInstructionUpdates.splice(queuedInstructionCount);
      }
    }

    /** Closes a human-requested project once every direct delivery story is done. */
    function completeProjectOnboardingIfDelivered(): boolean {
      const onboarding = state.projectOnboarding;
      if (
        !onboarding?.rootIssueId ||
        (onboarding.status !== "active" && onboarding.status !== "completed")
      ) {
        return false;
      }

      const projectTasks = state.tasks.filter((task) => task.parentId === onboarding.rootIssueId);
      if (projectTasks.length === 0 || projectTasks.some((task) => task.column !== "done")) return false;

      const previousSprintId = state.currentSprint?.id ?? null;
      closeDeliveredProjectSprint(projectTasks);
      const sprintClosed = previousSprintId !== null && state.currentSprint === null;
      if (onboarding.status === "completed") return sprintClosed;

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
          await createIssueComment(
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
        const comments = await readComments(issue.id);
        let route = reviewOwnerForProjectIssue(issue, comments);
        if (!route) return issue;

        if (
          route.reason === "product_decision" &&
          state.projectOnboarding?.status === "active" &&
          state.currentSprint?.status === "active"
        ) {
          // Genau einmal je offener Produktentscheidung. Der Kommentar loest
          // selbst ein `issue.comment.created` aus; ohne diese Pruefung
          // beantwortet der naechste Durchlauf dieselbe Frage erneut.
          if (!hasSprintScopeResolution(comments)) {
            await createIssueComment(
              issue.id,
              [
                "## Sprint scope already approved",
                "This decision is covered by the human-approved active sprint. QA continues with the approved ticket scope; no additional human approval is required.",
                SPRINT_SCOPE_RESOLUTION_MARKER,
                PRODUCT_DECISION_RESOLVED_MARKER,
              ].join("\n\n"),
              companyId
            );
          }
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
        const comments = await readComments(issue.id);
        const projection = projectIssueProjection({
          issueId: issue.id,
          description: issue.description ?? "",
          comments,
          agents: state.agents,
          voidedRefinementCommentIds: state.projectOnboarding?.refinementVoidedCommentIds,
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
            await createIssueComment(
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
            await createIssueComment(
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
          await createIssueComment(
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

    /** Restores a final QA approval that an older criteria projection left outside Done. */
    async function completeFinalQaProjectReview(issue: Issue): Promise<Issue> {
      if (
        !companyId ||
        !isProjectOnboardingChildIssue(issue) ||
        (issue.status !== "in_review" && issue.status !== "in_progress")
      ) {
        return issue;
      }

      const qa = state.agents.find((agent) => agent.role === "qa_engineer");
      if (!qa) return issue;

      try {
        const comments = await readComments(issue.id);
        if (!hasQaReviewApproval(comments, qa.id)) return issue;

        const projection = projectIssueProjection({
          issueId: issue.id,
          description: issue.description ?? "",
          comments,
          agents: state.agents,
          voidedRefinementCommentIds: state.projectOnboarding?.refinementVoidedCommentIds,
        });
        const hasCommitEvidence = projection.commits.length > 0;
        const criteriaVerified = projection.refinement.acceptanceCriteria.every((criterion) => criterion.met);
        if (!hasCommitEvidence || !criteriaVerified) return issue;

        const completed = await ctx.issues.update(
          issue.id,
          { status: "done", assigneeAgentId: qa.id },
          companyId
        );
        ctx.logger.info("Recovered final QA-approved project review", {
          issueId: completed.id,
          qaId: qa.id,
          criteriaCount: projection.refinement.acceptanceCriteria.length,
        });
        return completed;
      } catch (error) {
        ctx.logger.warn("Could not recover final QA-approved project review", {
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

      // "QA steht auf einem Ticket in `in_progress`" hiess bisher "QA hat
      // abgelehnt". Es heisst aber vor allem: der Host hat den Status fuer
      // *seinen eigenen* QA-Run gesetzt. Die Folge war auf jedem Ticket
      // dieselbe: 20 Sekunden nach der Uebergabe an QA nahm das Board ihr das
      // Ticket wieder weg, gab es einem Developer, und QA gab kurz darauf
      // trotzdem ihre Freigabe. Uebrig blieb ein "Rework"-Eintrag, aus dem die
      // Retrospektive Lehren zieht, die es nie gab.
      //
      // Eine Ablehnung ist etwas, das QA *schreibt*. Ohne diesen Beleg bleibt
      // das Ticket, wo es ist.
      const reviewComments = await readComments(issue.id);
      const rejected = reviewComments.some((comment) =>
        isQaReviewRejection(
          { authorAgentId: comment.authorAgentId ?? null, body: comment.body, createdAt: comment.createdAt },
          qa.id
        )
      );
      if (!rejected) return issue;

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
          await createIssueComment(
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

    /**
     * Holt Lieferarbeit zurueck, die vor der Sprintfreigabe begonnen wurde.
     *
     * Der Sprint ist die Freigabe des Humans, nicht eine Beschriftung. Ein
     * Agent kann sich trotzdem selbst ein Ticket greifen — ein Heartbeat-Run
     * hat genau das getan und ein frisch verfeinertes Ticket implementiert und
     * auf `done` gesetzt, waehrend das Board noch "Sprint planning" zeigte.
     * Alles, was dabei ausserhalb des Refinements passiert, gehoert unbesetzt
     * ins Backlog: die Commits bleiben im Ticket dokumentiert, geplant wird das
     * Ticket erst wieder mit dem Sprint.
     */
    async function returnPreSprintDeliveryToBacklog(issue: Issue): Promise<Issue> {
      const onboarding = state.projectOnboarding;
      if (!companyId || !isPreDeliveryGate(onboarding) || !isProjectOnboardingChildIssue(issue)) {
        return issue;
      }

      const technicalLeadId = state.agents.find((agent) => agent.role === "technical_lead")?.id ?? null;
      // Der Technical Lead *darf* vor dem Sprint an einem Ticket stehen: das
      // Refinement laeuft ueber genau diese Zuweisung.
      const isRefinementRun =
        technicalLeadId !== null &&
        issue.assigneeAgentId === technicalLeadId &&
        (issue.status === "todo" || issue.status === "in_progress");
      const startedDelivery =
        issue.status === "todo" ||
        issue.status === "in_progress" ||
        issue.status === "in_review" ||
        issue.status === "done";

      if (startedDelivery && !isRefinementRun) {
        try {
          const returned = await ctx.issues.update(
            issue.id,
            { status: "backlog", assigneeAgentId: null },
            companyId
          );
          // Ein stiller Rueckzug sieht fuer den Agenten wie ein verlorener Lauf
          // aus und wird beim naechsten Heartbeat wiederholt.
          await postIssueNotice(
            issue.id,
            "pre-sprint-delivery",
            [
              "## Delivery starts with the sprint",
              `Agent Scrum returned this ticket to the backlog: it was in \`${issue.status}\` before the human started the sprint.`,
              "Nothing here is lost — refinement, comments, and any recorded commits stay on the ticket. Sprint planning assigns a Developer once the human starts the sprint.",
              "Do not pick up project tickets without an assignment from the Scrum Board.",
            ].join("\n\n")
          );
          ctx.logger.warn("Returned pre-sprint delivery work to backlog", {
            issueId: returned.id,
            previousStatus: issue.status,
            previousAssignee: issue.assigneeAgentId ?? null,
          });
          return returned;
        } catch (error) {
          ctx.logger.warn("Could not return pre-sprint delivery work", {
            issueId: issue.id,
            error: String(error),
          });
          return issue;
        }
      }

      if (issue.status !== "blocked" || onboarding?.status !== "sprint_planning") return issue;

      const technicalLead = state.agents.find((agent) => agent.role === "technical_lead");
      if (!technicalLead || issue.assigneeAgentId !== technicalLead.id) return issue;

      try {
        const [comments, relations] = await Promise.all([
          readComments(issue.id),
          ctx.issues.relations.get(issue.id, companyId),
        ]);
        if (relations.blockedBy.length > 0) return issue;

        const projection = projectIssueProjection({
          issueId: issue.id,
          description: issue.description ?? "",
          comments,
          agents: state.agents,
          voidedRefinementCommentIds: state.projectOnboarding?.refinementVoidedCommentIds,
        });
        const refinement = projection.refinement;
        const readyForSprint =
          refinement.refined &&
          refinement.storyPoints > 0 &&
          refinement.acceptanceCriteria.length > 0;
        if (!readyForSprint) return issue;

        const returned = await ctx.issues.update(
          issue.id,
          { status: "backlog", assigneeAgentId: null },
          companyId
        );
        try {
          await createIssueComment(
            returned.id,
            "## Sprint planning recovery\n\nAgent Scrum returned this ready ticket to Backlog because it was blocked under the Technical Lead without a native issue blocker. The human can now start the sprint; sprint planning will assign an available Developer.",
            companyId
          );
        } catch (error) {
          ctx.logger.warn("Could not record sprint planning recovery", {
            issueId: returned.id,
            error: String(error),
          });
        }
        ctx.logger.warn("Recovered misassigned sprint planning issue", {
          issueId: returned.id,
          technicalLeadId: technicalLead.id,
        });
        return returned;
      } catch (error) {
        ctx.logger.warn("Could not recover misassigned sprint planning issue", {
          issueId: issue.id,
          error: String(error),
        });
        return issue;
      }
    }

    /** Returns a Technical Lead refinement task to the backlog after its marker is recorded. */
    async function returnRefinedTechnicalLeadIssueToBacklog(issue: Issue): Promise<Issue> {
      if (
        !companyId ||
        !isProjectOnboardingChildIssue(issue) ||
        (issue.status !== "todo" && issue.status !== "in_progress")
      ) {
        return issue;
      }

      const technicalLead = state.agents.find((agent) => agent.role === "technical_lead");
      if (!technicalLead || issue.assigneeAgentId !== technicalLead.id) return issue;

      try {
        const comments = await readComments(issue.id);
        const projection = projectIssueProjection({
          issueId: issue.id,
          description: issue.description ?? "",
          comments,
          agents: state.agents,
          voidedRefinementCommentIds: state.projectOnboarding?.refinementVoidedCommentIds,
        });
        if (!projection.refinement.refined) {
          // Ein vorhandener, aber unlesbarer Marker ist eine andere Lage als
          // gar kein Marker: der Agent hat geliefert, nur nicht verwertbar.
          const broken = comments.flatMap((comment) =>
            malformedMarkers(comment.body, REFINEMENT_MARKER)
          );
          if (broken.length > 0) {
            recordStall(
              issue.id,
              "The refinement marker is present but not valid JSON.",
              "refinement_invalid"
            );
            await postIssueNotice(
              issue.id,
              "refinement-malformed",
              [
                "## Technical refinement requested",
                "Der letzte Refinement-Marker liess sich nicht lesen — er enthaelt kein gueltiges JSON. Das Ticket bleibt dadurch ungeplant.",
                "Bitte den Marker erneut anhaengen, diesmal als eine einzige gueltige JSON-Zeile:",
                '```html\n<!-- agent-scrum:refinement:v1 {"storyPoints":5,"acceptanceCriteria":["..."],"technicalNotes":null,"risks":[]} -->\n```',
              ].join("\n\n")
            );
            await save();
          }
          return issue;
        }

        // Die Schaetzung ist da. Ein Vermerk "es fehlt eine Schaetzung" gilt
        // damit nicht mehr — auch wenn der Marker als Kommentar kam statt
        // durch das Tool, das ihn sonst zuruecknimmt.
        clearStall(issue.id);
        const returned = await ctx.issues.update(
          issue.id,
          { status: "backlog", assigneeAgentId: null },
          companyId
        );
        ctx.logger.info("Project refinement completed", {
          issueId: returned.id,
          technicalLeadId: technicalLead.id,
        });
        return returned;
      } catch (error) {
        ctx.logger.warn("Could not return refined project issue to backlog", {
          issueId: issue.id,
          error: String(error),
        });
        return issue;
      }
    }

    /**
     * Fuehrt ein Host-Issue durch die Weiterleitungen, die zu seiner Phase passen.
     *
     * Die Kette lief bisher bei jedem Issue-Event ungeprueft — inklusive der
     * Regel "ein `done` ohne Commit-Nachweis geht mit Developer zurueck nach
     * Development". Vor dem Sprintstart hat genau diese Regel die Lieferung
     * gestartet, die das Sprint-Gate verhindern sollte. Sie gilt jetzt nur noch
     * fuer freigegebene Lieferung; davor greift ausschliesslich die Rueckholung.
     */
    /**
     * Nimmt zurueck, was der Scrum Master an einem Lieferticket veraendert hat.
     *
     * Der Scrum Master ist der einzige zeitgesteuerte Watchdog: er laeuft alle
     * 30 Minuten, auch wenn ihm nichts zugewiesen ist. Genau dabei hat er ein
     * frisch verfeinertes Ticket ausgecheckt, implementiert und auf `done`
     * gesetzt — waehrend das Board noch "Sprint planning" zeigte.
     *
     * Seine Instruktion verbietet das bereits ("beanspruche keine
     * Delivery-Arbeit"), aber eine Prosaregel ist keine Durchsetzung. Der
     * Rueckbau haengt deshalb am Urheber, nicht an der Phase: auch im laufenden
     * Sprint gehoert ein Ticket dem zugewiesenen Developer, nicht dem
     * Watchdog. Rueckfallpunkt ist der zuletzt gespiegelte Board-Zustand — er
     * ist noch nicht ueberschrieben, weil die Spiegelung erst nach dem Routing
     * laeuft.
     */
    async function revertScrumMasterDeliveryClaim(
      issue: Issue,
      actorId: string | null
    ): Promise<Issue> {
      if (!companyId || !isProjectOnboardingChildIssue(issue)) return issue;

      const scrumMaster = state.agents.find((agent) => agent.role === "scrum_master");
      const technicalLead = state.agents.find((agent) => agent.role === "technical_lead");
      const productOwner = state.agents.find((agent) => agent.role === "product_owner");

      // Zwei Spuren: die Rolle hat das Ticket geaendert, oder sie steht als
      // Bearbeiter darauf. Die zweite faengt auch den Fall ab, in dem der
      // Worker das Ereignis verpasst hat und es erst beim Abgleich sieht.
      const claimedBy = (agent: WorkerState["agents"][number] | undefined) =>
        Boolean(agent && (actorId === agent.id || issue.assigneeAgentId === agent.id));

      // Der Scrum Master liefert ueberhaupt nicht — er ist Prozessbeobachter.
      // Technical Lead und Product Owner duerfen ein Ticket sehr wohl halten:
      // fuer Refinement bzw. Story-Arbeit. Was sie nicht duerfen, ist es
      // fertigmelden. Genau das ist passiert — der Technical Lead hat sein
      // Refinement-Ticket gleich implementiert und auf `done` gesetzt.
      const deliveredStatus = issue.status === "done" || issue.status === "in_review";
      const claimingAgent = claimedBy(scrumMaster)
        ? scrumMaster
        : deliveredStatus && claimedBy(technicalLead)
          ? technicalLead
          : deliveredStatus && claimedBy(productOwner)
            ? productOwner
            : null;
      if (!claimingAgent) return issue;

      const known = state.tasks.find((task) => task.id === issue.id);
      const previousColumn = known?.column ?? "backlog";
      const previousAssignee =
        known?.assignedAgentId && known.assignedAgentId !== claimingAgent.id
          ? known.assignedAgentId
          : null;
      // Ein Kommentar des Scrum Masters ist erlaubt und aendert nichts.
      if (issue.status === previousColumn && issue.assigneeAgentId === previousAssignee) {
        return issue;
      }

      try {
        const restored = await ctx.issues.update(
          issue.id,
          { status: previousColumn, assigneeAgentId: previousAssignee },
          companyId
        );
        await postIssueNotice(
          issue.id,
          "non-delivery-role-claim",
          [
            `## The ${claimingAgent.name} does not deliver`,
            `Agent Scrum reverted this ticket to \`${previousColumn}\`: it was moved or claimed by a role that does not deliver tickets.`,
            "Refinement, process facilitation, and story work stop short of implementation. A delivery ticket is finished by its assigned Developer and closed by QA.",
          ].join("\n\n")
        );
        ctx.logger.warn("Reverted a delivery claim by a non-delivery role", {
          issueId: issue.id,
          role: claimingAgent.role,
          claimedStatus: issue.status,
          restoredStatus: previousColumn,
          restoredAssignee: previousAssignee,
        });
        return restored;
      } catch (error) {
        ctx.logger.warn("Could not revert the delivery claim", {
          issueId: issue.id,
          error: String(error),
        });
        return issue;
      }
    }

    async function routeProjectIssue(issue: Issue, actorId: string | null): Promise<Issue> {
      // Zuerst, in jeder Phase: der Watchdog liefert nicht. Stuende diese
      // Pruefung weiter unten, haette das Commit-Nachweis-Gate den vom Scrum
      // Master auf `done` gesetzten Ticket schon einen Developer zugewiesen.
      const owned = await revertScrumMasterDeliveryClaim(issue, actorId);

      if (!canRouteDelivery(state.projectOnboarding)) {
        // Das Refinement laeuft auch vor dem Sprint — es ist die Vorbedingung
        // dafuer, dass der Human ihn ueberhaupt starten kann.
        const refined = await returnRefinedTechnicalLeadIssueToBacklog(owned);
        return returnPreSprintDeliveryToBacklog(refined);
      }

      let current = await routeProjectCompletionToQa(owned, actorId);
      current = await completeFinalQaProjectReview(current);
      current = await routeProjectReworkToDeveloper(current);
      current = await returnRefinedTechnicalLeadIssueToBacklog(current);
      current = await returnPreSprintDeliveryToBacklog(current);
      return routeProjectReview(current);
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

          // Nur den Status zu setzen hinterlaesst ein herrenloses TODO: es hat
          // niemanden, den der Worker wecken koennte. Die Zuweisung uebernimmt
          // die Planung direkt im Anschluss.
          const todo = await ctx.issues.update(issue.id, { status: "todo" }, companyId);
          try {
            await createIssueComment(
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
          // Direkt weiterreichen: ein freigegebenes Ticket ohne Assignee waere
          // sonst genau das herrenlose TODO, das den Fluss anhaelt.
          await requestProjectPlanning();
        }
      } catch (error) {
        ctx.logger.warn("Could not resolve project blockers", { error: String(error) });
      }
    }

    function refinementCandidates(): ScrumTask[] {
      const rootIssueId = state.projectOnboarding?.rootIssueId;
      if (!rootIssueId) return [];

      const technicalLeadId = state.agents.find(
        (agent) => agent.role === "technical_lead"
      )?.id;

      return state.tasks.filter(
        (task) =>
          task.parentId === rootIssueId &&
          !task.refined &&
          (
            (task.column === "backlog" && task.assignedAgentId === null) ||
            ((task.column === "todo" || task.column === "in_progress") &&
              task.assignedAgentId === technicalLeadId)
          )
      );
    }

    /**
     * Laeuft fuer dieses Ticket ein Run, der sein Zeitbudget noch einhaelt?
     *
     * Der Host meldet einen abgestuerzten Run weiter als "running". Genau
     * dafuer gibt es `LIVE_RUN_STALL_AFTER_MS`: danach ist er ein Stillstand
     * und darf keine Anfrage mehr aufhalten.
     */
    function isRunningWithinBudget(taskId: string): boolean {
      const run = state.liveRuns?.find((entry) => entry.taskId === taskId);
      if (!run) return false;

      const startedAt = Date.parse(run.startedAt);
      if (!Number.isFinite(startedAt)) return false;
      return Date.now() - startedAt < LIVE_RUN_STALL_AFTER_MS;
    }

    interface DeferredRefinement {
      task: ScrumTask;
      blockedBy: string[];
    }

    /**
     * Trennt Refinement-Kandidaten nach dem, was der Host zulaesst.
     *
     * Der Product Owner verknuepft Stories mit Abhaengigkeiten. Ein Weckruf auf
     * ein blockiertes Issue lehnt der Host mit "Issue is blocked by unresolved
     * blockers" ab. Die Abhaengigkeit ist aber eine *Liefer*reihenfolge — eine
     * Schaetzung braucht sie nicht. Blockierte Tickets fallen deshalb nicht
     * mehr stillschweigend heraus, sondern reisen als Zusatzauftrag auf dem
     * Weckruf eines freien Tickets mit.
     */
    async function partitionRefinementCandidates(
      tasks: ScrumTask[]
    ): Promise<{ open: ScrumTask[]; deferred: DeferredRefinement[] }> {
      const deferred: DeferredRefinement[] = [];
      if (!companyId || tasks.length === 0) return { open: tasks, deferred };

      const open: ScrumTask[] = [];
      for (const task of tasks) {
        try {
          const relations = await ctx.issues.relations.get(task.id, companyId);
          const blockers = relations.blockedBy.filter((blocker) => blocker.status !== "done");
          if (blockers.length > 0) {
            deferred.push({
              task,
              blockedBy: blockers.map((blocker) => blocker.identifier ?? blocker.title),
            });
            // Auf eine Abhaengigkeit zu warten ist kein Stillstand, sondern
            // Reihenfolge. Ein frueher vermerkter Weckruf-Fehler an diesem
            // Ticket war genau dieser Fall und wird zurueckgenommen.
            clearStall(task.id);
            continue;
          }
        } catch (error) {
          ctx.logger.warn("Could not read blocker relations; refining anyway", {
            issueId: task.id,
            error: String(error),
          });
        }
        open.push(task);
      }
      return { open, deferred };
    }

    /**
     * Haelt fest, welche Tickets hinter welchem Blocker auf ihr Refinement
     * warten — und ob ein anderer Weckruf sie mitnimmt.
     */
    function recordRefinementWaits(
      deferred: DeferredRefinement[],
      carrierTaskId: string | null
    ): boolean {
      const onboarding = state.projectOnboarding;
      if (!onboarding) return false;

      const previous = onboarding.refinementWaits ?? [];
      const now = new Date().toISOString();
      const waits: ProjectRefinementWait[] = deferred.map(({ task, blockedBy }) => ({
        taskId: task.id,
        blockedBy,
        carriedBy: carrierTaskId,
        // Die Wartezeit gehoert dem Ticket, nicht dem Durchlauf: sonst stuende
        // im Header nach jeder Auswertung wieder "seit weniger als einer Minute".
        since: previous.find((entry) => entry.taskId === task.id)?.since ?? now,
      }));

      if (JSON.stringify(waits) === JSON.stringify(previous)) return false;

      state.projectOnboarding = { ...onboarding, refinementWaits: waits, updatedAt: now };
      return true;
    }

    /** Gibt dem einzelnen Technical-Lead-Run seinen vollstaendigen Refinement-Batch. */
    function batchRefinementBrief(tasks: ScrumTask[], deferred: DeferredRefinement[]): string {
      const entries = [
        ...tasks.map((task) => ({ task, blockedBy: [] as string[] })),
        ...deferred,
      ];
      const lines = entries.map(({ task, blockedBy }) => {
        const label = task.identifier ?? task.title;
        const dependency = blockedBy.length > 0
          ? ` (Lieferreihenfolge: ${blockedBy.join(", ")})`
          : "";
        return `- **${label}** (\`${task.id}\`) — ${task.title}${dependency}`;
      });

      return [
        "### Vollstaendiger Refinement-Batch",
        "Schliesse jedes der folgenden Tickets in diesem einen Run ab. Rufe genau einmal `submit_refinement_batch` auf und uebergib darin jede exakte `issueId` mit einer Schaetzung und mindestens einem pruefbaren Akzeptanzkriterium. Ein unvollstaendiger Batch wird abgelehnt.",
        lines.join("\n"),
        "Aendere weder Status noch Zuweisung eines Tickets; der Plugin-Worker fuehrt gueltig verfeinerte Tickets anschliessend ins Backlog zurueck.",
      ].join("\n\n");
    }

    function reconcileProjectRefinementRequests(): boolean {
      const onboarding = state.projectOnboarding;
      if (!onboarding) return false;

      const candidates = new Set(refinementCandidates().map((task) => task.id));
      const requested = onboarding.refinementRequestedTaskIds ?? [];
      const restartRemainingBatch =
        !refinementBatchSubmissionInFlight &&
        requested.some((taskId) => state.tasks.some((task) => task.id === taskId && task.refined));
      const next = restartRemainingBatch ? [] : requested.filter((taskId) => candidates.has(taskId));
      // Ein verfeinertes Ticket wartet auf nichts mehr. Ohne diese Bereinigung
      // meldete der Header die Wartelage weiter, obwohl die Schaetzung laengst
      // im Ticket steht.
      const waits = onboarding.refinementWaits ?? [];
      const nextWaits = waits.filter((wait) => candidates.has(wait.taskId));
      if (next.length === requested.length && nextWaits.length === waits.length) return false;

      state.projectOnboarding = {
        ...onboarding,
        refinementRequestedTaskIds: next,
        refinementWaits: nextWaits,
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
    let refinementBatchSubmissionInFlight = false;
    /**
     * True, solange die Refinement-Routine auf diesem Aufrufpfad laeuft.
     *
     * Die Routine schreibt ins Ticket, das Schreiben erzeugt ein Host-Event,
     * und der Event-Handler fordert seinerseits ein Refinement an. Ohne diese
     * Markierung wuerde er die laufende Promise zurueckbekommen — also auf sich
     * selbst warten.
     */
    let refinementRunning = false;

    async function requestProjectRefinement(
      source: "automatic" | "manual" = "manual",
      force = false
    ): Promise<ProjectRefinementResult> {
      if (refinementRunning) {
        return { requested: false, error: "Refinement is already running.", taskIds: [] };
      }
      if (projectRefinementPromise) return projectRefinementPromise;

      refinementRunning = true;
      const refinement = requestProjectRefinementInternal(source, force);
      projectRefinementPromise = refinement;
      try {
        return await refinement;
      } finally {
        projectRefinementPromise = null;
        refinementRunning = false;
      }
    }

    async function requestProjectRefinementInternal(
      source: "automatic" | "manual" = "manual",
      force = false
    ): Promise<ProjectRefinementResult> {
      if (!companyId) return { requested: false, error: "No company context.", taskIds: [] as string[] };
      const refinementCompanyId = companyId;

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

      const attempts = new Map(
        (onboarding.refinementAttempts ?? []).map((entry) => [entry.taskId, entry])
      );
      const requestedTaskIds = new Set(onboarding.refinementRequestedTaskIds ?? []);

      const { open: candidates, deferred } = await partitionRefinementCandidates(
        refinementCandidates()
      );

      // Erschoepfte Tickets werden gemeldet, nicht verschwiegen. Der Technical
      // Lead liefert hier dauerhaft kein verwertbares Refinement; das ist eine
      // menschliche Entscheidung, kein Zustand zum Aussitzen.
      for (const task of candidates) {
        const attempt = attempts.get(task.id);
        if (!attempt || attempt.attempts < MAX_REFINEMENT_ATTEMPTS) continue;
        if (state.stalls?.some((entry) => entry.taskId === task.id)) continue;

        recordStall(
          task.id,
          `The Technical Lead did not produce a valid refinement marker in ${attempt.attempts} attempts.`,
          "refinement_invalid"
        );
        await postIssueNotice(
          task.id,
          "refinement-exhausted",
          [
            "## Refinement needs a human decision",
            `Agent Scrum requested a technical refinement ${attempt.attempts} times without receiving a valid \`agent-scrum:refinement:v1\` marker.`,
            "This ticket stays out of sprint planning until it is refined. Add the estimate and acceptance criteria by hand, or retry refinement from the Scrum Board.",
          ].join("\n\n")
        );
      }
      const taskIds = candidates
        .filter((task) => {
          // Ein laufender Run ist das staerkste "frag nicht nochmal": ein
          // zweiter Weckruf ueberholt ihn, und der Technical Lead faengt von
          // vorne an. Genau so hat ein Ticket sechs Anlaeufe verbraucht, ohne
          // je fertig zu werden — im Minutentakt des Reconcile-Jobs.
          //
          // Nur zaehlt "laufend" nicht unbegrenzt: ein Run jenseits seines
          // Zeitbudgets ist ein Stillstand, kein Fortschritt. Ohne diese Frist
          // haette die Bremse aus einem haengenden Run eine Dauersperre
          // gemacht — dieselbe Sorte Deadlock, gegen die sie gebaut ist.
          if (isRunningWithinBudget(task.id)) return false;

          // Der Deckel gehoert vor die Gedaechtnispruefung. Stand er dahinter,
          // liess ihn jedes Leeren der Anfrageliste ins Leere laufen: das
          // Ticket galt als "noch nie gefragt" und wurde erneut gefragt,
          // waehrend der Zaehler weiterlief.
          const attempt = attempts.get(task.id);
          if (!force && attempt && attempt.attempts >= MAX_REFINEMENT_ATTEMPTS) return false;

          if (force) return true;
          if (!requestedTaskIds.has(task.id)) return true;

          // Ein Wiederanlauf ist erlaubt, sobald der vorherige Versuch
          // erkennbar nichts geliefert hat — entweder weil er gescheitert ist
          // oder weil die Frist verstrichen ist. Bisher war jedes Ticket nach
          // genau einem Versuch endgueltig verloren.
          if (!attempt) return false;

          const failedRun = state.stalls?.some(
            (entry) => entry.taskId === task.id && entry.kind === "run_failed"
          );
          if (failedRun) return true;

          const waitedFor = Date.now() - Date.parse(attempt.lastRequestedAt);
          return Number.isFinite(waitedFor) && waitedFor >= REFINEMENT_RETRY_AFTER_MS;
        })
        .map((task) => task.id);
      // Eine Kette blockierter Tickets hat keinen freien Traeger. Genau so
      // entsteht der Stillstand: der Product Owner reiht die Stories der Reihe
      // nach auf, das erste Ticket wird verfeinert — und die uebrigen warten
      // auf ein `done`, das ohne Sprint nie kommt, waehrend der Sprint auf ihre
      // Schaetzung wartet. Der Kickoff ist nie blockiert und traegt den Batch
      // deshalb, wenn sonst niemand kann.
      const carrierTaskId = taskIds[0] ?? (deferred.length > 0 ? rootIssueId : null);
      if (carrierTaskId === null) {
        // Auch ohne freies Ticket bleibt die Wartelage eine Tatsache: ohne
        // diesen Vermerk behauptet der Header weiter, jemand verfeinere gerade.
        const waitsChanged = recordRefinementWaits(deferred, null);
        if (requestStateChanged || waitsChanged) await save();
        return { requested: false, error: "No project tickets need technical refinement.", taskIds };
      }
      const carrierIsKickoff = carrierTaskId === rootIssueId;

      try {
        // Der Technical Lead darf nur einen Run gleichzeitig ausfuehren. Ein
        // Carrier vermeidet eine Host-Warteschlange und gibt dem einen Run alle
        // offenen Stories samt ihrer exakten Tool-IDs mit.
        // Ein neu aufgetauchtes Ticket ist auch der Anlass, noch unverfeinerte
        // Tickets aus einer frueheren Einzelwarteschlange mitzunehmen. So
        // erholt ein bereits vor dem Batch-Fix gestartetes Feature sofort,
        // statt bis zum zeitbasierten Retry zu warten.
        const batchTasks = carrierIsKickoff ? [] : candidates;
        const carriedTaskIds = deferred.map((entry) => entry.task.id);
        const batchTaskIds = [...batchTasks.map((task) => task.id), ...carriedTaskIds];
        // Der Kickoff traegt den Auftrag nur; er wird nicht Teil des Batches
        // und bleibt fuer die Lieferkette unberuehrt.
        await ctx.issues.update(
          carrierTaskId,
          { status: "todo", assigneeAgentId: technicalLead.id },
          refinementCompanyId
        );
        // Der Weckruf traegt nur einen Grund-Code. Das erwartete Ergebnis
        // gehoert ins Carrier-Ticket, sonst muss der Agent es aus 12 KB
        // Instruktionen erraten — und genau daran scheitert der Batch.
        const brief = refinementBriefComment(attempts.get(carrierTaskId)?.attempts ?? 0);
        const kickoffNote = carrierIsKickoff
          ? "\n\nJedes Ticket dieses Batches ist durch eine Lieferreihenfolge blockiert und laesst sich nicht einzeln wecken. Der Auftrag steht deshalb hier am Kickoff. Verfeinere die genannten Tickets; an diesem Kickoff-Issue selbst aenderst du nichts."
          : "";
        const briefPosted = await postIssueNotice(
          carrierTaskId,
          "refinement-brief",
          `${brief}\n\n${batchRefinementBrief(batchTasks, deferred)}${kickoffNote}`
        );
        // Ohne zugestellten Auftrag ist der Weckruf schaedlich: der Technical
        // Lead startet, findet die erwartete Batch-Liste nicht im Ticket,
        // liefert keinen gueltigen Marker — und das zaehlt ihm als
        // Fehlversuch. Die Notizbremse hatte den Auftrag unterdrueckt, der
        // Weckruf ging trotzdem raus.
        if (!briefPosted) {
          ctx.logger.warn("Skipped a refinement wake-up because its brief was suppressed", {
            issueId: carrierTaskId,
            taskIds: batchTaskIds,
          });
          if (requestStateChanged) await save();
          return {
            requested: false,
            error: "The refinement brief could not be posted; waking the Technical Lead without it would only burn an attempt.",
            taskIds,
          };
        }
        const wakeup = await requestIssueWakeup(carrierTaskId, "project_refinement");
        if (!wakeup.queued) {
          throw new Error(wakeup.error ?? "Could not queue project refinement.");
        }
        const now = new Date().toISOString();
        for (const taskId of batchTaskIds) {
          const previous = attempts.get(taskId);
          attempts.set(taskId, {
            taskId,
            attempts: (previous?.attempts ?? 0) + 1,
            lastRequestedAt: now,
          });
        }
        state.projectOnboarding = {
          ...onboarding,
          refinementRequestedTaskIds: [...new Set([...requestedTaskIds, ...batchTaskIds])],
          refinementAttempts: [...attempts.values()],
          updatedAt: now,
        };
        recordRefinementWaits(deferred, carrierTaskId);
        state.ceremonies.push(
          createCeremonyRecord(
            "backlog_refinement",
            state.currentSprint?.id ?? null,
            carriedTaskIds.length > 0
              ? `Paperclip batch refinement requested for ${batchTaskIds.length} ticket(s); ${carriedTaskIds.length} delivery-blocked ticket(s) are included.`
              : `Paperclip batch refinement requested for ${batchTaskIds.length} ticket(s).`,
            { taskIds: batchTaskIds }
          )
        );
        await save();
        ctx.logger.info("Project refinement requested", {
          taskIds: batchTaskIds,
          carrierTaskId,
          carriedTaskIds,
          technicalLeadId: technicalLead.id,
          source,
        });
        return { requested: true, error: null, taskIds: batchTaskIds };
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
      const technicalLeadId = state.agents.find((agent) => agent.role === "technical_lead")?.id;

      // Bewusst kein "es liegt schon etwas in TODO"-Abbruch mehr. Die Kapazitaet
      // regeln `todoSlots` und die freien Entwicklerplaetze; der zusaetzliche
      // Wachposten hat ein *unzugewiesenes* TODO wie laufende Arbeit behandelt
      // und damit die Planung dauerhaft angehalten — das Ticket bekam nie einen
      // Assignee, und ohne Assignee weckt der Worker niemanden.
      const currentTodo = state.tasks.filter(
        (task) => task.column === "todo" && task.assignedAgentId !== technicalLeadId
      ).length;
      const todoSlots = Math.max(0, state.settings.wipLimits.todo - currentTodo);
      if (todoSlots === 0) return;

      // Kapazitaet folgt `wipLimitDevelopment`. Ein Ticket in `in_review` wartet
      // auf QA und belegt den Entwickler nicht — es als Auslastung zu zaehlen
      // hat die Einstellung wirkungslos gemacht.
      const developerLimit = state.settings.wipLimits.development;
      const availableDevelopers = state.agents.flatMap((agent) => {
        if (agent.role !== "developer") return [];

        const activeLoad = state.tasks.filter(
          (task) =>
            task.assignedAgentId === agent.id &&
            (task.column === "todo" || task.column === "in_progress")
        ).length;
        const freeSlots = Math.max(0, developerLimit - activeLoad);
        return Array.from({ length: freeSlots }, () => agent);
      });
      // Ein Ticket in TODO *ohne* Assignee ist herrenlos: der Blocker-Release
      // setzt nur den Status, die Zuweisung fehlt. Solche Tickets werden hier
      // uebernommen — sonst wartet das Board auf einen Agenten, den es nie
      // benannt hat.
      const orphanedTodo = state.tasks.filter(
        (task) =>
          task.parentId === rootIssueId &&
          task.column === "todo" &&
          task.assignedAgentId === null &&
          isReady(task)
      );
      const readyBacklog = state.tasks
        .filter(
          (task) => task.parentId === rootIssueId && task.column === "backlog" && isReady(task)
        )
        .sort(byBusinessValue);
      const planned = [...orphanedTodo, ...readyBacklog].slice(
        0,
        Math.min(todoSlots + orphanedTodo.length, availableDevelopers.length)
      );
      if (planned.length === 0) return;

      const productOwner = state.agents.find((agent) => agent.role === "product_owner");
      const plannedTaskIds: string[] = [];
      // Reihum zu verteilen ignoriert, was der Technical Lead ueber das Ticket
      // weiss. `pickAssignee` wertet Labels gegen Faehigkeiten und faellt bei
      // Gleichstand auf die geringste Auslastung zurueck.
      const remainingDevelopers = [...availableDevelopers];

      for (const task of planned) {
        const candidate = pickAssignee(task, remainingDevelopers, state);
        const developer = candidate?.agent ?? remainingDevelopers[0];
        if (!developer) break;
        remainingDevelopers.splice(remainingDevelopers.indexOf(developer), 1);
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
          // Der Lieferbranch steht im Ticket, nicht nur im Sprint: der Agent
          // liest das Ticket, nicht den Board-State — und der Human sieht am
          // Ticket, wohin es geliefert wird.
          const deliveryBranch =
            state.currentSprint?.deliveryBranch ?? state.projectOnboarding?.deliveryBranch ?? null;
          if (plannedTask) plannedTask.deliveryBranch = deliveryBranch;
          if (deliveryBranch) {
            await postIssueNotice(
              task.id,
              "delivery-branch",
              [
                "## Sprint assignment",
                `**Delivery branch:** \`${deliveryBranch}\``,
                "Work on this branch and push the ticket commits there. Do not create a branch or a pull request per ticket — the whole sprint delivers on this one branch.",
              ].join("\n\n")
            );
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
        return { ...issue, comments: await readComments(issue.id) };
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
     * Stammt dieses Kommentar-Event vom Worker selbst?
     *
     * Der Worker dokumentiert Routing-Entscheidungen als Kommentare. Jeder davon
     * erzeugt ein `issue.comment.created`, das ihn erneut aufruft. Ohne diesen
     * Filter ist jede Notiz der Ausloeser der naechsten.
     */
    function isOwnNoticeEvent(event: { payload?: unknown }): boolean {
      const payload = event.payload as { body?: unknown } | null;
      return typeof payload?.body === "string" && isPluginAuthoredNotice(payload.body);
    }

    /**
     * Laesst den Lernzyklus auch waehrend der Lieferung laufen.
     *
     * Die Retrospektive lief bisher genau einmal — beim Abschluss des
     * Projektauftrags. Damit konnte sie den Sprint, den sie auswertet, nicht
     * mehr verbessern; ihr einziger Zweck war also verfehlt.
     *
     * Sie darf hier laufen, weil sie als einzige Zeremonie keine Ticketzustaende
     * anfasst: sie liest fertige Arbeit und schreibt Learnings, Skills und
     * Vorschlaege. Impediment Resolution und Sprint Planning bleiben dagegen
     * ausgeschlossen — beide setzen `column` und `assignedAgentId`, was auf
     * einem host-gefuehrten Board sofort auseinanderlaufen wuerde. Ihre
     * Aufgaben uebernehmen `releaseResolvedProjectBlockers`,
     * `refreshOrchestrationStalls` und `planProjectBacklog`.
     */
    const MIN_DONE_TASKS_PER_RETROSPECTIVE = 2;

    async function maybeRunProjectRetrospective(): Promise<boolean> {
      const rootIssueId = state.projectOnboarding?.rootIssueId;
      if (!rootIssueId || state.settings.events.enableAutoReview === false) return false;

      const doneTasks = state.tasks.filter(
        (task) => task.parentId === rootIssueId && task.column === "done"
      );
      const lastRetrospective = [...state.ceremonies]
        .reverse()
        .find((ceremony) => ceremony.type === "sprint_retrospective");
      const alreadyInspected = lastRetrospective?.taskIds?.length ?? 0;
      if (doneTasks.length - alreadyInspected < MIN_DONE_TASKS_PER_RETROSPECTIVE) return false;

      // Die Zeremonie darf keine neue Produktarbeit erfinden — dieselbe Grenze
      // wie beim automatischen Trigger.
      const queuedWork = pendingWork.length;
      try {
        runCeremony("sprint_retrospective", false);
      } finally {
        pendingWork.splice(queuedWork);
      }
      await syncRetrospectiveSkills();
      ctx.logger.info("Project retrospective extracted learnings mid-delivery", {
        doneTasks: doneTasks.length,
        learnings: state.learnings.length,
      });
      return true;
    }

    /**
     * Liest den Stillstandszustand beim Host, statt ihn aus Events zu erraten.
     *
     * Die Event-Handler bleiben: sie melden sofort. Diese Abfrage ist die
     * Korrektur — sie findet auch, was waehrend eines Worker-Neustarts passiert
     * ist, und raeumt auf, was der Host laengst geloest hat.
     */
    async function refreshOrchestrationStalls(): Promise<boolean> {
      const rootIssueId = state.projectOnboarding?.rootIssueId;
      if (!companyId || !rootIssueId) return false;

      try {
        const summary = await ctx.issues.summaries.getOrchestration({
          issueId: rootIssueId,
          companyId,
          includeSubtree: true,
        });
        // Ab hier ist "kein laufender Run" eine Aussage und keine Luecke.
        orchestrationReadable = true;
        const knownTaskIds = new Set(state.tasks.map((task) => task.id));
        const recoveryChanged = await recoverTimedOutAgentRuns(summary, knownTaskIds);
        // Der Kickoff ist kein Kanban-Ticket, traegt aber die Analyse- und
        // Backlog-Laeufe. Ohne ihn haette die Ansicht in genau den Phasen keine
        // Belege, in denen sie am meisten behauptet.
        const runScope = new Set([...knownTaskIds, rootIssueId]);
        const liveRuns = liveRunsFromOrchestration(summary, runScope);
        const liveRunsChanged =
          JSON.stringify(liveRuns) !== JSON.stringify(state.liveRuns ?? []);
        if (liveRunsChanged) state.liveRuns = liveRuns;
        const observed = stallsFromOrchestration(
          summary,
          knownTaskIds
        );
        // Erledigte und stornierte Tickets koennen nicht stehen.
        const settled = new Set(
          state.tasks.filter((task) => task.column === "done").map((task) => task.id)
        );
        const refined = new Set(
          state.tasks.filter((task) => task.refined).map((task) => task.id)
        );
        const moving = new Set(
          state.tasks
            .filter((task) => task.column === "in_progress" || task.column === "in_review")
            .map((task) => task.id)
        );
        const merged = mergeStalls(
          state.stalls ?? [],
          observed,
          settled,
          refined,
          {
            issueId: rootIssueId,
            phaseChangedAt: state.projectOnboarding?.updatedAt ?? new Date(0).toISOString(),
          },
          moving
        );
        annotateTimeoutRecoveryStalls(merged, summary, knownTaskIds);
        if (
          !recoveryChanged &&
          !liveRunsChanged &&
          JSON.stringify(merged) === JSON.stringify(state.stalls ?? [])
        ) {
          return false;
        }

        state.stalls = merged;
        if (observed.length > 0) {
          ctx.logger.warn("Host reports stalled project work", {
            count: observed.length,
            kinds: [...new Set(observed.map((stall) => stall.kind))],
          });
        }
        return true;
      } catch (error) {
        // Fehlt die Capability oder antwortet der Host nicht, bleibt die
        // ereignisbasierte Erfassung die Grundlage. Das ist weniger, aber nicht
        // falsch — deshalb nur eine Warnung.
        orchestrationReadable = false;
        ctx.logger.warn("Could not read host orchestration summary", { error: String(error) });
        return false;
      }
    }

    /**
     * Setzt nach einem nativen Adapter-Timeout genau einen ticketgebundenen
     * Ersatzlauf ab. Ein Board-Cancel ist bewusst ausgeschlossen: Der Host
     * behandelt ihn als menschlichen Stop und darf ihn nicht wieder aufnehmen.
     */
    async function recoverTimedOutAgentRuns(
      summary: OrchestrationSnapshot,
      knownTaskIds: ReadonlySet<string>
    ): Promise<boolean> {
      const recoveries = (state.timeoutRecoveries ??= {});
      let changed = false;

      for (const taskId of Object.keys(recoveries)) {
        const recovery = recoveries[taskId];
        const completed = summary.runs.some(
          (run) =>
            run.issueId === taskId &&
            run.status === "succeeded" &&
            run.createdAt.localeCompare(recovery.sourceRunCreatedAt) > 0
        );
        if (!knownTaskIds.has(taskId) || completed) {
          delete recoveries[taskId];
          changed = true;
        }
      }

      for (const run of timedOutRunsAwaitingRecovery(summary, knownTaskIds)) {
        if (!run.issueId || recoveries[run.issueId]) continue;

        const attemptedAt = new Date().toISOString();
        const wakeup = await requestIssueWakeup(run.issueId, "project_run_timeout_recovery");
        recoveries[run.issueId] = {
          sourceRunId: run.id,
          sourceRunCreatedAt: run.createdAt,
          attemptedAt,
          queued: wakeup.queued,
          recoveryRunId: wakeup.runId ?? null,
        };
        changed = true;
        ctx.logger.warn("Recorded the single automatic recovery attempt after a managed run timeout", {
          issueId: run.issueId,
          sourceRunId: run.id,
          queued: wakeup.queued,
          recoveryRunId: wakeup.runId ?? null,
        });
      }

      return changed;
    }

    /** Beschreibt Recovery-Status im Board, ohne sein dauerhaftes Budget dort zu speichern. */
    function annotateTimeoutRecoveryStalls(
      stalls: TicketStall[],
      summary: OrchestrationSnapshot,
      knownTaskIds: ReadonlySet<string>
    ): void {
      const timedOutRuns = new Map(
        timedOutRunsAwaitingRecovery(summary, knownTaskIds)
          .filter((run): run is typeof run & { issueId: string } => Boolean(run.issueId))
          .map((run) => [run.issueId, run])
      );

      for (const stall of stalls) {
        const recovery = state.timeoutRecoveries?.[stall.taskId];
        const timedOutRun = timedOutRuns.get(stall.taskId);
        if (!recovery || !timedOutRun || stall.kind !== "run_failed") continue;

        stall.retriedAt = recovery.attemptedAt;
        if (timedOutRun.id === recovery.sourceRunId) {
          stall.reason = recovery.queued
            ? "The managed run timed out. One controlled recovery run was queued."
            : "The managed run timed out and its single recovery wake-up could not be queued.";
        } else {
          stall.reason = "The controlled recovery run also timed out. Automatic recovery is exhausted.";
        }
      }
    }

    /**
     * Findet Tickets, die auf einen menschlichen Board-Dialog warten.
     *
     * Der Host verlangt fuer einen agentengeschriebenen Wechsel nach
     * `in_review` einen Review-Pfad. Ein Agent, der sich selbst hilft, baut
     * dafuer eine `request_confirmation` mit `board_only` — und das Ticket
     * wartet danach auf einen Klick, den niemand erwartet. Der
     * Orchestrierungs-Snapshot kennt Freigaben, aber keine Interactions;
     * deshalb wird hier gezielt nachgesehen.
     */
    async function detectPendingInteractionStalls(): Promise<boolean> {
      const rootIssueId = state.projectOnboarding?.rootIssueId;
      if (!companyId || !rootIssueId) return false;

      // Frueher nur `in_review`. Beide beobachteten Faelle lagen woanders: einer
      // im Refinement, einer in der Entwicklung. Eine Rueckfrage haelt das
      // Ticket in *jeder* Spalte an, also wird auch in jeder gesucht.
      const activeColumns = new Set(["todo", "in_progress", "in_review", "blocked"]);
      const activeTasks = state.tasks.filter(
        (task) => task.parentId === rootIssueId && activeColumns.has(task.column)
      );
      if (activeTasks.length === 0) return false;

      let changed = false;
      for (const task of activeTasks) {
        try {
          const interactions = await ctx.issues.listInteractions(task.id, companyId);
          const blocking = interactions.find(
            (interaction) => (interaction as { status?: string }).status === "pending"
          );
          if (!blocking) {
            // Die Frage ist beantwortet — der Vermerk gehoert weg, sonst meldet
            // das Board weiter "blocked" auf einem laufenden Ticket.
            if (state.stalls?.some((s) => s.taskId === task.id && s.kind === "awaiting_decision")) {
              clearStall(task.id);
              changed = true;
            }
            continue;
          }

          const label = task.identifier ?? task.title;
          recordStall(
            task.id,
            `${label} is waiting for a decision that an agent asked for inside the ticket.`,
            "awaiting_decision"
          );
          // Der Agent bekommt die Regel dort, wo er sie liest: im Ticket. Die
          // Instruktion verbietet eigene Confirmations laengst — sie steht nur
          // in 12 KB Bundle, und der naechste Run beginnt hier.
          await postIssueNotice(
            task.id,
            "self-authored-confirmation",
            [
              "## This ticket is waiting on a confirmation you created",
              "A board confirmation stops the ticket until a human clicks it — and nobody is watching for that click, so the ticket simply stops.",
              "Inside an approved sprint you decide within the acceptance criteria; you do not ask for a confirmation. If a question genuinely exceeds the ticket scope, say so in a comment and let the Scrum Master escalate it.",
            ].join("\n\n")
          );
          changed = true;
        } catch (error) {
          ctx.logger.warn("Could not inspect issue interactions", {
            issueId: task.id,
            error: String(error),
          });
          return changed;
        }
      }
      return changed;
    }

    /**
     * Wann der teure Voll-Abgleich zuletzt lief.
     *
     * Das Board pollt alle paar Sekunden. Der Voll-Abgleich liest jedes Issue
     * des Projekts *und schreibt dabei* — er gehoert damit nicht in einen
     * Lesepfad, den die Oberflaeche taktet. Events treiben die Arbeit; dieser
     * Abgleich heilt nur, was ein verpasstes Event liegen gelassen hat.
     */
    let lastFullSyncAt = 0;
    const FULL_SYNC_INTERVAL_MS = 60 * 1000;

    /**
     * Liest den Liefer-Scope: bevorzugt als Kickoff-Teilbaum, sonst das Projekt.
     *
     * `getSubtree` liefert genau die Issues, die dieses Board zeigt — in einem
     * Aufruf und ohne Fremd-Issues des Projekts. Fehlt die Capability oder
     * antwortet der Host nicht, bleibt das Projekt-Listing die Grundlage; das
     * Board soll nicht leer laufen, nur weil eine Optimierung fehlt.
     */
    async function listProjectScopeIssues(
      rootIssueId: string,
      projectId: string,
      limit: number,
      offset: number
    ): Promise<Issue[]> {
      if (!companyId) return [];

      if (offset === 0 && subtreeReadAvailable) {
        try {
          const subtree = await ctx.issues.getSubtree(rootIssueId, companyId, {
            includeRoot: true,
          });
          return subtree.issues;
        } catch (error) {
          // Einmal merken statt bei jedem Abgleich erneut anlaufen zu lassen.
          subtreeReadAvailable = false;
          ctx.logger.warn("Subtree read unavailable, falling back to project listing", {
            error: String(error),
          });
        }
      }
      // Der Teilbaum kam bereits vollstaendig; eine zweite Seite gibt es nicht.
      if (subtreeReadAvailable) return [];

      return ctx.issues.list({ companyId, projectId, limit, offset });
    }

    /** Wird einmal abgeschaltet, wenn der Host den Teilbaum nicht liefert. */
    let subtreeReadAvailable = true;

    /**
     * Fuehrt den Voll-Abgleich nur aus, wenn er faellig ist.
     *
     * `force` gilt fuer Pfade, die auf Aktualitaet angewiesen sind: Start,
     * menschliche Aktionen und Statuswechsel.
     */
    async function reconcileProjectIssues(force = false): Promise<boolean> {
      // Materialisieren muss jeder Lesevorgang: ein neu angelegtes Child-Issue
      // darf nicht bis zum naechsten Routing-Fenster unsichtbar bleiben.
      // Gedrosselt wird nur der Teil, der *schreibt*.
      const routeDue = force || Date.now() - lastFullSyncAt >= FULL_SYNC_INTERVAL_MS;
      return syncOnboardingProjectIssues({ route: routeDue });
    }

    /**
     * Heilt verpasste Events nach einem Worker-Neustart.
     *
     * Das Host-Issue bleibt die Quelle der Wahrheit. Daher aktualisiert diese
     * Funktion nur das lokale Materialisat und startet keine Zeremonie.
     *
     * `route` trennt Lesen von Schreiben. Die fuenf Routing-Regeln aendern
     * Host-Zustand; sie gehoeren nicht in einen Pfad, den die Oberflaeche im
     * Sekundentakt aufruft.
     */
    async function syncOnboardingProjectIssues(
      options: { route?: boolean } = {}
    ): Promise<boolean> {
      const route = options.route !== false;
      if (route) lastFullSyncAt = Date.now();
      const onboarding = state.projectOnboarding;
      if (
        !companyId ||
        !onboarding?.projectId ||
        !onboarding.rootIssueId ||
        (
          onboarding.status !== "backlog_in_progress" &&
          onboarding.status !== "sprint_planning" &&
          onboarding.status !== "active" &&
          onboarding.status !== "completed"
        )
      ) {
        return false;
      }

      let changed = false;
      let offset = 0;
      const limit = 100;

      try {
        while (true) {
          // Der Kickoff-Teilbaum ist genau der Liefer-Scope. Das gesamte Projekt
          // zu listen holt auch Issues, die dieses Board nie anfasst — und
          // zwingt danach zum Filtern.
          const issues = await listProjectScopeIssues(
            onboarding.rootIssueId,
            onboarding.projectId,
            limit,
            offset
          );
          for (const issue of issues) {
            const current = route ? await routeProjectIssue(issue, null) : issue;
            const result = syncProjectOnboardingIssue(
              state.tasks,
              onboarding,
              await withHostComments(current),
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
      // Nur im Schreibfenster: die Abfrage kostet einen Host-Aufruf und der
      // Stillstandszustand aendert sich nicht im Sekundentakt.
      const stallsChanged = route ? await refreshOrchestrationStalls() : false;
      const interactionStalls = route ? await detectPendingInteractionStalls() : false;
      const learned = route && !projectCompleted ? await maybeRunProjectRetrospective() : false;
      if (
        changed ||
        projectCompleted ||
        refinementRequestsChanged ||
        agentActivityChanged ||
        stallsChanged ||
        interactionStalls ||
        learned
      ) {
        if (changed) state.metrics = recalculateMetrics(state);
        await save();
      }
      if (projectCompleted) await syncRetrospectiveSkills();
      // Blocker aufloesen heisst Host-Issues aendern — auch das gehoert in den
      // Schreibpfad, nicht in jeden Board-Aufruf.
      if (route) await releaseResolvedProjectBlockers();
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
            // Die deklarierten Faehigkeiten der Rolle, nicht ein leeres Array:
            // die skill-basierte Zuweisung hat sonst nie etwas zu vergleichen
            // und faellt immer auf blosse Reihenfolge zurueck.
            capabilities: existing?.capabilities?.length
              ? existing.capabilities
              : declaredCapabilities(member.capabilities),
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
      await syncRetrospectiveSkills();
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
     * Veröffentlicht lokale Retrospektiv-Skills in der Paperclip-Bibliothek und
     * versieht passende Rollen einmalig mit den aktiven Skills. Die gemerkten
     * Agent-IDs verhindern, dass ein späteres manuelles Abwählen im nativen UI
     * bei jedem Board-Refresh wieder rückgängig gemacht wird.
     */
    async function syncRetrospectiveSkills(): Promise<void> {
      if (!companyId || state.skills.length === 0 || state.agents.length === 0) return;

      const config = await readConfig();
      const baseUrl = String(config.apiBaseUrl ?? "").trim().replace(/\/+$/, "");
      if (!baseUrl) return;

      const token = String(config.apiToken ?? "").trim();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;

      const client: SkillSyncClient = {
        async listCompanySkills(targetCompanyId) {
          const response = await fetch(`${baseUrl}/api/companies/${targetCompanyId}/skills`, { headers });
          if (!response.ok) throw new Error(`Could not list Company Skills (${response.status})`);

          const payload = await response.json();
          return Array.isArray(payload)
            ? payload.flatMap((value) => {
                const skill = asRecord(value);
                return (
                  typeof skill.id === "string" &&
                  typeof skill.key === "string" &&
                  typeof skill.slug === "string" &&
                  typeof skill.name === "string"
                )
                  ? [{ id: skill.id, key: skill.key, slug: skill.slug, name: skill.name }]
                  : [];
              })
            : [];
        },
        async createCompanySkill(targetCompanyId, params) {
          const response = await fetch(`${baseUrl}/api/companies/${targetCompanyId}/skills`, {
            method: "POST",
            headers,
            body: JSON.stringify(params),
          });
          if (!response.ok) throw new Error(`Could not create Company Skill (${response.status})`);

          const skill = asRecord(await response.json());
          if (
            typeof skill.id !== "string" ||
            typeof skill.key !== "string" ||
            typeof skill.slug !== "string" ||
            typeof skill.name !== "string"
          ) {
            throw new Error("Paperclip returned an invalid Company Skill");
          }
          return { id: skill.id, key: skill.key, slug: skill.slug, name: skill.name };
        },
        async listAgentSkills(agentId) {
          const response = await fetch(`${baseUrl}/api/agents/${agentId}/skills`, { headers });
          if (!response.ok) throw new Error(`Could not list Agent Skills (${response.status})`);

          const snapshot = asRecord(await response.json());
          return {
            desiredSkills: Array.isArray(snapshot.desiredSkills)
              ? snapshot.desiredSkills.filter((key): key is string => typeof key === "string")
              : undefined,
            entries: Array.isArray(snapshot.entries)
              ? snapshot.entries.flatMap((value) => {
                  const entry = asRecord(value);
                  return typeof entry.key === "string" && typeof entry.desired === "boolean"
                    ? [{ key: entry.key, desired: entry.desired }]
                    : [];
                })
              : undefined,
          };
        },
        async syncAgentSkills(agentId, desiredSkills) {
          const response = await fetch(`${baseUrl}/api/agents/${agentId}/skills/sync`, {
            method: "POST",
            headers,
            body: JSON.stringify({ desiredSkills }),
          });
          if (!response.ok) throw new Error(`Could not sync Agent Skills (${response.status})`);
          return response.json();
        },
      };

      let library;
      try {
        library = await ensureLibrarySkills(client, companyId, state.skills);
      } catch (error) {
        ctx.logger.warn("Could not publish learned skills to Paperclip", { error: String(error) });
        return;
      }

      let changed = false;
      for (const skill of state.skills) {
        const paperclipSkillKey = library.keys.get(skill.id);
        const paperclipSkillId = library.skillIds.get(skill.id);
        if (!paperclipSkillKey || !paperclipSkillId) continue;
        if (skill.paperclipSkillKey !== paperclipSkillKey || skill.paperclipSkillId !== paperclipSkillId) {
          skill.paperclipSkillKey = paperclipSkillKey;
          skill.paperclipSkillId = paperclipSkillId;
          changed = true;
        }
      }

      let assignments = 0;
      for (const agent of state.agents) {
        const pendingSkills = state.skills.filter((skill) =>
          skill.active &&
          skill.roles.includes(agent.role) &&
          !(Array.isArray(skill.paperclipAssignedAgentIds) && skill.paperclipAssignedAgentIds.includes(agent.id)) &&
          library.keys.has(skill.id)
        );
        if (pendingSkills.length === 0) continue;

        try {
          await assignSkillsToAgent(
            client,
            agent.id,
            pendingSkills.map((skill) => library.keys.get(skill.id)!)
          );
          for (const skill of pendingSkills) {
            skill.paperclipAssignedAgentIds = [
              ...new Set([...(skill.paperclipAssignedAgentIds ?? []), agent.id]),
            ];
          }
          changed = true;
          assignments += 1;
        } catch (error) {
          ctx.logger.warn("Could not assign learned skills to managed agent", {
            agentId: agent.id,
            error: String(error),
          });
        }
      }

      if (library.created.length > 0 || assignments > 0) {
        ctx.logger.info("Learned skills synchronized with Paperclip", {
          created: library.created.length,
          reused: library.reused.length,
          assignments,
        });
      }
      if (changed) await save();
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
      let timeoutUpdates = 0;
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
          const current = await currentResponse.json() as {
            adapterType?: unknown;
            adapterConfig?: unknown;
            runtimeConfig?: unknown;
          };
          const adapterConfig = scrumRunTimeoutAdapterConfigPatch(asRecord(current.adapterConfig));
          if (adapterConfig) {
            const adapterResponse = await fetch(`${baseUrl}/api/agents/${target.agentId}`, {
              method: "PATCH",
              headers,
              body: JSON.stringify({ adapterConfig }),
            });
            if (!adapterResponse.ok) {
              ctx.logger.warn("Could not apply managed agent run timeout", {
                agent: member.displayName,
                status: adapterResponse.status,
              });
            } else {
              timeoutUpdates += 1;
            }
          }
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

      if (heartbeatUpdates > 0 || timeoutUpdates > 0 || instructionUpdates > 0) {
        ctx.logger.info("Managed agent runtime policy applied", {
          heartbeatUpdates,
          timeoutUpdates,
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
      await syncRetrospectiveSkills();
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

        const routedIssue = await routeProjectIssue(issue, event.actorId ?? null);
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
        // Der Lernzyklus haengt an fertiger Arbeit, nicht an einem Zeitfenster:
        // ein abgeschlossenes Ticket ist der Anlass, nicht der naechste Tick.
        if (!projectCompleted) await maybeRunProjectRetrospective();
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
      // Eigene Routing-Notizen sind Protokoll, kein neuer Vorgang.
      if (isOwnNoticeEvent(event)) return;

      const issueId = issueIdFromEvent(event);
      if (issueId) {
        // `syncOnboardingIssue` routet dieses Issue bereits. Ein zusaetzlicher
        // Lauf ueber alle offenen Reviews verdoppelt nur jede Schreiboperation.
        await syncOnboardingIssue({
          companyId: event.companyId,
          entityId: issueId,
          actorId: event.actorId,
        });
        await refreshTechnicalAnalysisStatus();
        return;
      }

      await refreshTechnicalAnalysisStatus();
      await routeOpenProjectReviews();
    });

    /**
     * Ein gescheiterter Agent-Run war bisher unsichtbar.
     *
     * Das Ticket blieb in `in_progress` stehen, das Board zeigte "laeuft", und
     * der einzige Weg zurueck war der 30-Minuten-Watchdog des Scrum Masters —
     * der einen abgestuerzten Run nicht als solchen erkennen kann.
     */
    async function recordRunFailure(event: PluginEvent, label: string): Promise<void> {
      const issueId = issueIdFromEvent(event);
      if (!issueId || !state.tasks.some((task) => task.id === issueId)) return;

      recordStall(issueId, label, "run_failed");
      ctx.logger.error("Agent run did not finish", { issueId, label, eventId: event.eventId });
      await save();
    }

    registerCompanyEvent("agent.run.failed", async (event) => {
      await recordRunFailure(event, "The agent run failed. The ticket needs a new attempt.");
    });

    registerCompanyEvent("agent.run.cancelled", async (event) => {
      await recordRunFailure(event, "The agent run was cancelled before it finished.");
    });

    registerCompanyEvent("agent.run.finished", async (event) => {
      const issueId = issueIdFromEvent(event);
      if (!issueId || !state.stalls?.some((entry) => entry.taskId === issueId)) return;

      clearStall(issueId);
      if (state.timeoutRecoveries?.[issueId]) delete state.timeoutRecoveries[issueId];
      await save();
    });

    /**
     * Eine wartende Freigabe ist der haeufigste Grund fuer ein Ticket, das
     * "ewig dauert" — und der Header behauptete dabei, es sei keine noetig.
     */
    registerCompanyEvent("approval.created", async (event) => {
      const issueId = issueIdFromEvent(event);
      if (!issueId || !state.tasks.some((task) => task.id === issueId)) return;

      recordStall(issueId, "Waiting for a human approval outside the board.", "awaiting_approval");
      await save();
    });

    registerCompanyEvent("approval.decided", async (event) => {
      const issueId = issueIdFromEvent(event);
      if (!issueId) return;

      clearStall(issueId);
      await save();
    });

    registerCompanyEvent("budget.incident.opened", async (event) => {
      const issueId = issueIdFromEvent(event);
      if (!issueId || !state.tasks.some((task) => task.id === issueId)) return;

      recordStall(issueId, "A budget incident stopped this agent.", "budget");
      await save();
    });

    registerCompanyEvent("budget.incident.resolved", async (event) => {
      const issueId = issueIdFromEvent(event);
      if (!issueId) return;

      clearStall(issueId);
      await save();
    });

    /** Ein aufgeloester Blocker soll die Arbeit sofort weitertreiben, nicht erst beim naechsten Kommentar. */
    registerCompanyEvent("issue.relations.updated", async () => {
      await releaseResolvedProjectBlockers();
    });

    // -------------------------------------------------------------------------
    // Data the UI reads
    // -------------------------------------------------------------------------

    registerCompanyData("board", async (params) => {
      // Die Oberflaeche taktet diesen Aufruf. Der Voll-Abgleich laeuft deshalb
      // gedrosselt: Events treiben die Arbeit, der Abgleich heilt nur Luecken.
      await refreshTechnicalAnalysisStatus();
      await reconcileProjectIssues(params.force === true);
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
        stalls: state.stalls ?? [],
        liveRuns: state.liveRuns ?? [],
        liveRunsKnown: orchestrationReadable,
        deliveryBranchOptions: await deliveryBranchOptions(),
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
        deliveryBranch: params.deliveryBranch,
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

    /**
     * Die Branches eines Projekts, bevor es ein Onboarding dafuer gibt.
     *
     * Das Startformular fragt danach, sobald der Human ein Projekt waehlt —
     * dort steht das Projekt noch nirgends im State. Ohne diesen Weg bliebe die
     * Branchwahl an das Sprint-Gate gebunden, und eine kleine Umsetzung, die es
     * ueberspringt, wuerde nie danach gefragt.
     */
    registerCompanyAction("listProjectBranches", async (params) => {
      if (!companyId) return { branches: [], error: "No company context." };

      const projectId = typeof params.projectId === "string" ? params.projectId.trim() : "";
      if (!projectId) return { branches: [], error: "Choose a Paperclip project first." };

      const onboarding = state.projectOnboarding;
      const suggestion = onboarding
        ? suggestDeliveryBranch(onboarding, state.completedSprints.length + 1)
        : "feature/delivery-sprint-1";
      return branchOptionsForProject(projectId, onboarding?.deliveryBranch ?? null, suggestion);
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
        await createIssueComment(
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
        await createIssueComment(
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
        await createIssueComment(
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

    registerCompanyAction("startProjectSprint", async (params) => {
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

      // Der Branch ist optional: waehlt der Human keinen, bleibt es beim
      // bisherigen Verhalten des Teams. Waehlt er einen, gilt er fuer alle
      // Tickets des Sprints. Was nicht passieren darf: dass das Board ihm
      // ungefragt einen erfindet und die Agents auf einen Branch schickt, den
      // niemand entschieden hat.
      const requestedBranch = params.deliveryBranch ?? onboarding.deliveryBranch ?? null;
      const hasBranchRequest = typeof requestedBranch === "string" && requestedBranch.trim() !== "";
      if (hasBranchRequest && !normalizeBranchName(requestedBranch)) {
        return { started: false, error: "That is not a usable Git branch name." };
      }
      const deliveryBranch = hasBranchRequest ? normalizeBranchName(requestedBranch) : null;

      const sprint = createProjectSprint({
        onboarding: { ...onboarding, deliveryBranch },
        id: createId(),
        sprintNumber: state.completedSprints.length + 1,
        lengthWeeks: state.settings.sprint.lengthWeeks,
      });
      state.currentSprint = sprint;
      state.projectOnboarding = {
        ...transitionProjectOnboarding(onboarding, "active"),
        deliveryBranch,
      };
      await save();

      try {
        await createIssueComment(
          onboarding.rootIssueId,
          [
            `## ${sprint.name} started`,
            "The human approved the first sprint. Agent Scrum will plan refined backlog issues through the Paperclip workflow.",
            deliveryBranch
              ? `**Delivery branch:** \`${deliveryBranch}\` — every ticket of this sprint is delivered on this branch. Do not open a branch per ticket.`
              : null,
          ]
            .filter((part): part is string => part !== null)
            .join("\n\n"),
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

    /**
     * Stellt den Projektablauf auf eine fruehere Stufe zurueck.
     *
     * Ein Sprint, der auf falschen Stories oder falschen Schaetzungen laeuft,
     * war bisher nicht zurueckzuholen: die Statusuebergaenge laufen nur
     * vorwaerts, und die alten Refinement-Marker haetten jede Story sofort
     * wieder als sprintreif ausgewiesen. Der Reset raeumt beides — er beendet
     * den Sprint, holt jedes Ticket unbesetzt ins Backlog und entwertet die
     * bisherigen Schaetzungen ueber einen Zeitstempel, ohne einen einzigen
     * Kommentar zu loeschen.
     */
    registerCompanyAction("resetProjectWorkflow", async (params) => {
      if (!companyId) return { reset: false, error: "No company context." };

      const target: ProjectWorkflowResetTarget =
        params.target === "stories" ? "stories" : "refinement";
      const onboarding = state.projectOnboarding;
      if (!onboarding?.rootIssueId || !canResetProjectWorkflow(onboarding)) {
        return {
          reset: false,
          error: "There is no running project workflow to reset.",
        };
      }
      const rootIssueId = onboarding.rootIssueId;

      await syncOnboardingProjectIssues();
      const projectTasks = state.tasks.filter((task) => task.parentId === rootIssueId);
      const returnedTaskIds: string[] = [];
      // Genau der Kommentar, der die aktuelle Schaetzung traegt, wird entwertet
      // — nicht ein Zeitfenster. Ein neuer Marker zaehlt dadurch sofort, auch
      // wenn er in derselben Millisekunde entsteht.
      const voidedCommentIds: string[] = [];
      for (const task of projectTasks) {
        try {
          const comments = await readComments(task.id);
          const sourceCommentId = projectIssueProjection({
            issueId: task.id,
            description: task.description,
            comments,
            agents: state.agents,
            voidedRefinementCommentIds: onboarding.refinementVoidedCommentIds,
          }).refinement.sourceCommentId;
          if (sourceCommentId) voidedCommentIds.push(sourceCommentId);

          const returned = await ctx.issues.update(
            task.id,
            { status: "backlog", assigneeAgentId: null },
            companyId
          );
          syncProjectOnboardingIssue(state.tasks, onboarding, await withHostComments(returned), null, state.agents);
          returnedTaskIds.push(task.id);
        } catch (error) {
          ctx.logger.warn("Could not return a project ticket during the workflow reset", {
            issueId: task.id,
            error: String(error),
          });
        }
      }

      // Ein abgebrochener Sprint ist kein abgeschlossener: er wandert nicht in
      // die Historie, aus der die Velocity gerechnet wird.
      const cancelledSprint = state.currentSprint?.name ?? null;
      state.currentSprint = null;
      state.projectOnboarding = resetProjectOnboarding(onboarding, target, voidedCommentIds);
      for (const task of state.tasks) {
        if (task.parentId !== rootIssueId) continue;
        task.sprintId = null;
        task.refined = false;
        task.storyPoints = 0;
        task.acceptanceCriteria = [];
      }
      state.metrics = recalculateMetrics(state);
      state.ceremonies.push(
        createCeremonyRecord(
          "sprint_planning",
          null,
          target === "stories"
            ? `Human reset the workflow to Product Owner story work for ${returnedTaskIds.length} ticket(s).`
            : `Human reset the workflow to technical refinement for ${returnedTaskIds.length} ticket(s).`,
          { taskIds: returnedTaskIds }
        )
      );
      await save();

      try {
        await createIssueComment(
          rootIssueId,
          [
            `## Workflow reset to ${target === "stories" ? "story work" : "technical refinement"}`,
            cancelledSprint
              ? `The human cancelled **${cancelledSprint}** and returned every ticket to the backlog.`
              : "The human returned every ticket to the backlog.",
            "Earlier estimates and acceptance criteria no longer count. The comments stay on the tickets as history; sprint planning waits for a fresh refinement.",
            target === "stories"
              ? "Product Owner: revise the stories first — split, drop, or rewrite them to match the current request."
              : "Technical Lead: estimate the existing stories again.",
          ].join("\n\n"),
          companyId
        );
      } catch (error) {
        ctx.logger.warn("Could not record the workflow reset", {
          issueId: rootIssueId,
          error: String(error),
        });
      }

      // Die naechste Stufe faengt selbst wieder an zu laufen: Stories ueber den
      // Product Owner, Schaetzungen ueber den Technical Lead.
      let wakeup: { queued: boolean; error?: string | null } = { queued: false };
      let refinement: ProjectRefinementResult | null = null;
      if (target === "stories") {
        const productOwner = state.agents.find((agent) => agent.role === "product_owner");
        if (productOwner) {
          await ctx.issues.update(
            rootIssueId,
            {
              description: createBacklogDiscoveryPrompt(state.projectOnboarding),
              status: "todo",
              assigneeAgentId: productOwner.id,
            },
            companyId
          );
          wakeup = await requestIssueWakeup(rootIssueId, "project_onboarding_backlog_reset");
        }
      } else {
        refinement = await requestProjectRefinement("automatic", true);
      }

      ctx.logger.info("Project workflow reset", {
        target,
        cancelledSprint,
        taskIds: returnedTaskIds,
      });
      return {
        reset: true,
        target,
        cancelledSprint,
        taskIds: returnedTaskIds,
        projectOnboarding: state.projectOnboarding,
        wakeup,
        refinement,
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

        await createIssueComment(
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
        if (!issue) {
          return {
            approved: false,
            error: "The held ticket is no longer available.",
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
        await createIssueComment(
          approvedIssue.id,
          `## Human scope approved\n\nThis project ticket was created from held ticket ${issue.id} after human scope approval.`,
          companyId
        );
        await ctx.issues.update(
          issueId,
          { status: "cancelled", assigneeAgentId: null },
          companyId
        );
        await createIssueComment(
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

    registerCompanyAction("dismissScopeHold", async (params) => {
      if (!companyId) return { dismissed: false, error: "No company context." };

      const issueId = typeof params.issueId === "string" ? params.issueId : "";
      const onboarding = state.projectOnboarding;
      const hold = onboarding?.scopeHolds.find((candidate) => candidate.issueId === issueId);
      if (!issueId || !onboarding?.projectId || !hold) {
        return { dismissed: false, error: "This ticket has no pending held scope item." };
      }

      try {
        const issue = await ctx.issues.get(issueId, companyId);
        if (!issue) {
          return {
            dismissed: false,
            error: "The held ticket is no longer available.",
          };
        }

        if (issue.status !== "cancelled") {
          await ctx.issues.update(issueId, { status: "cancelled", assigneeAgentId: null }, companyId);
        }
        await createIssueComment(
          issueId,
          "## Human scope dismissed\n\nA human dismissed this held item. No follow-up project request or delivery work will start from it.",
          companyId
        );
        state.projectOnboarding = {
          ...onboarding,
          scopeHolds: onboarding.scopeHolds.filter((candidate) => candidate.issueId !== issueId),
          updatedAt: new Date().toISOString(),
        };
        await save();
        ctx.logger.info("Human scope hold dismissed", { issueId });
        return { dismissed: true, error: null };
      } catch (error) {
        ctx.logger.warn("Could not dismiss held project scope", {
          issueId,
          error: String(error),
        });
        return { dismissed: false, error: String(error) };
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
          input: {
            projectId: project.id,
            brief,
            constraints,
            skipSprintPlanning: false,
            // Eine Nachfassaktion erbt die Branchwahl des Projekts, statt sie
            // stillschweigend fallen zu lassen.
            deliveryBranch: state.projectOnboarding?.deliveryBranch ?? null,
          },
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
        await createIssueComment(
          followUpIssue.id,
          `## Human scope approved\n\nThis follow-up ticket was created from held ticket ${heldIssue.id}.`,
          companyId
        );
        await ctx.issues.update(issueId, { status: "cancelled", assigneeAgentId: null }, companyId);
        await createIssueComment(
          issueId,
          `## Human scope approved as follow-up\n\nDelivery continues in new kickoff ${rootIssue.id} and project ticket ${followUpIssue.id}.`,
          companyId
        );

        const followUpOnboarding = startProjectOnboarding({
          input: {
            projectId: project.id,
            brief,
            constraints,
            skipSprintPlanning: false,
            // Eine Nachfassaktion erbt die Branchwahl des Projekts, statt sie
            // stillschweigend fallen zu lassen.
            deliveryBranch: state.projectOnboarding?.deliveryBranch ?? null,
          },
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
    await syncRetrospectiveSkills();
      await dispatchWork();
      await save();
      return { started: true, record };
    });

    // -------------------------------------------------------------------------
    // Agent tools
    // -------------------------------------------------------------------------

    /**
     * Prueft, ob dieser Agent dieses Ticket auf diesem Weg veraendern darf.
     *
     * `ToolRunContext` nennt den Agenten, aber nicht das Ticket — die Ticket-ID
     * kommt als Parameter und ist damit erst einmal eine Behauptung. Rolle und
     * Projektzugehoerigkeit werden deshalb hier geprueft, nicht geglaubt.
     */
    async function authorizeToolCall(
      runCtx: ToolRunContext,
      issueId: unknown,
      expectedRole: string
    ): Promise<{ ok: true; issueId: string } | { ok: false; error: string }> {
      if (typeof issueId !== 'string' || !issueId.trim()) {
        return { ok: false, error: 'issueId is required.' };
      }

      const agent = state.agents.find((entry) => entry.id === runCtx.agentId);
      if (!agent || agent.role !== expectedRole) {
        return { ok: false, error: `Only the ${expectedRole.replace('_', ' ')} may use this tool.` };
      }

      const task = state.tasks.find((entry) => entry.id === issueId);
      if (!task || task.parentId !== state.projectOnboarding?.rootIssueId) {
        return { ok: false, error: 'This ticket does not belong to the active project request.' };
      }

      return { ok: true, issueId };
    }

    function expectedRefinementBatchTaskIds(): string[] {
      const requested = new Set(state.projectOnboarding?.refinementRequestedTaskIds ?? []);
      return refinementCandidates()
        .filter((task) => requested.has(task.id))
        .map((task) => task.id);
    }

    /** Nur der Scrum Master fuehrt einen Watchdog-Lauf. */
    function authorizeWatchdogCall(
      runCtx: ToolRunContext
    ): { ok: true } | { ok: false; error: string } {
      const agent = state.agents.find((entry) => entry.id === runCtx.agentId);
      if (!agent || agent.role !== 'scrum_master') {
        return { ok: false, error: 'Only the Scrum Master may use this tool.' };
      }
      return { ok: true };
    }

    ctx.tools.register(
      GET_WATCHDOG_AGENDA_TOOL,
      {
        displayName: 'Read the watchdog agenda',
        description:
          'Return the impediments a Scrum Master watchdog run has to look at. An empty agenda ends the run.',
        parametersSchema: toolSchema(GET_WATCHDOG_AGENDA_TOOL),
      },
      async (_params, runCtx) => {
        const auth = authorizeWatchdogCall(runCtx);
        if (!auth.ok) return { error: auth.error };

        const agenda = watchdogAgenda(state);
        if (agenda.clear) {
          return {
            content: [
              'Agenda: empty.',
              `Nothing on this board is stuck (${agenda.checkedTasks} ticket(s) checked).`,
              'Your run ends here. Call submit_watchdog_report with clear=true and stop. Do not look for other work.',
            ].join('\n\n'),
          };
        }

        const lines = agenda.items.map((item) => {
          const label = item.identifier ?? item.taskId ?? 'board';
          const title = item.title ? ` — ${item.title}` : '';
          return `- [${item.kind}] ${label}${title}\n  ${item.detail}\n  Responsible: ${item.owner}${item.taskId ? `\n  taskId: ${item.taskId}` : ''}`;
        });

        return {
          content: [
            `Agenda: ${agenda.items.length} item(s).`,
            lines.join('\n'),
            'Read the named tickets, then call submit_watchdog_report exactly once with one finding per item. Do not change any ticket status or assignee, and do not implement anything — the board wakes the responsible role from your report.',
          ].join('\n\n'),
        };
      }
    );

    ctx.tools.register(
      SUBMIT_WATCHDOG_REPORT_TOOL,
      {
        displayName: 'Submit the watchdog report',
        description:
          'The single final act of a watchdog run: report impediments so the board can wake the responsible role.',
        parametersSchema: toolSchema(SUBMIT_WATCHDOG_REPORT_TOOL),
      },
      async (params, runCtx) => {
        const auth = authorizeWatchdogCall(runCtx);
        if (!auth.ok) return { error: auth.error };

        const parsed = validateWatchdogReport(params);
        if (!parsed.ok) return { error: parsed.error };

        const rootIssueId = state.projectOnboarding?.rootIssueId ?? null;
        const findings = parsed.value.findings.filter(
          (finding) =>
            !finding.taskId ||
            state.tasks.some((task) => task.id === finding.taskId && task.parentId === rootIssueId)
        );

        state.ceremonies.push(
          createCeremonyRecord(
            'impediment_resolution',
            state.currentSprint?.id ?? null,
            watchdogReportSummary({ ...parsed.value, findings }),
            { taskIds: findings.flatMap((finding) => (finding.taskId ? [finding.taskId] : [])) }
          )
        );
        await save();

        // Wecken ist Sache des Boards: der Watchdog benennt nur, was steht. So
        // bleibt die Zustaendigkeit dort, wo sie nachvollziehbar ist.
        const woken: string[] = [];
        for (const finding of findings) {
          if (!finding.taskId) continue;
          try {
            await postIssueNotice(
              finding.taskId,
              'watchdog-finding',
              [
                '## Scrum Master watchdog',
                finding.note,
                'Reported by the process watchdog. The responsible role owns the next step; the watchdog does not take the ticket over.',
              ].join('\n\n')
            );
            const wakeup = await requestIssueWakeup(finding.taskId, 'project_watchdog_finding');
            if (wakeup.queued) woken.push(finding.taskId);
          } catch (error) {
            ctx.logger.warn('Could not act on a watchdog finding', {
              issueId: finding.taskId,
              error: String(error),
            });
          }
        }

        ctx.logger.info('Watchdog report recorded', {
          clear: parsed.value.clear,
          findings: findings.length,
          woken: woken.length,
        });
        return {
          content: parsed.value.clear
            ? 'Report recorded: nothing is stuck. Your run is complete.'
            : `Report recorded for ${findings.length} impediment(s); the board woke ${woken.length} responsible agent(s). Your run is complete.`,
        };
      }
    );

    ctx.tools.register(
      SUBMIT_REFINEMENT_TOOL,
      {
        displayName: 'Submit ticket refinement',
        description:
          'Record estimate, acceptance criteria, technical notes, risks, and labels for a project ticket.',
        parametersSchema: toolSchema(SUBMIT_REFINEMENT_TOOL),
      },
      async (params, runCtx) => {
        const record = params as Record<string, unknown>;
        const auth = await authorizeToolCall(runCtx, record.issueId, 'technical_lead');
        if (!auth.ok) return { error: auth.error };

        const expectedBatchTaskIds = expectedRefinementBatchTaskIds();
        if (expectedBatchTaskIds.length > 1 && expectedBatchTaskIds.includes(auth.issueId)) {
          return {
            error: 'This ticket belongs to an active refinement batch. Use submit_refinement_batch for every batch ticket in one call.',
          };
        }

        const parsed = validateRefinement(record);
        if (!parsed.ok) return { error: parsed.error };

        try {
          await createIssueComment(auth.issueId, refinementComment(parsed.value), runCtx.companyId, {
            authorAgentId: runCtx.agentId,
          });
        } catch (error) {
          return { error: `Could not record the refinement: ${String(error)}` };
        }

        clearStall(auth.issueId);
        await save();
        return {
          content: `Refinement recorded: ${parsed.value.storyPoints} points, ${parsed.value.acceptanceCriteria.length} acceptance criteria. The ticket is now eligible for sprint planning.`,
        };
      }
    );

    ctx.tools.register(
      SUBMIT_REFINEMENT_BATCH_TOOL,
      {
        displayName: 'Submit complete refinement batch',
        description:
          'Record every estimate and acceptance-criteria set from the active project refinement batch in one call.',
        parametersSchema: toolSchema(SUBMIT_REFINEMENT_BATCH_TOOL),
      },
      async (params, runCtx) => {
        const record = params as Record<string, unknown>;
        const agent = state.agents.find((entry) => entry.id === runCtx.agentId);
        if (!agent || agent.role !== 'technical_lead') {
          return { error: 'Only the technical lead may use this tool.' };
        }

        const parsed = validateRefinementBatch(record);
        if (!parsed.ok) return { error: parsed.error };

        const expectedTaskIds = expectedRefinementBatchTaskIds();
        const submittedTaskIds = parsed.value.refinements.map((entry) => entry.issueId);
        const submitted = new Set(submittedTaskIds);
        const expected = new Set(expectedTaskIds);
        const missing = expectedTaskIds.filter((issueId) => !submitted.has(issueId));
        const unexpected = submittedTaskIds.filter((issueId) => !expected.has(issueId));
        if (expectedTaskIds.length === 0) {
          return { error: 'There is no active project refinement batch.' };
        }
        if (missing.length > 0 || unexpected.length > 0) {
          return {
            error: `Batch refinement is incomplete. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`,
          };
        }

        for (const entry of parsed.value.refinements) {
          const auth = await authorizeToolCall(runCtx, entry.issueId, 'technical_lead');
          if (!auth.ok) return { error: auth.error };
        }

        refinementBatchSubmissionInFlight = true;
        try {
          for (const entry of parsed.value.refinements) {
            await createIssueComment(
              entry.issueId,
              refinementComment(entry.refinement),
              runCtx.companyId,
              { authorAgentId: runCtx.agentId }
            );
            clearStall(entry.issueId);
          }

          for (const entry of parsed.value.refinements) {
            const issue = await ctx.issues.get(entry.issueId, runCtx.companyId);
            if (!issue) throw new Error(`Could not load refined ticket ${entry.issueId}.`);

            const returned = await returnRefinedTechnicalLeadIssueToBacklog(issue);
            syncProjectOnboardingIssue(
              state.tasks,
              state.projectOnboarding,
              await withHostComments(returned),
              runCtx.agentId,
              state.agents
            );
          }

          reconcileProjectRefinementRequests();
          await save();
          return {
            content: `Batch refinement recorded for ${parsed.value.refinements.length} tickets. Every ticket is now eligible for sprint planning.`,
          };
        } catch (error) {
          return { error: `Could not record the refinement batch: ${String(error)}` };
        } finally {
          refinementBatchSubmissionInFlight = false;
        }
      }
    );

    ctx.tools.register(
      SUBMIT_QA_VERDICT_TOOL,
      {
        displayName: 'Submit QA verdict',
        description: 'Record the QA result for a ticket in review, criterion by criterion.',
        parametersSchema: toolSchema(SUBMIT_QA_VERDICT_TOOL),
      },
      async (params, runCtx) => {
        const record = params as Record<string, unknown>;
        const auth = await authorizeToolCall(runCtx, record.issueId, 'qa_engineer');
        if (!auth.ok) return { error: auth.error };

        const parsed = validateQaVerdict(record);
        if (!parsed.ok) return { error: parsed.error };

        try {
          await createIssueComment(auth.issueId, qaVerdictComment(parsed.value), runCtx.companyId, {
            authorAgentId: runCtx.agentId,
          });
        } catch (error) {
          return { error: `Could not record the QA verdict: ${String(error)}` };
        }

        return {
          content: parsed.value.approved
            ? 'Approval recorded. Agent Scrum completes the ticket once commit evidence is present.'
            : 'Change request recorded. Agent Scrum returns the ticket to a developer.',
        };
      }
    );

    /**
     * Uebergibt ein fertiges Ticket an QA — in einem Schritt.
     *
     * Der Host lehnt einen agentengeschriebenen Wechsel nach `in_review` ab:
     * er liesse das Ticket ohne jemanden zurueck, der die naechste Handlung
     * besitzt. Ein Developer hat sich daraufhin selbst eine
     * `request_confirmation` gebaut — die auf einen *menschlichen* Klick
     * wartet, nicht auf QA. Damit stand das Ticket still, obwohl alles fertig
     * war.
     *
     * Das Plugin darf den Wechsel vornehmen, weil es dabei zugleich QA
     * zuweist und weckt: die naechste Handlung hat einen Besitzer.
     */
    ctx.tools.register(
      SUBMIT_FOR_REVIEW_TOOL,
      {
        displayName: 'Hand a ticket to QA',
        description:
          'Record the review summary and delivered commit, move the ticket to review, and assign QA.',
        parametersSchema: toolSchema(SUBMIT_FOR_REVIEW_TOOL),
      },
      async (params, runCtx) => {
        const record = params as Record<string, unknown>;
        const auth = await authorizeToolCall(runCtx, record.issueId, 'developer');
        if (!auth.ok) return { error: auth.error };

        const parsed = validateReviewSubmission(record);
        if (!parsed.ok) return { error: parsed.error };

        const qa = state.agents.find((agent) => agent.role === 'qa_engineer');
        const productOwner = state.agents.find((agent) => agent.role === 'product_owner');
        const reviewer = parsed.value.productDecisionRequired ? productOwner : qa;
        if (!reviewer) return { error: 'No reviewer is available for this project.' };

        try {
          await createIssueComment(
            auth.issueId,
            reviewSubmissionComment(parsed.value),
            runCtx.companyId,
            { authorAgentId: runCtx.agentId }
          );
          await ctx.issues.update(
            auth.issueId,
            { status: 'in_review', assigneeAgentId: reviewer.id },
            runCtx.companyId
          );
        } catch (error) {
          return { error: `Could not hand the ticket to review: ${String(error)}` };
        }

        await requestIssueWakeup(
          auth.issueId,
          parsed.value.productDecisionRequired
            ? 'project_review_product_decision'
            : 'project_review_qa'
        );
        clearStall(auth.issueId);
        await save();

        return {
          content: `Ticket handed to ${reviewer.name}. Do not change the status yourself — Agent Scrum owns the review routing from here.`,
        };
      }
    );

    ctx.tools.register(
      RECORD_COMMIT_TOOL,
      {
        displayName: 'Record delivery commit',
        description: 'Record the pushed commit that delivers a ticket.',
        parametersSchema: toolSchema(RECORD_COMMIT_TOOL),
      },
      async (params, runCtx) => {
        const record = params as Record<string, unknown>;
        const auth = await authorizeToolCall(runCtx, record.issueId, 'developer');
        if (!auth.ok) return { error: auth.error };

        const parsed = validateCommit(record);
        if (!parsed.ok) return { error: parsed.error };

        try {
          await createIssueComment(auth.issueId, commitComment(parsed.value), runCtx.companyId, {
            authorAgentId: runCtx.agentId,
          });
        } catch (error) {
          return { error: `Could not record the commit: ${String(error)}` };
        }

        return { content: `Commit ${parsed.value.sha.slice(0, 8)} recorded as delivery evidence.` };
      }
    );

    /** Holt das im Manifest deklarierte Schema, damit beide nie auseinanderlaufen. */
    function toolSchema(name: string): Record<string, unknown> {
      const declared = manifest.tools?.find((tool) => tool.name === name);
      return (declared?.parametersSchema ?? { type: 'object' }) as Record<string, unknown>;
    }

    // -------------------------------------------------------------------------
    // Reconcile tick
    // -------------------------------------------------------------------------

    /**
     * Stellt fest, was steht — ohne dass jemand das Board oeffnen muss.
     *
     * Bewusst kein zweiter Scheduler: der Tick startet keine Zeremonie und
     * weist nichts zu. Er liest die Orchestrierungssicht des Hosts und schreibt
     * das Ergebnis ins Board. Ein Agent-Run, der waehrend eines Worker-
     * Neustarts scheitert, ist sonst dauerhaft unsichtbar, weil sein Event
     * niemanden mehr erreicht hat.
     */
    ctx.jobs.register("reconcile-stalled-work", async (job) => {
      const scopes = await reconcilableCompanies();
      if (scopes.length === 0) {
        ctx.logger.info("Reconcile tick found no bound company", { trigger: job.trigger });
        return;
      }

      for (const scope of scopes) {
        try {
          await withCompanyInvocation(scope, async () => {
            if (!state.projectOnboarding?.rootIssueId) return;

            const changed = await refreshOrchestrationStalls();
            if (changed) await save();
            ctx.logger.info("Reconcile tick completed", {
              companyId: scope,
              stalls: state.stalls?.length ?? 0,
            });
          });
        } catch (error) {
          ctx.logger.warn("Reconcile tick could not inspect a company", {
            companyId: scope,
            error: String(error),
          });
        }
      }
    });

    /**
     * Firmen, die der Tick pruefen darf.
     *
     * Der Job-Kontext traegt keine Firma — anders als ein Event oder eine
     * Aktion. Der Fan-out ueber `ctx.companies.list()` wird deshalb *versucht*;
     * verweigert der Host ihn, bleibt die zuletzt gebundene Firma uebrig. Das
     * ist weniger Abdeckung, aber kein falsches Ergebnis.
     */
    async function reconcilableCompanies(): Promise<string[]> {
      try {
        const companies = await ctx.companies.list({ limit: 100 });
        const ids = companies.map((company) => company.id).filter(Boolean);
        if (ids.length > 0) return ids;
      } catch (error) {
        ctx.logger.info("Reconcile tick falls back to the bound company", {
          reason: String(error),
        });
      }
      return companyId ? [companyId] : [];
    }

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
