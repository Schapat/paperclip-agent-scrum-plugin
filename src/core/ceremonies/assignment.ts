/**
 * Skill-basierte Ticketzuweisung (Spec §3, Spalte TODO)
 *
 * Der Product Owner analysiert verfügbare Entwickler, berücksichtigt deren
 * Skills und weist passende Tickets zu. Die Auswahl ist deterministisch und
 * begründbar — jede Zuweisung wird mit ihrem Score als Entscheidung
 * protokolliert.
 */

import type { ScrumAgent, ScrumTask, WorkerState } from '../types';

/**
 * Bewertung eines Entwicklers für ein Ticket.
 */
export interface AssignmentCandidate {
  agent: ScrumAgent;
  /** Anzahl übereinstimmender Skills */
  skillScore: number;
  /** Aktuell laufende Tickets */
  load: number;
  /** Menschenlesbare Begründung */
  reason: string;
}

/**
 * Skills eines Agents — `skills` bevorzugt, sonst die Capabilities.
 */
function skillsOf(agent: ScrumAgent): string[] {
  const raw = agent.skills?.length ? agent.skills : agent.capabilities;
  return raw.map((s) => s.toLowerCase());
}

/**
 * Zählt laufende Tickets eines Agents (Development + Review).
 */
export function currentLoad(agent: ScrumAgent, state: WorkerState): number {
  return state.tasks.filter(
    (t) =>
      t.assignedAgentId === agent.id && (t.column === 'in_progress' || t.column === 'in_review')
  ).length;
}

/**
 * Bewertet alle Entwickler für ein Ticket.
 *
 * Der Skill-Score zählt Überschneidungen zwischen den Labels des Tickets und
 * den Skills des Entwicklers. Entwickler am WIP-Limit fallen ganz heraus,
 * damit die Zuweisung das Limit nie verletzt.
 */
export function rankCandidates(
  task: ScrumTask,
  developers: ScrumAgent[],
  state: WorkerState
): AssignmentCandidate[] {
  const wipLimit = state.settings.wipLimits.development;
  const wanted = task.labels.map((l) => l.toLowerCase());

  return developers
    .map((agent) => {
      const skills = skillsOf(agent);
      const matched = wanted.filter((label) => skills.includes(label));
      const load = currentLoad(agent, state);

      const reason = matched.length
        ? `Skills ${matched.join(', ')} passen zu den Ticket-Labels; aktuelle Auslastung ${load}/${wipLimit}.`
        : `Keine Skill-Überschneidung, aber freie Kapazität (${load}/${wipLimit}).`;

      return { agent, skillScore: matched.length, load, reason };
    })
    .filter((c) => c.load < wipLimit)
    .sort((a, b) => {
      // Bester Skill-Match zuerst, bei Gleichstand die geringste Auslastung.
      if (b.skillScore !== a.skillScore) return b.skillScore - a.skillScore;
      return a.load - b.load;
      // Danach bewusst kein weiteres Kriterium: `sort` ist stabil, also bleibt
      // die uebergebene Teamreihenfolge erhalten. Nach der UUID zu sortieren
      // waere zwar deterministisch, aber sachlich willkuerlich — Developer 2
      // ginge vor Developer 1, sobald sein Schluessel kleiner ist.
    });
}

/**
 * Wählt den besten Entwickler für ein Ticket.
 *
 * Liefert `null`, wenn alle Entwickler am WIP-Limit sind — dann bleibt das
 * Ticket in TODO liegen, statt das Limit zu sprengen.
 */
export function pickAssignee(
  task: ScrumTask,
  developers: ScrumAgent[],
  state: WorkerState
): AssignmentCandidate | null {
  return rankCandidates(task, developers, state)[0] ?? null;
}
