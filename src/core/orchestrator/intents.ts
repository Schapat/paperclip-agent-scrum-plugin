/**
 * Was das Board als Naechstes will — als Datum, nicht als Seiteneffekt.
 *
 * Bisher war die Antwort auf "wer ist jetzt dran?" ueber 19 Aufrufstellen im
 * Worker verteilt, jede mit eigenem Grund, eigener Sperre und eigenem Zaehler.
 * Ob zwei davon gleichzeitig dasselbe Ticket anfassen, liess sich nur durch
 * Lesen aller 19 beantworten — und meistens falsch.
 *
 * Eine Absicht ist deshalb ein Wert: `planBoard()` rechnet aus, *was* geschehen
 * soll, der Executor entscheidet *ob* es schon geschehen ist. Beides ist damit
 * einzeln pruefbar, und die Frage "warum passiert nichts?" hat genau eine
 * Fundstelle.
 */

import type { AgentRole } from '../types';

/**
 * Die Art der Absicht — sie bestimmt, wer geweckt wird und wofuer.
 *
 * Bewusst fachlich benannt und nicht nach dem Mechanismus: `refine` bleibt
 * `refine`, egal ob der Host es ueber eine Zuweisung oder einen Weckruf
 * zustellt. Die 12 alten `project_*`-Gruende beschrieben dagegen den Anlass des
 * Aufrufs, nicht die Arbeit — weshalb `project_sprint_planning` und
 * `project_blocker_resolved` am Ende dieselbe Sache meinten.
 */
export type IntentKind =
  /** Ein Ticket im Backlog hat keine Schaetzung und keine Kriterien. */
  | 'refine'
  /** Ein sprintreifes Ticket braucht einen Bearbeiter. */
  | 'assign'
  /** Ein zugewiesenes Ticket wartet auf seinen Entwickler. */
  | 'implement'
  /** Ein Ticket liegt im Review und wartet auf ein QA-Urteil. */
  | 'review'
  /** Ein Ticket steht in Blocked und braucht eine Entscheidung. */
  | 'unblock'
  /** Das Board kann hier nichts mehr tun — ein Mensch muss handeln. */
  | 'await_human';

/** Wer eine Absicht ausfuehrt. `human` ist kein Agent, sondern das Ende der Automatik. */
export type IntentRole = AgentRole | 'human';

export interface BoardIntent {
  /**
   * Die stabile Identitaet dieser Absicht.
   *
   * Sie ersetzt den Versuchszaehler, der bisher in einer `Map` im
   * Arbeitsspeicher lag und jeden Worker-Neustart auf 1 zuruecksetzte. Weil der
   * Zaehler im Idempotency-Key steckte, verschluckte der Host nach einem
   * Neustart entweder den Weckruf oder feuerte ihn doppelt — je nachdem, wie
   * sein Dedup-Fenster gerade stand.
   *
   * Der Schluessel haengt nur an Ticket und Art: derselbe Zustand erzeugt
   * denselben Schluessel, ueber jeden Neustart hinweg.
   */
  key: string;
  taskId: string;
  kind: IntentKind;
  role: IntentRole;
  /**
   * Der Agent, der die Arbeit tut — `null`, solange die Rolle unbesetzt ist.
   *
   * Bei `assign` ist das der vorgeschlagene Bearbeiter: der Executor schreibt
   * ihn ans Ticket, bevor er weckt. Ein Ticket ohne Bearbeiter weckt niemanden,
   * und genau daran hing das Board zuletzt fest.
   */
  agentId: string | null;
  /** Was das Board beobachtet hat, in einem Satz — fuer Weckruf und Log. */
  reason: string;
}

/** Baut den Schluessel einer Absicht. Nur hier, damit er nirgends auseinanderlaeuft. */
export function intentKey(taskId: string, kind: IntentKind): string {
  return `${taskId}:${kind}`;
}
