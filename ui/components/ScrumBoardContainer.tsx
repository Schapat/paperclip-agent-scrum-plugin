/**
 * ScrumBoardContainer
 *
 * Gemeinsamer Container für beide Einstiegspunkte (Paperclip-Page in
 * `exports.tsx` und Dev-Harness in `App.tsx`). Vorher gab es zwei
 * auseinandergelaufene Kopien mit je eigenen Demo-Daten — hier existiert die
 * Board-Logik genau einmal, gespeist aus dem echten Worker-State.
 */

import { useCallback, useMemo, useState } from 'react';
import type { CeremonyType, PluginSettings, ScrumTask } from '@shared/types';
import { KanbanBoard } from './KanbanBoard';
import { Header } from './Header';
import { Settings } from './Settings';
import { AgentLog } from './AgentLog';
import type { Comment, Decision } from './TicketDetailPanel';
import { useScrumBoard } from '../hooks/useScrumBoard';
import { loadSettingsFromStorage, saveSettingsToStorage } from '../lib/settings-storage';

/**
 * Zeremonien, die sich von Hand auslösen lassen (Spec §2).
 */
const CEREMONIES: Array<{ type: CeremonyType; label: string }> = [
  { type: 'sprint_planning', label: 'Sprint Planning' },
  { type: 'backlog_refinement', label: 'Refinement' },
  { type: 'impediment_resolution', label: 'Blocker lösen' },
  { type: 'sprint_review', label: 'Review' },
  { type: 'sprint_retrospective', label: 'Retrospektive' },
];

export interface ScrumBoardContainerProps {
  /** Polling-Intervall des Boards in ms */
  pollingInterval?: number;
}

export function ScrumBoardContainer({ pollingInterval = 5000 }: ScrumBoardContainerProps) {
  const { state, loading, error, moveTask, runCeremony, reviewTicket, ceremonies, messages, decisions } =
    useScrumBoard({ pollingIntervalMs: pollingInterval });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [settings, setSettings] = useState<PluginSettings>(() => loadSettingsFromStorage());

  const handleSettingsChange = useCallback((next: PluginSettings) => {
    setSettings(next);
    saveSettingsToStorage(next);
  }, []);

  const tasks = useMemo(() => state?.tasks ?? [], [state]);

  /**
   * Kommentare eines Tickets für das Detail-Panel.
   *
   * Sie liegen bereits am Ticket (der Message-Bus spiegelt jede
   * Agenten-Nachricht dorthin), es ist also kein Nachladen nötig.
   */
  const fetchComments = useCallback(
    async (taskId: string): Promise<Comment[]> => {
      const task = tasks.find((t) => t.id === taskId);
      return (task?.comments ?? []).map((c) => ({
        id: c.id,
        authorId: c.authorId ?? '',
        authorName: c.authorName,
        authorRole: c.authorRole,
        body: c.body,
        createdAt: c.createdAt,
      }));
    },
    [tasks]
  );

  /**
   * Protokollierte Agentenentscheidungen eines Tickets (Spec §5).
   */
  const fetchDecisions = useCallback(
    async (taskId: string): Promise<Decision[]> => {
      const task = tasks.find((t) => t.id === taskId);
      return (task?.decisions ?? []).map((d) => ({
        id: d.id,
        type: toPanelDecisionType(d.type),
        description: d.description,
        reasoning: d.reasoning,
        madeBy: d.madeByName,
        madeByRole: d.madeByRole,
        timestamp: d.timestamp,
        relatedTaskIds: d.relatedTaskIds,
      }));
    },
    [tasks]
  );

  const handleMoveTask = useCallback(
    (task: ScrumTask, from: ScrumTask['column'], to: ScrumTask['column']) => moveTask(task, from, to),
    [moveTask]
  );

  if (loading && !state) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <p>Lade Scrum Board...</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="error-container">
        <h1>Scrum Board nicht verfügbar</h1>
        <p>{error ?? 'Der Worker hat keinen State geliefert.'}</p>
      </div>
    );
  }

  const lastCeremony = ceremonies[ceremonies.length - 1];
  const inReview = state.tasks.filter((t) => t.column === 'in_review');

  return (
    <div className="app">
      <Header currentSprint={state.currentSprint} onSettingsClick={() => setSettingsOpen(true)} />

      {/* Fehler blockieren das Board nicht — z.B. ein abgelehnter Übergang */}
      {error && <div className="board-notice board-notice-error">{error}</div>}

      <div className="ceremony-bar">
        {CEREMONIES.map((c) => (
          <button
            key={c.type}
            className="btn btn-secondary"
            onClick={() => runCeremony(c.type)}
            title={`${c.label} jetzt durchführen`}
          >
            {c.label}
          </button>
        ))}
        {/* QA-Review für alles, was in der Review-Spalte wartet (Spec §3) */}
        {inReview.length > 0 && (
          <button
            className="btn btn-secondary"
            onClick={() => inReview.forEach((t) => void reviewTicket(t.id))}
            title="Alle Tickets in Review gegen ihre Akzeptanzkriterien prüfen"
          >
            QA-Review ({inReview.length})
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={() => setLogOpen(true)}
          title="Alle Agenten-Nachrichten und -Entscheidungen ansehen"
        >
          Agenten-Log
        </button>
        {lastCeremony && <span className="ceremony-last">{lastCeremony.summary}</span>}
      </div>

      <main className="main-content">
        <KanbanBoard
          initialTasks={tasks}
          pollingInterval={0}
          showLoadingSkeleton={false}
          onMoveTask={handleMoveTask}
          onFetchComments={fetchComments}
          onFetchDecisions={fetchDecisions}
        />
      </main>

      <Settings
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onClose={() => setSettingsOpen(false)}
        isOpen={settingsOpen}
      />

      <AgentLog
        messages={messages}
        decisions={decisions}
        tasks={tasks}
        learnings={state.learnings}
        skills={state.skills}
        proposedStories={state.proposedStories}
        isOpen={logOpen}
        onClose={() => setLogOpen(false)}
      />
    </div>
  );
}

/**
 * Bildet die Entscheidungstypen der Domäne auf die des Detail-Panels ab.
 *
 * Das Panel kennt nur eine Teilmenge; alles Übrige wird als `status_change`
 * dargestellt, damit keine Entscheidung im Verlauf verschwindet.
 */
function toPanelDecisionType(type: string): Decision['type'] {
  const known: Decision['type'][] = [
    'auto_assign',
    'status_change',
    'priority_change',
    'estimation',
    'blocked',
    'unblocked',
  ];
  return known.includes(type as Decision['type']) ? (type as Decision['type']) : 'status_change';
}
