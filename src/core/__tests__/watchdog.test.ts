import { describe, expect, it } from 'vitest';

import { createScrumTask } from '../factories';
import type { ScrumAgent, ScrumTask, TicketStall, WorkerState } from '../types';
import { validateWatchdogReport, watchdogAgenda, watchdogReportSummary } from '../watchdog';

function task(overrides: Partial<ScrumTask> = {}): ScrumTask {
  return {
    ...createScrumTask({
      title: 'Slider markup',
      description: 'As a visitor, I want to browse images.',
      identifier: 'TESAA-17',
    }),
    updatedAt: '2026-08-10T12:00:00.000Z',
    ...overrides,
  };
}

function agent(role: string, id: string): ScrumAgent {
  return {
    id,
    name: `${role} agent`,
    role,
    status: 'idle',
    currentTaskId: null,
    capabilities: [],
  };
}

function board(
  tasks: ScrumTask[],
  agents: ScrumAgent[] = [],
  stalls: TicketStall[] = []
): Pick<WorkerState, 'tasks' | 'agents' | 'stalls' | 'currentSprint'> {
  return { tasks, agents, stalls, currentSprint: null };
}

const NOW = Date.parse('2026-08-10T13:00:00.000Z');

/**
 * Der zeitgesteuerte Lauf des Scrum Masters startet garantiert — auch, wenn es
 * nichts zu tun gibt. Genau dann hat er sich einmal ein Ticket gegriffen und
 * implementiert. Die Agenda ist die Gegenmassnahme: ein Auftrag mit Ende.
 */
describe('the watchdog agenda', () => {
  it('is empty on a board where nothing is stuck', () => {
    const agenda = watchdogAgenda(
      board([task({ column: 'in_progress', assignedAgentId: 'dev-1' })], [agent('developer', 'dev-1')]),
      NOW
    );

    expect(agenda.clear).toBe(true);
    expect(agenda.items).toEqual([]);
  });

  it('does not turn a refined backlog ticket into work for the watchdog', () => {
    // Genau dieses Ticket hat der Watchdog implementiert. Es steht bereit fuer
    // die Sprintplanung — und geht ihn nichts an.
    const agenda = watchdogAgenda(board([task({ column: 'backlog', refined: true, storyPoints: 3 })]), NOW);

    expect(agenda.clear).toBe(true);
  });

  it('names blocked and stalled tickets with the role that owns them', () => {
    const blocked = task({ id: 'task-1', column: 'blocked' });
    const stalled = task({ id: 'task-2', identifier: 'TESAA-18', column: 'in_progress' });
    const agenda = watchdogAgenda(
      board([blocked, stalled], [], [
        {
          taskId: 'task-2',
          kind: 'run_failed',
          reason: 'The agent run ended without a result.',
          detectedAt: '2026-08-10T12:30:00.000Z',
        },
      ]),
      NOW
    );

    expect(agenda.clear).toBe(false);
    expect(agenda.items).toMatchObject([
      { kind: 'blocked_ticket', taskId: 'task-1', owner: 'technical_lead' },
      { kind: 'stalled_ticket', taskId: 'task-2', detail: 'The agent run ended without a result.' },
    ]);
  });

  it('sends a waiting human approval to the human, not to an agent', () => {
    const agenda = watchdogAgenda(
      board([task({ id: 'task-1' })], [], [
        {
          taskId: 'task-1',
          kind: 'awaiting_approval',
          reason: 'Waiting for a human approval outside the board.',
          detectedAt: '2026-08-10T12:30:00.000Z',
        },
      ]),
      NOW
    );

    expect(agenda.items[0]).toMatchObject({ kind: 'stalled_ticket', owner: 'human' });
  });

  it('reports a review only once it has been open too long', () => {
    const fresh = watchdogAgenda(
      board([task({ column: 'in_review', updatedAt: '2026-08-10T12:45:00.000Z' })]),
      NOW
    );
    expect(fresh.clear).toBe(true);

    const stale = watchdogAgenda(
      board([task({ column: 'in_review', updatedAt: '2026-08-10T12:00:00.000Z' })]),
      NOW
    );
    expect(stale.items[0]).toMatchObject({ kind: 'review_waiting', owner: 'qa_engineer' });
  });

  it('reports idle capacity only while work is actually waiting', () => {
    const idleWithWork = watchdogAgenda(
      board([task({ column: 'todo', assignedAgentId: 'dev-1' })], [agent('developer', 'dev-2')]),
      NOW
    );
    expect(idleWithWork.items.some((item) => item.kind === 'idle_developer')).toBe(true);

    const idleWithoutWork = watchdogAgenda(board([], [agent('developer', 'dev-2')]), NOW);
    expect(idleWithoutWork.clear).toBe(true);
  });
});

describe('the watchdog report', () => {
  it('accepts a clear run', () => {
    expect(validateWatchdogReport({ clear: true })).toMatchObject({ ok: true });
    expect(watchdogReportSummary({ clear: true, findings: [] })).toContain('nothing is stuck');
  });

  it('refuses a report that says both nothing and something', () => {
    expect(
      validateWatchdogReport({
        clear: true,
        findings: [{ kind: 'blocked_ticket', note: 'stuck' }],
      })
    ).toMatchObject({ ok: false });
  });

  it('refuses an empty run that is not declared clear', () => {
    expect(validateWatchdogReport({ clear: false, findings: [] })).toMatchObject({ ok: false });
  });

  it('insists on a note, so a finding says what to do', () => {
    expect(
      validateWatchdogReport({ clear: false, findings: [{ kind: 'blocked_ticket', note: '  ' }] })
    ).toMatchObject({ ok: false });
  });

  it('rejects a made-up finding kind', () => {
    expect(
      validateWatchdogReport({ clear: false, findings: [{ kind: 'implemented_it', note: 'done' }] })
    ).toMatchObject({ ok: false });
  });

  it('keeps the ticket reference when there is one', () => {
    const parsed = validateWatchdogReport({
      clear: false,
      findings: [{ kind: 'blocked_ticket', taskId: 'task-1', note: 'Waiting on TESAA-17.' }],
    });

    expect(parsed).toMatchObject({
      ok: true,
      value: { findings: [{ taskId: 'task-1', kind: 'blocked_ticket' }] },
    });
  });
});
