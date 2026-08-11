import { useEffect, useState, type FormEvent } from "react";

import type { ProjectOnboarding, TicketStall } from "../../core/types";
import type { ProjectProgress } from "../../core/project-issue-projection";
import { describeProjectWorkflow, type ProjectWorkflowActivity } from "./project-workflow";

export interface ProjectOption {
  id: string;
  name: string;
}

/** Die Branch-Auswahl, die das Board vor dem Sprintstart anbietet. */
export interface DeliveryBranchOptions {
  selected: string | null;
  suggestion: string;
  branches: string[];
  defaultBranch: string | null;
  error: string | null;
}

const NEW_BRANCH_OPTION = "__new__";
const NO_BRANCH_OPTION = "";

interface ProjectOnboardingPanelProps {
  onboarding: ProjectOnboarding;
  projects: ProjectOption[];
  busy: boolean;
  hostControlled: boolean;
  canStart: boolean;
  onOpenKickoff?: () => void;
  kickoffHref?: string | null;
  progress: ProjectProgress;
  latestEventSummary: string | null;
  canStartSprint: boolean;
  /** Tickets, die nachweislich stehen — speist die Begruendung im Header. */
  stalls?: TicketStall[];
  /** Laeuft gerade ein Agent-Run? `undefined`, wenn der Host es nicht sagt. */
  agentRunning?: boolean;
  /** Auswaehlbare Lieferbranches fuer den ersten Sprint. */
  branchOptions?: DeliveryBranchOptions;
  scopeHoldBusyId: string | null;
  onStart: (input: {
    projectId: string;
    brief: string;
    constraints: string;
    skipSprintPlanning: boolean;
    deliveryBranch: string;
  }) => Promise<void>;
  /** Laedt die Branches des im Formular gewaehlten Projekts. */
  onLoadBranches?: (projectId: string) => Promise<DeliveryBranchOptions>;
  onActivate: () => Promise<void>;
  onStartSprint: (input: { deliveryBranch: string }) => Promise<void>;
  /** Setzt den Ablauf auf Story-Arbeit oder auf das technische Refinement zurueck. */
  onResetWorkflow: (input: { target: "stories" | "refinement" }) => Promise<void>;
  onApproveScopeHold: (issueId: string) => Promise<void>;
  onStartScopeHoldFollowUp: (issueId: string) => Promise<void>;
  onDismissScopeHold: (issueId: string) => Promise<void>;
}

export function ProjectOnboardingPanel({
  onboarding,
  projects,
  busy,
  hostControlled,
  canStart,
  onOpenKickoff,
  kickoffHref,
  progress,
  latestEventSummary,
  canStartSprint,
  stalls,
  agentRunning,
  branchOptions,
  scopeHoldBusyId,
  onStart,
  onLoadBranches,
  onActivate,
  onStartSprint,
  onResetWorkflow,
  onApproveScopeHold,
  onStartScopeHoldFollowUp,
  onDismissScopeHold,
}: ProjectOnboardingPanelProps) {
  const [projectId, setProjectId] = useState("");
  const [brief, setBrief] = useState("");
  const [constraints, setConstraints] = useState("");
  const [skipSprintPlanning, setSkipSprintPlanning] = useState(false);
  const [startingNextProject, setStartingNextProject] = useState(false);
  // `null` heisst "der Human hat noch nicht angefasst" — dann gilt die
  // gespeicherte Wahl, sonst kein Branch.
  const [branchChoice, setBranchChoice] = useState<string | null>(null);
  const [customBranch, setCustomBranch] = useState("");
  // Die Branches haengen am *im Formular* gewaehlten Projekt, nicht am
  // Onboarding — das gibt es zu diesem Zeitpunkt noch gar nicht.
  const [formBranchOptions, setFormBranchOptions] = useState<DeliveryBranchOptions | null>(null);
  const planningNextFeature = onboarding.status === "completed";
  const workflow = describeProjectWorkflow(onboarding, progress, {
    stalls,
    phaseSince: onboarding.updatedAt,
    agentRunning,
    refinementWaits: onboarding.refinementWaits,
  });
  // Im Startformular gilt das dort gewaehlte Projekt, sonst das Onboarding.
  const activeBranchOptions = formBranchOptions ?? branchOptions;
  const suggestedBranch = activeBranchOptions?.suggestion ?? "";
  const storedBranch = activeBranchOptions?.selected ?? onboarding.deliveryBranch ?? null;
  // Kein Branch ist die Vorgabe. Einen zu erfinden hiesse, die Agents auf einen
  // Branch zu schicken, den niemand entschieden hat.
  const selectedBranch = branchChoice ?? storedBranch ?? NO_BRANCH_OPTION;
  const deliveryBranch =
    selectedBranch === NO_BRANCH_OPTION
      ? ""
      : selectedBranch === NEW_BRANCH_OPTION
        ? customBranch.trim()
        : selectedBranch;

  useEffect(() => {
    if (!projectId || !onLoadBranches) {
      setFormBranchOptions(null);
      return;
    }

    let cancelled = false;
    void onLoadBranches(projectId).then((options) => {
      if (!cancelled) setFormBranchOptions(options);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, onLoadBranches]);

  function submitStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onStart({ projectId, brief, constraints, skipSprintPlanning, deliveryBranch });
  }

  function startNextFeature() {
    setProjectId(onboarding.projectId ?? "");
    setBrief("");
    setConstraints("");
    setSkipSprintPlanning(false);
    setStartingNextProject(true);
  }

  if (canStart && (onboarding.status !== "completed" || startingNextProject)) {
    return (
      <section className="project-onboarding" aria-labelledby="project-onboarding-title">
        <div className="project-onboarding-heading">
          <p className="project-onboarding-eyebrow">Project work</p>
          <h2 id="project-onboarding-title">
            {planningNextFeature ? "Plan next feature" : "Start a project request"}
          </h2>
        </div>

        <ProjectWorkflowTracker workflow={workflow} />

        <form className="project-onboarding-form" onSubmit={submitStart}>
          <label className="project-onboarding-field">
            <span>Paperclip project</span>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={busy || projects.length === 0}
            >
              <option value="">Choose a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="project-onboarding-field project-onboarding-field-wide">
            <span>{planningNextFeature ? "Feature request" : "Work request"}</span>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={planningNextFeature ? "e.g. Add a de/EN translation toggle" : "Describe the requested outcome"}
              disabled={busy}
              required
            />
          </label>

          <label className="project-onboarding-field project-onboarding-field-wide">
            <span>Constraints</span>
            <textarea
              value={constraints}
              onChange={(event) => setConstraints(event.target.value)}
              placeholder="Design system, dependencies, accessibility, delivery constraints"
              disabled={busy}
            />
          </label>

          <label className="project-onboarding-compact project-onboarding-field-wide">
            <input
              type="checkbox"
              checked={skipSprintPlanning}
              onChange={(event) => setSkipSprintPlanning(event.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>Small implementation</strong>
              <small>Skip the separate sprint-planning step after backlog approval.</small>
            </span>
          </label>

          <div className="project-onboarding-field-wide">
            <DeliveryBranchPicker
              busy={busy || !projectId}
              options={activeBranchOptions}
              selected={selectedBranch}
              customBranch={customBranch}
              suggestion={suggestedBranch}
              onSelect={setBranchChoice}
              onCustomChange={setCustomBranch}
            />
          </div>

          <div className="project-onboarding-actions project-onboarding-field-wide">
            <button className="btn btn-primary" type="submit" disabled={busy || projects.length === 0}>
              {busy ? "Starting…" : planningNextFeature ? "Start feature analysis" : "Start technical analysis"}
            </button>
          </div>
        </form>
      </section>
    );
  }

  const action = onboarding.status === "backlog_in_progress"
      ? {
          label: onboarding.requiresSprint ? "Approve backlog for sprint planning" : "Approve backlog",
          run: onActivate,
        }
      : onboarding.status === "sprint_planning"
        ? { label: "Start first sprint", run: () => onStartSprint({ deliveryBranch }) }
      : onboarding.status === "completed" && canStart
        ? { label: "Plan next feature", run: startNextFeature }
      : null;
  // Der stärkste Beleg dafuer, dass der Product Owner arbeitet, ist die Zahl
  // der Stories, die waehrenddessen entsteht — nicht ein Satz darueber.
  const backlogInProgress = onboarding.status === "backlog_in_progress";
  // Der Sprint startet erst, wenn das Refinement fertig ist. Fehlt noch etwas,
  // gehoert der Grund sichtbar hin — nicht ein fehlender Knopf.
  const refinementPending = onboarding.status === "sprint_planning" && progress.unrefinedTasks > 0;
  const backlogProgressNote = backlogInProgress
    ? progress.totalTasks > 0
      ? `${progress.totalTasks} ${progress.totalTasks === 1 ? "story" : "stories"} created so far`
      : "No stories yet — the first one usually appears within a few minutes."
    : null;
  // Solange keine Story existiert, gibt es nichts zu genehmigen. Der Knopf war
  // trotzdem die auffaelligste Schaltflaeche der Ansicht.
  const actionReady = backlogInProgress
    ? progress.totalTasks > 0
    : onboarding.status === "sprint_planning"
      ? // Der Branch ist optional; nur eine angefangene, leere Eingabe haelt auf.
        canStartSprint && !(selectedBranch === NEW_BRANCH_OPTION && deliveryBranch.length === 0)
      : true;
  const actionBlockedReason = backlogInProgress
    ? "The Product Owner has not created any stories yet."
    : refinementPending
      ? `${progress.unrefinedTasks} ${progress.unrefinedTasks === 1 ? "story is" : "stories are"} still waiting for the Technical Lead's estimate and acceptance criteria.`
      : onboarding.status === "sprint_planning" && !canStartSprint
        ? "No refined backlog ticket is ready for the sprint yet."
        : null;
  const analysisInProgress = onboarding.status === "analysis_in_progress";
  const analysisReady = onboarding.status === "analysis_ready";
  const sprintPlanning = onboarding.status === "sprint_planning";
  const projectCompleted = onboarding.status === "completed";
  const canApproveScope =
    onboarding.status === "backlog_in_progress" ||
    onboarding.status === "sprint_planning" ||
    onboarding.status === "active";
  // Ein Ablauf, der schon Stories hat, laesst sich zurueckstellen. Vor der
  // Analyse gibt es nichts, worauf man zurueckstellen koennte.
  const canReset = canApproveScope;

  return (
    <section className="project-onboarding project-onboarding-status" aria-labelledby="project-onboarding-title">
      <div className="project-onboarding-heading">
        <p className="project-onboarding-eyebrow">Project work</p>
        <h2 id="project-onboarding-title">{onboarding.projectName ?? "Project request"}</h2>
      </div>

      <div className="project-onboarding-progress">
        {onboarding.rootIssueId && (
          onOpenKickoff ? (
            <button className="project-onboarding-kickoff" type="button" onClick={onOpenKickoff}>
              <span className="project-onboarding-kickoff-kind">Kickoff ticket</span>
              <strong>Kickoff: {onboarding.projectName}</strong>
              <span>
                {analysisReady
                  ? "Review the Technical Lead analysis and decide"
                  : "Open the Technical Lead analysis and workflow"}
              </span>
            </button>
          ) : (
            <div className="project-onboarding-kickoff">
              <span className="project-onboarding-kickoff-kind">Kickoff ticket</span>
              <strong>Kickoff: {onboarding.projectName}</strong>
            </div>
          )
        )}

        <ProjectWorkflowTracker
          workflow={workflow}
          onOpenKickoff={onOpenKickoff}
          kickoffHref={kickoffHref}
          progressNote={backlogProgressNote}
        />

        {/*
          Die Stage-Zeile wiederholte in jedem Zustand nur die Ueberschrift des
          Trackers — und widersprach ihr, sobald beide unterschiedlich
          herleiteten ("waits for human approval" waehrend der Technical Lead
          noch verfeinerte). Der Tracker ist die einzige Quelle.
        */}

        {progress.totalTasks > 0 && (
          <p className="project-onboarding-progress-summary">
            {progress.measure === "story_points"
              ? `${progress.completedPoints} / ${progress.estimatedPoints} story points (${progress.percent}%)`
              : `${progress.doneTasks} / ${progress.totalTasks} tasks complete (${progress.percent}%)`}
            {!projectCompleted && progress.unrefinedTasks > 0 &&
              ` · ${progress.unrefinedTasks} awaiting refinement`}
          </p>
        )}

        {projectCompleted && (
          <p className="project-onboarding-lock" role="status">
            Sprint review and retrospective are complete. Plan the next feature to start a new analysis, backlog, and sprint.
          </p>
        )}

        {onboarding.scopeHolds.length > 0 && (
          <div className="project-onboarding-lock" role="alert">
            <strong>{projectCompleted ? "Human follow-up approval required" : "Human scope approval required"}</strong>
            <span>
              {projectCompleted
                ? `${onboarding.scopeHolds.length} held item${onboarding.scopeHolds.length === 1 ? " is" : "s are"} ready for a new follow-up request. Approval starts a new technical analysis; dismissing an item discards it.`
                : !canApproveScope
                  ? `${onboarding.scopeHolds.length} held item${onboarding.scopeHolds.length === 1 ? " is" : "s are"} waiting for the new technical analysis and backlog discovery before scope can be approved.`
                  : `${onboarding.scopeHolds.length} agent-created item${onboarding.scopeHolds.length === 1 ? " was" : "s were"} held outside this project. Approve an item to create a tracked project ticket for it.`}
            </span>
            <div className="project-onboarding-scope-holds">
              {onboarding.scopeHolds.map((hold) => (
                <div key={hold.issueId} className="project-onboarding-scope-hold">
                  <span>{hold.title}</span>
                  <div className="project-onboarding-scope-hold-actions">
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={busy || (!projectCompleted && !canApproveScope) || scopeHoldBusyId === hold.issueId}
                      onClick={() => void (projectCompleted ? onStartScopeHoldFollowUp : onApproveScopeHold)(hold.issueId)}
                    >
                      {scopeHoldBusyId === hold.issueId
                        ? "Working..."
                        : projectCompleted
                          ? "Approve as follow-up"
                          : canApproveScope
                            ? "Approve scope"
                            : "Await analysis"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={busy || scopeHoldBusyId === hold.issueId}
                      onClick={() => void onDismissScopeHold(hold.issueId)}
                    >
                      {scopeHoldBusyId === hold.issueId ? "Working..." : "Dismiss hold"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {latestEventSummary && (
          <p className="project-onboarding-event" role="status">
            <span>Latest board event</span>
            {latestEventSummary}
          </p>
        )}

        {hostControlled && !projectCompleted && progress.unrefinedTasks > 0 && (
          <p className="project-onboarding-lock">
            Sprint planning waits for Technical Lead refinement with estimates and acceptance criteria.
          </p>
        )}

        {sprintPlanning && !canStartSprint && progress.unrefinedTasks === 0 && (
          <p className="project-onboarding-lock" role="status">
            Sprint planning needs at least one refined backlog ticket before the first sprint can start.
          </p>
        )}

        {analysisInProgress && (
          <p className="project-onboarding-lock" role="status">
            Stories stay locked until the Technical Lead completes the analysis.
          </p>
        )}

        {analysisReady && (
          <p className="project-onboarding-lock" role="status">
            Review and approve the Technical Lead analysis in the kickoff ticket before Product Owner story discovery
            can start.
          </p>
        )}

        {sprintPlanning && (
          <DeliveryBranchPicker
            busy={busy}
            options={branchOptions}
            selected={selectedBranch}
            customBranch={customBranch}
            suggestion={suggestedBranch}
            onSelect={setBranchChoice}
            onCustomChange={setCustomBranch}
          />
        )}

        {action && (
          <div className="project-onboarding-actions">
            <button
              className={`btn ${actionReady ? "btn-primary" : "btn-secondary"}`}
              type="button"
              disabled={busy || !actionReady}
              onClick={() => void action.run()}
              title={actionReady ? undefined : actionBlockedReason ?? undefined}
            >
              {busy ? "Working…" : action.label}
            </button>
          </div>
        )}

        {canReset && (
          <WorkflowReset
            busy={busy}
            sprintRunning={onboarding.status === "active"}
            onReset={onResetWorkflow}
          />
        )}
      </div>
    </section>
  );
}

interface WorkflowResetProps {
  busy: boolean;
  sprintRunning: boolean;
  onReset: (input: { target: "stories" | "refinement" }) => Promise<void>;
}

/**
 * Der Rueckweg im Ablauf.
 *
 * Stories → Refinement → Sprint laeuft sonst nur vorwaerts: ein Sprint auf
 * falscher Grundlage liess sich nur aussitzen. Der Reset ist bewusst
 * zweistufig — er beendet einen laufenden Sprint und entwertet alle
 * Schaetzungen, und das soll kein Klick aus Versehen sein.
 */
function WorkflowReset({ busy, sprintRunning, onReset }: WorkflowResetProps) {
  const [pending, setPending] = useState<"stories" | "refinement" | null>(null);

  const label = {
    stories: "back to story work",
    refinement: "back to technical refinement",
  };

  return (
    <div className="project-onboarding-reset">
      <p className="project-onboarding-reset-note">
        <strong>Start the workflow over</strong>
        <span>
          {sprintRunning
            ? "Cancels the running sprint, returns every ticket to the backlog, and drops the current estimates. Comments stay on the tickets."
            : "Returns every ticket to the backlog and drops the current estimates. Comments stay on the tickets."}
        </span>
      </p>

      {pending ? (
        <div className="project-onboarding-reset-actions">
          <span className="project-onboarding-reset-confirm">Reset {label[pending]}?</span>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => {
              const target = pending;
              setPending(null);
              void onReset({ target });
            }}
          >
            {busy ? "Working…" : "Yes, reset"}
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={busy}
            onClick={() => setPending(null)}
          >
            Keep going
          </button>
        </div>
      ) : (
        <div className="project-onboarding-reset-actions">
          <button
            className="btn btn-secondary"
            type="button"
            disabled={busy}
            onClick={() => setPending("stories")}
          >
            Revise stories
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={busy}
            onClick={() => setPending("refinement")}
          >
            Refine again
          </button>
        </div>
      )}
    </div>
  );
}

interface DeliveryBranchPickerProps {
  busy: boolean;
  options?: DeliveryBranchOptions;
  selected: string;
  customBranch: string;
  suggestion: string;
  onSelect: (value: string) => void;
  onCustomChange: (value: string) => void;
}

/**
 * Die Branchentscheidung des Humans, vor dem Sprintstart.
 *
 * Ohne sie erfindet jeder Developer-Run seinen eigenen Feature-Branch: die
 * Tickets eines Sprints liegen dann auf mehreren Branches, und der
 * abschliessende Pull Request findet seine Commits nicht wieder.
 */
function DeliveryBranchPicker({
  busy,
  options,
  selected,
  customBranch,
  suggestion,
  onSelect,
  onCustomChange,
}: DeliveryBranchPickerProps) {
  const branches = options?.branches ?? [];
  const creatingBranch = selected === NEW_BRANCH_OPTION;
  const noBranch = selected === NO_BRANCH_OPTION;

  return (
    <div className="project-onboarding-branch">
      <label className="project-onboarding-field">
        <span>Delivery branch (optional)</span>
        <select
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
          disabled={busy}
        >
          <option value={NO_BRANCH_OPTION}>No branch — leave it to the team</option>
          <option value={NEW_BRANCH_OPTION}>Create a new branch…</option>
          {branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
              {branch === options?.defaultBranch ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>

      {creatingBranch && (
        <label className="project-onboarding-field">
          <span>Branch name</span>
          <input
            type="text"
            value={customBranch}
            placeholder={suggestion}
            onChange={(event) => onCustomChange(event.target.value)}
            disabled={busy}
          />
        </label>
      )}

      <p className="project-onboarding-branch-note">
        {options?.error && !noBranch
          ? options.error
          : noBranch
            ? "Without a branch the developers keep deciding for themselves, as before. Pick one to hold the whole sprint on a single branch."
            : "Every ticket of this sprint is delivered on this branch — one pull request for the whole sprint, not one per ticket."}
      </p>
    </div>
  );
}

interface ProjectWorkflowTrackerProps {
  /** Beobachtbarer Fortschritt der laufenden Phase, z. B. angelegte Stories. */
  progressNote?: string | null;
  workflow: ProjectWorkflowActivity;
  onOpenKickoff?: () => void;
  kickoffHref?: string | null;
}

function ProjectWorkflowTracker({
  workflow,
  onOpenKickoff,
  kickoffHref,
  progressNote,
}: ProjectWorkflowTrackerProps) {
  return (
    <div
      className={`project-onboarding-workflow is-${workflow.phase} waiting-on-${workflow.waitingOn}`}
      aria-live="polite"
    >
      <div className="project-onboarding-workflow-summary">
        <span className="project-onboarding-workflow-eyebrow">
          {workflow.waitingOn === "agent" ? "Working now" : "Outside the board now"}
        </span>
        <strong>
          {/* Ein arbeitender Agent war bisher nur an der Formulierung zu
              erkennen. Der Indikator macht die Frage "laeuft ueberhaupt was?"
              auf einen Blick beantwortbar. */}
          {workflow.waitingOn === "agent" && (
            <span className="project-onboarding-working-dot" aria-hidden="true" />
          )}
          {workflow.title}
        </strong>
        <span>{workflow.detail}</span>
        {progressNote && <span className="project-onboarding-workflow-evidence">{progressNote}</span>}
      </div>
      <div className="project-onboarding-workflow-meta">
        <span className="project-onboarding-workflow-actor">
          {workflow.waitingOn === "agent" ? "Running as " : "With "}
          {workflow.actor}
        </span>
        {workflow.attentionRequired && (
          <span className="project-onboarding-workflow-approval">Human approval required</span>
        )}
        <span>{workflow.nextStep}</span>
      </div>
      {(onOpenKickoff || kickoffHref) && (
        <div className="project-onboarding-workflow-actions">
          {onOpenKickoff && (
            <button className="btn btn-secondary" type="button" onClick={onOpenKickoff}>
              {workflow.attentionRequired ? "Review in board" : "Open in board"}
            </button>
          )}
          {kickoffHref && (
            <a className="project-onboarding-workflow-link" href={kickoffHref}>
              {workflow.ticketLinkLabel}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

