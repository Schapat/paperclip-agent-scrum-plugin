/**
 * Tests für die Aggregation des Agenten-Logs (Spec §7)
 *
 * Prüft die Datenseite dessen, was die `AgentLog`-Komponente anzeigt:
 * dass Nachrichten und Entscheidungen sauber gesammelt und chronologisch
 * zusammengeführt werden können.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ScrumAgent, WorkerState } from '../../types';
import { createDefaultSettings } from '../../types';
import { createScrumTask } from '../../factories';
import { broadcast, collectDecisions, recordDecision, sendMessage } from '../message-bus';

function agent(id: string, role: string): ScrumAgent {
  return { id, name: id, role, status: 'idle', currentTaskId: null, capabilities: [] };
}

function createState(): WorkerState {
  return {
    initialized: true,
    currentSprint: null,
    tasks: [],
    agents: [agent('po-1', 'product_owner'), agent('sm-1', 'scrum_master'), agent('qa-1', 'qa_engineer')],
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

describe('Agenten-Log Aggregation', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('erfasst auch Nachrichten ohne Ticketbezug', () => {
    // Prozess-Broadcasts hängen an keinem Ticket und wären in der reinen
    // Ticketsicht unsichtbar — im globalen Log müssen sie auftauchen.
    broadcast(state, state.agents[1], 'Sprint Planning wird gestartet', 'Los geht es.', 'sprint_planning');

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].taskId).toBeNull();
  });

  it('führt Nachrichten und Entscheidungen chronologisch zusammen', () => {
    const task = createScrumTask({ id: 't-1', title: 'Login', description: '' });
    state.tasks.push(task);

    const msg = sendMessage(state, {
      from: state.agents[0],
      to: null,
      subject: 'Priorisiert',
      body: 'Backlog sortiert.',
    });
    const decision = recordDecision(state, {
      task,
      type: 'auto_assign',
      description: 'Zugewiesen',
      reasoning: 'Skill passt.',
      madeBy: state.agents[0],
    });

    msg.timestamp = '2026-08-01T10:00:00.000Z';
    decision.timestamp = '2026-08-01T11:00:00.000Z';

    const merged = [
      ...state.messages.map((m) => ({ id: m.id, ts: m.timestamp })),
      ...collectDecisions(state).map((d) => ({ id: d.id, ts: d.timestamp })),
    ].sort((a, b) => b.ts.localeCompare(a.ts));

    // Jüngste zuerst: die Entscheidung steht vor der Nachricht
    expect(merged[0].id).toBe(decision.id);
    expect(merged[1].id).toBe(msg.id);
  });

  it('sammelt Entscheidungen über mehrere Tickets hinweg', () => {
    const a = createScrumTask({ id: 'a', title: 'A', description: '' });
    const b = createScrumTask({ id: 'b', title: 'B', description: '' });
    state.tasks.push(a, b);

    recordDecision(state, {
      task: a,
      type: 'review_passed',
      description: 'A abgenommen',
      reasoning: 'Alle AC erfüllt.',
      madeBy: state.agents[2],
    });
    recordDecision(state, {
      task: b,
      type: 'review_rejected',
      description: 'B abgelehnt',
      reasoning: 'AC-2 offen.',
      madeBy: state.agents[2],
    });

    const all = collectDecisions(state);
    expect(all).toHaveLength(2);
    // Jede Entscheidung trägt ihre Begründung (Spec §5/§7)
    expect(all.every((d) => d.reasoning.length > 0)).toBe(true);
    expect(all.every((d) => d.madeByRole === 'qa_engineer')).toBe(true);
  });

  it('behält den Ticketbezug für die Auflösung zum Titel', () => {
    const task = createScrumTask({ id: 't-1', title: 'Login', description: '' });
    state.tasks.push(task);

    sendMessage(state, {
      from: state.agents[2],
      to: null,
      subject: 'Review abgelehnt',
      body: 'AC-2 fehlt.',
      taskId: 't-1',
    });

    const entry = state.messages[0];
    expect(entry.taskId).toBe('t-1');
    expect(state.tasks.find((t) => t.id === entry.taskId)?.title).toBe('Login');
  });
});
