import { useState, type FormEvent } from "react";

import type { ProjectOnboarding } from "../../core/types";
import type { ProjectProgress } from "../../core/project-issue-projection";

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
  kickoffHref: string | null;
  progress: ProjectProgress;
  latestEventSummary: string | null;
  canStartSprint: boolean;
  onStart: (input: { projectId: string; brief: string; constraints: string }) => Promise<void>;
  onStartBacklogDiscovery: () => Promise<void>;
  onActivate: () => Promise<void>;
  onStartSprint: () => Promise<void>;
}

export function ProjectOnboardingPanel({
  onboarding,
  projects,
  busy,
  hostControlled,
  canStart,
  kickoffHref,
  progress,
  latestEventSummary,
  canStartSprint,
  onStart,
  onStartBacklogDiscovery,
  onActivate,
  onStartSprint,
}: ProjectOnboardingPanelProps) {
  const [projectId, setProjectId] = useState("");
  const [brief, setBrief] = useState("");
  const [constraints, setConstraints] = useState("");
  const [startingNextProject, setStartingNextProject] = useState(false);

  function submitStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onStart({ projectId, brief, constraints });
  }

  if (canStart && (onboarding.status !== "completed" || startingNextProject)) {
    return (
      <section className="project-onboarding" aria-labelledby="project-onboarding-title">
        <div className="project-onboarding-heading">
          <p className="project-onboarding-eyebrow">Project work</p>
          <h2 id="project-onboarding-title">
            {onboarding.status === "completed" ? "Start next project request" : "Start a project request"}
          </h2>
        </div>

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
            <span>Work request</span>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Describe the requested outcome"
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

          <div className="project-onboarding-actions project-onboarding-field-wide">
            <button className="btn btn-primary" type="submit" disabled={busy || projects.length === 0}>
              {busy ? "Starting…" : "Start technical analysis"}
            </button>
          </div>
        </form>
      </section>
    );
  }

  const action = onboarding.status === "analysis_ready"
    ? { label: "Start story discovery", run: onStartBacklogDiscovery }
    : onboarding.status === "backlog_in_progress"
      ? {
          label: onboarding.requiresSprint ? "Approve backlog for sprint planning" : "Approve backlog",
          run: onActivate,
        }
      : onboarding.status === "sprint_planning" && canStartSprint
        ? { label: "Start first sprint", run: onStartSprint }
      : onboarding.status === "completed" && canStart
        ? { label: "Start next project request", run: () => setStartingNextProject(true) }
      : null;
  const analysisInProgress = onboarding.status === "analysis_in_progress";
  const sprintPlanning = onboarding.status === "sprint_planning";
  const projectCompleted = onboarding.status === "completed";

  return (
    <section className="project-onboarding project-onboarding-status" aria-labelledby="project-onboarding-title">
      <div className="project-onboarding-heading">
        <p className="project-onboarding-eyebrow">Project work</p>
        <h2 id="project-onboarding-title">{onboarding.projectName ?? "Project request"}</h2>
      </div>

      <div className="project-onboarding-progress">
        {onboarding.rootIssueId && (
          kickoffHref ? (
            <a className="project-onboarding-kickoff" href={kickoffHref}>
              <span className="project-onboarding-kickoff-kind">Kickoff ticket</span>
              <strong>Kickoff: {onboarding.projectName}</strong>
              <span>Open the Technical Lead analysis in Paperclip</span>
            </a>
          ) : (
            <div className="project-onboarding-kickoff">
              <span className="project-onboarding-kickoff-kind">Kickoff ticket</span>
              <strong>Kickoff: {onboarding.projectName}</strong>
            </div>
          )
        )}

        <p className={`project-onboarding-stage is-${onboarding.status}`}>
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
            Project request complete. No follow-up work will start until a human creates a new project request.
          </p>
        )}

        {onboarding.scopeHolds.length > 0 && (
          <div className="project-onboarding-lock" role="alert">
            <strong>Human scope approval required</strong>
            <span>
              {onboarding.scopeHolds.length} agent-created item{onboarding.scopeHolds.length === 1 ? " was" : "s were"} held outside this project: {onboarding.scopeHolds.map((hold) => hold.title).join(", ")}.
            </span>
          </div>
        )}

        {latestEventSummary && (
          <p className="project-onboarding-event" role="status">
            <span>Latest workflow event</span>
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

function stageLabel(status: ProjectOnboarding["status"], hostControlled: boolean): string {
  switch (status) {
    case "analysis_in_progress":
      return "Technical analysis in progress";
    case "analysis_ready":
      return "Technical analysis ready for review";
    case "backlog_in_progress":
      return "Product Owner is preparing the first backlog";
    case "sprint_planning":
      return "Sprint planning waits for human approval";
    case "active":
      return hostControlled ? "Paperclip delivery active" : "Delivery enabled";
    case "completed":
      return "Project request complete — awaiting human direction";
    default:
      return "Project request not started";
  }
}