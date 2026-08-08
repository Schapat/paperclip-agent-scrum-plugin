/**
 * Sprint Review (Spec §2)
 *
 * Trigger: Sprint abgeschlossen.
 *
 * Ablauf: Die QA präsentiert die abgeschlossenen Arbeiten, der Product Owner
 * bewertet den Business Value, die Ergebnisse werden dokumentiert.
 */

import type { CeremonyRecord, ScrumTask, WorkerState } from '@shared/types';
import { createCeremonyRecord } from '@shared/factories';
import { broadcast, findAgentByRole, recordDecision, sendMessage } from '../communication';
import { collectProposals } from '../learning';
import type { CeremonyContext } from './types';
import { PRIORITY_RANK } from './types';

/**
 * Ergebnis des Sprint Reviews.
 */
export interface SprintReviewResult {
  /** Im Sprint abgeschlossene Tickets */
  completed: ScrumTask[];
  /** Eingeplant, aber nicht fertig geworden */
  carriedOver: ScrumTask[];
  /** Summe der abgeschlossenen Story Points = Velocity des Sprints */
  completedPoints: number;
  /** Anteil erfüllter Akzeptanzkriterien über alle fertigen Tickets */
  criteriaCoverage: number;
}

/**
 * Tickets, die zum aktuellen Sprint gehören.
 *
 * Ohne laufenden Sprint fällt die Auswertung auf alle Tickets zurück, damit
 * das Review auch im reinen Kanban-Betrieb ein Ergebnis liefert.
 */
function sprintTasks(state: WorkerState): ScrumTask[] {
  const sprint = state.currentSprint;
  if (!sprint) return state.tasks;
  return state.tasks.filter((t) => t.sprintId === sprint.id || sprint.taskIds.includes(t.id));
}

/**
 * Wertet den Sprint aus.
 */
export function analyzeSprint(state: WorkerState): SprintReviewResult {
  const tasks = sprintTasks(state);
  const completed = tasks.filter((t) => t.column === 'done');
  const carriedOver = tasks.filter((t) => t.column !== 'done');

  const completedPoints = completed.reduce((sum, t) => sum + t.storyPoints, 0);

  const allCriteria = completed.flatMap((t) => t.acceptanceCriteria);
  const criteriaCoverage = allCriteria.length
    ? allCriteria.filter((c) => c.met).length / allCriteria.length
    : 1;

  return { completed, carriedOver, completedPoints, criteriaCoverage };
}

/**
 * Führt das Sprint Review durch.
 */
export function runSprintReview(ctx: CeremonyContext): CeremonyRecord {
  const { state } = ctx;
  const scrumMaster = findAgentByRole(state, 'scrum_master');
  const productOwner = findAgentByRole(state, 'product_owner');
  const qa = findAgentByRole(state, 'qa_engineer');

  const messageIds: string[] = [];
  const result = analyzeSprint(state);

  messageIds.push(
    broadcast(state, scrumMaster, 'Sprint Review wird gestartet', 'Die QA präsentiert die Ergebnisse.', 'sprint_review')
      .id
  );

  // --- QA präsentiert -----------------------------------------------------
  messageIds.push(
    sendMessage(state, {
      from: qa,
      to: null,
      subject: 'Abgeschlossene Arbeiten',
      body: result.completed.length
        ? `${result.completed.length} Ticket(s) abgeschlossen (${result.completedPoints} Punkte):\n` +
          result.completed.map((t) => `- ${t.title} (${t.storyPoints} P)`).join('\n') +
          `\n\nAkzeptanzkriterien erfüllt: ${Math.round(result.criteriaCoverage * 100)}%`
        : 'In diesem Sprint wurde kein Ticket abgeschlossen.',
      ceremony: 'sprint_review',
    }).id
  );

  // --- Product Owner bewertet den Business Value --------------------------
  const byValue = [...result.completed].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  );
  const highValue = byValue.filter((t) => t.priority === 'critical' || t.priority === 'high');

  messageIds.push(
    sendMessage(state, {
      from: productOwner,
      to: null,
      subject: 'Bewertung Business Value',
      body:
        `${highValue.length} von ${result.completed.length} abgeschlossenen Tickets hatten hohe oder kritische Priorität. ` +
        (result.carriedOver.length
          ? `${result.carriedOver.length} Ticket(s) werden in den nächsten Sprint übernommen.`
          : 'Der Sprint wurde vollständig abgeschlossen.'),
      ceremony: 'sprint_review',
    }).id
  );

  for (const task of result.completed) {
    recordDecision(state, {
      task,
      type: 'ceremony',
      description: 'Im Sprint Review abgenommen',
      reasoning: `Ticket ist "done"; ${task.acceptanceCriteria.filter((c) => c.met).length}/${
        task.acceptanceCriteria.length
      } Akzeptanzkriterien erfüllt.`,
      madeBy: productOwner,
    });
  }

  // --- Produkt-Erkenntnisse in Backlog-Nachschub übersetzen ---------------
  // Ein Review, das nur Velocity festschreibt, erzeugt keinen Wert. Der
  // eigentliche Ertrag ist, was aus dem Gelieferten für das Produkt folgt:
  // offen gebliebene Kriterien, abgeschlossene Epics, wirksam gewordene Risiken.

  const proposals = collectProposals(state, [...result.completed, ...result.carriedOver]);
  state.proposedStories.push(...proposals);

  if (proposals.length > 0) {
    messageIds.push(
      sendMessage(state, {
        from: qa,
        to: productOwner ? [productOwner] : null,
        subject: `${proposals.length} Anschlussarbeit(en) aus dem Sprint`,
        body: proposals.map((p) => `- **${p.title}**\n  ${p.rationale}`).join('\n'),
        ceremony: 'sprint_review',
      }).id
    );

    ctx.requestAgentWork?.({
      ceremony: 'sprint_review',
      role: 'product_owner',
      taskIds: proposals.flatMap((p) => p.sourceTaskIds),
      instruction:
        'Bewerte diese Anschlussarbeiten gegen die Produktvision und lege die relevanten als ' +
        'Backlog-Items an (Beschreibung, Business Value, grobe Akzeptanzkriterien):\n' +
        proposals.map((p) => `- ${p.title} (Anlass: ${p.rationale})`).join('\n'),
    });
  }

  // Nicht abgeschlossene Tickets brauchen eine Entscheidung des PO, statt
  // stillschweigend in den nächsten Sprint zu rutschen
  if (result.carriedOver.length > 0) {
    ctx.requestAgentWork?.({
      ceremony: 'sprint_review',
      role: 'product_owner',
      taskIds: result.carriedOver.map((t) => t.id),
      instruction:
        'Entscheide je Ticket: in den nächsten Sprint übernehmen, neu priorisieren oder ' +
        'zurück ins Backlog. Begründe die Entscheidung am Ticket.',
    });
  }

  // --- Sprint abschließen und Velocity festschreiben ----------------------
  if (state.currentSprint) {
    state.currentSprint.status = 'completed';
    state.currentSprint.completedPoints = result.completedPoints;
    state.currentSprint.velocity = result.completedPoints;
    state.currentSprint.updatedAt = new Date().toISOString();
    state.completedSprints.push(state.currentSprint);
  }

  state.metrics.velocity = result.completedPoints;

  const summary =
    `Sprint Review: ${result.completed.length} Ticket(s) abgeschlossen (${result.completedPoints} Punkte), ` +
    `${result.carriedOver.length} übernommen, ` +
    `${Math.round(result.criteriaCoverage * 100)}% Akzeptanzkriterien erfüllt, ` +
    `${proposals.length} Anschlussarbeit(en) vorgeschlagen.`;

  const record = createCeremonyRecord('sprint_review', state.currentSprint?.id ?? null, summary, {
    messageIds,
    taskIds: result.completed.map((t) => t.id),
  });

  state.ceremonies.push(record);
  return record;
}
