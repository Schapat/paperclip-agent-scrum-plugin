/**
 * Tests für das QA-Review (Spec §3, Spalte Review)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ScrumAgent, ScrumTask, WorkerState } from '@shared/types';
import { createDefaultSettings } from '@shared/types';
import { createAcceptanceCriterion, createScrumTask } from '@shared/factories';
import { reviewTicket } from '../qa-review';

function agent(id: string, role: string): ScrumAgent {
  return { id, name: id, role, status: 'idle', currentTaskId: null, capabilities: [] };
}

function createState(): WorkerState {
  return {
    initialized: true,
    currentSprint: null,
    tasks: [],
    agents: [agent('qa-1', 'qa_engineer'), agent('dev-1', 'developer')],
    settings: createDefaultSettings(),
    metrics: {
      totalPoints: 0,
      completedPoints: 0,
      remainingPoints: 0,
      averageCycleTime: 0,
      velocity: 0,
      burndownData: [],
      changelog: [],
    },
    messages: [],
    ceremonies: [],
    completedSprints: [],
    learnings: [],
    skills: [],
    proposedStories: [],
  };
}

/** Ticket in der Review-Spalte mit zwei Akzeptanzkriterien. */
function reviewableTask(overrides: Partial<ScrumTask> = {}): ScrumTask {
  return createScrumTask({
    id: 't-1',
    title: 'Login',
    description: '',
    column: 'in_review',
    assignedAgentId: 'dev-1',
    storyPoints: 5,
    refined: true,
    acceptanceCriteria: [createAcceptanceCriterion('AC-1'), createAcceptanceCriterion('AC-2')],
    ...overrides,
  });
}

describe('QA-Review', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('setzt das Ticket auf Done, wenn alle Kriterien erfüllt sind', () => {
    const task = reviewableTask();
    state.tasks.push(task);

    const result = reviewTicket(state, 't-1', {
      metCriterionIds: task.acceptanceCriteria.map((c) => c.id),
    })!;

    expect(result.passed).toBe(true);
    expect(task.column).toBe('done');
    expect(task.completedAt).not.toBeNull();
    expect(result.decision.type).toBe('review_passed');
  });

  it('schickt das Ticket mit konkretem Feedback zurück in die Entwicklung', () => {
    const task = reviewableTask();
    state.tasks.push(task);

    // Nur das erste Kriterium bestätigt
    const result = reviewTicket(state, 't-1', {
      metCriterionIds: [task.acceptanceCriteria[0].id],
    })!;

    expect(result.passed).toBe(false);
    expect(task.column).toBe('in_progress');
    expect(result.unmetCriteria).toEqual(['AC-2']);

    // Das Feedback benennt das fehlende Kriterium im Ticketverlauf (Spec §3)
    const feedback = task.comments.find((c) => c.body.includes('Review abgelehnt'));
    expect(feedback?.body).toContain('AC-2');
    expect(feedback?.body).not.toContain('AC-1');
  });

  it('lehnt ab, wenn ein Prüfpunkt offen ist, obwohl alle Kriterien erfüllt sind', () => {
    const task = reviewableTask();
    state.tasks.push(task);

    const result = reviewTicket(state, 't-1', {
      metCriterionIds: task.acceptanceCriteria.map((c) => c.id),
      checklist: { tests: false, security: false },
    })!;

    expect(result.passed).toBe(false);
    expect(result.failedChecks).toEqual(['Tests', 'Sicherheit']);
    expect(task.column).toBe('in_progress');
  });

  it('winkt ein Ticket ohne Akzeptanzkriterien nicht durch', () => {
    const task = reviewableTask({ acceptanceCriteria: [] });
    state.tasks.push(task);

    const result = reviewTicket(state, 't-1')!;

    expect(result.passed).toBe(false);
    expect(task.column).toBe('in_progress');
    expect(result.decision.reasoning).toContain('keine Akzeptanzkriterien');
  });

  it('vermerkt Prüfer und Zeitpunkt an jedem Kriterium', () => {
    const task = reviewableTask();
    state.tasks.push(task);

    reviewTicket(state, 't-1', { metCriterionIds: [task.acceptanceCriteria[0].id] });

    expect(task.acceptanceCriteria[0].verifiedBy).toBe('qa-1');
    expect(task.acceptanceCriteria[0].verifiedAt).not.toBeNull();
    expect(task.acceptanceCriteria[0].met).toBe(true);
    expect(task.acceptanceCriteria[1].met).toBe(false);
  });

  it('erhält den bisherigen Stand, wenn keine Kriterien übergeben werden', () => {
    const task = reviewableTask();
    task.acceptanceCriteria.forEach((c) => (c.met = true));
    state.tasks.push(task);

    const result = reviewTicket(state, 't-1')!;

    expect(result.passed).toBe(true);
    expect(task.column).toBe('done');
  });

  it('protokolliert den Statuswechsel in der History', () => {
    const task = reviewableTask();
    state.tasks.push(task);

    reviewTicket(state, 't-1', { metCriterionIds: task.acceptanceCriteria.map((c) => c.id) });

    const last = task.statusHistory.at(-1)!;
    expect(last.from).toBe('in_review');
    expect(last.to).toBe('done');
    expect(last.triggeredBy).toBe('qa-1');
  });

  it('nimmt Freitext der QA ins Feedback auf', () => {
    const task = reviewableTask();
    state.tasks.push(task);

    reviewTicket(state, 't-1', { notes: 'Bitte zusätzlich Edge Cases testen.' });

    expect(task.comments.at(-1)?.body).toContain('Edge Cases');
  });

  it('verweigert das Review außerhalb der Review-Spalte', () => {
    const task = reviewableTask({ column: 'in_progress' });
    state.tasks.push(task);

    expect(reviewTicket(state, 't-1')).toBeNull();
    expect(task.column).toBe('in_progress');
  });

  it('liefert null für ein unbekanntes Ticket', () => {
    expect(reviewTicket(state, 'gibt-es-nicht')).toBeNull();
  });
});
