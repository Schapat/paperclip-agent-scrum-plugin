/**
 * Einbettung gelernter Skills in die Agenten-Instruktionen
 *
 * Ein Skill, der nur im State steht, verändert das Verhalten der Agents nicht.
 * Wirksam wird er erst, wenn er in der `AGENTS.md` des Agents auftaucht — das
 * ist der Text, an dem sich der Agent bei jeder Aufgabe orientiert.
 *
 * Der eingefügte Abschnitt ist durch Marker begrenzt und wird bei jeder
 * Aktualisierung *ersetzt*, nicht angehängt. Ohne diese Idempotenz würde die
 * Instruktionsdatei mit jeder Retrospektive weiter anwachsen und irgendwann
 * das Kontextfenster des Agents auffressen.
 */

import type { AgentSkill, WorkerState } from '../types';
import { activeSkillsForRole } from './extract';

/** Beginn des generierten Abschnitts. */
export const SKILL_BLOCK_START = '<!-- scrum-team:skills:start -->';

/** Ende des generierten Abschnitts. */
export const SKILL_BLOCK_END = '<!-- scrum-team:skills:end -->';

/**
 * Reihenfolge der Kategorien im Abschnitt.
 *
 * Qualität zuerst: das sind die Skills aus Review-Rückweisungen, also die
 * Fehler, die das Team tatsächlich schon gemacht hat.
 */
const CATEGORY_ORDER: AgentSkill['category'][] = [
  'quality',
  'code',
  'architecture',
  'process',
  'domain',
  'tooling',
];

const CATEGORY_LABELS: Record<AgentSkill['category'], string> = {
  quality: 'Qualität',
  code: 'Code',
  architecture: 'Architektur',
  process: 'Prozess',
  domain: 'Fachlichkeit',
  tooling: 'Werkzeuge',
};

/**
 * Sortiert Skills: erst nach Kategorie, dann nach Bestätigungshäufigkeit.
 *
 * Ein oft bestätigter Skill steht oben — er beruht auf mehr Evidenz.
 */
function sortSkills(skills: AgentSkill[]): AgentSkill[] {
  return [...skills].sort((a, b) => {
    const byCategory = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (byCategory !== 0) return byCategory;
    if (b.reinforcementCount !== a.reinforcementCount) {
      return b.reinforcementCount - a.reinforcementCount;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Rendert die aktiven Skills als Markdown-Abschnitt.
 *
 * Liefert einen leeren String, wenn es keine Skills gibt — dann entfällt der
 * Abschnitt vollständig, statt eine leere Überschrift zu hinterlassen.
 */
export function renderSkillBlock(skills: AgentSkill[]): string {
  const active = skills.filter((s) => s.active);
  if (active.length === 0) return '';

  const lines: string[] = [
    SKILL_BLOCK_START,
    '',
    '## Gelernte Arbeitsweisen',
    '',
    'Diese Punkte hat das Team aus abgeschlossener Arbeit gelernt. Sie sind',
    'verbindlich — halte dich bei jeder Aufgabe daran.',
    '',
  ];

  let lastCategory: AgentSkill['category'] | null = null;
  for (const skill of sortSkills(active)) {
    if (skill.category !== lastCategory) {
      lines.push(`### ${CATEGORY_LABELS[skill.category] ?? skill.category}`, '');
      lastCategory = skill.category;
    }

    // Die Bestätigungszahl macht sichtbar, wie belastbar die Erkenntnis ist
    const confidence =
      skill.reinforcementCount > 1 ? ` _(${skill.reinforcementCount}× bestätigt)_` : '';
    lines.push(`- **${skill.name}**${confidence}`, `  ${skill.description}`, '');
  }

  lines.push(SKILL_BLOCK_END);
  return lines.join('\n');
}

/**
 * Entfernt einen vorhandenen Skill-Abschnitt aus einem Instruktionstext.
 *
 * Fehlt einer der Marker, bleibt der Text unverändert — lieber ein doppelter
 * Abschnitt als versehentlich abgeschnittene Basis-Instruktionen.
 */
export function stripSkillBlock(instructions: string): string {
  const start = instructions.indexOf(SKILL_BLOCK_START);
  if (start === -1) return instructions;

  const end = instructions.indexOf(SKILL_BLOCK_END, start);
  if (end === -1) return instructions;

  const before = instructions.slice(0, start);
  const after = instructions.slice(end + SKILL_BLOCK_END.length);
  return `${before.trimEnd()}\n${after.trimStart()}`.trimEnd();
}

/**
 * Setzt die aktiven Skills in einen Instruktionstext ein.
 *
 * Idempotent: mehrfaches Anwenden mit denselben Skills liefert denselben Text.
 * Ein vorhandener Abschnitt wird ersetzt, bei leerer Skill-Liste entfernt.
 */
export function applySkillBlock(instructions: string, skills: AgentSkill[]): string {
  const base = stripSkillBlock(instructions).trimEnd();
  const block = renderSkillBlock(skills);

  if (!block) return base;
  return `${base}\n\n${block}\n`;
}

/**
 * Beschreibt eine anstehende Aktualisierung der Instruktionen eines Agents.
 */
export interface InstructionUpdate {
  agentId: string;
  agentName: string;
  role: string;
  /** Vollständiger neuer Inhalt der AGENTS.md */
  instructions: string;
  /** Skills, die den Abschnitt füllen */
  skillIds: string[];
}

/**
 * Baut die Instruktionen für eine Rolle: Basis plus aktive Skills.
 *
 * Liefert `null`, wenn für die Rolle keine Basis-Instruktionen bekannt sind —
 * dann würde ein Update den bestehenden Text des Agents durch einen reinen
 * Skill-Abschnitt ersetzen und seine eigentliche Rollenbeschreibung löschen.
 */
export function buildInstructionsForRole(state: WorkerState, role: string): string | null {
  const base = state.agentInstructions[role];
  if (!base) return null;

  return applySkillBlock(base, activeSkillsForRole(state, role));
}

/**
 * Ermittelt die Instruktions-Updates für alle Agents der genannten Rollen.
 *
 * Übersprungen werden Rollen ohne bekannte Basis sowie Agents, deren Text sich
 * nicht ändern würde — ein Update ohne Änderung wäre ein unnötiger Schreib-
 * zugriff auf den Agent.
 */
export function collectInstructionUpdates(
  state: WorkerState,
  roles: Iterable<string>,
  /** Bereits ausgelieferter Stand je Agent, um No-Ops zu erkennen */
  current: Record<string, string> = {}
): InstructionUpdate[] {
  const updates: InstructionUpdate[] = [];

  for (const role of new Set(roles)) {
    const instructions = buildInstructionsForRole(state, role);
    if (!instructions) continue;

    const skillIds = activeSkillsForRole(state, role).map((s) => s.id);

    for (const agent of state.agents.filter((a) => a.role === role)) {
      if (current[agent.id] === instructions) continue;

      updates.push({
        agentId: agent.id,
        agentName: agent.name,
        role,
        instructions,
        skillIds,
      });
    }
  }

  return updates;
}
