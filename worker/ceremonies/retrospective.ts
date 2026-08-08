/**
 * Sprint Retrospektive (Spec §2)
 *
 * Trigger: nach dem Sprint Review.
 *
 * Ablauf: Analyse des Entwicklungsprozesses, Identifikation von Bottlenecks,
 * Verbesserungsvorschläge, Anpassung der Agentenstrategien.
 *
 * Die Bottleneck-Analyse ist aus dem Ticketverlauf berechenbar: wie lange
 * Tickets je Spalte lagen, wie oft Reviews zurückgewiesen wurden und wo das
 * WIP-Limit verletzt wurde.
 */

import type {
  AgentSkill,
  CeremonyRecord,
  RetrospectiveResult,
  ScrumTask,
  TaskStatus,
  WorkerState,
} from '@shared/types';
import { createCeremonyRecord } from '@shared/factories';
import { broadcast, findAgentByRole, sendMessage } from '../communication';
import {
  collectCandidates,
  collectInstructionUpdates,
  collectProposals,
  createSkill,
  findMatchingSkill,
  reinforceSkill,
  toLearning,
} from '../learning';
import type { CeremonyContext } from './types';

/**
 * Ab wie vielen Stunden Verweildauer eine Spalte als Bottleneck gilt.
 */
export const BOTTLENECK_HOURS = 48;

/**
 * Durchschnittliche Verweildauer je Spalte in Stunden.
 *
 * Berechnet aus `statusHistory`: die Zeit zwischen dem Eintritt in eine Spalte
 * und dem nächsten Statuswechsel. Tickets, die eine Spalte nie verlassen
 * haben, zählen bis jetzt.
 */
export function averageTimePerColumn(tasks: ScrumTask[], now = Date.now()): Record<string, number> {
  const totals: Record<string, { ms: number; count: number }> = {};

  for (const task of tasks) {
    const history = task.statusHistory;
    for (let i = 0; i < history.length; i++) {
      const entry = history[i];
      const enteredAt = Date.parse(entry.timestamp);
      if (Number.isNaN(enteredAt)) continue;

      const next = history[i + 1];
      const leftAt = next ? Date.parse(next.timestamp) : now;
      if (Number.isNaN(leftAt)) continue;

      const bucket = (totals[entry.to] ??= { ms: 0, count: 0 });
      bucket.ms += Math.max(0, leftAt - enteredAt);
      bucket.count += 1;
    }
  }

  const result: Record<string, number> = {};
  for (const [column, { ms, count }] of Object.entries(totals)) {
    result[column] = count > 0 ? ms / count / 3_600_000 : 0;
  }
  return result;
}

/**
 * Zählt, wie oft Tickets aus dem Review zurück in die Entwicklung gingen.
 *
 * Ein hoher Wert bedeutet, dass Tickets die Entwicklung zu früh verlassen —
 * ein klassischer Qualitäts-Bottleneck.
 */
export function countReviewRejections(tasks: ScrumTask[]): number {
  return tasks.reduce(
    (sum, task) =>
      sum +
      task.statusHistory.filter((h) => h.from === 'in_review' && h.to === 'in_progress').length,
    0
  );
}

/**
 * Tickets, die zum betrachteten Sprint gehören.
 *
 * Die Retro schaut auf die Arbeit *dieses* Sprints — ohne diese Eingrenzung
 * würde sie in jedem Durchlauf dieselben Learnings aus der gesamten
 * Projekthistorie erneut ableiten.
 */
export function sprintScopedTasks(state: WorkerState): ScrumTask[] {
  const sprint = state.currentSprint;
  if (!sprint) return state.tasks;

  const scoped = state.tasks.filter(
    (t) => t.sprintId === sprint.id || sprint.taskIds.includes(t.id)
  );
  return scoped.length > 0 ? scoped : state.tasks;
}

/**
 * Führt die Retrospektive durch und leitet konkrete Verbesserungen ab.
 */
export function analyzeProcess(state: WorkerState): RetrospectiveResult {
  const tasks = sprintScopedTasks(state);
  const perColumn = averageTimePerColumn(tasks);
  const rejections = countReviewRejections(tasks);
  const completed = tasks.filter((t) => t.column === 'done');

  const wentWell: string[] = [];
  const bottlenecks: string[] = [];
  const improvements: string[] = [];

  if (completed.length > 0) {
    const points = completed.reduce((sum, t) => sum + t.storyPoints, 0);
    wentWell.push(`${completed.length} Ticket(s) mit ${points} Story Points abgeschlossen.`);
  }

  const columnLabels: Partial<Record<TaskStatus, string>> = {
    backlog: 'Backlog',
    todo: 'TODO',
    in_progress: 'Development',
    in_review: 'Review',
    blocked: 'Blocked',
  };

  for (const [column, hours] of Object.entries(perColumn)) {
    if (column === 'done') continue;
    const label = columnLabels[column as TaskStatus] ?? column;
    if (hours >= BOTTLENECK_HOURS) {
      bottlenecks.push(`Tickets liegen im Schnitt ${hours.toFixed(1)}h in "${label}".`);
      improvements.push(
        column === 'in_review'
          ? 'Review-Kapazität erhöhen oder Review-WIP-Limit senken, damit Tickets nicht liegen bleiben.'
          : `Ursachen für die lange Verweildauer in "${label}" klären und Tickets kleiner schneiden.`
      );
    } else if (hours > 0) {
      wentWell.push(`Kurze Durchlaufzeit in "${label}" (${hours.toFixed(1)}h im Schnitt).`);
    }
  }

  if (rejections > 0) {
    bottlenecks.push(`${rejections}× wurde ein Ticket vom Review zurück in die Entwicklung geschickt.`);
    improvements.push(
      'Akzeptanzkriterien vor Entwicklungsstart schärfen und Definition of Done im Team verbindlich machen.'
    );
  } else if (completed.length > 0) {
    wentWell.push('Kein Ticket musste aus dem Review zurückgeschickt werden.');
  }

  const blocked = tasks.filter((t) => t.column === 'blocked');
  if (blocked.length > 0) {
    bottlenecks.push(`${blocked.length} Ticket(s) sind aktuell blockiert.`);
    improvements.push('Blocker im Daily konsequent eskalieren, statt sie über Sprints zu tragen.');
  }

  const unrefined = tasks.filter((t) => t.column === 'backlog' && !t.refined);
  if (unrefined.length >= 5) {
    bottlenecks.push(`${unrefined.length} unverfeinerte Tickets stauen sich im Backlog.`);
    improvements.push('Refinement fest einplanen, statt es nur bei Leerlauf auszulösen.');
  }

  if (bottlenecks.length === 0) {
    wentWell.push('Keine Bottlenecks im Prozess erkennbar.');
  }

  // Learnings, Skills und Story-Vorschläge füllt `runRetrospective` — sie
  // verändern den State und gehören deshalb nicht in die reine Analyse.
  return { wentWell, bottlenecks, improvements, learningIds: [], skillIds: [], proposedStories: [] };
}

/**
 * Führt die Sprint-Retrospektive durch.
 */
export function runRetrospective(ctx: CeremonyContext): CeremonyRecord {
  const { state } = ctx;
  const scrumMaster = findAgentByRole(state, 'scrum_master');

  const messageIds: string[] = [];
  const retrospective = analyzeProcess(state);

  messageIds.push(
    broadcast(
      state,
      scrumMaster,
      'Sprint Retrospektive wird gestartet',
      'Wir schauen auf den Prozess: Was lief gut, wo klemmt es?',
      'sprint_retrospective'
    ).id
  );

  // ---------------------------------------------------------------------------
  // Learnings aus der Arbeit des Sprints gewinnen
  // ---------------------------------------------------------------------------
  // Das ist der eigentliche Zweck der Retro: Ohne sie liefert das Team in jedem
  // Sprint dasselbe Ergebnis. Learnings sind der einzige Mechanismus, über den
  // es mit der Zeit *besser* wird.

  const sprintId = state.currentSprint?.id ?? null;
  const tasks = sprintScopedTasks(state);
  const candidates = collectCandidates(tasks, averageTimePerColumn(tasks));

  const learningIds: string[] = [];
  const skillIds: string[] = [];
  const newSkills: AgentSkill[] = [];
  const reinforced: AgentSkill[] = [];

  for (const candidate of candidates) {
    const existing = findMatchingSkill(state, candidate);
    const learning = toLearning(candidate, sprintId, existing?.id ?? null);

    if (existing) {
      // Wiederkehrendes Muster bestärkt den vorhandenen Skill, statt ein
      // Duplikat anzulegen
      reinforceSkill(existing, learning.id);
      if (!skillIds.includes(existing.id)) skillIds.push(existing.id);
      reinforced.push(existing);
    } else {
      const skill = createSkill(candidate, learning.id);
      learning.skillId = skill.id;
      state.skills.push(skill);
      skillIds.push(skill.id);
      newSkills.push(skill);
    }

    state.learnings.push(learning);
    learningIds.push(learning.id);
  }

  // ---------------------------------------------------------------------------
  // Neue Backlog-Items vorschlagen
  // ---------------------------------------------------------------------------

  const proposals = collectProposals(state, tasks);
  state.proposedStories.push(...proposals);

  retrospective.learningIds = learningIds;
  retrospective.skillIds = skillIds;
  retrospective.proposedStories = proposals;

  // ---------------------------------------------------------------------------
  // Ergebnis kommunizieren
  // ---------------------------------------------------------------------------

  messageIds.push(
    sendMessage(state, {
      from: scrumMaster,
      to: null,
      subject: 'Ergebnis der Retrospektive',
      body: [
        `**Was lief gut**\n${bulletList(retrospective.wentWell)}`,
        `**Bottlenecks**\n${bulletList(retrospective.bottlenecks)}`,
        `**Verbesserungen**\n${bulletList(retrospective.improvements)}`,
      ].join('\n\n'),
      ceremony: 'sprint_retrospective',
    }).id
  );

  // Aktivierte Skills betreffen konkrete Rollen — die erfahren es direkt
  const activated = [...newSkills, ...reinforced].filter((s) => s.active);
  let instructionUpdates = 0;

  if (activated.length > 0) {
    const affectedRoles = new Set(activated.flatMap((s) => s.roles));
    const recipients = state.agents.filter((a) => affectedRoles.has(a.role));

    messageIds.push(
      sendMessage(state, {
        from: scrumMaster,
        to: recipients.length > 0 ? recipients : null,
        subject: `${activated.length} Skill(s) aktiviert`,
        body:
          'Diese Erkenntnisse gelten ab sofort für eure Arbeit:\n' +
          activated.map((s) => `- **${s.name}**: ${s.description}`).join('\n'),
        ceremony: 'sprint_retrospective',
      }).id
    );

    // Entscheidend: Der Skill wird erst dadurch wirksam, dass er in der
    // AGENTS.md des Agents landet. Eine Nachricht allein ändert sein Verhalten
    // bei der nächsten Aufgabe nicht.
    for (const update of collectInstructionUpdates(state, affectedRoles)) {
      ctx.updateAgentInstructions?.(update);
      instructionUpdates += 1;
    }
  }

  if (proposals.length > 0) {
    const productOwner = findAgentByRole(state, 'product_owner');

    messageIds.push(
      sendMessage(state, {
        from: scrumMaster,
        to: productOwner ? [productOwner] : null,
        subject: `${proposals.length} neue Backlog-Item(s) vorgeschlagen`,
        body: proposals.map((p) => `- **${p.title}**\n  ${p.rationale}`).join('\n'),
        ceremony: 'sprint_retrospective',
      }).id
    );

    // Ausformuliert werden die Stories vom Product Owner — das Plugin liefert
    // nur den belegten Anlass
    ctx.requestAgentWork?.({
      ceremony: 'sprint_retrospective',
      role: 'product_owner',
      taskIds: [],
      instruction:
        'Formuliere aus diesen Anlässen Backlog-Items mit Beschreibung, Business Value und ' +
        'groben Akzeptanzkriterien:\n' +
        proposals.map((p) => `- ${p.title} (Anlass: ${p.rationale})`).join('\n'),
    });
  }

  if (newSkills.some((s) => !s.active)) {
    const pending = newSkills.filter((s) => !s.active);
    ctx.requestAgentWork?.({
      ceremony: 'sprint_retrospective',
      role: 'technical_lead',
      taskIds: pending.flatMap((s) =>
        state.learnings.filter((l) => s.learningIds.includes(l.id)).flatMap((l) => l.sourceTaskIds)
      ),
      instruction:
        'Prüfe diese Erkenntnisse und bestätige, ob sie als verbindlicher Skill gelten sollen:\n' +
        pending.map((s) => `- ${s.name}: ${s.description}`).join('\n'),
    });
  }

  const summary =
    `Retrospektive: ${learningIds.length} Learning(s), ` +
    `${skillIds.length} Skill(s) (${activated.length} aktiv, ${instructionUpdates} Instruktion(en) aktualisiert), ` +
    `${proposals.length} Story-Vorschlag/-Vorschläge, ` +
    `${retrospective.bottlenecks.length} Bottleneck(s).`;

  const record = createCeremonyRecord('sprint_retrospective', sprintId, summary, {
    messageIds,
    taskIds: [...new Set(candidates.flatMap((c) => c.taskIds))],
    retrospective,
  });

  state.ceremonies.push(record);
  return record;
}

function bulletList(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join('\n') : '- —';
}
