/**
 * Unit Tests für Status Transitions
 *
 * Testet alle erlaubten und verbotenen Workflow-Übergänge
 * gemäß Scrum/Kanban Best Practices.
 */

import { describe, it, expect } from 'vitest';
import {
  TRANSITION_RULES,
  validateTransition,
  getNextStatuses,
  transitionRequiresReason,
  getAutoActions,
  SCRUM_WORKFLOW,
  isProgressForward,
  calculateWorkflowProgress,
} from '../transitions';
import type { TaskStatus } from '../../types';

// =============================================================================
// Test Data
// =============================================================================

/**
 * Alle Status die im System existieren
 */
const ALL_STATUSES: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
];

/**
 * Erlaubte Transitionen gemäß Issue-Spezifikation
 */
const ALLOWED_TRANSITIONS: Array<{ from: TaskStatus; to: TaskStatus }> = [
  // Standard-Workflow
  { from: 'backlog', to: 'todo' },
  { from: 'todo', to: 'in_progress' },
  { from: 'in_progress', to: 'in_review' },
  { from: 'in_review', to: 'done' },
  { from: 'in_review', to: 'in_progress' }, // Review rejected

  // Rückwärts-Bewegungen
  { from: 'todo', to: 'backlog' },
  { from: 'in_progress', to: 'todo' },

  // Blocked-Übergänge
  { from: 'backlog', to: 'blocked' },
  { from: 'todo', to: 'blocked' },
  { from: 'in_progress', to: 'blocked' },
  { from: 'in_review', to: 'blocked' },
  { from: 'blocked', to: 'todo' },
  { from: 'blocked', to: 'in_progress' },
  { from: 'blocked', to: 'backlog' },

  // Reopen aus Done
  { from: 'done', to: 'in_progress' },
  { from: 'done', to: 'todo' },
];

/**
 * Verbotene Transitionen gemäß Issue-Spezifikation
 * WICHTIG: in_progress -> done ist NICHT erlaubt (Business-Regel: alles muss durch Review)
 */
const FORBIDDEN_TRANSITIONS: Array<{ from: TaskStatus; to: TaskStatus }> = [
  // Aus backlog nicht direkt weiter als todo
  { from: 'backlog', to: 'in_progress' },
  { from: 'backlog', to: 'in_review' },
  { from: 'backlog', to: 'done' },

  // Aus todo nicht direkt zu review oder done
  { from: 'todo', to: 'in_review' },
  { from: 'todo', to: 'done' },

  // KRITISCH: in_progress -> done ist verboten!
  { from: 'in_progress', to: 'done' },
  { from: 'in_progress', to: 'backlog' },

  // Aus in_review nicht zurück in frühere Phasen
  { from: 'in_review', to: 'todo' },
  { from: 'in_review', to: 'backlog' },

  // Aus done nicht nach backlog
  { from: 'done', to: 'backlog' },
  { from: 'done', to: 'in_review' },
  { from: 'done', to: 'blocked' },

  // Aus blocked nicht direkt zu review oder done
  { from: 'blocked', to: 'in_review' },
  { from: 'blocked', to: 'done' },
  // NOTE: blocked -> blocked wird als "gleicher Status" behandelt (valid: true ohne Transition)
  // und ist daher in den Edge-Case-Tests abgedeckt
];

// =============================================================================
// validateTransition Tests
// =============================================================================

describe('validateTransition', () => {
  describe('Erlaubte Transitionen', () => {
    it.each(ALLOWED_TRANSITIONS)(
      'sollte $from -> $to als valid: true zurückgeben',
      ({ from, to }) => {
        const result = validateTransition(from, to);

        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();

        // Transition-Objekt sollte vorhanden sein (außer same-status)
        if (from !== to) {
          expect(result.transition).toBeDefined();
          expect(result.transition?.from).toBe(from);
          expect(result.transition?.to).toBe(to);
        }
      }
    );
  });

  describe('Verbotene Transitionen', () => {
    it.each(FORBIDDEN_TRANSITIONS)(
      'sollte $from -> $to als valid: false mit Error zurückgeben',
      ({ from, to }) => {
        const result = validateTransition(from, to);

        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('Invalid transition');
        expect(result.error).toContain(from);
        expect(result.error).toContain(to);
        expect(result.transition).toBeUndefined();
      }
    );
  });

  describe('Edge Cases', () => {
    it.each(ALL_STATUSES)(
      'sollte gleicher Status (%s -> %s) als valid ohne Transition-Objekt behandeln',
      (status) => {
        const result = validateTransition(status, status);

        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
        // Bei gleichem Status gibt es keine Transition
        expect(result.transition).toBeUndefined();
      }
    );
  });

  describe('Kritische Business-Regel', () => {
    it('sollte in_progress -> done STRIKT verbieten (Review-Pflicht)', () => {
      const result = validateTransition('in_progress', 'done');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Invalid transition');

      // Zusätzliche Prüfung: done darf NUR aus in_review kommen
      const validDoneTransitions = TRANSITION_RULES.filter((t) => t.to === 'done');
      expect(validDoneTransitions.length).toBe(1);
      expect(validDoneTransitions[0].from).toBe('in_review');
    });
  });
});

// =============================================================================
// getNextStatuses Tests
// =============================================================================

describe('getNextStatuses', () => {
  it('sollte für backlog die korrekten nächsten Status zurückgeben', () => {
    const nextStatuses = getNextStatuses('backlog');

    expect(nextStatuses).toContain('todo');
    expect(nextStatuses).toContain('blocked');
    expect(nextStatuses).not.toContain('in_progress');
    expect(nextStatuses).not.toContain('in_review');
    expect(nextStatuses).not.toContain('done');
  });

  it('sollte für todo die korrekten nächsten Status zurückgeben', () => {
    const nextStatuses = getNextStatuses('todo');

    expect(nextStatuses).toContain('in_progress');
    expect(nextStatuses).toContain('backlog');
    expect(nextStatuses).toContain('blocked');
    expect(nextStatuses).not.toContain('in_review');
    expect(nextStatuses).not.toContain('done');
  });

  it('sollte für in_progress die korrekten nächsten Status zurückgeben', () => {
    const nextStatuses = getNextStatuses('in_progress');

    expect(nextStatuses).toContain('in_review');
    expect(nextStatuses).toContain('blocked');
    expect(nextStatuses).toContain('todo');
    // KRITISCH: done darf NICHT enthalten sein
    expect(nextStatuses).not.toContain('done');
  });

  it('sollte für in_review die korrekten nächsten Status zurückgeben', () => {
    const nextStatuses = getNextStatuses('in_review');

    expect(nextStatuses).toContain('done');
    expect(nextStatuses).toContain('in_progress');
    expect(nextStatuses).toContain('blocked');
    expect(nextStatuses).not.toContain('todo');
    expect(nextStatuses).not.toContain('backlog');
  });

  it('sollte für done die korrekten nächsten Status zurückgeben', () => {
    const nextStatuses = getNextStatuses('done');

    expect(nextStatuses).toContain('in_progress');
    expect(nextStatuses).toContain('todo');
    expect(nextStatuses).not.toContain('backlog');
    expect(nextStatuses).not.toContain('in_review');
    expect(nextStatuses).not.toContain('blocked');
  });

  it('sollte für blocked die korrekten nächsten Status zurückgeben', () => {
    const nextStatuses = getNextStatuses('blocked');

    expect(nextStatuses).toContain('todo');
    expect(nextStatuses).toContain('in_progress');
    expect(nextStatuses).toContain('backlog');
    expect(nextStatuses).not.toContain('in_review');
    expect(nextStatuses).not.toContain('done');
  });
});

// =============================================================================
// transitionRequiresReason Tests
// =============================================================================

describe('transitionRequiresReason', () => {
  describe('Transitionen ohne Grund-Erfordernis', () => {
    const noReasonRequired: Array<{ from: TaskStatus; to: TaskStatus }> = [
      { from: 'backlog', to: 'todo' },
      { from: 'todo', to: 'in_progress' },
      { from: 'todo', to: 'backlog' },
      { from: 'in_progress', to: 'in_review' },
      { from: 'in_review', to: 'done' },
      { from: 'blocked', to: 'todo' },
      { from: 'blocked', to: 'in_progress' },
      { from: 'blocked', to: 'backlog' },
    ];

    it.each(noReasonRequired)(
      'sollte für $from -> $to keinen Grund erfordern',
      ({ from, to }) => {
        expect(transitionRequiresReason(from, to)).toBe(false);
      }
    );
  });

  describe('Transitionen mit Grund-Erfordernis', () => {
    const reasonRequired: Array<{ from: TaskStatus; to: TaskStatus }> = [
      // Blocked erfordert immer Grund
      { from: 'backlog', to: 'blocked' },
      { from: 'todo', to: 'blocked' },
      { from: 'in_progress', to: 'blocked' },
      { from: 'in_review', to: 'blocked' },
      // Zurück-Bewegungen
      { from: 'in_progress', to: 'todo' },
      { from: 'in_review', to: 'in_progress' }, // Review rejected
      // Reopen
      { from: 'done', to: 'in_progress' },
      { from: 'done', to: 'todo' },
    ];

    it.each(reasonRequired)(
      'sollte für $from -> $to einen Grund erfordern',
      ({ from, to }) => {
        expect(transitionRequiresReason(from, to)).toBe(true);
      }
    );
  });

  it('sollte false für nicht-existierende Transitionen zurückgeben', () => {
    // Eine verbotene Transition sollte false zurückgeben (da keine Regel existiert)
    expect(transitionRequiresReason('backlog', 'done')).toBe(false);
  });
});

// =============================================================================
// getAutoActions Tests
// =============================================================================

describe('getAutoActions', () => {
  it('sollte set_timestamp für todo -> in_progress enthalten', () => {
    const actions = getAutoActions('todo', 'in_progress');

    expect(actions).toContainEqual({ type: 'set_timestamp', field: 'startedAt' });
    expect(actions).toContainEqual({ type: 'notify', target: 'agent' });
  });

  it('sollte completedAt-Timestamp und Metriken für in_review -> done setzen', () => {
    const actions = getAutoActions('in_review', 'done');

    expect(actions).toContainEqual({ type: 'set_timestamp', field: 'completedAt' });
    expect(actions).toContainEqual({ type: 'update_metrics' });
    expect(actions).toContainEqual({ type: 'update_parent' });
  });

  it('sollte Board bei blocked-Übergängen notifizieren', () => {
    const statusesThatCanBeBlocked: TaskStatus[] = [
      'backlog',
      'todo',
      'in_progress',
      'in_review',
    ];

    for (const status of statusesThatCanBeBlocked) {
      const actions = getAutoActions(status, 'blocked');
      expect(actions).toContainEqual({ type: 'notify', target: 'board' });
    }
  });

  it('sollte Agent bei unblock notifizieren', () => {
    const unblockTargets: TaskStatus[] = ['todo', 'in_progress'];

    for (const target of unblockTargets) {
      const actions = getAutoActions('blocked', target);
      expect(actions).toContainEqual({ type: 'notify', target: 'agent' });
      expect(actions).toContainEqual({
        type: 'log_changelog',
        action: 'unblocked',
      });
    }
  });

  it('sollte leeres Array für verbotene Transitionen zurückgeben', () => {
    const actions = getAutoActions('backlog', 'done');
    expect(actions).toEqual([]);
  });

  it('sollte log_changelog für alle erlaubten Transitionen enthalten', () => {
    for (const transition of ALLOWED_TRANSITIONS) {
      const actions = getAutoActions(transition.from, transition.to);

      // Jede erlaubte Transition sollte mindestens einen changelog-Eintrag haben
      const hasChangelogAction = actions.some(
        (a) => a.type === 'log_changelog'
      );
      expect(hasChangelogAction).toBe(true);
    }
  });
});

// =============================================================================
// SCRUM_WORKFLOW Tests
// =============================================================================

describe('SCRUM_WORKFLOW', () => {
  it('sollte die korrekte Standard-Reihenfolge haben', () => {
    expect(SCRUM_WORKFLOW).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'done',
    ]);
  });

  it('sollte blocked nicht enthalten', () => {
    expect(SCRUM_WORKFLOW).not.toContain('blocked');
  });
});

// =============================================================================
// isProgressForward Tests
// =============================================================================

describe('isProgressForward', () => {
  describe('Vorwärts-Bewegungen', () => {
    const forwardMoves: Array<{ from: TaskStatus; to: TaskStatus }> = [
      { from: 'backlog', to: 'todo' },
      { from: 'backlog', to: 'in_progress' },
      { from: 'backlog', to: 'in_review' },
      { from: 'backlog', to: 'done' },
      { from: 'todo', to: 'in_progress' },
      { from: 'todo', to: 'in_review' },
      { from: 'todo', to: 'done' },
      { from: 'in_progress', to: 'in_review' },
      { from: 'in_progress', to: 'done' },
      { from: 'in_review', to: 'done' },
    ];

    it.each(forwardMoves)(
      'sollte $from -> $to als Fortschritt erkennen',
      ({ from, to }) => {
        expect(isProgressForward(from, to)).toBe(true);
      }
    );
  });

  describe('Rückwärts-Bewegungen', () => {
    const backwardMoves: Array<{ from: TaskStatus; to: TaskStatus }> = [
      { from: 'todo', to: 'backlog' },
      { from: 'in_progress', to: 'backlog' },
      { from: 'in_progress', to: 'todo' },
      { from: 'in_review', to: 'backlog' },
      { from: 'in_review', to: 'todo' },
      { from: 'in_review', to: 'in_progress' },
      { from: 'done', to: 'backlog' },
      { from: 'done', to: 'todo' },
      { from: 'done', to: 'in_progress' },
      { from: 'done', to: 'in_review' },
    ];

    it.each(backwardMoves)(
      'sollte $from -> $to als kein Fortschritt erkennen',
      ({ from, to }) => {
        expect(isProgressForward(from, to)).toBe(false);
      }
    );
  });

  describe('Blocked-Sonderfälle', () => {
    it('sollte aus blocked raus als Fortschritt erkennen', () => {
      expect(isProgressForward('blocked', 'todo')).toBe(true);
      expect(isProgressForward('blocked', 'in_progress')).toBe(true);
      expect(isProgressForward('blocked', 'backlog')).toBe(true);
    });

    it('sollte nach blocked als kein Fortschritt erkennen', () => {
      expect(isProgressForward('backlog', 'blocked')).toBe(false);
      expect(isProgressForward('todo', 'blocked')).toBe(false);
      expect(isProgressForward('in_progress', 'blocked')).toBe(false);
    });
  });

  describe('Gleicher Status', () => {
    it.each(ALL_STATUSES.filter((s) => s !== 'blocked'))(
      'sollte %s -> %s als kein Fortschritt erkennen',
      (status) => {
        expect(isProgressForward(status, status)).toBe(false);
      }
    );
  });
});

// =============================================================================
// calculateWorkflowProgress Tests
// =============================================================================

describe('calculateWorkflowProgress', () => {
  it('sollte 0% für backlog zurückgeben', () => {
    expect(calculateWorkflowProgress('backlog')).toBe(0);
  });

  it('sollte 25% für todo zurückgeben', () => {
    expect(calculateWorkflowProgress('todo')).toBe(25);
  });

  it('sollte 50% für in_progress zurückgeben', () => {
    expect(calculateWorkflowProgress('in_progress')).toBe(50);
  });

  it('sollte 75% für in_review zurückgeben', () => {
    expect(calculateWorkflowProgress('in_review')).toBe(75);
  });

  it('sollte 100% für done zurückgeben', () => {
    expect(calculateWorkflowProgress('done')).toBe(100);
  });

  it('sollte 0% für blocked zurückgeben', () => {
    expect(calculateWorkflowProgress('blocked')).toBe(0);
  });
});

// =============================================================================
// TRANSITION_RULES Konsistenz-Tests
// =============================================================================

describe('TRANSITION_RULES Konsistenz', () => {
  it('sollte keine doppelten Regeln enthalten', () => {
    const ruleKeys = TRANSITION_RULES.map((r) => `${r.from}->${r.to}`);
    const uniqueKeys = new Set(ruleKeys);

    expect(ruleKeys.length).toBe(uniqueKeys.size);
  });

  it('sollte nur gültige TaskStatus-Werte verwenden', () => {
    for (const rule of TRANSITION_RULES) {
      expect(ALL_STATUSES).toContain(rule.from);
      expect(ALL_STATUSES).toContain(rule.to);
    }
  });

  it('sollte für jede Regel mindestens eine AutoAction haben', () => {
    for (const rule of TRANSITION_RULES) {
      expect(rule.autoActions.length).toBeGreaterThan(0);
    }
  });

  it('sollte requiresReason als boolean haben', () => {
    for (const rule of TRANSITION_RULES) {
      expect(typeof rule.requiresReason).toBe('boolean');
    }
  });
});

// =============================================================================
// Vollständigkeits-Check
// =============================================================================

describe('Transition-Matrix Vollständigkeit', () => {
  it('sollte alle definierten erlaubten Transitionen in TRANSITION_RULES haben', () => {
    for (const allowed of ALLOWED_TRANSITIONS) {
      const exists = TRANSITION_RULES.some(
        (r) => r.from === allowed.from && r.to === allowed.to
      );
      expect(exists).toBe(true);
    }
  });

  it('sollte keine der verbotenen Transitionen in TRANSITION_RULES haben', () => {
    for (const forbidden of FORBIDDEN_TRANSITIONS) {
      const exists = TRANSITION_RULES.some(
        (r) => r.from === forbidden.from && r.to === forbidden.to
      );
      expect(exists).toBe(false);
    }
  });

  it('sollte die erwartete Anzahl an Regeln haben', () => {
    // Entspricht den ALLOWED_TRANSITIONS
    expect(TRANSITION_RULES.length).toBe(ALLOWED_TRANSITIONS.length);
  });
});
