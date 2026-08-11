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

import type { LiveAgentRun, TicketStall } from './types';

/** Die Teilmenge der Host-Orchestrierung, die das Board auswertet. */
export interface OrchestrationSnapshot {
  runs: Array<{
    id: string;
    issueId: string | null;
    status: string;
    startedAt: string | null;
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
/** Nach dieser Zeit braucht ein noch laufender Agent-Run Aufmerksamkeit. */
export const LIVE_RUN_STALL_AFTER_MS = 10 * 60 * 1000;

/**
 * Liefert pro bekanntem Ticket nur den juengsten Host-Run.
 *
 * Aeltere Fehler duerfen ein zwischenzeitlich erfolgreiches oder erneut
 * gestartetes Ticket nicht weiter als Stillstand erscheinen lassen.
 */
function latestRunsByIssue(
  snapshot: OrchestrationSnapshot,
  knownTaskIds: ReadonlySet<string>
): Map<string, OrchestrationSnapshot['runs'][number]> {
  const latestRuns = new Map<string, OrchestrationSnapshot['runs'][number]>();

  for (const run of snapshot.runs) {
    if (!run.issueId || !knownTaskIds.has(run.issueId)) continue;
    const previous = latestRuns.get(run.issueId);
    if (
      !previous ||
      previous.createdAt.localeCompare(run.createdAt) < 0 ||
      (previous.createdAt === run.createdAt && previous.id.localeCompare(run.id) < 0)
    ) {
      latestRuns.set(run.issueId, run);
    }
  }

  return latestRuns;
}

/**
 * Liefert die Runs, die der Host gerade als laufend fuehrt.
 *
 * Das ist der einzige Beleg dafuer, dass ueberhaupt ein Agent arbeitet. Die
 * Ansicht hat diese Frage bisher aus dem Phasenstatus beantwortet und damit
 * auch dann "Working now" gezeigt, wenn seit einer halben Stunde kein Lauf
 * mehr existierte.
 */
export function liveRunsFromOrchestration(
  snapshot: OrchestrationSnapshot,
  knownTaskIds: ReadonlySet<string>
): LiveAgentRun[] {
  return [...latestRunsByIssue(snapshot, knownTaskIds).entries()].flatMap(([issueId, run]) =>
    LIVE_RUN_STATUSES.has(run.status)
      ? [{ taskId: issueId, runId: run.id, startedAt: run.startedAt ?? run.createdAt }]
      : []
  );
}

/** Liefert Timeouts, fuer die ein neuer, begrenzter Versuch sinnvoll ist. */
export function timedOutRunsAwaitingRecovery(
  snapshot: OrchestrationSnapshot,
  knownTaskIds: ReadonlySet<string>
): OrchestrationSnapshot['runs'] {
  return [...latestRunsByIssue(snapshot, knownTaskIds).values()].filter(
    (run) => run.status === 'timed_out'
  );
}

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

  const latestRuns = latestRunsByIssue(snapshot, knownTaskIds);
  const nowMs = Date.parse(now);
  if (Number.isFinite(nowMs)) {
    for (const [issueId, run] of latestRuns) {
      if (!LIVE_RUN_STATUSES.has(run.status)) continue;
      const startedAtMs = Date.parse(run.startedAt ?? run.createdAt);
      if (!Number.isFinite(startedAtMs) || nowMs - startedAtMs < LIVE_RUN_STALL_AFTER_MS) continue;

      add(
        issueId,
        'run_stalled',
        'The agent run exceeded its 10-minute execution budget without finishing.',
        run.startedAt ?? run.createdAt
      );
    }
  }

  for (const [issueId, run] of latestRuns) {
    if (!DEAD_RUN_STATUSES.has(run.status)) continue;

    add(
      issueId,
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
  observed: readonly TicketStall[],
  /**
   * Tickets, die sich nachweislich bewegt haben.
   *
   * Ein erledigtes Ticket kann nicht stehen. Ohne diese Bereinigung meldete
   * ein fertiges Projekt weiter "blocked — human approval required", weil der
   * Stillstand von vorhin nie jemand zurueckgenommen hat.
   */
  settledTaskIds: ReadonlySet<string> = new Set(),
  /**
   * Tickets, die inzwischen verfeinert sind.
   *
   * Ein "Refinement fehlt"-Stillstand ueberlebte die Schaetzung, die ihn
   * aufhebt: er wird nur beim Tool-Aufruf zurueckgenommen, und ein als
   * Kommentar nachgereichter Marker laeuft nicht durch das Tool. Das Board
   * meldete danach "blocked" auf einem sprintreifen Backlog.
   */
  refinedTaskIds: ReadonlySet<string> = new Set(),
  /**
   * Der Kickoff und der Zeitpunkt seines letzten Phasenwechsels.
   *
   * Ein Stillstand am Kickoff — etwa ein Weckruf, der nicht eingereiht wurde —
   * gehoert zu der Phase, in der er entstand. Ist die Phase weitergezogen,
   * beschreibt er nichts mehr. Er kann sich aber auch nicht selbst
   * zuruecknehmen: der Kickoff ist kein Kanban-Ticket und faellt damit aus
   * jeder Ticket-Bereinigung heraus. Das Board meldete deshalb "blocked" wegen
   * eines abgebrochenen Versuchs von vor acht Minuten.
   */
  kickoff: { issueId: string; phaseChangedAt: string } | null = null
): TicketStall[] {
  const hostOwned = new Set<TicketStall['kind']>([
    'run_failed',
    'run_stalled',
    'awaiting_approval',
    'budget',
  ]);
  const observedIds = new Set(observed.map((stall) => stall.taskId));

  // Die Schaetzung ist da — der Vermerk "es fehlt eine Schaetzung" ist damit
  // erledigt, unabhaengig davon, auf welchem Weg sie kam.
  const obsolete = (stall: TicketStall) =>
    settledTaskIds.has(stall.taskId) ||
    (stall.kind === 'refinement_invalid' && refinedTaskIds.has(stall.taskId)) ||
    (kickoff !== null &&
      stall.taskId === kickoff.issueId &&
      stall.detectedAt.localeCompare(kickoff.phaseChangedAt) < 0);

  const kept = existing.filter(
    (stall) => !hostOwned.has(stall.kind) && !observedIds.has(stall.taskId) && !obsolete(stall)
  );
  return [...kept, ...observed.filter((stall) => !obsolete(stall))];
}
