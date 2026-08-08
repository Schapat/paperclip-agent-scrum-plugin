/**
 * Tests für die Agentenkommunikation (Spec §6)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ScrumAgent, WorkerState } from '@shared/types';
import { createDefaultSettings, MAX_MESSAGE_LOG } from '@shared/types';
import { createScrumTask } from '@shared/factories';
import {
  broadcast,
  collectDecisions,
  findAgentById,
  findAgentByRole,
  findAgentsByRole,
  messagesForTask,
  recordDecision,
  sendMessage,
} from '../message-bus';

// =============================================================================
// Fixtures
// =============================================================================

function agent(id: string, role: string, name = id): ScrumAgent {
  return { id, name, role, status: 'idle', currentTaskId: null, capabilities: [] };
}

function createState(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    initialized: true,
    currentSprint: null,
    tasks: [],
    agents: [
      agent('po-1', 'product_owner', 'Product Owner'),
      agent('sm-1', 'scrum_master', 'Scrum Master'),
      agent('tl-1', 'technical_lead', 'Technical Lead'),
      agent('dev-1', 'developer', 'Developer 1'),
      agent('dev-2', 'developer', 'Developer 2'),
      agent('qa-1', 'qa_engineer', 'QA Engineer'),
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
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Team-Verzeichnis', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('findet Einzelrollen', () => {
    expect(findAgentByRole(state, 'product_owner')?.id).toBe('po-1');
    expect(findAgentByRole(state, 'qa_engineer')?.id).toBe('qa-1');
  });

  it('liefert null für unbekannte Rollen', () => {
    expect(findAgentByRole(state, 'designer')).toBeNull();
  });

  it('findet alle Developer', () => {
    expect(findAgentsByRole(state, 'developer').map((a) => a.id)).toEqual(['dev-1', 'dev-2']);
  });

  it('findet Agents per ID und toleriert null', () => {
    expect(findAgentById(state, 'tl-1')?.role).toBe('technical_lead');
    expect(findAgentById(state, null)).toBeNull();
    expect(findAgentById(state, 'nope')).toBeNull();
  });
});

describe('sendMessage', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('protokolliert die Nachricht global', () => {
    const tl = findAgentByRole(state, 'technical_lead')!;
    const dev = findAgentByRole(state, 'developer')!;

    const msg = sendMessage(state, {
      from: tl,
      to: [dev],
      subject: 'Implementiere gemäß Architektur',
      body: 'Siehe technische Hinweise am Ticket.',
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toBe(msg);
    expect(msg.fromAgentRole).toBe('technical_lead');
    expect(msg.toAgentIds).toEqual(['dev-1']);
  });

  it('spiegelt ticketbezogene Nachrichten als Kommentar ins Ticket (Spec §6)', () => {
    const task = createScrumTask({ id: 't-1', title: 'Login', description: 'desc' });
    state.tasks.push(task);

    const qa = findAgentByRole(state, 'qa_engineer')!;
    const dev = findAgentByRole(state, 'developer')!;

    const msg = sendMessage(state, {
      from: qa,
      to: [dev],
      subject: 'Review abgelehnt',
      body: 'Folgende Acceptance Criteria fehlen: AC-2.',
      taskId: 't-1',
    });

    expect(task.comments).toHaveLength(1);
    expect(task.comments[0].messageId).toBe(msg.id);
    expect(task.comments[0].authorRole).toBe('qa_engineer');
    expect(task.comments[0].body).toContain('Review abgelehnt');
    expect(task.comments[0].body).toContain('AC-2');
  });

  it('ignoriert eine unbekannte taskId, ohne zu werfen', () => {
    const po = findAgentByRole(state, 'product_owner')!;
    expect(() =>
      sendMessage(state, { from: po, to: null, subject: 's', body: 'b', taskId: 'missing' })
    ).not.toThrow();
    expect(state.messages).toHaveLength(1);
  });

  it('behandelt einen Broadcast als Nachricht ohne Empfängerliste', () => {
    const sm = findAgentByRole(state, 'scrum_master')!;
    const msg = broadcast(state, sm, 'Sprint Planning', 'Wird gestartet.', 'sprint_planning');

    expect(msg.toAgentIds).toBeNull();
    expect(msg.ceremony).toBe('sprint_planning');
  });

  it('deckelt das Protokoll bei MAX_MESSAGE_LOG', () => {
    const sm = findAgentByRole(state, 'scrum_master')!;
    for (let i = 0; i < MAX_MESSAGE_LOG + 25; i++) {
      broadcast(state, sm, `msg-${i}`, 'body');
    }

    expect(state.messages).toHaveLength(MAX_MESSAGE_LOG);
    // Die ältesten Einträge fallen heraus, die jüngste bleibt erhalten
    expect(state.messages.at(-1)?.subject).toBe(`msg-${MAX_MESSAGE_LOG + 24}`);
    expect(state.messages.some((m) => m.subject === 'msg-0')).toBe(false);
  });

  it('filtert Nachrichten pro Ticket', () => {
    const task = createScrumTask({ id: 't-1', title: 'A', description: '' });
    state.tasks.push(task);
    const po = findAgentByRole(state, 'product_owner')!;

    sendMessage(state, { from: po, to: null, subject: 'x', body: 'y', taskId: 't-1' });
    sendMessage(state, { from: po, to: null, subject: 'z', body: 'w' });

    expect(messagesForTask(state, 't-1')).toHaveLength(1);
  });
});

describe('recordDecision', () => {
  let state: WorkerState;
  beforeEach(() => {
    state = createState();
  });

  it('hängt die Entscheidung mit Begründung ans Ticket', () => {
    const task = createScrumTask({ id: 't-1', title: 'A', description: '' });
    state.tasks.push(task);
    const po = findAgentByRole(state, 'product_owner')!;

    const decision = recordDecision(state, {
      task,
      type: 'auto_assign',
      description: 'Ticket an Developer 1 zugewiesen',
      reasoning: 'Developer 1 ist idle und hat den passenden Skill "frontend".',
      madeBy: po,
    });

    expect(task.decisions).toHaveLength(1);
    expect(task.decisions[0]).toBe(decision);
    expect(decision.reasoning).toContain('idle');
    expect(decision.madeByRole).toBe('product_owner');
  });

  it('erlaubt Prozessentscheidungen ohne Ticket', () => {
    const sm = findAgentByRole(state, 'scrum_master')!;
    const decision = recordDecision(state, {
      task: null,
      type: 'ceremony',
      description: 'Refinement gestartet',
      reasoning: 'Kein Ticket in Development.',
      madeBy: sm,
    });

    expect(decision.taskId).toBeNull();
    expect(state.tasks).toHaveLength(0);
  });

  it('sammelt Entscheidungen über alle Tickets, jüngste zuerst', () => {
    const a = createScrumTask({ id: 'a', title: 'A', description: '' });
    const b = createScrumTask({ id: 'b', title: 'B', description: '' });
    state.tasks.push(a, b);
    const sm = findAgentByRole(state, 'scrum_master')!;

    recordDecision(state, {
      task: a,
      type: 'status_change',
      description: 'erste',
      reasoning: 'r',
      madeBy: sm,
    });
    recordDecision(state, {
      task: b,
      type: 'status_change',
      description: 'zweite',
      reasoning: 'r',
      madeBy: sm,
    });
    // Zeitstempel künstlich auseinanderziehen, damit die Sortierung greift
    a.decisions[0].timestamp = '2026-01-01T00:00:00.000Z';
    b.decisions[0].timestamp = '2026-06-01T00:00:00.000Z';

    const all = collectDecisions(state);
    expect(all.map((d) => d.description)).toEqual(['zweite', 'erste']);
  });

  it('respektiert das Limit von collectDecisions', () => {
    const task = createScrumTask({ id: 't', title: 'T', description: '' });
    state.tasks.push(task);
    const sm = findAgentByRole(state, 'scrum_master')!;
    for (let i = 0; i < 10; i++) {
      recordDecision(state, {
        task,
        type: 'status_change',
        description: `d-${i}`,
        reasoning: 'r',
        madeBy: sm,
      });
    }

    expect(collectDecisions(state, 3)).toHaveLength(3);
  });
});
