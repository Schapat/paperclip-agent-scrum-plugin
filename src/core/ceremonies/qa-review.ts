/**
 * QA-Review (Spec §3, Spalte Review)
 *
 * Die QA prüft ein Ticket gegen seine Akzeptanzkriterien und entscheidet:
 *
 *   - alle Kriterien erfüllt → Done
 *   - sonst → zurück nach Development, mit konkretem Feedback
 *
 * Das Feedback ist bewusst spezifisch (welche Kriterien fehlen, welche
 * Prüfpunkte offen sind) — Spec §3 verlangt "konkretes Feedback,
 * Verbesserungsvorschläge, offene Punkte, fehlende Tests".
 */

import type { AgentDecision, ScrumTask, WorkerState } from '../types';
import { findAgentByRole, recordDecision, sendMessage } from '../communication';
import { validateTransition } from '../hooks/transitions';

/**
 * Prüfpunkte der QA über die Akzeptanzkriterien hinaus (Spec §3 Review).
 */
export interface QaChecklist {
  tests: boolean;
  codeQuality: boolean;
  performance: boolean;
  security: boolean;
  documentation: boolean;
}

export const DEFAULT_CHECKLIST: QaChecklist = {
  tests: true,
  codeQuality: true,
  performance: true,
  security: true,
  documentation: true,
};

const CHECKLIST_LABELS: Record<keyof QaChecklist, string> = {
  tests: 'Tests',
  codeQuality: 'Codequalität',
  performance: 'Performance',
  security: 'Sicherheit',
  documentation: 'Dokumentation',
};

export interface ReviewInput {
  /** IDs der Kriterien, die die QA als erfüllt bestätigt */
  metCriterionIds?: string[];
  /** Ergebnis der übrigen Prüfpunkte */
  checklist?: Partial<QaChecklist>;
  /** Freitext-Anmerkungen der QA */
  notes?: string;
}

export interface ReviewResult {
  passed: boolean;
  /** Neue Spalte des Tickets */
  column: ScrumTask['column'];
  /** Nicht erfüllte Akzeptanzkriterien */
  unmetCriteria: string[];
  /** Fehlgeschlagene Prüfpunkte */
  failedChecks: string[];
  decision: AgentDecision;
}

/**
 * Führt das QA-Review für ein Ticket durch.
 *
 * Liefert `null`, wenn das Ticket nicht in der Review-Spalte steht — ein
 * Review außerhalb von "Review" wäre ein Fehler im Aufrufer, kein stiller
 * Statuswechsel.
 */
export function reviewTicket(
  state: WorkerState,
  taskId: string,
  input: ReviewInput = {}
): ReviewResult | null {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || task.column !== 'in_review') return null;

  const qa = findAgentByRole(state, 'qa_engineer');
  const developer = state.agents.find((a) => a.id === task.assignedAgentId) ?? null;
  const now = new Date().toISOString();

  // --- Akzeptanzkriterien abhaken ----------------------------------------
  // Ohne explizite Angabe bleibt der bisherige Stand erhalten; so kann die QA
  // ein Review auch in mehreren Schritten durchführen.
  if (input.metCriterionIds) {
    const confirmed = new Set(input.metCriterionIds);
    for (const criterion of task.acceptanceCriteria) {
      criterion.met = confirmed.has(criterion.id);
      criterion.verifiedBy = qa?.id ?? null;
      criterion.verifiedAt = now;
    }
  }

  const unmetCriteria = task.acceptanceCriteria.filter((c) => !c.met).map((c) => c.text);

  // --- Übrige Prüfpunkte --------------------------------------------------
  const checklist = { ...DEFAULT_CHECKLIST, ...input.checklist };
  const failedChecks = (Object.keys(checklist) as Array<keyof QaChecklist>)
    .filter((key) => !checklist[key])
    .map((key) => CHECKLIST_LABELS[key]);

  // Ein Ticket ohne Akzeptanzkriterien ist nicht prüfbar und darf nicht
  // stillschweigend durchgewunken werden (Spec §3).
  const hasCriteria = task.acceptanceCriteria.length > 0;
  const passed = hasCriteria && unmetCriteria.length === 0 && failedChecks.length === 0;

  const target: ScrumTask['column'] = passed ? 'done' : 'in_progress';
  if (!validateTransition(task.column, target).valid) return null;

  // --- Statuswechsel ------------------------------------------------------
  task.statusHistory.push({
    from: task.column,
    to: target,
    timestamp: now,
    triggeredBy: qa?.id ?? null,
  });
  task.column = target;
  task.updatedAt = now;
  if (passed) task.completedAt = now;

  // --- Feedback & Protokoll ----------------------------------------------
  if (passed) {
    sendMessage(state, {
      from: qa,
      to: developer ? [developer] : null,
      subject: 'Review bestanden',
      body:
        `Alle ${task.acceptanceCriteria.length} Akzeptanzkriterien erfüllt, ` +
        'alle Prüfpunkte in Ordnung. Ticket ist Done.' +
        (input.notes ? `\n\n${input.notes}` : ''),
      taskId: task.id,
    });
  } else {
    const parts: string[] = [];
    if (!hasCriteria) {
      parts.push(
        'Das Ticket hat keine Akzeptanzkriterien — ohne sie ist es nicht prüfbar. ' +
          'Bitte mit dem Technical Lead nachziehen.'
      );
    }
    if (unmetCriteria.length > 0) {
      parts.push(
        `Folgende Acceptance Criteria fehlen:\n${unmetCriteria.map((c) => `- ${c}`).join('\n')}`
      );
    }
    if (failedChecks.length > 0) {
      parts.push(`Offene Prüfpunkte: ${failedChecks.join(', ')}.`);
    }
    if (input.notes) parts.push(input.notes);

    sendMessage(state, {
      from: qa,
      to: developer ? [developer] : null,
      subject: 'Review abgelehnt',
      body: parts.join('\n\n'),
      taskId: task.id,
    });
  }

  const decision = recordDecision(state, {
    task,
    type: passed ? 'review_passed' : 'review_rejected',
    description: passed ? 'Review bestanden — Ticket auf Done' : 'Review abgelehnt — zurück in Development',
    reasoning: passed
      ? `Alle ${task.acceptanceCriteria.length} Akzeptanzkriterien erfüllt und alle Prüfpunkte bestanden.`
      : [
          !hasCriteria ? 'keine Akzeptanzkriterien vorhanden' : null,
          unmetCriteria.length ? `${unmetCriteria.length} Kriterium/Kriterien offen` : null,
          failedChecks.length ? `Prüfpunkte offen: ${failedChecks.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('; '),
    madeBy: qa,
  });

  return { passed, column: target, unmetCriteria, failedChecks, decision };
}
