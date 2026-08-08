/**
 * State-Persistenz
 *
 * Der Worker kann in unterschiedlichen Umgebungen laufen: als Plugin im
 * Paperclip-Host (der eine Storage-API bereitstellt), als Web Worker im
 * Browser oder in Tests. Statt eine dieser Umgebungen fest zu verdrahten,
 * liegt hinter `StorageAdapter` ein austauschbares Backend, das beim Start
 * automatisch erkannt wird.
 *
 * Geladener State wird migriert (`normalizeScrumTask`), weil persistierte
 * Daten aus einer älteren Plugin-Version stammen können, in der es die
 * Refinement- und Protokollfelder noch nicht gab.
 */

import type { ScrumTask, WorkerState } from '@shared/types';
import { normalizeScrumTask } from '@shared/factories';

/**
 * Aktuelle Schema-Version des persistierten States.
 *
 * Wird beim Laden geprüft; bei einer neueren Version als der eigenen wird der
 * State verworfen, statt ihn falsch zu interpretieren.
 */
export const STATE_SCHEMA_VERSION = 3;

/** Schlüssel, unter dem der State abgelegt wird. */
export const STATE_KEY = 'scrum-team:state';

/**
 * Umschlag um den persistierten State.
 */
export interface PersistedState {
  version: number;
  savedAt: string;
  state: WorkerState;
}

/**
 * Austauschbares Storage-Backend.
 */
export interface StorageAdapter {
  /** Name für Logging/Diagnose */
  readonly name: string;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// =============================================================================
// Backends
// =============================================================================

/**
 * In-Memory-Fallback.
 *
 * Überlebt keinen Neustart — wird nur verwendet, wenn keine echte Storage-API
 * verfügbar ist, damit der Worker trotzdem lauffähig bleibt.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  readonly name = 'memory';
  private store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * Minimalschnittstelle, die ein Host bereitstellen muss.
 *
 * Bewusst schmal gehalten: `getItem`/`setItem`/`removeItem` decken sowohl
 * `localStorage` als auch eine asynchrone Host-API ab.
 */
export interface HostStorageLike {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/**
 * Adapter für eine vom Host bereitgestellte Storage-API.
 *
 * Normalisiert synchrone und asynchrone Implementierungen auf Promises.
 */
export class HostStorageAdapter implements StorageAdapter {
  constructor(
    readonly name: string,
    private readonly host: HostStorageLike
  ) {}

  async getItem(key: string): Promise<string | null> {
    return (await this.host.getItem(key)) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.host.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    await this.host.removeItem(key);
  }
}

/**
 * Erkennt das beste verfügbare Backend.
 *
 * Reihenfolge: explizite Plugin-Storage-API des Hosts, dann `localStorage`
 * (Browser/Dev-Harness), sonst In-Memory.
 */
export function detectStorageAdapter(scope: unknown = globalThis): StorageAdapter {
  const global = scope as {
    paperclipStorage?: HostStorageLike;
    pluginStorage?: HostStorageLike;
    localStorage?: HostStorageLike;
  };

  if (global.paperclipStorage) {
    return new HostStorageAdapter('paperclip-host', global.paperclipStorage);
  }
  if (global.pluginStorage) {
    return new HostStorageAdapter('plugin-host', global.pluginStorage);
  }
  if (global.localStorage) {
    return new HostStorageAdapter('localStorage', global.localStorage);
  }
  return new MemoryStorageAdapter();
}

// =============================================================================
// Serialisierung
// =============================================================================

/**
 * Stellt einen geladenen State auf das aktuelle Schema um.
 *
 * Fehlende Felder aus älteren Versionen werden ergänzt, statt sie als
 * `undefined` durchzureichen — sonst würde etwa `state.messages.push(...)`
 * beim ersten Zeremonie-Lauf werfen.
 */
export function migrateState(raw: Partial<WorkerState>): Partial<WorkerState> {
  return {
    ...raw,
    tasks: (raw.tasks ?? []).map((t) => normalizeScrumTask(t as Partial<ScrumTask> & { id: string })),
    agents: raw.agents ?? [],
    messages: raw.messages ?? [],
    ceremonies: raw.ceremonies ?? [],
    completedSprints: raw.completedSprints ?? [],
    learnings: raw.learnings ?? [],
    skills: raw.skills ?? [],
    proposedStories: raw.proposedStories ?? [],
  };
}

/**
 * Persistiert den State.
 */
export async function persistState(adapter: StorageAdapter, state: WorkerState): Promise<void> {
  const payload: PersistedState = {
    version: STATE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    state,
  };
  await adapter.setItem(STATE_KEY, JSON.stringify(payload));
}

/**
 * Lädt den State.
 *
 * Liefert `null`, wenn nichts gespeichert ist, der Inhalt unlesbar ist oder
 * aus einer neueren Schema-Version stammt. In allen drei Fällen startet der
 * Worker mit einem frischen State — das ist sicherer, als kaputte Daten
 * teilweise zu übernehmen.
 */
export async function restoreState(adapter: StorageAdapter): Promise<Partial<WorkerState> | null> {
  const raw = await adapter.getItem(STATE_KEY);
  if (!raw) return null;

  let parsed: PersistedState;
  try {
    parsed = JSON.parse(raw) as PersistedState;
  } catch {
    console.warn('[Storage] Gespeicherter State ist kein gültiges JSON — wird verworfen.');
    return null;
  }

  if (typeof parsed?.version !== 'number' || !parsed.state) {
    console.warn('[Storage] Gespeicherter State hat ein unbekanntes Format — wird verworfen.');
    return null;
  }

  if (parsed.version > STATE_SCHEMA_VERSION) {
    console.warn(
      `[Storage] Gespeicherter State hat Version ${parsed.version}, unterstützt wird maximal ${STATE_SCHEMA_VERSION} — wird verworfen.`
    );
    return null;
  }

  return migrateState(parsed.state);
}

/**
 * Löscht den persistierten State (Uninstall).
 */
export async function clearState(adapter: StorageAdapter): Promise<void> {
  await adapter.removeItem(STATE_KEY);
}

// =============================================================================
// Entprellter Writer
// =============================================================================

/**
 * Bündelt schnell aufeinanderfolgende Speichervorgänge.
 *
 * Eine Zeremonie verschiebt viele Tickets nacheinander; ohne Entprellung würde
 * jeder Schritt einen eigenen Schreibvorgang auslösen.
 */
export class DebouncedSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: WorkerState | null = null;

  constructor(
    private readonly adapter: StorageAdapter,
    private readonly delayMs = 500
  ) {}

  /**
   * Plant einen Speichervorgang ein.
   */
  schedule(state: WorkerState): void {
    this.pending = state;
    if (this.timer) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  /**
   * Schreibt sofort, falls etwas aussteht.
   */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const state = this.pending;
    this.pending = null;
    if (!state) return;

    try {
      await persistState(this.adapter, state);
    } catch (error) {
      console.error('[Storage] Speichern fehlgeschlagen:', error);
    }
  }
}
