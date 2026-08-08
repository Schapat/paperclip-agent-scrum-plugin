/**
 * AgentLog
 *
 * Globales, nachvollziehbares Protokoll des Teams (Spec §7):
 * jede Agenten-Nachricht und jede Entscheidung samt Begründung.
 *
 * Ergänzt die ticketbezogene Sicht im Detail-Panel um den Blick über das
 * gesamte Board — nur so sieht man Prozessentscheidungen, die an keinem
 * einzelnen Ticket hängen (etwa Zeremonie-Broadcasts des Scrum Masters).
 */

import { useMemo, useState } from 'react';
import type {
  AgentDecision,
  AgentMessage,
  AgentSkill,
  Learning,
  ProposedStory,
  ScrumTask,
} from '../../core/types';

export interface AgentLogProps {
  messages: AgentMessage[];
  decisions: AgentDecision[];
  /** Für die Auflösung von Ticket-IDs zu Titeln */
  tasks: ScrumTask[];
  /** In Retrospektiven gewonnene Erkenntnisse */
  learnings?: Learning[];
  /** Daraus abgeleitete Fähigkeiten der Agents */
  skills?: AgentSkill[];
  /** Von Review/Retro vorgeschlagene Backlog-Items */
  proposedStories?: ProposedStory[];
  isOpen: boolean;
  onClose: () => void;
}

type LogFilter = 'all' | 'messages' | 'decisions' | 'learnings';

/** Vereinheitlichter Eintrag, damit beide Quellen chronologisch mischbar sind. */
interface LogEntry {
  id: string;
  kind: 'message' | 'decision';
  timestamp: string;
  actor: string;
  actorRole: string;
  title: string;
  body: string;
  /** Nur bei Entscheidungen gesetzt */
  reasoning?: string;
  taskId: string | null;
}

const ROLE_ICONS: Record<string, string> = {
  product_owner: '📋',
  scrum_master: '🛡️',
  technical_lead: '⚙️',
  developer: '💻',
  qa_engineer: '🔍',
  system: '🤖',
};

function iconFor(role: string): string {
  return ROLE_ICONS[role] ?? '🤖';
}

export function AgentLog({
  messages,
  decisions,
  tasks,
  learnings = [],
  skills = [],
  proposedStories = [],
  isOpen,
  onClose,
}: AgentLogProps) {
  const [filter, setFilter] = useState<LogFilter>('all');

  const entries = useMemo<LogEntry[]>(() => {
    const fromMessages: LogEntry[] = messages.map((m) => ({
      id: m.id,
      kind: 'message',
      timestamp: m.timestamp,
      actor: m.fromAgentName,
      actorRole: m.fromAgentRole,
      title: m.subject,
      body: m.body,
      taskId: m.taskId,
    }));

    const fromDecisions: LogEntry[] = decisions.map((d) => ({
      id: d.id,
      kind: 'decision',
      timestamp: d.timestamp,
      actor: d.madeByName,
      actorRole: d.madeByRole,
      title: d.description,
      body: '',
      reasoning: d.reasoning,
      taskId: d.taskId,
    }));

    const all =
      filter === 'messages' ? fromMessages : filter === 'decisions' ? fromDecisions : [...fromMessages, ...fromDecisions];

    // Jüngste zuerst
    return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [messages, decisions, filter]);

  if (!isOpen) return null;

  const titleOf = (id: string | null): string | null => {
    if (!id) return null;
    return tasks.find((t) => t.id === id)?.title ?? `#${id.slice(0, 8)}`;
  };

  return (
    <div className="agent-log-overlay" onClick={onClose} role="presentation">
      <aside
        className="agent-log"
        role="dialog"
        aria-modal="true"
        aria-label="Agenten-Log"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="agent-log-header">
          <h2>Agenten-Log</h2>
          <button className="btn btn-icon" onClick={onClose} aria-label="Log schließen">
            ✕
          </button>
        </header>

        <div className="agent-log-filters" role="tablist">
          {(
            [
              ['all', 'Alle'],
              ['messages', 'Nachrichten'],
              ['decisions', 'Entscheidungen'],
              ['learnings', `Learnings (${learnings.length})`],
            ] as Array<[LogFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={filter === value}
              className={`agent-log-filter ${filter === value ? 'is-active' : ''}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {filter === 'learnings' ? (
          <LearningsPanel learnings={learnings} skills={skills} proposals={proposedStories} />
        ) : entries.length === 0 ? (
          <p className="agent-log-empty">
            Noch keine Einträge — starte eine Zeremonie, um das Team in Bewegung zu setzen.
          </p>
        ) : (
          <ol className="agent-log-entries">
            {entries.map((entry) => {
              const ticket = titleOf(entry.taskId);
              return (
                <li key={`${entry.kind}-${entry.id}`} className={`agent-log-entry is-${entry.kind}`}>
                  <div className="agent-log-entry-head">
                    <span className="agent-log-icon" aria-hidden="true">
                      {iconFor(entry.actorRole)}
                    </span>
                    <span className="agent-log-actor">{entry.actor}</span>
                    <span className="agent-log-kind">
                      {entry.kind === 'decision' ? 'Entscheidung' : 'Nachricht'}
                    </span>
                    <time className="agent-log-time" dateTime={entry.timestamp}>
                      {new Date(entry.timestamp).toLocaleString('de-DE')}
                    </time>
                  </div>

                  <div className="agent-log-title">{entry.title}</div>
                  {entry.body && <div className="agent-log-body">{entry.body}</div>}
                  {entry.reasoning && (
                    <div className="agent-log-reasoning">
                      <strong>Begründung:</strong> {entry.reasoning}
                    </div>
                  )}
                  {ticket && <div className="agent-log-ticket">→ {ticket}</div>}
                </li>
              );
            })}
          </ol>
        )}
      </aside>
    </div>
  );
}

/**
 * Zeigt, was das Team gelernt hat und was daraus folgt.
 *
 * Ohne diese Ansicht wären Skills unsichtbarer State — der Mehrwert der
 * Retrospektive wäre für niemanden nachvollziehbar.
 */
function LearningsPanel({
  learnings,
  skills,
  proposals,
}: {
  learnings: Learning[];
  skills: AgentSkill[];
  proposals: ProposedStory[];
}) {
  if (learnings.length === 0 && skills.length === 0 && proposals.length === 0) {
    return (
      <p className="agent-log-empty">
        Noch keine Learnings — sie entstehen in der Retrospektive aus den erledigten Tickets eines
        Sprints.
      </p>
    );
  }

  const active = skills.filter((s) => s.active);
  const pending = skills.filter((s) => !s.active);

  return (
    <div className="learnings-panel">
      {active.length > 0 && (
        <section>
          <h3>Aktive Skills ({active.length})</h3>
          <ul className="learnings-list">
            {active.map((skill) => (
              <li key={skill.id} className="learning-item is-active">
                <div className="learning-title">{skill.name}</div>
                <div className="learning-body">{skill.description}</div>
                <div className="learning-meta">
                  {skill.roles.join(', ')} · {skill.reinforcementCount}× bestätigt
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <h3>Zur Bestätigung ({pending.length})</h3>
          <ul className="learnings-list">
            {pending.map((skill) => (
              <li key={skill.id} className="learning-item">
                <div className="learning-title">{skill.name}</div>
                <div className="learning-body">{skill.description}</div>
                <div className="learning-meta">
                  Wird aktiv, sobald sich das Muster wiederholt
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {learnings.length > 0 && (
        <section>
          <h3>Erkenntnisse ({learnings.length})</h3>
          <ul className="learnings-list">
            {learnings.map((learning) => (
              <li key={learning.id} className="learning-item">
                <div className="learning-body">{learning.insight}</div>
                {/* Der Beleg macht die Erkenntnis nachprüfbar */}
                <div className="learning-meta">
                  {learning.category} · {learning.evidence}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {proposals.length > 0 && (
        <section>
          <h3>Vorgeschlagene Backlog-Items ({proposals.length})</h3>
          <ul className="learnings-list">
            {proposals.map((proposal) => (
              <li key={proposal.id} className="learning-item">
                <div className="learning-title">{proposal.title}</div>
                <div className="learning-meta">{proposal.rationale}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
