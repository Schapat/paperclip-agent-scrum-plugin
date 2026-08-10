/**
 * Uebersetzt die Orchestrierungssicht des Hosts in Stillstaende des Boards.
 *
 * Bisher hat der Worker diesen Zustand aus einzelnen Events zusammengesetzt.
 * Das hat zwei Luecken: ein Run, der waehrend eines Worker-Neustarts scheitert,
 * erzeugt kein Event mehr, das jemand hoert — und ein Event, das der Worker
 * verpasst, bleibt fuer immer verpasst. Der Host kennt den Zustand dagegen
 * jederzeit vollstaendig.
 *
 * Das Modul bleibt frei von SDK-Aufrufen, damit die Regeln ohne laufenden Host
 * pruefbar sind.
 */

import type { TicketStall } from './types';

/** Die Teilmenge der Host-Orchestrierung, die das Board auswertet. */
export interface OrchestrationSnapshot {
  runs: Array<{
    issueId: string | null;
    status: string;
    error: string | null;
    finishedAt: string | null;
    createdAt: string;
  }>;
  approvals: Array<{
    issueId: string;
    status: string;
    decidedAt: string | null;
    createdAt: string;
  }>;
  invocationBlocks: Array<{
    issueId: string;
    scopeName: string;
    reason: string;
  }>;
  openBudgetIncidents: Array<{
    scopeType: string;
    scopeId: string;
    status: string;
    metric: string;
    createdAt: string;
  }>;
}

/** Run-Zustaende, die bedeuten: dieses Ticket bewegt sich nicht mehr von selbst. */
const DEAD_RUN_STATUSES = new Set(['failed', 'cancelled', 'error', 'timed_out']);
/** Run-Zustaende, die bedeuten: es arbeitet noch jemand daran. */
const LIVE_RUN_STATUSES = new Set(['queued', 'running', 'pending', 'in_progress']);

/**
 * Leitet aus einem Host-Snapshot ab, welche Tickets stehen.
 *
 * Bewusst konservativ: ein Ticket gilt nur dann als stehend, wenn der Host
 * etwas Benennbares meldet. "Dauert lange" ist kein Stillstand.
 */
export function stallsFromOrchestration(
  snapshot: OrchestrationSnapshot,
  knownTaskIds: ReadonlySet<string>,
  now = new Date().toISOString()
): TicketStall[] {
  const stalls = new Map<string, TicketStall>();

  const add = (taskId: string, kind: TicketStall['kind'], reason: string, detectedAt: string) => {
    if (!knownTaskIds.has(taskId) || stalls.has(taskId)) return;
    stalls.set(taskId, { taskId, kind, reason, detectedAt, retriedAt: null });
  };

  // Eine wartende Freigabe zuerst: sie erklaert ein stehendes Ticket besser als
  // der Run, der deswegen nicht weiterlaeuft.
  for (const approval of snapshot.approvals) {
    if (approval.decidedAt || approval.status === 'approved' || approval.status === 'rejected') continue;
    add(
      approval.issueId,
      'awaiting_approval',
      'Waiting for a human approval outside the board.',
      approval.createdAt
    );
  }

  for (const block of snapshot.invocationBlocks) {
    add(
      block.issueId,
      'budget',
      `The agent is blocked in ${block.scopeName}: ${block.reason}`,
      now
    );
  }

  // Ein toter Run zaehlt nur, solange kein neuerer Run dasselbe Ticket wieder
  // aufgenommen hat — sonst meldet das Board einen Fehler, der laengst
  // wiederholt wurde.
  const latestLiveRun = new Map<string, string>();
  for (const run of snapshot.runs) {
    if (!run.issueId || !LIVE_RUN_STATUSES.has(run.status)) continue;
    const known = latestLiveRun.get(run.issueId);
    if (!known || known.localeCompare(run.createdAt) < 0) latestLiveRun.set(run.issueId, run.createdAt);
  }

  for (const run of snapshot.runs) {
    if (!run.issueId || !DEAD_RUN_STATUSES.has(run.status)) continue;

    const revivedAt = latestLiveRun.get(run.issueId);
    if (revivedAt && revivedAt.localeCompare(run.createdAt) > 0) continue;

    add(
      run.issueId,
      'run_failed',
      run.error
        ? `The agent run ended without a result: ${run.error}`
        : 'The agent run ended without a result.',
      run.finishedAt ?? run.createdAt
    );
  }

  return [...stalls.values()];
}

/**
 * Fuehrt beobachtete Stillstaende mit den bereits bekannten zusammen.
 *
 * Der Host-Snapshot ist die Wahrheit fuer alles, was er kennt. Was er nicht
 * kennt — etwa ein nicht eingereihter Weckruf oder ein unlesbarer Marker —
 * bleibt erhalten, denn dafuer gibt es keine Host-Entsprechung.
 */
export function mergeStalls(
  existing: readonly TicketStall[],
  observed: readonly TicketStall[]
): TicketStall[] {
  const hostOwned = new Set<TicketStall['kind']>(['run_failed', 'awaiting_approval', 'budget']);
  const observedIds = new Set(observed.map((stall) => stall.taskId));

  const kept = existing.filter(
    (stall) => !hostOwned.has(stall.kind) && !observedIds.has(stall.taskId)
  );
  return [...kept, ...observed];
}
