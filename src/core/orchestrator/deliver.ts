/**
 * Ob eine faellige Absicht jetzt zugestellt wird — und wann sie aufgibt.
 *
 * `planBoard()` rechnet bei jedem Durchlauf die vollstaendige Lage neu aus. Das
 * ist die Staerke des Entwurfs und zugleich seine einzige Gefahr: der Reconcile-
 * Tick laeuft jede Minute, und eine Absicht, die bestehen bleibt, weil der
 * geweckte Agent noch nachdenkt, wuerde sechzigmal pro Stunde neu zugestellt.
 * Genau dieses Ueberholen im Minutentakt hat das alte Board erzeugt.
 *
 * Die Bremse gehoert deshalb hierher und nirgendwo sonst — nicht in die Regeln
 * (die sollen die Lage beschreiben, nicht das Timing) und nicht in den Worker
 * (dort lag sie bisher, verteilt auf vier Sperren im Arbeitsspeicher, die jeder
 * Neustart verlor).
 *
 * Das Modul bleibt frei von SDK-Aufrufen, damit die Politik ohne laufenden Host
 * pruefbar ist.
 */

import type { IntentLog } from '../types';
import type { BoardIntent } from './intents';

export type { IntentLog, IntentRecord } from '../types';

/**
 * Wartezeit vor dem naechsten Versuch, nach Anzahl bisheriger Versuche.
 *
 * Der erste Wiederholversuch kommt nach fuenf Minuten: kuerzer waere ein
 * Ueberholen, laenger fuehlt sich das Board tot an. Danach waechst die Wartezeit
 * dreifach, denn wenn der zweite Versuch nichts gebracht hat, bringt der dritte
 * fuenf Minuten spaeter auch nichts.
 */
const RETRY_BACKOFF_MS = [5, 15, 45, 60].map((minutes) => minutes * 60 * 1000);

/**
 * Nach so vielen Versuchen ist es kein Ausrutscher mehr.
 *
 * Weiterzuwecken kostet dann nur noch Budget. Die Absicht wird an einen
 * Menschen uebergeben — das Board sagt lieber "ich komme hier nicht weiter" als
 * stumm im Kreis zu laufen.
 */
export const MAX_INTENT_ATTEMPTS = 5;

function backoffFor(attempts: number): number {
  return RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length) - 1] ?? 0;
}

export interface DeliveryPlan {
  /** Absichten, die jetzt an ihren Agenten gehen. */
  deliver: BoardIntent[];
  /**
   * Absichten, die aufgegeben wurden.
   *
   * Sie tragen die Rolle `human`: das Board hat es oft genug versucht.
   */
  escalate: BoardIntent[];
  /** Der fortgeschriebene Log — ersetzt den alten vollstaendig. */
  log: IntentLog;
}

/**
 * Entscheidet, welche der faelligen Absichten jetzt zugestellt werden.
 *
 * Der zurueckgegebene Log enthaelt *nur* Eintraege zu Absichten, die noch
 * anliegen. Das ist keine Aufraeumarbeit, sondern die Regel, die den Zaehler
 * zuruecksetzt: verschwindet eine Absicht, weil das Ticket weitergezogen ist,
 * verschwindet ihre Vorgeschichte mit. Kommt dieselbe Art spaeter erneut vor —
 * etwa `implement` nach einem abgelehnten Review — beginnt sie wieder bei null,
 * denn inzwischen ist nachweislich etwas passiert.
 */
export function planDelivery(
  intents: readonly BoardIntent[],
  log: IntentLog,
  now: number = Date.now()
): DeliveryPlan {
  const deliver: BoardIntent[] = [];
  const escalate: BoardIntent[] = [];
  const next: IntentLog = {};
  const timestamp = new Date(now).toISOString();

  for (const intent of intents) {
    // Was ohnehin auf einen Menschen wartet, wird nicht zugestellt und zaehlt
    // nicht mit — es gibt keinen Agenten, den man dafuer wecken koennte.
    if (intent.role === 'human') {
      escalate.push(intent);
      continue;
    }

    const record = log[intent.key];

    if (!record) {
      deliver.push(intent);
      next[intent.key] = { lastDeliveredAt: timestamp, attempts: 1 };
      continue;
    }

    if (record.attempts >= MAX_INTENT_ATTEMPTS) {
      escalate.push({
        ...intent,
        role: 'human',
        reason: `${intent.reason} The board woke the responsible role ${record.attempts} times without progress.`,
      });
      // Der Eintrag bleibt: ohne ihn faengt die Eskalation beim naechsten Tick
      // wieder von vorn an zu wecken.
      next[intent.key] = record;
      continue;
    }

    const due = Date.parse(record.lastDeliveredAt) + backoffFor(record.attempts);
    if (Number.isFinite(due) && now < due) {
      // Die Wartezeit laeuft noch — der geweckte Agent bekommt seine Zeit.
      next[intent.key] = record;
      continue;
    }

    deliver.push(intent);
    next[intent.key] = { lastDeliveredAt: timestamp, attempts: record.attempts + 1 };
  }

  return { deliver, escalate, log: next };
}
