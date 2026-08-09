import { useState, type FormEvent } from "react";

import type { ProjectOnboarding } from "../../core/types";
import type { ProjectProgress } from "../../core/project-issue-projection";
import { describeProjectWorkflow, type ProjectWorkflowActivity } from "./project-workflow";

export interface ProjectOption {
  id: string;
  name: string;
}

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
  scopeHoldBusyId: string | null;
  onStart: (input: {
    projectId: string;
    brief: string;
    constraints: string;
    skipSprintPlanning: boolean;
  }) => Promise<void>;
  onActivate: () => Promise<void>;
  onStartSprint: () => Promise<void>;
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
  scopeHoldBusyId,
  onStart,
  onActivate,
  onStartSprint,
  onApproveScopeHold,
  onStartScopeHoldFollowUp,
  onDismissScopeHold,
}: ProjectOnboardingPanelProps) {
  const [projectId, setProjectId] = useState("");
  const [brief, setBrief] = useState("");
  const [constraints, setConstraints] = useState("");
  const [skipSprintPlanning, setSkipSprintPlanning] = useState(false);
  const [startingNextProject, setStartingNextProject] = useState(false);
  const planningNextFeature = onboarding.status === "completed";
  const workflow = describeProjectWorkflow(onboarding, progress);

  function submitStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onStart({ projectId, brief, constraints, skipSprintPlanning });
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
      : onboarding.status === "sprint_planning" && canStartSprint
        ? { label: "Start first sprint", run: onStartSprint }
      : onboarding.status === "completed" && canStart
        ? { label: "Plan next feature", run: startNextFeature }
      : null;
  const analysisInProgress = onboarding.status === "analysis_in_progress";
  const analysisReady = onboarding.status === "analysis_ready";
  const sprintPlanning = onboarding.status === "sprint_planning";
  const projectCompleted = onboarding.status === "completed";
  const canApproveScope =
    onboarding.status === "backlog_in_progress" ||
    onboarding.status === "sprint_planning" ||
    onboarding.status === "active";

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
        />

        <p className={`project-onboarding-stage is-${onboarding.status}`}>
          {analysisInProgress && <span className="project-onboarding-spinner" aria-hidden="true" />}
          {stageLabel(onboarding.status, hostControlled)}
        </p>

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

        {action && (
          <div className="project-onboarding-actions">
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void action.run()}>
              {busy ? "Working…" : action.label}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

interface ProjectWorkflowTrackerProps {
  workflow: ProjectWorkflowActivity;
  onOpenKickoff?: () => void;
  kickoffHref?: string | null;
}

function ProjectWorkflowTracker({ workflow, onOpenKickoff, kickoffHref }: ProjectWorkflowTrackerProps) {
  return (
    <div className={`project-onboarding-workflow is-${workflow.phase}`} aria-live="polite">
      <div className="project-onboarding-workflow-summary">
        <span className="project-onboarding-workflow-eyebrow">Outside the board now</span>
        <strong>{workflow.title}</strong>
        <span>{workflow.detail}</span>
      </div>
      <div className="project-onboarding-workflow-meta">
        <span className="project-onboarding-workflow-actor">With {workflow.actor}</span>
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

function stageLabel(status: ProjectOnboarding["status"], hostControlled: boolean): string {
  switch (status) {
    case "analysis_in_progress":
      return "Technical analysis in progress";
    case "analysis_ready":
      return "Technical analysis ready for approval";
    case "backlog_in_progress":
      return "Product Owner is preparing the first backlog";
    case "sprint_planning":
      return "Sprint planning waits for human approval";
    case "active":
      return hostControlled ? "Paperclip delivery active" : "Delivery enabled";
    case "completed":
      return "Project request complete — ready for the next feature";
    default:
      return "Project request not started";
  }
}