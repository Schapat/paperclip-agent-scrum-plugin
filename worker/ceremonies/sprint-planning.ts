/**
 * Sprint Planning (Spec §2)
 *
 * Trigger: Sprint beginnt oder die TODO-Spalte ist leer.
 *
 * Ablauf:
 *  1. Product Owner priorisiert das Backlog nach Business Value.
 *  2. Technical Lead prüft die technische Umsetzbarkeit — nur verfeinerte,
 *     geschätzte und nicht blockierte Tickets kommen in den Sprint.
 *  3. Unfertige Tickets gehen zur Verfeinerung an den Technical Lead zurück.
 *  4. Der Product Owner weist die Tickets passenden Entwicklern zu.
 */

import type { CeremonyRecord, ScrumTask } from '@shared/types';
import { createCeremonyRecord } from '@shared/factories';
import { broadcast, findAgentByRole, findAgentsByRole, recordDecision, sendMessage } from '../communication';
import { pickAssignee } from './assignment';
import type { CeremonyContext } from './types';
import { byBusinessValue, isBlockedByDependency, isReady } from './types';

/**
 * Wie viele Story Points der Sprint aufnehmen kann.
 *
 * Grundlage ist die Velocity der abgeschlossenen Sprints. Ohne Historie greift
 * ein konservativer Startwert, damit der erste Sprint nicht überladen wird.
 */
export function sprintCapacity(ctx: CeremonyContext): number {
  const { completedSprints, settings } = ctx.state;
  if (completedSprints.length === 0) {
    // Startannahme: 8 Punkte pro Developer und Sprint-Woche
    return 8 * settings.teamSize.developerCount * settings.sprint.lengthWeeks;
  }

  const recent = completedSprints.slice(-3);
  const avg = recent.reduce((sum, s) => sum + s.velocity, 0) / recent.length;
  return Math.max(1, Math.round(avg));
}

/**
 * Führt das Sprint Planning durch.
 */
export function runSprintPlanning(ctx: CeremonyContext): CeremonyRecord {
  const { state } = ctx;
  const scrumMaster = findAgentByRole(state, 'scrum_master');
  const productOwner = findAgentByRole(state, 'product_owner');
  const technicalLead = findAgentByRole(state, 'technical_lead');
  const developers = findAgentsByRole(state, 'developer');

  const messageIds: string[] = [];
  const plannedTaskIds: string[] = [];

  messageIds.push(
    broadcast(state, scrumMaster, 'Sprint Planning wird gestartet', 'Wir planen den nächsten Sprint.', 'sprint_planning')
      .id
  );

  // --- 1. Product Owner priorisiert ---------------------------------------
  const backlog = state.tasks.filter((t) => t.column === 'backlog').sort(byBusinessValue);

  // --- 2. Technical Lead prüft Umsetzbarkeit ------------------------------
  const ready: ScrumTask[] = [];
  const notReady: ScrumTask[] = [];
  for (const task of backlog) {
    if (isReady(task) && !isBlockedByDependency(task, state)) {
      ready.push(task);
    } else {
      notReady.push(task);
    }
  }

  // --- 3. Unfertige Tickets zurück ins Refinement -------------------------
  if (notReady.length > 0) {
    messageIds.push(
      sendMessage(state, {
        from: productOwner,
        to: technicalLead ? [technicalLead] : null,
        subject: 'Bitte technische Ausarbeitung durchführen',
        body:
          `${notReady.length} Ticket(s) sind nicht sprintreif ` +
          `(fehlende Schätzung, Akzeptanzkriterien oder offene Abhängigkeit).`,
        ceremony: 'sprint_planning',
      }).id
    );

    ctx.requestAgentWork?.({
      ceremony: 'sprint_planning',
      role: 'technical_lead',
      taskIds: notReady.map((t) => t.id),
      instruction:
        'Verfeinere diese Tickets: Akzeptanzkriterien ergänzen, Aufwand schätzen, ' +
        'technische Hinweise und Abhängigkeiten erfassen.',
    });
  }

  // --- 4. Sprint füllen, begrenzt durch Kapazität und WIP-Limit -----------
  const capacity = sprintCapacity(ctx);
  const todoLimit = state.settings.wipLimits.todo;
  const currentTodo = state.tasks.filter((t) => t.column === 'todo').length;

  let usedPoints = 0;
  let slots = Math.max(0, todoLimit - currentTodo);

  for (const task of ready) {
    if (slots <= 0) break;
    if (usedPoints + task.storyPoints > capacity) continue;

    task.column = 'todo';
    task.sprintId = state.currentSprint?.id ?? null;
    task.updatedAt = new Date().toISOString();
    task.statusHistory.push({
      from: 'backlog',
      to: 'todo',
      timestamp: task.updatedAt,
      triggeredBy: productOwner?.id ?? null,
    });

    if (state.currentSprint && !state.currentSprint.taskIds.includes(task.id)) {
      state.currentSprint.taskIds.push(task.id);
    }

    recordDecision(state, {
      task,
      type: 'status_change',
      description: `In den Sprint aufgenommen (${task.storyPoints} Punkte)`,
      reasoning:
        `Priorität "${task.priority}", verfeinert und geschätzt. ` +
        `Sprint-Kapazität ${usedPoints + task.storyPoints}/${capacity} Punkte belegt.`,
      madeBy: productOwner,
    });

    usedPoints += task.storyPoints;
    slots -= 1;
    plannedTaskIds.push(task.id);
  }

  // --- 5. Zuweisung an passende Entwickler --------------------------------
  let assigned = 0;
  const devLimit = state.settings.wipLimits.development;

  for (const task of state.tasks.filter((t) => t.column === 'todo' && !t.assignedAgentId)) {
    const candidate = pickAssignee(task, developers, state);
    if (!candidate) break; // Alle Entwickler am WIP-Limit

    task.assignedAgentId = candidate.agent.id;
    task.updatedAt = new Date().toISOString();

    recordDecision(state, {
      task,
      type: 'auto_assign',
      description: `Zugewiesen an ${candidate.agent.name}`,
      reasoning: candidate.reason,
      madeBy: productOwner,
    });

    messageIds.push(
      sendMessage(state, {
        from: technicalLead,
        to: [candidate.agent],
        subject: 'Implementiere gemäß Architektur',
        body: task.technicalNotes
          ? `Technische Hinweise:\n${task.technicalNotes}`
          : 'Keine gesonderten technischen Hinweise — bitte an den Akzeptanzkriterien orientieren.',
        taskId: task.id,
        ceremony: 'sprint_planning',
      }).id
    );

    // Nach der Zuweisung startet die Umsetzung, solange das WIP-Limit hält
    if (currentLoadOf(candidate.agent.id, ctx) < devLimit) {
      task.column = 'in_progress';
      task.startedAt = task.startedAt ?? task.updatedAt;
      task.statusHistory.push({
        from: 'todo',
        to: 'in_progress',
        timestamp: task.updatedAt,
        triggeredBy: candidate.agent.id,
      });
      candidate.agent.status = 'working';
      candidate.agent.currentTaskId = task.id;
    }

    assigned += 1;
    if (!plannedTaskIds.includes(task.id)) plannedTaskIds.push(task.id);
  }

  const summary =
    `Sprint Planning: ${plannedTaskIds.length} Ticket(s) eingeplant (${usedPoints}/${capacity} Punkte), ` +
    `${assigned} zugewiesen, ${notReady.length} zurück ins Refinement.`;

  const record = createCeremonyRecord('sprint_planning', state.currentSprint?.id ?? null, summary, {
    messageIds,
    taskIds: plannedTaskIds,
  });

  state.ceremonies.push(record);
  return record;
}

/**
 * Laufende Tickets eines Agents — nach jeder Zuweisung neu gezählt, damit das
 * WIP-Limit innerhalb eines Plannings nicht überschritten wird.
 */
function currentLoadOf(agentId: string, ctx: CeremonyContext): number {
  return ctx.state.tasks.filter(
    (t) => t.assignedAgentId === agentId && (t.column === 'in_progress' || t.column === 'in_review')
  ).length;
}
