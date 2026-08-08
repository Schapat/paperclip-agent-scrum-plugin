/**
 * Agentenkommunikation (Spec §6)
 *
 * Alle Agents kommunizieren über diesen Bus. Zwei Garantien machen den
 * Prozess nachvollziehbar:
 *
 *  1. Jede Nachricht landet im globalen Protokoll (`state.messages`).
 *  2. Bezieht sich eine Nachricht auf ein Ticket, wird sie zusätzlich als
 *     Kommentar in dessen Verlauf gespiegelt — dadurch ist im Board an jedem
 *     Ticket sichtbar, wer was wann veranlasst hat.
 *
 * Entscheidungen (`recordDecision`) sind bewusst von Nachrichten getrennt:
 * eine Nachricht ist Kommunikation, eine Entscheidung trägt eine Begründung
 * und beantwortet "warum ist das passiert?" (Spec §5).
 */

import type {
  AgentDecision,
  AgentMessage,
  CeremonyType,
  DecisionType,
  ScrumAgent,
  ScrumTask,
  WorkerState,
} from '@shared/types';
import { MAX_MESSAGE_LOG } from '@shared/types';
import { createComment, createDecision, createMessage } from '@shared/factories';

// =============================================================================
// Team-Verzeichnis
// =============================================================================

/**
 * Findet den ersten Agent mit der gegebenen Rolle.
 *
 * Für Einzelrollen (PO, Scrum Master, Tech Lead, QA) ist das der gesuchte
 * Agent; bei Developern liefert es schlicht den ersten.
 */
export function findAgentByRole(state: WorkerState, role: string): ScrumAgent | null {
  return state.agents.find((a) => a.role === role) ?? null;
}

/**
 * Findet alle Agents mit der gegebenen Rolle (relevant für Developer).
 */
export function findAgentsByRole(state: WorkerState, role: string): ScrumAgent[] {
  return state.agents.filter((a) => a.role === role);
}

/**
 * Findet einen Agent per ID.
 */
export function findAgentById(state: WorkerState, id: string | null): ScrumAgent | null {
  if (!id) return null;
  return state.agents.find((a) => a.id === id) ?? null;
}

// =============================================================================
// Nachrichten
// =============================================================================

export interface SendMessageParams {
  /** Absender; `null` steht für systemgenerierte Nachrichten */
  from: ScrumAgent | null;
  /** Empfänger; `null` ist ein Broadcast an das gesamte Team */
  to: ScrumAgent[] | null;
  subject: string;
  body: string;
  /** Ticket, auf das sich die Nachricht bezieht */
  taskId?: string | null;
  /** Zeremonie, in deren Rahmen die Nachricht entsteht */
  ceremony?: CeremonyType | null;
}

/**
 * Verschickt eine Agent-Nachricht und protokolliert sie.
 *
 * Mutiert `state`: hängt die Nachricht an `state.messages` an und spiegelt sie
 * — sofern `taskId` gesetzt ist — als Kommentar an das Ticket.
 */
export function sendMessage(state: WorkerState, params: SendMessageParams): AgentMessage {
  const message = createMessage({
    from: params.from,
    to: params.to ? params.to.map((a) => a.id) : null,
    subject: params.subject,
    body: params.body,
    taskId: params.taskId ?? null,
    ceremony: params.ceremony ?? null,
  });

  state.messages.push(message);
  trimMessageLog(state);

  // Ticketbezogene Nachrichten im Ticketverlauf spiegeln (Spec §6)
  if (message.taskId) {
    const task = state.tasks.find((t) => t.id === message.taskId);
    if (task) {
      task.comments.push(
        createComment(task.id, params.from, `**${params.subject}**\n\n${params.body}`, message.id)
      );
      task.updatedAt = message.timestamp;
    }
  }

  return message;
}

/**
 * Broadcast an das gesamte Team (z.B. "Sprint Planning wird gestartet").
 */
export function broadcast(
  state: WorkerState,
  from: ScrumAgent | null,
  subject: string,
  body: string,
  ceremony: CeremonyType | null = null
): AgentMessage {
  return sendMessage(state, { from, to: null, subject, body, ceremony });
}

/**
 * Begrenzt das Nachrichtenprotokoll auf die jüngsten Einträge.
 *
 * Ein dauerhaft laufendes Team erzeugt endlos Nachrichten; ohne Deckel würde
 * der persistierte State unbegrenzt wachsen. Die Ticket-Kommentare bleiben
 * davon unberührt — pro Ticket ist der Verlauf ohnehin endlich.
 */
function trimMessageLog(state: WorkerState): void {
  if (state.messages.length > MAX_MESSAGE_LOG) {
    state.messages.splice(0, state.messages.length - MAX_MESSAGE_LOG);
  }
}

// =============================================================================
// Entscheidungen
// =============================================================================

export interface RecordDecisionParams {
  task: ScrumTask | null;
  type: DecisionType;
  /** Was entschieden wurde */
  description: string;
  /** Warum — Pflicht, sonst ist die Entscheidung nicht nachvollziehbar */
  reasoning: string;
  madeBy: ScrumAgent | null;
  relatedTaskIds?: string[];
}

/**
 * Protokolliert eine Agentenentscheidung am Ticket (Spec §5).
 *
 * Ohne Ticket (`task: null`) wird die Entscheidung nur zurückgegeben — etwa
 * bei Prozessentscheidungen des Scrum Masters, die kein Ticket betreffen; der
 * Aufrufer hängt sie dann an den Zeremonie-Eintrag.
 */
export function recordDecision(state: WorkerState, params: RecordDecisionParams): AgentDecision {
  const decision = createDecision(
    params.task?.id ?? null,
    params.type,
    params.description,
    params.reasoning,
    params.madeBy,
    params.relatedTaskIds ?? []
  );

  if (params.task) {
    params.task.decisions.push(decision);
    params.task.updatedAt = decision.timestamp;
  }

  // `state` wird hier bewusst nicht mutiert: Entscheidungen leben am Ticket,
  // damit sie im Ticket-Detail direkt verfügbar sind.
  void state;

  return decision;
}

/**
 * Sammelt alle Entscheidungen über alle Tickets, jüngste zuerst.
 *
 * Grundlage für das globale Agenten-Log im Board (Spec §7).
 */
export function collectDecisions(state: WorkerState, limit = 100): AgentDecision[] {
  return state.tasks
    .flatMap((t) => t.decisions)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

/**
 * Liefert die Nachrichten zu einem Ticket, älteste zuerst.
 */
export function messagesForTask(state: WorkerState, taskId: string): AgentMessage[] {
  return state.messages.filter((m) => m.taskId === taskId);
}
