/**
 * Der Auftrag, mit dem ein Agent geweckt wird.
 *
 * Projektgebundene Tickets sind Host-Issues: der Host stellt dem Agenten das
 * Ticket selbst zu, und der Grund reicht als Anlass. Lokale Tickets gibt es nur
 * im Plugin-State — dort muss der Auftrag den Inhalt mitbringen, sonst weckt der
 * Worker jemanden, der nicht weiss, worum es geht.
 *
 * Bewusst knapp und ohne Rollenkunde: was ein Technical Lead beim Refinement
 * tut, steht in seinen Instruktionen. Hier steht nur, *welches* Ticket und
 * *warum jetzt*.
 */

import type { ScrumTask } from '../types';
import type { BoardIntent } from './intents';

const DIRECTIVE: Record<BoardIntent['kind'], string> = {
  refine:
    'Refine this ticket: add an estimate in story points and at least one acceptance criterion, then record it.',
  assign: 'Take this ticket into the sprint and start work on it.',
  implement: 'Implement this ticket and move it to review when the work is delivered.',
  review:
    'Review this ticket against every acceptance criterion and record your verdict — approval or a change request.',
  unblock:
    'This ticket is blocked. Decide how it proceeds: resolve the blocker, or say who has to and what for.',
  await_human: 'This ticket needs a human decision. Do not act on it.',
};

/** Nennt das Ticket so, wie ein Mensch es im Board wiederfindet. */
function label(task: ScrumTask): string {
  return task.identifier ? `${task.identifier} — ${task.title}` : task.title;
}

/**
 * Baut den Auftrag fuer ein lokales Ticket.
 *
 * Der Grund der Absicht steht mit im Text: er beschreibt die Beobachtung, die
 * den Weckruf ausgeloest hat ("kein Lauf aktiv", "wartet ohne Bearbeiter"). Ohne
 * ihn liest sich jeder Wiederholversuch wie der erste.
 */
export function intentInstruction(intent: BoardIntent, task: ScrumTask): string {
  return [
    `## ${label(task)}`,
    `Ticket ID: ${task.id}`,
    '',
    DIRECTIVE[intent.kind],
    '',
    `_Why now: ${intent.reason}_`,
  ].join('\n');
}
