/**
 * Tests fuer die Zustellpolitik.
 *
 * Zwei Fehler sind hier moeglich, und sie sind gegenlaeufig: zu oft zustellen
 * (das Ueberholen im Minutentakt, an dem das alte Board litt) und zu selten
 * (der Stillstand, gegen den die Wiedervorlage gebaut wurde). Die Tests halten
 * beide Seiten fest.
 */

import { describe, it, expect } from 'vitest';
import { MAX_INTENT_ATTEMPTS, planDelivery, type IntentLog } from '../deliver';
import type { BoardIntent } from '../intents';

const MINUTE = 60 * 1000;
const T0 = Date.parse('2026-08-12T10:00:00.000Z');

function intent(overrides: Partial<BoardIntent> = {}): BoardIntent {
  return {
    key: 'task-1:implement',
    taskId: 'task-1',
    kind: 'implement',
    role: 'developer',
    agentId: 'dev-1',
    reason: 'The ticket is assigned and waits to start.',
    ...overrides,
  };
}

/** Stellt dieselbe Absicht wiederholt zu, bis die Versuche erschoepft sind. */
function deliverRepeatedly(times: number, step = 24 * 60 * MINUTE) {
  let log: IntentLog = {};
  let last = planDelivery([intent()], log, T0);
  log = last.log;

  for (let i = 1; i < times; i++) {
    last = planDelivery([intent()], log, T0 + i * step);
    log = last.log;
  }
  return { last, log };
}

describe('Erstzustellung', () => {
  it('eine neue Absicht geht sofort raus', () => {
    const result = planDelivery([intent()], {}, T0);

    expect(result.deliver).toHaveLength(1);
    expect(result.log['task-1:implement'].attempts).toBe(1);
  });

  it('mehrere Absichten werden unabhängig voneinander beurteilt', () => {
    const result = planDelivery(
      [intent(), intent({ key: 'task-2:review', taskId: 'task-2', kind: 'review' })],
      { 'task-1:implement': { lastDeliveredAt: new Date(T0).toISOString(), attempts: 1 } },
      T0 + MINUTE
    );

    expect(result.deliver.map((entry) => entry.taskId)).toEqual(['task-2']);
  });
});

describe('Wartezeit', () => {
  it('hält eine gerade zugestellte Absicht zurück', () => {
    const log: IntentLog = {
      'task-1:implement': { lastDeliveredAt: new Date(T0).toISOString(), attempts: 1 },
    };

    // Der Reconcile-Tick läuft jede Minute — hier darf nichts rausgehen.
    expect(planDelivery([intent()], log, T0 + MINUTE).deliver).toHaveLength(0);
  });

  it('stellt nach Ablauf der Wartezeit erneut zu', () => {
    const log: IntentLog = {
      'task-1:implement': { lastDeliveredAt: new Date(T0).toISOString(), attempts: 1 },
    };
    const result = planDelivery([intent()], log, T0 + 6 * MINUTE);

    expect(result.deliver).toHaveLength(1);
    expect(result.log['task-1:implement'].attempts).toBe(2);
  });

  it('die Wartezeit wächst mit jedem Versuch', () => {
    const log: IntentLog = {
      'task-1:implement': { lastDeliveredAt: new Date(T0).toISOString(), attempts: 2 },
    };

    // Nach dem zweiten Versuch sind es 15 Minuten, nicht mehr 5.
    expect(planDelivery([intent()], log, T0 + 6 * MINUTE).deliver).toHaveLength(0);
    expect(planDelivery([intent()], log, T0 + 16 * MINUTE).deliver).toHaveLength(1);
  });
});

describe('Aufgabe', () => {
  it('nach erschöpften Versuchen übernimmt ein Mensch', () => {
    const { last } = deliverRepeatedly(MAX_INTENT_ATTEMPTS + 1);

    expect(last.deliver).toHaveLength(0);
    expect(last.escalate).toHaveLength(1);
    expect(last.escalate[0].role).toBe('human');
    expect(last.escalate[0].reason).toContain('without progress');
  });

  it('eine eskalierte Absicht wird nicht weiter geweckt', () => {
    const { log } = deliverRepeatedly(MAX_INTENT_ATTEMPTS + 1);

    // Auch einen Tag später bleibt es bei der Eskalation.
    const later = planDelivery([intent()], log, T0 + 40 * 24 * 60 * MINUTE);
    expect(later.deliver).toHaveLength(0);
    expect(later.escalate).toHaveLength(1);
  });

  it('eine Absicht für einen Menschen zählt keine Versuche', () => {
    const waiting = intent({ role: 'human', kind: 'await_human', key: 'task-1:await_human' });
    const result = planDelivery([waiting], {}, T0);

    expect(result.deliver).toHaveLength(0);
    expect(result.escalate).toHaveLength(1);
    expect(result.log).toEqual({});
  });
});

describe('Zurücksetzen durch Fortschritt', () => {
  it('eine verschwundene Absicht verliert ihre Vorgeschichte', () => {
    const log: IntentLog = {
      'task-1:implement': { lastDeliveredAt: new Date(T0).toISOString(), attempts: 4 },
    };

    // Das Ticket ist weitergezogen — `implement` fällt nicht mehr an.
    const moved = planDelivery([intent({ key: 'task-1:review', kind: 'review' })], log, T0);
    expect(moved.log['task-1:implement']).toBeUndefined();

    // Kommt es später zurück (Rework), beginnt es wieder bei eins.
    const back = planDelivery([intent()], moved.log, T0 + MINUTE);
    expect(back.deliver).toHaveLength(1);
    expect(back.log['task-1:implement'].attempts).toBe(1);
  });

  it('ein leerer Plan leert den Log', () => {
    const log: IntentLog = {
      'task-1:implement': { lastDeliveredAt: new Date(T0).toISOString(), attempts: 2 },
    };

    expect(planDelivery([], log, T0).log).toEqual({});
  });
});
