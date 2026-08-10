import { describe, expect, it } from 'vitest';

import {
  LIVE_RUN_STALL_AFTER_MS,
  mergeStalls,
  stallsFromOrchestration,
  timedOutRunsAwaitingRecovery,
  type OrchestrationSnapshot,
} from '../project-orchestration';

const NOW = '2026-08-10T12:10:00.000Z';
const RUN_STARTED_AT = '2026-08-10T12:00:00.000Z';

function snapshotWithRun(status: string, createdAt = RUN_STARTED_AT): OrchestrationSnapshot {
  return {
    runs: [
      {
        id: 'run-1',
        issueId: 'ticket-1',
        status,
        startedAt: createdAt,
        error: null,
        finishedAt: null,
        createdAt,
      },
    ],
    approvals: [],
    invocationBlocks: [],
    openBudgetIncidents: [],
  };
}

describe('project orchestration run limits', () => {
  it('reports a live agent run once it exceeds the bounded-run budget', () => {
    const stalls = stallsFromOrchestration(
      snapshotWithRun('running'),
      new Set(['ticket-1']),
      NOW
    );

    expect(LIVE_RUN_STALL_AFTER_MS).toBe(10 * 60 * 1000);
    expect(stalls).toEqual([
      expect.objectContaining({
        taskId: 'ticket-1',
        kind: 'run_stalled',
        detectedAt: RUN_STARTED_AT,
      }),
    ]);
  });

  it('selects only the latest timed-out run for one controlled recovery', () => {
    expect(
      timedOutRunsAwaitingRecovery(snapshotWithRun('timed_out'), new Set(['ticket-1']))
    ).toEqual([
      expect.objectContaining({
        id: 'run-1',
        issueId: 'ticket-1',
        status: 'timed_out',
      }),
    ]);

    const completedAfterTimeout: OrchestrationSnapshot = {
      ...snapshotWithRun('timed_out'),
      runs: [
        ...snapshotWithRun('timed_out').runs,
        {
          id: 'run-2',
          issueId: 'ticket-1',
          status: 'succeeded',
          startedAt: '2026-08-10T12:01:00.000Z',
          error: null,
          finishedAt: '2026-08-10T12:02:00.000Z',
          createdAt: '2026-08-10T12:01:00.000Z',
        },
      ],
    };

    expect(
      timedOutRunsAwaitingRecovery(completedAfterTimeout, new Set(['ticket-1']))
    ).toEqual([]);
    expect(stallsFromOrchestration(completedAfterTimeout, new Set(['ticket-1']), NOW)).toEqual([]);

    expect(
      timedOutRunsAwaitingRecovery(snapshotWithRun('cancelled'), new Set(['ticket-1']))
    ).toEqual([]);
  });

  it('clears a reported live-run stall after the host no longer reports it', () => {
    const remaining = mergeStalls(
      [
        {
          taskId: 'ticket-1',
          kind: 'run_stalled',
          reason: 'The agent run exceeded its execution budget.',
          detectedAt: RUN_STARTED_AT,
          retriedAt: null,
        },
      ],
      []
    );

    expect(remaining).toEqual([]);
  });
});