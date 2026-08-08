/**
 * Brücke zwischen UI und Worker
 *
 * Das Board darf keine Demo-Daten anzeigen — es spiegelt den echten
 * Worker-State (Spec §5, "Alle Statusänderungen erfolgen in Echtzeit").
 *
 * Der Transport ist austauschbar, weil das Plugin in zwei Umgebungen läuft:
 * im Paperclip-Host, der den Worker selbst betreibt und eine Message-Bridge
 * bereitstellt, und im Standalone-Dev-Harness, wo die UI den Worker selbst
 * startet. `createWorkerTransport` erkennt beides.
 */

import type { PluginMessage } from '@shared/types';

// =============================================================================
// Transport
// =============================================================================

export interface WorkerTransport {
  /** Name für Diagnose */
  readonly name: string;
  post(message: PluginMessage): void;
  /** Registriert einen Listener; liefert die Abmeldefunktion */
  subscribe(handler: (message: PluginMessage) => void): () => void;
  dispose(): void;
}

/**
 * Vom Host bereitgestellte Bridge.
 */
export interface HostBridgeLike {
  postMessage(message: PluginMessage): void;
  onMessage(handler: (message: PluginMessage) => void): (() => void) | void;
}

/**
 * Transport über eine Host-Bridge.
 */
export function createHostTransport(host: HostBridgeLike): WorkerTransport {
  const handlers = new Set<(m: PluginMessage) => void>();

  const unsubscribeHost = host.onMessage((message) => {
    handlers.forEach((h) => h(message));
  });

  return {
    name: 'host-bridge',
    post: (message) => host.postMessage(message),
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    dispose: () => {
      handlers.clear();
      if (typeof unsubscribeHost === 'function') unsubscribeHost();
    },
  };
}

/**
 * Transport über einen selbst gestarteten Web Worker.
 */
export function createWebWorkerTransport(worker: Worker): WorkerTransport {
  const handlers = new Set<(m: PluginMessage) => void>();

  const onMessage = (event: MessageEvent<PluginMessage>) => {
    handlers.forEach((h) => h(event.data));
  };
  worker.addEventListener('message', onMessage);

  return {
    name: 'web-worker',
    post: (message) => worker.postMessage(message),
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    dispose: () => {
      handlers.clear();
      worker.removeEventListener('message', onMessage);
      worker.terminate();
    },
  };
}

/**
 * Erkennt den passenden Transport.
 *
 * Stellt der Host eine Bridge bereit, wird sie genutzt — der Host besitzt dann
 * den Worker-Lebenszyklus. Sonst startet die UI den Worker selbst.
 */
export function createWorkerTransport(scope: unknown = globalThis): WorkerTransport {
  const global = scope as { paperclipPlugin?: Partial<HostBridgeLike> };

  const host = global.paperclipPlugin;
  if (typeof host?.postMessage === 'function' && typeof host?.onMessage === 'function') {
    return createHostTransport(host as HostBridgeLike);
  }

  const worker = new Worker(new URL('../../worker/index.ts', import.meta.url), {
    type: 'module',
  });
  return createWebWorkerTransport(worker);
}

// =============================================================================
// Bridge
// =============================================================================

/**
 * Wie lange auf eine Antwort des Workers gewartet wird.
 *
 * Ohne Timeout würde ein `request`, dessen Antwort nie kommt (etwa weil der
 * Worker beim Start gescheitert ist), die aufrufende Komponente dauerhaft im
 * Ladezustand hängen lassen.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Typisierter Zugriff auf den Worker.
 */
export class ScrumBridge {
  constructor(private readonly transport: WorkerTransport) {}

  get transportName(): string {
    return this.transport.name;
  }

  /**
   * Sendet eine Nachricht ohne auf Antwort zu warten.
   */
  post(type: string, payload: Record<string, unknown> = {}): void {
    this.transport.post({ type, payload });
  }

  /**
   * Abonniert einen Nachrichtentyp; liefert die Abmeldefunktion.
   */
  on(type: string, handler: (payload: Record<string, unknown>) => void): () => void {
    return this.transport.subscribe((message) => {
      if (message.type === type) handler(message.payload);
    });
  }

  /**
   * Abonniert alle Nachrichten.
   */
  onAny(handler: (message: PluginMessage) => void): () => void {
    return this.transport.subscribe(handler);
  }

  /**
   * Sendet eine Nachricht und wartet auf die erste passende Antwort.
   *
   * `responseTypes` nimmt bewusst mehrere Typen entgegen: der Worker antwortet
   * auf ein Kommando je nach Ausgang mit unterschiedlichen Nachrichten (etwa
   * `TASK_MOVED` oder `TASK_MOVE_FAILED`). Ohne beide zu beobachten würde der
   * Fehlerfall bis zum Timeout hängen.
   *
   * `match` filtert zusätzlich auf die konkrete Antwort — sonst könnte ein
   * gleichzeitig eintreffendes Event zu einem anderen Ticket die Anfrage
   * fälschlich auflösen.
   */
  request(
    type: string,
    responseTypes: string | string[],
    payload: Record<string, unknown> = {},
    options: {
      match?: (payload: Record<string, unknown>, type: string) => boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<{ type: string; payload: Record<string, unknown> }> {
    const expected = Array.isArray(responseTypes) ? responseTypes : [responseTypes];
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Worker hat auf "${type}" nicht innerhalb von ${timeoutMs}ms geantwortet`));
      }, timeoutMs);

      const unsubscribe = this.transport.subscribe((message) => {
        if (!expected.includes(message.type)) return;
        if (options.match && !options.match(message.payload, message.type)) return;

        clearTimeout(timer);
        unsubscribe();
        resolve({ type: message.type, payload: message.payload });
      });

      this.transport.post({ type, payload });
    });
  }

  dispose(): void {
    this.transport.dispose();
  }
}
