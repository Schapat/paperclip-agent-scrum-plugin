/**
 * Plugin UI entrypoint.
 *
 * Every export here is referenced by `exportName` in the manifest's UI slots.
 * Data flows through the SDK hooks — `usePluginData` reads what the worker
 * registered via `ctx.data.register`, `usePluginAction` calls what it
 * registered via `ctx.actions.register`. There is no separate transport.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  usePluginAction,
  usePluginData,
  type PluginSidebarProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";

import type {
  AgentDecision,
  AgentMessage,
  AgentSkill,
  Learning,
  ProposedStory,
  ScrumAgent,
  ScrumSprint,
  ScrumTask,
  SprintMetrics,
  CeremonyRecord,
  CeremonyType,
  ProjectOnboarding,
  TaskStatus,
} from "../core/types";
import type { ProjectProgress } from "../core/project-issue-projection";

import { KanbanBoard } from "./components/KanbanBoard";
import { AgentLog } from "./components/AgentLog";
import { ProjectOnboardingPanel, type ProjectOption } from "./components/ProjectOnboardingPanel";
import { AgentScrumStyleSheet } from "./styles";

// ---------------------------------------------------------------------------
// Shapes the worker returns
// ---------------------------------------------------------------------------

interface BoardData {
  tasks: ScrumTask[];
  agents: ScrumAgent[];
  currentSprint: ScrumSprint | null;
  metrics: SprintMetrics;
  ceremonies: CeremonyRecord[];
  projectOnboarding: ProjectOnboarding;
  canStartProjectOnboarding: boolean;
  canStartProjectSprint: boolean;
  projectProgress: ProjectProgress;
}

interface LogData {
  messages: AgentMessage[];
  decisions: AgentDecision[];
  learnings: Learning[];
  skills: AgentSkill[];
  proposedStories: ProposedStory[];
}

/** Ceremonies an operator can start by hand. */
const CEREMONIES: Array<{ type: CeremonyType; label: string }> = [
  { type: "sprint_planning", label: "Planning" },
  { type: "backlog_refinement", label: "Refinement" },
  { type: "impediment_resolution", label: "Clear blockers" },
  { type: "sprint_review", label: "Review" },
  { type: "sprint_retrospective", label: "Retrospective" },
];

function AgentScrumRoot({ children }: { children: ReactNode }) {
  return (
    <div className="agent-scrum-root">
      <AgentScrumStyleSheet />
      {children}
    </div>
  );
}

/** Native navigation entry alongside the host's company navigation items. */
export function ScrumBoardSidebarLink({ context }: PluginSidebarProps) {
  const href = context.companyPrefix ? `/${context.companyPrefix}/scrum-board` : "/scrum-board";
  const isActive = typeof window !== "undefined" && window.location.pathname.startsWith(href);

  return (
    <a
      href={href}
      aria-current={isActive ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.5rem 0.75rem",
        borderRadius: "0.375rem",
        color: "var(--foreground)",
        background: isActive ? "var(--accent)" : "transparent",
        fontSize: "0.875rem",
        fontWeight: 500,
        lineHeight: 1.25,
        textDecoration: "none",
      }}
    >
      <span aria-hidden="true">▦</span>
      <span>Scrum Board</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Page slot: the board
// ---------------------------------------------------------------------------

export function ScrumBoardPage({ context }: PluginWidgetProps) {
  const { data, loading, error, refresh } = usePluginData<BoardData>("board");
  const log = usePluginData<LogData>("log");
  const projects = usePluginData<ProjectOption[]>("projects");

  const moveTask = usePluginAction("moveTask");
  const reviewTicket = usePluginAction("reviewTicket");
  const runCeremony = usePluginAction("runCeremony");
  const startProjectOnboarding = usePluginAction("startProjectOnboarding");
  const startBacklogDiscovery = usePluginAction("startBacklogDiscovery");
  const activateProjectOnboarding = usePluginAction("activateProjectOnboarding");
  const startProjectSprint = usePluginAction("startProjectSprint");
  const requestProjectRefinement = usePluginAction("requestProjectRefinement");
  const retryProjectRefinement = usePluginAction("retryProjectRefinement");

  const [logOpen, setLogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [refinementBusy, setRefinementBusy] = useState(false);

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const inReview = useMemo(() => tasks.filter((t) => t.column === "in_review"), [tasks]);

  useEffect(() => {
    if (!data?.projectOnboarding.rootIssueId) return;

    const interval = window.setInterval(() => refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [data?.projectOnboarding.rootIssueId, refresh]);

  const handleMove = useCallback(
    async (task: ScrumTask, _from: TaskStatus, to: TaskStatus) => {
      const result = (await moveTask({ taskId: task.id, column: to })) as {
        moved?: boolean;
        error?: string;
      };
      // A rejected transition is a rule, not a failure — show it, keep going.
      if (!result?.moved) setNotice(result?.error ?? "Transition not allowed");
      else setNotice(null);
      refresh();
      return Boolean(result?.moved);
    },
    [moveTask, refresh],
  );

  const handleCeremony = useCallback(
    async (ceremony: CeremonyType) => {
      const result = (await runCeremony({ ceremony })) as { started?: boolean; error?: string };
      if (!result?.started) setNotice(result?.error ?? "Ceremony could not start");
      else setNotice(null);
      refresh();
      log.refresh();
    },
    [runCeremony, refresh, log],
  );

  const refreshOnboarding = useCallback(() => {
    refresh();
    projects.refresh();
    log.refresh();
  }, [refresh, projects, log]);

  const handleStartProjectOnboarding = useCallback(
    async (input: { projectId: string; brief: string; constraints: string }) => {
      setOnboardingBusy(true);
      try {
        const result = (await startProjectOnboarding(input)) as {
          started?: boolean;
          error?: string;
          wakeup?: { queued?: boolean; error?: string | null };
        };
        if (!result?.started) setNotice(result?.error ?? "Project request could not start");
        else if (result.wakeup?.queued === false) setNotice(result.wakeup.error ?? "Technical analysis could not queue");
        else setNotice(null);
        refreshOnboarding();
      } catch (actionError) {
        setNotice(actionError instanceof Error ? actionError.message : "Project request could not start");
      } finally {
        setOnboardingBusy(false);
      }
    },
    [startProjectOnboarding, refreshOnboarding],
  );

  const handleStartBacklogDiscovery = useCallback(async () => {
    setOnboardingBusy(true);
    try {
      const result = (await startBacklogDiscovery({})) as {
        started?: boolean;
        error?: string;
        wakeup?: { queued?: boolean; error?: string | null };
      };
      if (!result?.started) setNotice(result?.error ?? "Story discovery could not start");
      else if (result.wakeup?.queued === false) setNotice(result.wakeup.error ?? "Story discovery could not queue");
      else setNotice(null);
      refreshOnboarding();
    } catch (actionError) {
      setNotice(actionError instanceof Error ? actionError.message : "Story discovery could not start");
    } finally {
      setOnboardingBusy(false);
    }
  }, [startBacklogDiscovery, refreshOnboarding]);

  const handleActivateProjectOnboarding = useCallback(async () => {
    setOnboardingBusy(true);
    try {
      const result = (await activateProjectOnboarding({})) as { activated?: boolean; error?: string };
      if (!result?.activated) setNotice(result?.error ?? "Backlog could not be approved");
      else setNotice(null);
      refreshOnboarding();
    } catch (actionError) {
      setNotice(actionError instanceof Error ? actionError.message : "Backlog could not be approved");
    } finally {
      setOnboardingBusy(false);
    }
  }, [activateProjectOnboarding, refreshOnboarding]);

  const handleStartProjectSprint = useCallback(async () => {
    setOnboardingBusy(true);
    try {
      const result = (await startProjectSprint({})) as { started?: boolean; error?: string };
      if (!result?.started) setNotice(result?.error ?? "Sprint could not start");
      else setNotice(null);
      refreshOnboarding();
    } catch (actionError) {
      setNotice(actionError instanceof Error ? actionError.message : "Sprint could not start");
    } finally {
      setOnboardingBusy(false);
    }
  }, [refreshOnboarding, startProjectSprint]);

  const handleRequestProjectRefinement = useCallback(async () => {
    setRefinementBusy(true);
    try {
      const hasPriorRequest = Boolean(
        data?.projectOnboarding.refinementRequestedTaskIds.some((taskId) =>
          tasks.some((task) => task.id === taskId && !task.refined)
        )
      );
      const result = (await (hasPriorRequest ? retryProjectRefinement : requestProjectRefinement)({})) as {
        requested?: boolean;
        error?: string | null;
        taskIds?: string[];
      };
      if (!result?.requested) setNotice(result?.error ?? "Technical refinement could not start");
      else setNotice(null);
      refresh();
    } catch (actionError) {
      setNotice(actionError instanceof Error ? actionError.message : "Technical refinement could not start");
    } finally {
      setRefinementBusy(false);
    }
  }, [data?.projectOnboarding.refinementRequestedTaskIds, requestProjectRefinement, refresh, retryProjectRefinement, tasks]);

  const handleReview = useCallback(async () => {
    for (const task of inReview) {
      await reviewTicket({ taskId: task.id });
    }
    refresh();
    log.refresh();
  }, [inReview, reviewTicket, refresh, log]);

  const fetchComments = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      return (task?.comments ?? []).map((c) => ({
        id: c.id,
        authorId: c.authorId ?? "",
        authorName: c.authorName,
        authorRole: c.authorRole,
        body: c.body,
        createdAt: c.createdAt,
      }));
    },
    [tasks],
  );

  const fetchDecisions = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return [];

      const structured = task.decisions.map((decision) => ({
        id: decision.id,
        type: decision.type,
        description: decision.description,
        reasoning: decision.reasoning,
        madeBy: decision.madeByName,
        madeByRole: decision.madeByRole,
        timestamp: decision.timestamp,
        relatedTaskIds: decision.relatedTaskIds,
      }));
      const hostTransitions = task.statusHistory.slice(1).map((entry, index) => ({
        id: `host-status:${task.id}:${index}:${entry.timestamp}`,
        type: "status_change" as const,
        description: `Paperclip status: ${entry.from ?? "new"} → ${entry.to}`,
        reasoning: "Synchronized from the Paperclip issue workflow.",
        madeBy: entry.triggeredBy ?? "Paperclip",
        madeByRole: "host",
        timestamp: entry.timestamp,
        relatedTaskIds: [],
      }));

      return [...structured, ...hostTransitions].sort((left, right) =>
        right.timestamp.localeCompare(left.timestamp)
      );
    },
    [tasks],
  );

  if (loading && !data) {
    return <AgentScrumRoot><div className="loading-container">Loading board…</div></AgentScrumRoot>;
  }
  if (error) {
    return <AgentScrumRoot><div className="error-container">{error.message}</div></AgentScrumRoot>;
  }
  if (!data) {
    return <AgentScrumRoot><div className="error-container">No board data.</div></AgentScrumRoot>;
  }

  const lastCeremony = data.ceremonies[data.ceremonies.length - 1];
  const deliveryEnabled = data.projectOnboarding.status === "active";
  const hostControlled = Boolean(
    data.projectOnboarding.rootIssueId &&
      tasks.some((task) => task.parentId === data.projectOnboarding.rootIssueId),
  );
  const hasPriorRefinementRequest = data.projectOnboarding.refinementRequestedTaskIds.some((taskId) =>
    tasks.some((task) => task.id === taskId && !task.refined)
  );
  const kickoffHref =
    data.projectOnboarding.rootIssueId && context.companyPrefix
      ? `/${context.companyPrefix}/issues/${data.projectOnboarding.rootIssueId}`
      : null;

  return (
    <AgentScrumRoot>
      <div className="app">
      <header className="header">
        <h1 className="logo">Agent Scrum</h1>
        <div className="header-center">
          {data.currentSprint ? (
            <span className="sprint-name">{data.currentSprint.name}</span>
          ) : data.projectOnboarding.status === "sprint_planning" ? (
            <span className="sprint-name">Sprint planning</span>
          ) : (hostControlled && deliveryEnabled) ? (
            <span className="sprint-name">Paperclip project delivery</span>
          ) : (
            <span className="sprint-name">No active sprint</span>
          )}
        </div>
      </header>

      {notice && <div className="board-notice board-notice-error">{notice}</div>}

      <ProjectOnboardingPanel
        onboarding={data.projectOnboarding}
        projects={projects.data ?? []}
        busy={onboardingBusy}
        hostControlled={hostControlled}
        canStart={data.canStartProjectOnboarding}
        kickoffHref={kickoffHref}
        progress={data.projectProgress}
        latestEventSummary={lastCeremony?.summary ?? null}
        canStartSprint={data.canStartProjectSprint}
        onStart={handleStartProjectOnboarding}
        onStartBacklogDiscovery={handleStartBacklogDiscovery}
        onActivate={handleActivateProjectOnboarding}
        onStartSprint={handleStartProjectSprint}
      />

      <div className="ceremony-bar">
        {hostControlled &&
          data.projectOnboarding.status === "active" &&
          data.projectProgress.unrefinedTasks > 0 && (
          <button
            className="btn btn-secondary"
            onClick={() => void handleRequestProjectRefinement()}
            disabled={refinementBusy}
          >
            {refinementBusy
              ? "Requesting refinement…"
              : `${hasPriorRefinementRequest ? "Retry" : "Request"} refinement (${data.projectProgress.unrefinedTasks})`}
          </button>
        )}
        {CEREMONIES.map((c) => (
          <button
            key={c.type}
            className="btn btn-secondary"
            onClick={() => void handleCeremony(c.type)}
            disabled={
              hostControlled ||
              (!deliveryEnabled &&
                (c.type === "sprint_planning" || c.type === "backlog_refinement"))
            }
            title={
              hostControlled
                ? "Project-backed tickets are coordinated through their Paperclip issues."
                : undefined
            }
          >
            {c.label}
          </button>
        ))}
        {inReview.length > 0 && (
          <button
            className="btn btn-secondary"
            onClick={() => void handleReview()}
            disabled={hostControlled}
            title={
              hostControlled
                ? "Project-backed tickets are reviewed through their Paperclip issues."
                : undefined
            }
          >
            QA review ({inReview.length})
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => setLogOpen(true)}>
          Agent log
        </button>
        {lastCeremony && <span className="ceremony-last">{lastCeremony.summary}</span>}
      </div>

      <main className="main-content">
        <KanbanBoard
          initialTasks={tasks}
          pollingInterval={0}
          showLoadingSkeleton={false}
          onMoveTask={handleMove}
          enableDragDrop={!hostControlled}
          onFetchComments={fetchComments}
          onFetchDecisions={fetchDecisions}
          agents={data.agents}
        />
      </main>

        <AgentLog
          messages={log.data?.messages ?? []}
          decisions={log.data?.decisions ?? []}
          tasks={tasks}
          learnings={log.data?.learnings ?? []}
          skills={log.data?.skills ?? []}
          proposedStories={log.data?.proposedStories ?? []}
          isOpen={logOpen}
          onClose={() => setLogOpen(false)}
        />
      </div>
    </AgentScrumRoot>
  );
}

// ---------------------------------------------------------------------------
// Dashboard widgets
// ---------------------------------------------------------------------------

export function SprintProgressWidget(_props: PluginWidgetProps) {
  const { data, loading } = usePluginData<BoardData>("board");

  if (loading && !data) {
    return <AgentScrumRoot><div className="widget widget-loading">Loading sprint…</div></AgentScrumRoot>;
  }
  if (!data) {
    return <AgentScrumRoot><div className="widget widget-empty">No sprint data.</div></AgentScrumRoot>;
  }

  const { metrics, currentSprint, projectOnboarding, projectProgress } = data;
  const showingProjectProgress = !currentSprint && projectProgress.totalTasks > 0;
  const percent = showingProjectProgress
    ? projectProgress.percent
    : metrics.totalPoints > 0
      ? Math.round((metrics.completedPoints / metrics.totalPoints) * 100)
      : 0;
  const title = currentSprint?.name ?? (showingProjectProgress
    ? `${projectOnboarding.projectName ?? "Project"} progress`
    : "No active sprint");
  const progressText = showingProjectProgress
    ? projectProgress.measure === "story_points"
      ? `${projectProgress.completedPoints} / ${projectProgress.estimatedPoints} story points`
      : `${projectProgress.doneTasks} / ${projectProgress.totalTasks} tasks complete`
    : `${metrics.completedPoints} / ${metrics.totalPoints} story points`;

  return (
    <AgentScrumRoot>
      <div className="widget widget-sprint-progress">
      <h3>{title}</h3>
      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Sprint progress"
      >
        <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <p>{progressText} ({percent}%)</p>
      <p className="widget-meta">
        {showingProjectProgress
          ? `${projectProgress.refinedTasks}/${projectProgress.totalTasks} tasks refined · ${projectProgress.inProgressTasks} in development`
          : `Velocity: ${metrics.velocity}`}
      </p>
      </div>
    </AgentScrumRoot>
  );
}

export function TeamStatusWidget(_props: PluginWidgetProps) {
  const { data, loading } = usePluginData<BoardData>("board");

  if (loading && !data) {
    return <AgentScrumRoot><div className="widget widget-loading">Loading team…</div></AgentScrumRoot>;
  }
  if (!data) {
    return <AgentScrumRoot><div className="widget widget-empty">No team data.</div></AgentScrumRoot>;
  }

  return (
    <AgentScrumRoot>
      <div className="widget widget-team-status">
      <h3>Team</h3>
      <ul className="team-list">
        {data.agents.map((agent) => {
          const task = data.tasks.find((t) => t.id === agent.currentTaskId);
          return (
            <li key={agent.id} className={`team-member team-member-${agent.status}`}>
              <span className="team-member-name">{agent.name}</span>
              <span className="team-member-task">{task ? task.title : "idle"}</span>
            </li>
          );
        })}
      </ul>
      </div>
    </AgentScrumRoot>
  );
}
