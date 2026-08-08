/**
 * Backlog Refinement (Spec §2)
 *
 * Trigger: Entwickler haben keine Arbeit, das Backlog unterschreitet die
 * Mindestgröße, oder ein geplanter Refinement-Zeitpunkt ist erreicht.
 *
 * Ablauf:
 *  - Der Product Owner erstellt neue Backlog-Items aus der Produktvision.
 *  - Der Technical Lead analysiert alle Tickets, zerlegt große Features,
 *    ergänzt Akzeptanzkriterien und technische Hinweise, erkennt
 *    Abhängigkeiten und schätzt den Aufwand.
 *  - Der Product Owner passt die Prioritäten an.
 *
 * Die *inhaltliche* Arbeit — Stories schreiben, Kriterien formulieren,
 * schätzen — leisten die KI-Agents. Diese Funktion erkennt, *was* zu tun ist,
 * beauftragt die zuständigen Agents und protokolliert die Entscheidungen.
 */

import type { CeremonyRecord, ScrumTask, WorkerState } from '../types';
import { createCeremonyRecord } from '../factories';
import { broadcast, findAgentByRole, recordDecision, sendMessage } from '../communication';
import type { CeremonyContext } from './types';
import { byBusinessValue, isReady } from './types';

/**
 * Mindestgröße des Backlogs an sprintreifen Tickets.
 *
 * Unterschreitet das Backlog diesen Wert, muss der Product Owner nachlegen,
 * damit das Team nicht in den Leerlauf läuft (Spec §4).
 */
export const MIN_READY_BACKLOG = 5;

/**
 * Ab dieser Schätzung gilt ein Ticket als zu groß für einen Sprint und wird
 * vom Technical Lead zerlegt (Spec §2 "Große Features werden zerlegt").
 */
export const SPLIT_THRESHOLD_POINTS = 13;

/**
 * Was das Refinement zu tun gefunden hat.
 */
export interface RefinementFindings {
  /** Tickets ohne Verfeinerung */
  unrefined: ScrumTask[];
  /** Tickets ohne Schätzung */
  unestimated: ScrumTask[];
  /** Tickets ohne Akzeptanzkriterien */
  missingCriteria: ScrumTask[];
  /** Zu große Tickets, die zerlegt werden müssen */
  tooLarge: ScrumTask[];
  /** Wie viele sprintreife Tickets aktuell im Backlog liegen */
  readyCount: number;
  /** True, wenn der Product Owner neue Items schreiben muss */
  needsNewItems: boolean;
}

/**
 * Analysiert das Backlog.
 */
export function analyzeBacklog(state: WorkerState): RefinementFindings {
  const backlog = state.tasks.filter((t) => t.column === 'backlog');
  const readyCount = backlog.filter(isReady).length;

  return {
    unrefined: backlog.filter((t) => !t.refined),
    unestimated: backlog.filter((t) => t.storyPoints <= 0),
    missingCriteria: backlog.filter((t) => t.acceptanceCriteria.length === 0),
    tooLarge: backlog.filter((t) => t.storyPoints >= SPLIT_THRESHOLD_POINTS),
    readyCount,
    needsNewItems: readyCount < MIN_READY_BACKLOG,
  };
}

/**
 * Führt das Backlog Refinement durch.
 */
export function runBacklogRefinement(ctx: CeremonyContext): CeremonyRecord {
  const { state } = ctx;
  const scrumMaster = findAgentByRole(state, 'scrum_master');
  const productOwner = findAgentByRole(state, 'product_owner');
  const technicalLead = findAgentByRole(state, 'technical_lead');

  const messageIds: string[] = [];
  const touched = new Set<string>();

  messageIds.push(
    broadcast(
      state,
      scrumMaster,
      'Backlog Refinement wird gestartet',
      'Wir bringen das Backlog auf Sprintreife.',
      'backlog_refinement'
    ).id
  );

  const findings = analyzeBacklog(state);

  // --- Product Owner: neue Items aus der Produktvision ---------------------
  if (findings.needsNewItems) {
    const missing = MIN_READY_BACKLOG - findings.readyCount;

    messageIds.push(
      sendMessage(state, {
        from: scrumMaster,
        to: productOwner ? [productOwner] : null,
        subject: 'Backlog aufstocken',
        body: `Nur ${findings.readyCount} sprintreife Tickets im Backlog (Minimum ${MIN_READY_BACKLOG}). Bitte neue User Stories aus der Produktvision ableiten.`,
        ceremony: 'backlog_refinement',
      }).id
    );

    ctx.requestAgentWork?.({
      ceremony: 'backlog_refinement',
      role: 'product_owner',
      taskIds: [],
      instruction: `Erstelle mindestens ${missing} neue Backlog-Items (Epics/User Stories) auf Basis der Produktvision, inklusive Business Value und grober Akzeptanzkriterien.`,
    });
  }

  // --- Technical Lead: Tickets analysieren --------------------------------
  const needsWork = dedupe([
    ...findings.unrefined,
    ...findings.unestimated,
    ...findings.missingCriteria,
  ]);

  if (needsWork.length > 0) {
    for (const task of needsWork) {
      touched.add(task.id);
      const gaps: string[] = [];
      if (!task.refined) gaps.push('nicht verfeinert');
      if (task.storyPoints <= 0) gaps.push('nicht geschätzt');
      if (task.acceptanceCriteria.length === 0) gaps.push('ohne Akzeptanzkriterien');

      recordDecision(state, {
        task,
        type: 'refinement',
        description: 'Für Refinement vorgemerkt',
        reasoning: `Ticket ist ${gaps.join(', ')}.`,
        madeBy: technicalLead,
      });
    }

    messageIds.push(
      sendMessage(state, {
        from: productOwner,
        to: technicalLead ? [technicalLead] : null,
        subject: 'Bitte technische Ausarbeitung durchführen',
        body: `${needsWork.length} Ticket(s) benötigen Akzeptanzkriterien, technische Hinweise, Abhängigkeiten und eine Schätzung.`,
        ceremony: 'backlog_refinement',
      }).id
    );

    ctx.requestAgentWork?.({
      ceremony: 'backlog_refinement',
      role: 'technical_lead',
      taskIds: needsWork.map((t) => t.id),
      instruction:
        'Ergänze je Ticket: Akzeptanzkriterien, technische Hinweise, erkannte Abhängigkeiten, ' +
        'Risiken und eine Aufwandsschätzung in Story Points.',
    });
  }

  // --- Technical Lead: zu große Tickets zerlegen --------------------------
  if (findings.tooLarge.length > 0) {
    for (const task of findings.tooLarge) {
      touched.add(task.id);
      recordDecision(state, {
        task,
        type: 'refinement',
        description: 'Zur Zerlegung vorgemerkt',
        reasoning: `Schätzung ${task.storyPoints} Punkte liegt bei/über der Schwelle von ${SPLIT_THRESHOLD_POINTS} — passt nicht in einen Sprint.`,
        madeBy: technicalLead,
      });
    }

    ctx.requestAgentWork?.({
      ceremony: 'backlog_refinement',
      role: 'technical_lead',
      taskIds: findings.tooLarge.map((t) => t.id),
      instruction:
        `Zerlege diese Tickets in Subtasks von jeweils unter ${SPLIT_THRESHOLD_POINTS} Story Points ` +
        'und verlinke sie über parentId mit dem Ursprungsticket.',
    });
  }

  // --- Product Owner: Prioritäten anpassen --------------------------------
  const prioritized = state.tasks.filter((t) => t.column === 'backlog').sort(byBusinessValue);
  messageIds.push(
    sendMessage(state, {
      from: productOwner,
      to: null,
      subject: 'Backlog neu priorisiert',
      body: prioritized.length
        ? `Reihenfolge nach Business Value:\n${prioritized
            .slice(0, 10)
            .map((t, i) => `${i + 1}. [${t.priority}] ${t.title}`)
            .join('\n')}`
        : 'Backlog ist leer.',
      ceremony: 'backlog_refinement',
    }).id
  );

  const summary =
    `Backlog Refinement: ${findings.readyCount} sprintreif, ` +
    `${needsWork.length} zur Ausarbeitung, ` +
    `${findings.tooLarge.length} zur Zerlegung` +
    (findings.needsNewItems ? ', neue Items beim Product Owner angefordert' : '') +
    '.';

  const record = createCeremonyRecord('backlog_refinement', state.currentSprint?.id ?? null, summary, {
    messageIds,
    taskIds: [...touched],
  });

  state.ceremonies.push(record);
  return record;
}

/**
 * Entfernt Duplikate anhand der Ticket-ID.
 *
 * Ein Ticket kann in mehreren Findings gleichzeitig auftauchen (etwa
 * unverfeinert *und* ungeschätzt) — der Technical Lead soll es trotzdem nur
 * einmal beauftragt bekommen.
 */
function dedupe(tasks: ScrumTask[]): ScrumTask[] {
  const seen = new Set<string>();
  return tasks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}
