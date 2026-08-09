/**
 * Integrationstest: vollständiger Ticket-Lifecycle (Spec §3)
 *
 * Prüft das Zusammenspiel von Zeremonien, Transition-Regeln, Agenten-
 * kommunikation und Persistenz an einem durchgehenden Szenario:
 *
 *   Backlog → (Refinement) → TODO → Development → Review → Done
 *
 * inklusive des Rückwegs Review → Development mit QA-Feedback.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { PluginContext, ScrumAgent, ScrumSprint, ScrumTask, WorkerState } from '../types';
import { createDefaultSettings } from '../types';
import { createAcceptanceCriterion, createScrumTask } from '../factories';

import { runBacklogRefinement } from '../ceremonies/refinement';
import { runSprintPlanning } from '../ceremonies/sprint-planning';
import { runSprintReview } from '../ceremonies/sprint-review';
import { runRetrospective } from '../ceremonies/retrospective';
import type { AgentWorkRequest, CeremonyContext } from '../ceremonies/types';

import { reviewTicket } from '../ceremonies/qa-review';
import { validateTransition } from '../hooks/transitions';
import { onStatusChange } from '../hooks/lifecycle';
import { migrateState } from '../storage';

// =============================================================================
// Fixtures
// =============================================================================

function agent(id: string, role: string, skills: string[] = []): ScrumAgent {
  return { id, name: id, role, status: 'idle', currentTaskId: null, capabilities: [], skills };
}

function activeSprint(): ScrumSprint {
  return {
    id: 'sprint-1',
    name: 'Sprint 1',
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-08-14T00:00:00.000Z',
    status: 'active',
    taskIds: [],
    goal: 'Login ausliefern',
    velocity: 0,
    completedPoints: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function createState(): WorkerState {
  return {
    initialized: true,
    currentSprint: activeSprint(),
    tasks: [],
    agents: [
      agent('po-1', 'product_owner'),
      agent('sm-1', 'scrum_master'),
      agent('tl-1', 'technical_lead'),
      agent('dev-1', 'developer', ['frontend']),
      agent('qa-1', 'qa_engineer'),
    ],
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
    agentInstructions: {},
  };
}

/**
 * Verschiebt ein Ticket unter Beachtung der Transition-Regeln.
 *
 * Bildet nach, was der Worker beim Statuswechsel tut, damit der Test die
 * echten Regeln durchläuft statt sie zu umgehen.
 */
function move(task: ScrumTask, to: ScrumTask['column'], by: string | null): boolean {
  if (!validateTransition(task.column, to).valid) return false;

  const now = new Date().toISOString();
  task.statusHistory.push({ from: task.column, to, timestamp: now, triggeredBy: by });
  task.column = to;
  task.updatedAt = now;
  if (to === 'in_progress' && !task.startedAt) task.startedAt = now;
  if (to === 'done') task.completedAt = now;
  return true;
}

// =============================================================================
// Szenario
// =============================================================================

describe('Ticket-Lifecycle end-to-end', () => {
  let state: WorkerState;
  let ctx: CeremonyContext;
  let requests: AgentWorkRequest[];

  beforeEach(() => {
    state = createState();
    requests = [];
    ctx = { state, requestAgentWork: (r) => requests.push(r) };
  });

  it('führt ein Ticket von Backlog bis Done durch alle Spalten', () => {
    // --- Product Owner legt ein rohes Ticket an -----------------------------
    const task = createScrumTask({
      title: 'Login-Formular implementieren',
      description: 'Als User möchte ich mich einloggen können',
      type: 'story',
      priority: 'high',
      labels: ['frontend'],
    });
    state.tasks.push(task);

    // --- Refinement erkennt die Lücken --------------------------------------
    runBacklogRefinement(ctx);

    expect(task.refined).toBe(false);
    const refineRequest = requests.find((r) => r.role === 'technical_lead');
    expect(refineRequest?.taskIds).toContain(task.id);

    // --- Technical Lead arbeitet das Ticket aus (was sonst der Agent tut) ---
    task.refined = true;
    task.storyPoints = 5;
    task.technicalNotes = 'React Hook Form + Zod-Validierung.';
    task.acceptanceCriteria = [
      createAcceptanceCriterion('Login mit gültigen Daten führt zum Dashboard', 'tl-1'),
      createAcceptanceCriterion('Fehlermeldung bei ungültigen Daten', 'tl-1'),
    ];

    // --- Planning zieht es in den Sprint und weist es zu --------------------
    runSprintPlanning(ctx);

    expect(task.sprintId).toBe('sprint-1');
    expect(task.assignedAgentId).toBe('dev-1');
    expect(task.column).toBe('in_progress');
    expect(state.currentSprint!.taskIds).toContain(task.id);

    // Die Zuweisung ist begründet protokolliert (Spec §5)
    const assignDecision = task.decisions.find((d) => d.type === 'auto_assign');
    expect(assignDecision?.reasoning).toContain('frontend');

    // Der Technical Lead hat den Entwickler informiert (Spec §6)
    const devMessage = task.comments.find((c) => c.body.includes('Implementiere gemäß Architektur'));
    expect(devMessage).toBeDefined();

    // --- Developer meldet fertig → Review -----------------------------------
    expect(move(task, 'in_review', 'dev-1')).toBe(true);

    // --- QA weist zurück, weil ein Kriterium fehlt (Spec §3 Review) ---------
    const firstReview = reviewTicket(state, task.id, {
      metCriterionIds: [task.acceptanceCriteria[0].id],
    })!;

    expect(firstReview.passed).toBe(false);
    expect(task.column).toBe('in_progress');
    expect(firstReview.unmetCriteria).toEqual(['Fehlermeldung bei ungültigen Daten']);

    // Das Feedback benennt das offene Kriterium im Ticketverlauf
    const rejection = task.comments.find((c) => c.body.includes('Review abgelehnt'));
    expect(rejection?.body).toContain('Fehlermeldung bei ungültigen Daten');

    // --- Zweiter Anlauf: alle Kriterien erfüllt -----------------------------
    expect(move(task, 'in_review', 'dev-1')).toBe(true);
    const secondReview = reviewTicket(state, task.id, {
      metCriterionIds: task.acceptanceCriteria.map((c) => c.id),
    })!;

    expect(secondReview.passed).toBe(true);
    expect(task.column).toBe('done');

    // --- Review schreibt die Velocity fest ----------------------------------
    runSprintReview(ctx);
    expect(state.completedSprints).toHaveLength(1);
    expect(state.completedSprints[0].velocity).toBe(5);

    // --- Retrospektive erkennt die Rückweisung ------------------------------
    const retro = runRetrospective(ctx);
    expect(
      retro.retrospective!.bottlenecks.some((b) => b.includes('zurück in die Entwicklung'))
    ).toBe(true);
  });

  it('lässt den direkten Sprung von Development nach Done nicht zu', () => {
    const task = createScrumTask({ title: 'Abkürzung', description: '', column: 'in_progress' });
    // Spec §3: Alles muss durch Review
    expect(move(task, 'done', 'dev-1')).toBe(false);
    expect(task.column).toBe('in_progress');
  });

  it('blockiert einen lokalen Review-zu-Done-Übergang mit offenen Kriterien', async () => {
    const task = createScrumTask({
      title: 'Offene QA-Prüfung',
      description: '',
      column: 'in_review',
      acceptanceCriteria: [createAcceptanceCriterion('Akzeptanzkriterium noch offen')],
    });
    state.tasks.push(task);
    const hookContext: PluginContext = {
      state,
      currentAgent: state.agents.find((agent) => agent.role === 'qa_engineer') ?? null,
      emit: () => undefined,
      updateState: () => undefined,
      saveState: async () => undefined,
    };

    const result = await onStatusChange(task, 'in_review', 'done', hookContext);

    expect(result).toMatchObject({ success: false, cancelled: true });
    expect(result.error).toContain('acceptance criterion');
    expect(task.column).toBe('in_review');
    expect(task.completedAt).toBeNull();
  });

  it('blockiert einen lokalen Review-zu-Done-Übergang ohne Kriterien', async () => {
    const task = createScrumTask({
      title: 'Unverfeinerte QA-Prüfung',
      description: '',
      column: 'in_review',
    });
    state.tasks.push(task);
    const hookContext: PluginContext = {
      state,
      currentAgent: state.agents.find((agent) => agent.role === 'qa_engineer') ?? null,
      emit: () => undefined,
      updateState: () => undefined,
      saveState: async () => undefined,
    };

    const result = await onStatusChange(task, 'in_review', 'done', hookContext);

    expect(result).toMatchObject({ success: false, cancelled: true });
    expect(result.error).toContain('no acceptance criteria');
    expect(task.column).toBe('in_review');
    expect(task.completedAt).toBeNull();
  });

  it('übersteht eine Serialisierungs-Runde mit vollständigem Verlauf', async () => {
    const task = createScrumTask({
      title: 'Login',
      description: '',
      refined: true,
      storyPoints: 3,
      acceptanceCriteria: [createAcceptanceCriterion('AC-1')],
      labels: ['frontend'],
    });
    state.tasks.push(task);
    runSprintPlanning(ctx);

    // Der Host speichert das Board als JSON in ctx.state; geprüft wird, dass
    // die Migration daraus wieder einen vollständigen Zustand herstellt.
    const restored = migrateState(JSON.parse(JSON.stringify(state)));

    const restoredTask = restored.tasks!.find((t: ScrumTask) => t.id === task.id)!;
    expect(restoredTask.column).toBe(task.column);
    expect(restoredTask.assignedAgentId).toBe('dev-1');
    expect(restoredTask.comments.length).toBe(task.comments.length);
    expect(restoredTask.decisions.length).toBe(task.decisions.length);
    expect(restored.messages!.length).toBe(state.messages.length);
    expect(restored.ceremonies!.length).toBe(1);
  });

  it('läuft nicht leer, wenn das Backlog erschöpft ist (Spec §4)', () => {
    // Kein Ticket im Board: Refinement muss beim PO Nachschub anfordern
    runBacklogRefinement(ctx);

    expect(requests.some((r) => r.role === 'product_owner')).toBe(true);
    // Und das Planning darf trotzdem sauber durchlaufen
    expect(() => runSprintPlanning(ctx)).not.toThrow();
  });
});
