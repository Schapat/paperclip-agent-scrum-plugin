/**
 * useScrumBoard
 *
 * Verbindet die UI mit dem Worker und hält den Board-State aktuell.
 *
 * Der Worker ist die einzige Quelle der Wahrheit: die UI schickt Kommandos und
 * übernimmt den zurückgemeldeten State. Deshalb aktualisiert dieser Hook nach
 * jeder zustandsverändernden Nachricht den State neu, statt lokal
 * mitzurechnen — sonst würden UI und Worker auseinanderlaufen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentDecision,
  AgentMessage,
  CeremonyRecord,
  CeremonyType,
  ScrumTask,
  TaskStatus,
  WorkerState,
} from '@shared/types';
import { ScrumBridge, createWorkerTransport, type WorkerTransport } from '../lib/worker-bridge';

/**
 * Nachrichtentypen des Workers, die eine State-Änderung bedeuten.
 *
 * Nach jeder davon holt der Hook den State neu — so bleibt das Board in
 * Echtzeit aktuell, ohne jede Mutation einzeln nachzubilden.
 */
const STATE_CHANGING_EVENTS = [
  'TASK_MOVED',
  'TASK_CREATED',
  'TASK_ASSIGNED',
  'TICKET_REVIEWED',
  'SPRINT_CREATED',
  'CEREMONY_COMPLETED',
  'METRICS_UPDATE',
  'PLUGIN_INSTALL_COMPLETE',
] as const;

export interface UseScrumBoardResult {
  /** Aktueller Worker-State; `null` solange nicht geladen */
  state: WorkerState | null;
  loading: boolean;
  error: string | null;
  /** Name des genutzten Transports (Diagnose) */
  transport: string;

  /** Protokoll der Agentenkommunikation (Spec §6) */
  messages: AgentMessage[];
  /** Protokollierte Agentenentscheidungen (Spec §5) */
  decisions: AgentDecision[];
  /** Durchgeführte Zeremonien (Spec §2) */
  ceremonies: CeremonyRecord[];

  /** Verschiebt ein Ticket; liefert false bei verbotenem Übergang */
  moveTask: (task: ScrumTask, from: TaskStatus, to: TaskStatus) => Promise<boolean>;
  /** Startet eine Zeremonie von Hand */
  runCeremony: (ceremony: CeremonyType) => void;
  /**
   * Lässt die QA ein Ticket prüfen (Spec §3 Review).
   *
   * Ohne `metCriterionIds` behält das Review den bisherigen Stand der
   * Akzeptanzkriterien bei.
   */
  reviewTicket: (taskId: string, metCriterionIds?: string[]) => Promise<boolean>;
  /** Lädt den State neu */
  refresh: () => void;
}

export interface UseScrumBoardOptions {
  /** Polling-Intervall als Sicherheitsnetz, falls ein Event verloren geht */
  pollingIntervalMs?: number;
  /** Transport überschreiben (Tests) */
  transport?: WorkerTransport;
}

export function useScrumBoard(options: UseScrumBoardOptions = {}): UseScrumBoardResult {
  const { pollingIntervalMs = 5000 } = options;

  const [state, setState] = useState<WorkerState | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [decisions, setDecisions] = useState<AgentDecision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Der Transport darf sich über die Lebensdauer der Komponente nicht ändern —
  // ein neuer Worker pro Render wäre fatal.
  const providedTransport = options.transport;
  const bridgeRef = useRef<ScrumBridge | null>(null);
  if (!bridgeRef.current) {
    bridgeRef.current = new ScrumBridge(providedTransport ?? createWorkerTransport());
  }
  const bridge = bridgeRef.current;

  const refresh = useCallback(() => {
    bridge.post('GET_STATE');
    bridge.post('GET_MESSAGES');
  }, [bridge]);

  // --- Abonnements ---------------------------------------------------------
  useEffect(() => {
    const unsubscribers: Array<() => void> = [];

    unsubscribers.push(
      bridge.on('STATE_UPDATE', (payload) => {
        setState(payload.state as WorkerState);
        setLoading(false);
        setError(null);
      })
    );

    unsubscribers.push(
      bridge.on('WORKER_READY', (payload) => {
        setState(payload.state as WorkerState);
        setLoading(false);
        setError(null);
      })
    );

    unsubscribers.push(
      bridge.on('MESSAGES', (payload) => {
        setMessages((payload.messages as AgentMessage[]) ?? []);
        setDecisions((payload.decisions as AgentDecision[]) ?? []);
      })
    );

    unsubscribers.push(
      bridge.on('WORKER_ERROR', (payload) => {
        setError(String(payload.error));
        setLoading(false);
      })
    );

    unsubscribers.push(
      bridge.on('TASK_MOVE_FAILED', (payload) => {
        // Ein abgelehnter Übergang ist kein Fehlerzustand des Boards, sondern
        // eine Regelverletzung — sichtbar machen, aber das Board nicht sperren.
        setError(String(payload.error ?? 'Übergang nicht erlaubt'));
      })
    );

    for (const event of STATE_CHANGING_EVENTS) {
      unsubscribers.push(bridge.on(event, () => refresh()));
    }

    // Worker initialisieren und ersten State anfordern
    bridge.post('INIT');
    refresh();

    return () => unsubscribers.forEach((u) => u());
  }, [bridge, refresh]);

  // --- Polling als Sicherheitsnetz ----------------------------------------
  useEffect(() => {
    if (pollingIntervalMs <= 0) return;
    const timer = setInterval(refresh, pollingIntervalMs);
    return () => clearInterval(timer);
  }, [pollingIntervalMs, refresh]);

  // --- Worker beim Unmount abbauen ----------------------------------------
  useEffect(() => {
    return () => {
      // Einen vom Aufrufer gestellten Transport besitzt der Hook nicht und
      // darf ihn deshalb auch nicht beenden.
      if (!providedTransport) bridgeRef.current?.dispose();
    };
  }, [providedTransport]);

  // --- Kommandos -----------------------------------------------------------
  const moveTask = useCallback(
    async (task: ScrumTask, _from: TaskStatus, to: TaskStatus): Promise<boolean> => {
      try {
        const result = await bridge.request(
          'MOVE_TASK',
          ['TASK_MOVED', 'TASK_MOVE_FAILED'],
          { taskId: task.id, newColumn: to },
          // Nur die Antwort zu genau diesem Ticket zählt
          { match: (payload) => payload.taskId === task.id }
        );
        return result.type === 'TASK_MOVED';
      } catch {
        return false;
      }
    },
    [bridge]
  );

  const runCeremony = useCallback(
    (ceremony: CeremonyType) => {
      bridge.post('RUN_CEREMONY', { ceremony });
    },
    [bridge]
  );

  const reviewTicket = useCallback(
    async (taskId: string, metCriterionIds?: string[]): Promise<boolean> => {
      try {
        const result = await bridge.request(
          'REVIEW_TICKET',
          ['TICKET_REVIEWED', 'ERROR'],
          { taskId, metCriterionIds },
          { match: (payload) => payload.taskId === taskId }
        );
        return result.type === 'TICKET_REVIEWED' && result.payload.passed === true;
      } catch {
        return false;
      }
    },
    [bridge]
  );

  const ceremonies = useMemo(() => state?.ceremonies ?? [], [state]);

  return {
    state,
    loading,
    error,
    transport: bridge.transportName,
    messages,
    decisions,
    ceremonies,
    moveTask,
    runCeremony,
    reviewTicket,
    refresh,
  };
}
