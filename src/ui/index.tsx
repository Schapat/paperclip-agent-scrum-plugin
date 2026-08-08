/**
 * Plugin UI entrypoint.
 *
 * Every export here is referenced by `exportName` in the manifest's UI slots.
 * Data flows through the SDK hooks — `usePluginData` reads what the worker
 * registered via `ctx.data.register`, `usePluginAction` calls what it
 * registered via `ctx.actions.register`. There is no separate transport.
 */

import { useCallback, useMemo, useState } from "react";
import {
  usePluginAction,
  usePluginData,
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
  TaskStatus,
} from "../core/types";

import { KanbanBoard } from "./components/KanbanBoard";
import { AgentLog } from "./components/AgentLog";
import "./styles/index.css";

// ---------------------------------------------------------------------------
// Shapes the worker returns
// ---------------------------------------------------------------------------

interface BoardData {
  tasks: ScrumTask[];
  agents: ScrumAgent[];
  currentSprint: ScrumSprint | null;
  metrics: SprintMetrics;
  ceremonies: CeremonyRecord[];
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

// ---------------------------------------------------------------------------
// Page slot: the board
// ---------------------------------------------------------------------------

export function ScrumBoardPage(_props: PluginWidgetProps) {
  const { data, loading, error, refresh } = usePluginData<BoardData>("board");
  const log = usePluginData<LogData>("log");

  const moveTask = usePluginAction("moveTask");
  const reviewTicket = usePluginAction("reviewTicket");
  const runCeremony = usePluginAction("runCeremony");

  const [logOpen, setLogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const inReview = useMemo(() => tasks.filter((t) => t.column === "in_review"), [tasks]);

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
      await runCeremony({ ceremony });
      refresh();
      log.refresh();
    },
    [runCeremony, refresh, log],
  );

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
      return (task?.decisions ?? []).map((d) => ({
        id: d.id,
        type: "status_change" as const,
        description: d.description,
        reasoning: d.reasoning,
        madeBy: d.madeByName,
        madeByRole: d.madeByRole,
        timestamp: d.timestamp,
        relatedTaskIds: d.relatedTaskIds,
      }));
    },
    [tasks],
  );

  if (loading && !data) return <div className="loading-container">Loading board…</div>;
  if (error) return <div className="error-container">{error.message}</div>;
  if (!data) return <div className="error-container">No board data.</div>;

  const lastCeremony = data.ceremonies[data.ceremonies.length - 1];

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">Agent Scrum</h1>
        <div className="header-center">
          {data.currentSprint ? (
            <span className="sprint-name">{data.currentSprint.name}</span>
          ) : (
            <span className="sprint-name">No active sprint</span>
          )}
        </div>
      </header>

      {notice && <div className="board-notice board-notice-error">{notice}</div>}

      <div className="ceremony-bar">
        {CEREMONIES.map((c) => (
          <button
            key={c.type}
            className="btn btn-secondary"
            onClick={() => void handleCeremony(c.type)}
          >
            {c.label}
          </button>
        ))}
        {inReview.length > 0 && (
          <button className="btn btn-secondary" onClick={() => void handleReview()}>
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
          onFetchComments={fetchComments}
          onFetchDecisions={fetchDecisions}
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
  );
}

// ---------------------------------------------------------------------------
// Dashboard widgets
// ---------------------------------------------------------------------------

export function SprintProgressWidget(_props: PluginWidgetProps) {
  const { data, loading } = usePluginData<BoardData>("board");

  if (loading && !data) return <div className="widget widget-loading">Loading sprint…</div>;
  if (!data) return <div className="widget widget-empty">No sprint data.</div>;

  const { metrics, currentSprint } = data;
  const percent = metrics.totalPoints > 0
    ? Math.round((metrics.completedPoints / metrics.totalPoints) * 100)
    : 0;

  return (
    <div className="widget widget-sprint-progress">
      <h3>{currentSprint?.name ?? "No active sprint"}</h3>
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
      <p>
        {metrics.completedPoints} / {metrics.totalPoints} story points ({percent}%)
      </p>
      <p className="widget-meta">Velocity: {metrics.velocity}</p>
    </div>
  );
}

export function TeamStatusWidget(_props: PluginWidgetProps) {
  const { data, loading } = usePluginData<BoardData>("board");

  if (loading && !data) return <div className="widget widget-loading">Loading team…</div>;
  if (!data) return <div className="widget widget-empty">No team data.</div>;

  return (
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
  );
}
