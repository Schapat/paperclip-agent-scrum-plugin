/**
 * Gemeinsame Typen für die Scrum-Zeremonien (Spec §2)
 *
 * Wichtige Abgrenzung: die Zeremonie-Funktionen orchestrieren den *Prozess*
 * deterministisch — sie sortieren, verschieben, weisen zu, rechnen Metriken und
 * protokollieren Entscheidungen. Die *inhaltliche* Arbeit (User Stories
 * schreiben, Akzeptanzkriterien formulieren, Code schätzen) leisten die echten
 * KI-Agents in Paperclip. Dafür stellt eine Zeremonie über
 * `requestAgentWork` eine Anforderung, die der Worker in ein Paperclip-Event
 * übersetzt. So erfindet das Plugin keine Inhalte, die eigentlich vom Agent
 * kommen müssen.
 */

import type { CeremonyType, ScrumTask, WorkerState } from '@shared/types';

/**
 * Anforderung inhaltlicher Arbeit an einen KI-Agent.
 */
export interface AgentWorkRequest {
  /** In welcher Zeremonie die Anforderung entsteht */
  ceremony: CeremonyType;
  /** Rolle des adressierten Agents, z.B. 'product_owner' */
  role: string;
  /** Betroffene Tickets (leer, wenn es um Neuanlage geht) */
  taskIds: string[];
  /** Was der Agent tun soll */
  instruction: string;
}

/**
 * Kontext, den jede Zeremonie erhält.
 */
export interface CeremonyContext {
  /** Wird von den Zeremonien mutiert */
  state: WorkerState;
  /** Fordert inhaltliche Arbeit von einem KI-Agent an */
  requestAgentWork?: (request: AgentWorkRequest) => void;
}

/**
 * Prüft, ob ein Ticket bereit für den Sprint ist.
 *
 * "Ready" heißt: der Technical Lead hat es verfeinert, es hat eine Schätzung
 * und mindestens ein Akzeptanzkriterium. Ohne diese Definition würde das
 * Planning unfertige Tickets in den Sprint ziehen (Spec §3).
 */
export function isReady(task: ScrumTask): boolean {
  return task.refined && task.storyPoints > 0 && task.acceptanceCriteria.length > 0;
}

/**
 * Prüft, ob ein Ticket durch ein anderes, noch nicht fertiges Ticket blockiert ist.
 */
export function isBlockedByDependency(task: ScrumTask, state: WorkerState): boolean {
  return task.links.some((link) => {
    if (link.type !== 'blocked_by') return false;
    const target = state.tasks.find((t) => t.id === link.taskId);
    return !!target && target.column !== 'done';
  });
}

/**
 * Rangfolge der Prioritäten für die Backlog-Sortierung des Product Owners.
 */
export const PRIORITY_RANK: Record<ScrumTask['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Sortiert Tickets nach Business Value: Priorität zuerst, dann Alter.
 *
 * Bei gleicher Priorität gewinnt das ältere Ticket, damit nichts dauerhaft
 * im Backlog verhungert.
 */
export function byBusinessValue(a: ScrumTask, b: ScrumTask): number {
  const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (rank !== 0) return rank;
  return a.createdAt.localeCompare(b.createdAt);
}
