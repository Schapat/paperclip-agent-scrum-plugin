/**
 * Event-Trigger für Scrum-Zeremonien (Spec §2, §4)
 *
 * Zeremonien werden ausschließlich durch den Zustand des Boards ausgelöst,
 * nicht durch Uhrzeiten. Agents arbeiten schneller als jeder Zeitplan.
 * Maßgeblich ist immer: *was ist auf dem Board passiert?*
 *
 * Zwei Eigenschaften machen das robust:
 *
 *  1. **Flankensteuerung.** Eine Bedingung feuert, wenn sie von "nicht erfüllt"
 *     auf "erfüllt" wechselt — nicht solange sie erfüllt ist. Ohne das würde
 *     etwa ein dauerhaft leeres TODO das Sprint Planning endlos neu starten.
 *
 *  2. **Kaskadenbegrenzung.** Eine Zeremonie verändert das Board und kann die
 *     nächste auslösen (Review → Retro). Das ist gewollt, aber gedeckelt,
 *     damit ein Zyklus das System nicht blockiert.
 */

import type { CeremonyType, WorkerState } from '../types';
import { isReady } from '../ceremonies/types';
import { MIN_READY_BACKLOG } from '../ceremonies/refinement';
import { canRunAutomaticDelivery } from '../project-onboarding';

/**
 * Eine zustandsbasierte Auslösebedingung.
 */
export interface TriggerCondition {
  id: string;
  ceremony: CeremonyType;
  /** Begründung für das Log, wenn die Bedingung feuert */
  describe: (state: WorkerState) => string;
  isActive: (state: WorkerState) => boolean;
}

/**
 * Sprintreife Tickets im Backlog.
 */
function readyBacklog(state: WorkerState) {
  return state.tasks.filter((t) => t.column === 'backlog' && isReady(t));
}

// =============================================================================
// Bedingungen
// =============================================================================

/**
 * TODO ist leer, aber es liegt verfeinerte Arbeit bereit → Sprint Planning.
 *
 * Die zweite Hälfte ist entscheidend: ohne sprintreife Tickets hätte das
 * Planning nichts zu tun, und die Bedingung bliebe dauerhaft aktiv.
 */
export const TRIGGER_TODO_EMPTY: TriggerCondition = {
  id: 'todo-empty',
  ceremony: 'sprint_planning',
  isActive: (state) =>
    state.tasks.filter((t) => t.column === 'todo').length === 0 && readyBacklog(state).length > 0,
  describe: (state) =>
    `TODO ist leer, ${readyBacklog(state).length} sprintreife Ticket(s) warten im Backlog.`,
};

/**
 * Niemand entwickelt und es gibt nichts Sprintreifes → Refinement.
 *
 * Gäbe es sprintreife Tickets, wäre das Planning zuständig; deshalb ist diese
 * Bedingung bewusst darauf beschränkt, dass der Nachschub *inhaltlich* fehlt.
 */
export const TRIGGER_NO_DEVELOPMENT: TriggerCondition = {
  id: 'no-development',
  ceremony: 'backlog_refinement',
  isActive: (state) =>
    state.tasks.filter((t) => t.column === 'in_progress').length === 0 &&
    readyBacklog(state).length === 0,
  describe: () => 'Kein Ticket in Development und nichts Sprintreifes im Backlog.',
};

/**
 * Der Vorrat an sprintreifen Tickets unterschreitet das Minimum → Refinement.
 */
export const TRIGGER_BACKLOG_LOW: TriggerCondition = {
  id: 'backlog-low',
  ceremony: 'backlog_refinement',
  isActive: (state) => readyBacklog(state).length < MIN_READY_BACKLOG,
  describe: (state) =>
    `Nur ${readyBacklog(state).length} sprintreife Ticket(s) im Backlog (Minimum ${MIN_READY_BACKLOG}).`,
};

/**
 * Ein Ticket ist blockiert → Blocker auflösen bzw. eskalieren.
 */
export const TRIGGER_BLOCKED: TriggerCondition = {
  id: 'blocked-tasks',
  ceremony: 'impediment_resolution',
  isActive: (state) => state.tasks.some((t) => t.column === 'blocked'),
  describe: (state) =>
    `${state.tasks.filter((t) => t.column === 'blocked').length} Ticket(s) blockiert.`,
};

/**
 * Ein Developer ist frei, obwohl Arbeit bereitliegt → Kapazität belegen.
 *
 * Das ist der klassische Flow-Verlust: Kapazität steht still, während in TODO
 * Tickets warten.
 */
export const TRIGGER_DEVELOPER_IDLE: TriggerCondition = {
  id: 'developer-idle',
  ceremony: 'impediment_resolution',
  isActive: (state) => {
    const developers = state.agents.filter((a) => a.role === 'developer');
    if (developers.length === 0) return false;

    const busy = new Set(
      state.tasks
        .filter((t) => t.column === 'in_progress' || t.column === 'in_review')
        .map((t) => t.assignedAgentId)
    );
    const idle = developers.filter((d) => !busy.has(d.id));
    const waiting = state.tasks.filter((t) => t.column === 'todo').length;

    return idle.length > 0 && waiting > 0;
  },
  describe: () => 'Freie Entwicklerkapazität, während Tickets in TODO warten.',
};

/**
 * Alle Sprint-Tickets sind fertig → Sprint Review.
 *
 * Das Sprintziel ist erreicht, sobald nichts mehr offen ist — unabhängig vom
 * Enddatum.
 */
export const TRIGGER_SPRINT_COMPLETE: TriggerCondition = {
  id: 'sprint-complete',
  ceremony: 'sprint_review',
  isActive: (state) => {
    const sprint = state.currentSprint;
    if (!sprint || sprint.status !== 'active') return false;

    const sprintTasks = state.tasks.filter(
      (t) => t.sprintId === sprint.id || sprint.taskIds.includes(t.id)
    );
    return sprintTasks.length > 0 && sprintTasks.every((t) => t.column === 'done');
  },
  describe: (state) => `Alle Tickets des Sprints "${state.currentSprint?.name}" sind abgeschlossen.`,
};

/**
 * Ein Review liegt vor, die Retrospektive fehlt → Retrospektive (Spec §2).
 */
export const TRIGGER_RETRO_PENDING: TriggerCondition = {
  id: 'review-without-retro',
  ceremony: 'sprint_retrospective',
  isActive: (state) => {
    const lastReview = [...state.ceremonies].reverse().find((c) => c.type === 'sprint_review');
    if (!lastReview) return false;

    return !state.ceremonies.some(
      (c) => c.type === 'sprint_retrospective' && c.sprintId === lastReview.sprintId
    );
  },
  describe: () => 'Sprint Review liegt vor, Retrospektive steht noch aus.',
};

/**
 * Alle Bedingungen in Auswertungsreihenfolge.
 *
 * Planning vor Refinement: liegt sprintreife Arbeit bereit, soll sie in den
 * Sprint, bevor neuer Nachschub erzeugt wird.
 */
export const TRIGGER_CONDITIONS: TriggerCondition[] = [
  TRIGGER_TODO_EMPTY,
  TRIGGER_NO_DEVELOPMENT,
  TRIGGER_BACKLOG_LOW,
  TRIGGER_BLOCKED,
  TRIGGER_DEVELOPER_IDLE,
  TRIGGER_SPRINT_COMPLETE,
  TRIGGER_RETRO_PENDING,
];

/**
 * Ordnet jede Zeremonie ihrem Schalter in `settings.events` zu.
 */
const ENABLE_FLAG: Record<CeremonyType, keyof WorkerState['settings']['events']> = {
  sprint_planning: 'enableAutoPlanning',
  backlog_refinement: 'enableAutoRefinement',
  impediment_resolution: 'enableAutoImpediments',
  sprint_review: 'enableAutoReview',
  sprint_retrospective: 'enableAutoReview',
};

/**
 * Ist die automatische Auslösung dieser Zeremonie eingeschaltet?
 *
 * Abgeschaltete Zeremonien lassen sich weiterhin von Hand starten — der
 * Schalter betrifft nur den automatischen Trigger.
 */
export function isCeremonyEnabled(state: WorkerState, ceremony: CeremonyType): boolean {
  // Der Human kontrolliert den Einstieg in ein neues Projekt. Ohne die
  // Freigabe durfte ein leeres Board sonst sofort einen generischen PO-Auftrag
  // auslosen, bevor der Technical Lead die vorhandene Codebasis analysiert hat.
  if (
    (ceremony === 'sprint_planning' || ceremony === 'backlog_refinement') &&
    state.projectOnboarding &&
    !canRunAutomaticDelivery(state.projectOnboarding)
  ) {
    return false;
  }

  return state.settings.events[ENABLE_FLAG[ceremony]] !== false;
}

// =============================================================================
// Auswertung
// =============================================================================

export interface FiredTrigger {
  conditionId: string;
  ceremony: CeremonyType;
  reason: string;
}

/**
 * Ermittelt, welche Bedingungen aktiv sind.
 */
export function activeConditions(
  state: WorkerState,
  conditions: TriggerCondition[] = TRIGGER_CONDITIONS
): Set<string> {
  return new Set(conditions.filter((c) => c.isActive(state)).map((c) => c.id));
}

/**
 * Bestimmt die Zeremonien, die durch *neu* eingetretene Bedingungen fällig sind.
 *
 * Bedingungen, die schon beim letzten Durchlauf aktiv waren, feuern nicht
 * erneut — erst wenn sie zwischendurch inaktiv waren, sind sie wieder scharf.
 */
export function newlyFired(
  state: WorkerState,
  previouslyActive: Set<string>,
  conditions: TriggerCondition[] = TRIGGER_CONDITIONS
): FiredTrigger[] {
  const fired: FiredTrigger[] = [];
  const seenCeremonies = new Set<CeremonyType>();

  for (const condition of conditions) {
    if (!condition.isActive(state)) continue;
    if (previouslyActive.has(condition.id)) continue;
    // Abgeschaltete Zeremonien feuern nicht automatisch (bleiben aber manuell
    // auslösbar)
    if (!isCeremonyEnabled(state, condition.ceremony)) continue;

    // Zwei Bedingungen können dieselbe Zeremonie verlangen (etwa beide
    // Refinement-Auslöser) — sie soll trotzdem nur einmal laufen.
    if (seenCeremonies.has(condition.ceremony)) continue;
    seenCeremonies.add(condition.ceremony);

    fired.push({
      conditionId: condition.id,
      ceremony: condition.ceremony,
      reason: condition.describe(state),
    });
  }

  return fired;
}

// =============================================================================
// Engine
// =============================================================================

/**
 * Obergrenze für Zeremonien pro Auswertung.
 *
 * Eine Zeremonie verändert das Board und kann die nächste auslösen — erwünscht
 * bei Review → Retro. Der Deckel verhindert, dass ein unerwarteter Zyklus den
 * Worker blockiert.
 */
export const MAX_CASCADE = 5;

export interface TriggerEngineOptions {
  getState: () => WorkerState;
  /** Führt eine Zeremonie aus */
  run: (ceremony: CeremonyType, reason: string) => void;
  conditions?: TriggerCondition[];
}

/**
 * Wertet die Trigger nach jeder Zustandsänderung aus.
 *
 * Es gibt bewusst keinen Timer: die Auswertung hängt an den Ereignissen, die
 * den State verändern (Ticket verschoben, Review abgeschlossen, Zeremonie
 * gelaufen).
 */
export class CeremonyTriggerEngine {
  private previouslyActive = new Set<string>();
  /** Schützt vor Rekursion, wenn eine Zeremonie erneut `evaluate` auslöst */
  private evaluating = false;

  constructor(private readonly options: TriggerEngineOptions) {}

  /**
   * Wertet aus und führt fällige Zeremonien aus.
   */
  evaluate(): CeremonyType[] {
    if (this.evaluating) return [];
    this.evaluating = true;

    const executed: CeremonyType[] = [];
    try {
      for (let round = 0; round < MAX_CASCADE; round++) {
        const state = this.options.getState();
        const fired = newlyFired(state, this.previouslyActive, this.options.conditions);

        // Flankenspeicher immer nachziehen — auch wenn nichts gefeuert hat,
        // damit inaktiv gewordene Bedingungen wieder scharf werden.
        this.previouslyActive = activeConditions(state, this.options.conditions);

        if (fired.length === 0) break;

        for (const trigger of fired) {
          this.options.run(trigger.ceremony, trigger.reason);
          executed.push(trigger.ceremony);
        }
      }
    } finally {
      this.evaluating = false;
    }

    return executed;
  }
}
