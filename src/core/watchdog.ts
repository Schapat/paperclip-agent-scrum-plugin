/**
 * Der Auftrag des Scrum-Master-Watchdogs.
 *
 * Der Scrum Master ist die einzige zeitgesteuerte Rolle: er laeuft alle 30
 * Minuten, auch wenn ihm nichts zugewiesen ist. Genau das ist die Lage, in der
 * ein faehiges Modell sich Arbeit sucht — einmal hat es ein verfeinertes Ticket
 * ausgecheckt, implementiert und auf `done` gesetzt, waehrend das Board noch
 * "Sprint planning" zeigte.
 *
 * Die Gegenmassnahme ist kein weiterer Verbotssatz, sondern ein Auftrag: das
 * Board rechnet aus, was zu pruefen ist, und der Watchdog bekommt genau diese
 * Liste. Ist sie leer, ist sein Lauf zu Ende. Was er tun darf, endet an einem
 * einzigen Bericht.
 *
 * Das Modul bleibt frei von SDK-Aufrufen, damit die Regeln ohne laufenden Host
 * pruefbar sind.
 */

import type { ScrumTask, TicketStall, WorkerState } from './types';

/** Woran ein Ticket haengt — die Kategorie bestimmt, wer geweckt wird. */
export type WatchdogItemKind =
  | 'blocked_ticket'
  | 'stalled_ticket'
  | 'idle_developer'
  | 'unassigned_work'
  | 'review_waiting';

export interface WatchdogItem {
  kind: WatchdogItemKind;
  /** Leer bei Befunden, die kein einzelnes Ticket betreffen. */
  taskId: string | null;
  identifier: string | null;
  title: string | null;
  /** Was das Board beobachtet hat, in einem Satz. */
  detail: string;
  /** Die Rolle, die das aufloesen kann. */
  owner: 'product_owner' | 'technical_lead' | 'developer' | 'qa_engineer' | 'human';
}

export interface WatchdogAgenda {
  items: WatchdogItem[];
  /** Nichts zu tun — der Lauf endet hier. */
  clear: boolean;
  checkedTasks: number;
}

/** Wie lange ein Review offen sein darf, bevor der Watchdog ihn meldet. */
export const REVIEW_ATTENTION_AFTER_MS = 30 * 60 * 1000;

function label(task: ScrumTask): { identifier: string | null; title: string } {
  return { identifier: task.identifier ?? null, title: task.title };
}

/**
 * Rechnet aus, was ein Watchdog-Lauf zu pruefen hat.
 *
 * Bewusst nur beobachtbare Lagen: ein Ticket ist blockiert, ein Ticket steht
 * nachweislich, ein Developer ist frei waehrend Arbeit wartet. "Sieh dir das
 * Board an" ist kein Auftrag, sondern eine Einladung.
 */
export function watchdogAgenda(
  state: Pick<WorkerState, 'tasks' | 'agents' | 'stalls' | 'currentSprint'>,
  now = Date.now()
): WatchdogAgenda {
  const items: WatchdogItem[] = [];
  const tasks = state.tasks;
  const stalls: TicketStall[] = state.stalls ?? [];

  for (const task of tasks.filter((entry) => entry.column === 'blocked')) {
    items.push({
      kind: 'blocked_ticket',
      taskId: task.id,
      ...label(task),
      detail: 'The ticket sits in Blocked. Check whether its blockers are done and say who resolves them.',
      owner: 'technical_lead',
    });
  }

  for (const stall of stalls) {
    const task = tasks.find((entry) => entry.id === stall.taskId);
    if (!task) continue;
    items.push({
      kind: 'stalled_ticket',
      taskId: task.id,
      ...label(task),
      detail: stall.reason,
      owner: stall.kind === 'awaiting_approval' || stall.kind === 'budget' ? 'human' : 'technical_lead',
    });
  }

  for (const task of tasks.filter((entry) => entry.column === 'in_review')) {
    const since = Date.parse(task.updatedAt);
    if (!Number.isFinite(since) || now - since < REVIEW_ATTENTION_AFTER_MS) continue;
    items.push({
      kind: 'review_waiting',
      taskId: task.id,
      ...label(task),
      detail: 'The review has been open for more than 30 minutes without a QA verdict.',
      owner: 'qa_engineer',
    });
  }

  // Ein Ticket in TODO ohne Bearbeiter wartet auf niemanden — es faellt sonst
  // aus jeder Zustaendigkeit heraus.
  for (const task of tasks.filter((entry) => entry.column === 'todo' && entry.assignedAgentId === null)) {
    items.push({
      kind: 'unassigned_work',
      taskId: task.id,
      ...label(task),
      detail: 'The ticket is in TODO without an assignee, so no agent is woken for it.',
      owner: 'product_owner',
    });
  }

  // Freie Kapazitaet ist nur dann ein Befund, wenn tatsaechlich Arbeit wartet.
  const waiting = tasks.filter((task) => task.column === 'todo').length;
  if (waiting > 0) {
    const busy = new Set(
      tasks
        .filter((task) => task.column === 'in_progress' || task.column === 'in_review')
        .map((task) => task.assignedAgentId)
    );
    const idle = state.agents.filter((agent) => agent.role === 'developer' && !busy.has(agent.id));
    if (idle.length > 0) {
      items.push({
        kind: 'idle_developer',
        taskId: null,
        identifier: null,
        title: null,
        detail: `${idle.length} developer(s) have no ticket in progress while ${waiting} ticket(s) wait in TODO.`,
        owner: 'product_owner',
      });
    }
  }

  return { items, clear: items.length === 0, checkedTasks: tasks.length };
}

export interface WatchdogReportEntry {
  taskId: string | null;
  kind: WatchdogItemKind;
  note: string;
}

export interface WatchdogReportInput {
  findings: WatchdogReportEntry[];
  /** Der Watchdog hat nichts gefunden. */
  clear: boolean;
}

export type WatchdogValidation =
  | { ok: true; value: WatchdogReportInput }
  | { ok: false; error: string };

const REPORT_KINDS: ReadonlySet<string> = new Set<WatchdogItemKind>([
  'blocked_ticket',
  'stalled_ticket',
  'idle_developer',
  'unassigned_work',
  'review_waiting',
]);

/** Prueft den einen Bericht, den ein Watchdog-Lauf abgeben darf. */
export function validateWatchdogReport(input: unknown): WatchdogValidation {
  const record = isRecord(input) ? input : {};
  const clear = record.clear === true;
  const rawFindings = Array.isArray(record.findings) ? record.findings : [];

  if (clear && rawFindings.length > 0) {
    return { ok: false, error: 'A clear report cannot carry findings. Report either "clear" or the findings.' };
  }
  if (!clear && rawFindings.length === 0) {
    return { ok: false, error: 'Report at least one finding, or set clear to true.' };
  }

  const findings: WatchdogReportEntry[] = [];
  for (const entry of rawFindings) {
    if (!isRecord(entry)) return { ok: false, error: 'Every finding must be an object.' };

    const kind = typeof entry.kind === 'string' ? entry.kind : '';
    if (!REPORT_KINDS.has(kind)) {
      return { ok: false, error: `Unknown finding kind "${kind}". Use one of: ${[...REPORT_KINDS].join(', ')}.` };
    }
    const note = typeof entry.note === 'string' ? entry.note.trim() : '';
    if (!note) return { ok: false, error: 'Every finding needs a note that names the impediment.' };

    const taskId = typeof entry.taskId === 'string' && entry.taskId.trim() ? entry.taskId.trim() : null;
    findings.push({ taskId, kind: kind as WatchdogItemKind, note });
  }

  return { ok: true, value: { findings, clear } };
}

/** Fasst den Bericht so zusammen, wie er im Board-Log erscheint. */
export function watchdogReportSummary(input: WatchdogReportInput): string {
  if (input.clear) return 'Scrum Master watchdog: nothing is stuck.';

  const kinds = [...new Set(input.findings.map((finding) => finding.kind))];
  return `Scrum Master watchdog reported ${input.findings.length} impediment(s): ${kinds.join(', ')}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const GET_WATCHDOG_AGENDA_TOOL = 'get_watchdog_agenda';
export const SUBMIT_WATCHDOG_REPORT_TOOL = 'submit_watchdog_report';
