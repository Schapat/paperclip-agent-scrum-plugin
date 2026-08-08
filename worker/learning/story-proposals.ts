/**
 * Ableitung neuer Backlog-Items aus abgeschlossener Arbeit
 *
 * Review und Retrospektive sollen nicht nur zurückblicken, sondern Nachschub
 * für das Backlog erzeugen. Vorgeschlagen wird nur, was einen konkreten Anlass
 * im Board hat — der Product Owner formuliert die Story anschließend aus.
 */

import type { ProposedStory, ScrumTask, WorkerState } from '@shared/types';
import { createId } from '@shared/factories';

/**
 * Erzeugt einen Vorschlag.
 */
function propose(
  title: string,
  rationale: string,
  sourceTaskIds: string[],
  suggestedType: ProposedStory['suggestedType'] = 'improvement',
  suggestedPriority: ProposedStory['suggestedPriority'] = 'medium'
): ProposedStory {
  return {
    id: createId(),
    title,
    rationale,
    suggestedType,
    suggestedPriority,
    sourceTaskIds,
    createdTaskId: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Leitet Vorschläge aus nicht erfüllten Akzeptanzkriterien ab.
 *
 * Ein Ticket gilt als fertig, obwohl einzelne Kriterien offen blieben — dieser
 * Rest muss sichtbar bleiben, statt still unterzugehen.
 */
export function proposeFromUnmetCriteria(tasks: ScrumTask[]): ProposedStory[] {
  const proposals: ProposedStory[] = [];

  for (const task of tasks.filter((t) => t.column === 'done')) {
    const unmet = task.acceptanceCriteria.filter((c) => !c.met);
    if (unmet.length === 0) continue;

    proposals.push(
      propose(
        `Offene Kriterien aus "${task.title}" nachziehen`,
        `Das Ticket wurde abgeschlossen, ${unmet.length} Akzeptanzkriterium/-kriterien blieben offen: ` +
          unmet.map((c) => c.text).join('; '),
        [task.id],
        'improvement',
        'high'
      )
    );
  }

  return proposals;
}

/**
 * Leitet Vorschläge aus eingetretenen Risiken ab.
 *
 * Ein Risiko ohne hinterlegte Gegenmaßnahme, das ein Ticket blockiert hat,
 * bleibt sonst für kommende Tickets bestehen.
 */
export function proposeFromRisks(tasks: ScrumTask[]): ProposedStory[] {
  const proposals: ProposedStory[] = [];

  for (const task of tasks) {
    const wasBlocked = task.statusHistory.some((h) => h.to === 'blocked');
    if (!wasBlocked) continue;

    for (const risk of task.risks.filter((r) => r.severity === 'high' && !r.mitigation)) {
      proposals.push(
        propose(
          `Gegenmaßnahme für Risiko: ${risk.description}`,
          `Das Risiko wurde bei "${task.title}" wirksam und hat das Ticket blockiert, eine Gegenmaßnahme fehlt.`,
          [task.id],
          'improvement',
          'high'
        )
      );
    }
  }

  return proposals;
}

/**
 * Leitet einen Vorschlag aus wiederholten Review-Rückweisungen ab.
 *
 * Häufen sich Rückweisungen, ist meist die Definition of Done oder die
 * Testabdeckung das eigentliche Problem — und damit selbst ein Arbeitspaket.
 */
export function proposeFromRejections(tasks: ScrumTask[], threshold = 3): ProposedStory[] {
  const rejections = tasks.reduce(
    (sum, task) =>
      sum + task.statusHistory.filter((h) => h.from === 'in_review' && h.to === 'in_progress').length,
    0
  );

  if (rejections < threshold) return [];

  return [
    propose(
      'Definition of Done schärfen und Testabdeckung erhöhen',
      `Im Sprint gab es ${rejections} Review-Rückweisungen — ein Hinweis darauf, dass Tickets zu früh als fertig gemeldet werden.`,
      tasks
        .filter((t) => t.statusHistory.some((h) => h.from === 'in_review' && h.to === 'in_progress'))
        .map((t) => t.id),
      'improvement',
      'high'
    ),
  ];
}

/**
 * Leitet Vorschläge aus Epics ab, deren Subtasks vollständig fertig sind.
 *
 * Ein abgeschlossenes Epic ist meist der Anlass für den nächsten Ausbauschritt.
 */
export function proposeFollowUps(tasks: ScrumTask[]): ProposedStory[] {
  const epics = tasks.filter((t) => t.type === 'epic');
  const proposals: ProposedStory[] = [];

  for (const epic of epics) {
    const children = tasks.filter((t) => t.parentId === epic.id);
    if (children.length === 0) continue;
    if (!children.every((c) => c.column === 'done')) continue;

    proposals.push(
      propose(
        `Folgeschritte zu "${epic.title}" festlegen`,
        `Alle ${children.length} Subtasks des Epics sind abgeschlossen — der nächste Ausbauschritt ist zu bestimmen.`,
        [epic.id, ...children.map((c) => c.id)],
        'feature',
        'medium'
      )
    );
  }

  return proposals;
}

/**
 * Sammelt alle Vorschläge und entfernt bereits bekannte.
 *
 * Ohne die Duplikatsprüfung würde derselbe Vorschlag in jedem Sprint erneut
 * auftauchen, solange sein Anlass im Board steht.
 */
export function collectProposals(state: WorkerState, tasks: ScrumTask[]): ProposedStory[] {
  const all = [
    ...proposeFromUnmetCriteria(tasks),
    ...proposeFromRisks(tasks),
    ...proposeFromRejections(tasks),
    ...proposeFollowUps(tasks),
  ];

  const knownTitles = new Set(state.proposedStories.map((p) => p.title.toLowerCase()));
  const existingTitles = new Set(state.tasks.map((t) => t.title.toLowerCase()));

  return all.filter((proposal) => {
    const key = proposal.title.toLowerCase();
    if (knownTitles.has(key) || existingTitles.has(key)) return false;
    knownTitles.add(key);
    return true;
  });
}
