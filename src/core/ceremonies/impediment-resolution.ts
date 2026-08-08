/**
 * Impediment Resolution — Ersatz für das Daily Scrum
 *
 * Warum kein Daily?
 *
 * Der Zweck eines Dailys ist Synchronisation: Menschen wissen nicht, woran die
 * anderen arbeiten. Für Agents entfällt dieser Zweck vollständig — der
 * Board-Zustand ist für alle jederzeit und lückenlos sichtbar. Ein Bericht
 * "Ich habe X erledigt und arbeite an Y" wiederholt nur, was ohnehin im Board
 * steht, und erzeugt Nachrichten ohne Erkenntnisgewinn.
 *
 * Wertvoll war am Daily nur der *Scrum-Master-Anteil*: Blocker erkennen und
 * Leerlauf beheben. Genau das tut dieses Event — und zwar handelnd statt
 * berichtend:
 *
 *   - Auflösbare Blocker werden aufgelöst (Abhängigkeit inzwischen erledigt).
 *   - Nicht auflösbare Blocker werden mit konkreter Aufgabe eskaliert.
 *   - Freie Entwicklerkapazität wird mit wartenden Tickets belegt.
 *
 * Jede dieser Aktionen verändert das Board. Bleibt nichts zu tun, entsteht auch
 * kein Eintrag — ein Event ohne Wirkung soll keine Spur hinterlassen.
 */

import type { CeremonyRecord, ScrumAgent, ScrumTask, WorkerState } from '../types';
import { createCeremonyRecord } from '../factories';
import { findAgentByRole, findAgentsByRole, recordDecision, sendMessage } from '../communication';
import { pickAssignee } from './assignment';
import type { CeremonyContext } from './types';

/**
 * Was das Event bewirkt hat.
 */
export interface ImpedimentResult {
  /** Blocker, deren Ursache inzwischen behoben ist */
  unblocked: ScrumTask[];
  /** Blocker, die Eingriff brauchen */
  escalated: ScrumTask[];
  /** Neu zugewiesene und gestartete Tickets */
  assigned: Array<{ task: ScrumTask; agent: ScrumAgent }>;
}

/**
 * Findet die noch offenen Abhängigkeiten eines Tickets.
 */
function openDependencies(task: ScrumTask, state: WorkerState): ScrumTask[] {
  return task.links
    .filter((link) => link.type === 'blocked_by')
    .map((link) => state.tasks.find((t) => t.id === link.taskId))
    .filter((t): t is ScrumTask => !!t && t.column !== 'done');
}

/**
 * Löst Blocker auf, deren Ursache weggefallen ist.
 *
 * Ein Ticket, das auf ein inzwischen fertiges Ticket gewartet hat, kann sofort
 * weiterlaufen — darauf muss niemand hingewiesen werden.
 */
export function resolveBlockers(state: WorkerState, scrumMaster: ScrumAgent | null): {
  unblocked: ScrumTask[];
  escalated: ScrumTask[];
} {
  const unblocked: ScrumTask[] = [];
  const escalated: ScrumTask[] = [];

  for (const task of state.tasks.filter((t) => t.column === 'blocked')) {
    const open = openDependencies(task, state);

    if (open.length === 0) {
      // Ursache behoben: zurück in die Entwicklung
      const now = new Date().toISOString();
      task.statusHistory.push({
        from: 'blocked',
        to: 'todo',
        timestamp: now,
        triggeredBy: scrumMaster?.id ?? null,
      });
      task.column = 'todo';
      task.updatedAt = now;

      recordDecision(state, {
        task,
        type: 'unblocked',
        description: 'Blockade aufgehoben, Ticket zurück in TODO',
        reasoning: 'Alle blockierenden Tickets sind abgeschlossen.',
        madeBy: scrumMaster,
      });

      unblocked.push(task);
    } else {
      escalated.push(task);
    }
  }

  return { unblocked, escalated };
}

/**
 * Belegt freie Entwicklerkapazität mit wartenden Tickets.
 *
 * Das ist der Unterschied zum Daily: statt "Developer 2 ist frei" zu melden,
 * bekommt Developer 2 ein Ticket.
 */
export function fillIdleCapacity(
  state: WorkerState,
  productOwner: ScrumAgent | null
): Array<{ task: ScrumTask; agent: ScrumAgent }> {
  const developers = findAgentsByRole(state, 'developer');
  const assigned: Array<{ task: ScrumTask; agent: ScrumAgent }> = [];

  // Nicht zugewiesene Tickets in TODO, wichtigste zuerst
  const waiting = state.tasks
    .filter((t) => t.column === 'todo')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const task of waiting) {
    const candidate = pickAssignee(task, developers, state);
    if (!candidate) break; // Alle Entwickler am WIP-Limit

    const now = new Date().toISOString();
    task.assignedAgentId = candidate.agent.id;
    task.column = 'in_progress';
    task.startedAt = task.startedAt ?? now;
    task.updatedAt = now;
    task.statusHistory.push({
      from: 'todo',
      to: 'in_progress',
      timestamp: now,
      triggeredBy: candidate.agent.id,
    });

    candidate.agent.status = 'working';
    candidate.agent.currentTaskId = task.id;

    recordDecision(state, {
      task,
      type: 'auto_assign',
      description: `Freie Kapazität belegt: ${candidate.agent.name}`,
      reasoning: candidate.reason,
      madeBy: productOwner,
    });

    assigned.push({ task, agent: candidate.agent });
  }

  return assigned;
}

/**
 * Führt die Impediment Resolution durch.
 *
 * Liefert `null`, wenn es nichts zu tun gab — dann wird auch kein
 * Zeremonie-Eintrag erzeugt.
 */
export function runImpedimentResolution(ctx: CeremonyContext): CeremonyRecord | null {
  const { state } = ctx;
  const scrumMaster = findAgentByRole(state, 'scrum_master');
  const productOwner = findAgentByRole(state, 'product_owner');
  const technicalLead = findAgentByRole(state, 'technical_lead');

  const { unblocked, escalated } = resolveBlockers(state, scrumMaster);
  const assigned = fillIdleCapacity(state, productOwner);

  // Ein Event ohne Wirkung hinterlässt keine Spur
  if (unblocked.length === 0 && escalated.length === 0 && assigned.length === 0) {
    return null;
  }

  const messageIds: string[] = [];

  for (const task of unblocked) {
    messageIds.push(
      sendMessage(state, {
        from: scrumMaster,
        to: null,
        subject: 'Blockade aufgehoben',
        body: 'Die blockierenden Tickets sind abgeschlossen, das Ticket ist wieder einplanbar.',
        taskId: task.id,
        ceremony: 'impediment_resolution',
      }).id
    );
  }

  for (const task of escalated) {
    const open = openDependencies(task, state);

    messageIds.push(
      sendMessage(state, {
        from: scrumMaster,
        to: technicalLead ? [technicalLead] : null,
        subject: 'Blocker braucht Eingriff',
        body:
          `Das Ticket wartet auf: ${open.map((t) => `"${t.title}" (${t.column})`).join(', ')}.\n` +
          'Bitte Priorität der blockierenden Tickets prüfen oder die Abhängigkeit auflösen.',
        taskId: task.id,
        ceremony: 'impediment_resolution',
      }).id
    );

    recordDecision(state, {
      task,
      type: 'blocked',
      description: 'Blocker an Technical Lead eskaliert',
      reasoning: `${open.length} blockierende(s) Ticket(s) noch offen: ${open.map((t) => t.title).join(', ')}.`,
      madeBy: scrumMaster,
    });
  }

  if (escalated.length > 0) {
    ctx.requestAgentWork?.({
      ceremony: 'impediment_resolution',
      role: 'technical_lead',
      taskIds: escalated.map((t) => t.id),
      instruction:
        'Löse die Blockaden auf: blockierende Tickets höher priorisieren, Abhängigkeit entfernen ' +
        'oder das Ticket so umschneiden, dass es ohne die Abhängigkeit umsetzbar ist.',
    });
  }

  for (const { task, agent } of assigned) {
    messageIds.push(
      sendMessage(state, {
        from: technicalLead,
        to: [agent],
        subject: 'Implementiere gemäß Architektur',
        body: task.technicalNotes
          ? `Technische Hinweise:\n${task.technicalNotes}`
          : 'Keine gesonderten technischen Hinweise — bitte an den Akzeptanzkriterien orientieren.',
        taskId: task.id,
        ceremony: 'impediment_resolution',
      }).id
    );
  }

  const summary =
    `Impediment Resolution: ${unblocked.length} Blockade(n) aufgehoben, ` +
    `${escalated.length} eskaliert, ${assigned.length} Ticket(s) neu gestartet.`;

  const record = createCeremonyRecord(
    'impediment_resolution',
    state.currentSprint?.id ?? null,
    summary,
    {
      messageIds,
      taskIds: [
        ...unblocked.map((t) => t.id),
        ...escalated.map((t) => t.id),
        ...assigned.map((a) => a.task.id),
      ],
    }
  );

  state.ceremonies.push(record);
  return record;
}
