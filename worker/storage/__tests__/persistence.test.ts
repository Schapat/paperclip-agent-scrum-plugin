/**
 * Tests für die State-Persistenz
 */

import { describe, it, expect, beforeEach, vi, afterEach, type MockInstance } from 'vitest';
import type { WorkerState } from '@shared/types';
import { createDefaultSettings } from '@shared/types';
import { createScrumTask } from '@shared/factories';
import {
  DebouncedSaver,
  HostStorageAdapter,
  MemoryStorageAdapter,
  STATE_KEY,
  STATE_SCHEMA_VERSION,
  clearState,
  detectStorageAdapter,
  migrateState,
  persistState,
  restoreState,
} from '../persistence';

function createState(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    initialized: true,
    currentSprint: null,
    tasks: [],
    agents: [],
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

describe('Round-Trip', () => {
  it('stellt gespeicherten State wieder her', async () => {
    const adapter = new MemoryStorageAdapter();
    const task = createScrumTask({ title: 'Login', description: 'desc', storyPoints: 5 });
    await persistState(adapter, createState({ tasks: [task] }));

    const restored = await restoreState(adapter);
    expect(restored?.tasks?.[0].title).toBe('Login');
    expect(restored?.tasks?.[0].storyPoints).toBe(5);
  });

  it('liefert null, wenn nichts gespeichert ist', async () => {
    expect(await restoreState(new MemoryStorageAdapter())).toBeNull();
  });

  it('löscht den State', async () => {
    const adapter = new MemoryStorageAdapter();
    await persistState(adapter, createState());
    await clearState(adapter);
    expect(await restoreState(adapter)).toBeNull();
  });

  it('schreibt den Umschlag mit Version und Zeitstempel', async () => {
    const adapter = new MemoryStorageAdapter();
    await persistState(adapter, createState());

    const raw = JSON.parse((await adapter.getItem(STATE_KEY))!);
    expect(raw.version).toBe(STATE_SCHEMA_VERSION);
    expect(typeof raw.savedAt).toBe('string');
  });
});

describe('Robustheit beim Laden', () => {
  let warn: MockInstance;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('verwirft ungültiges JSON', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.setItem(STATE_KEY, '{kaputt');
    expect(await restoreState(adapter)).toBeNull();
  });

  it('verwirft ein unbekanntes Format', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.setItem(STATE_KEY, JSON.stringify({ irgendwas: true }));
    expect(await restoreState(adapter)).toBeNull();
  });

  it('verwirft einen State aus einer neueren Schema-Version', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.setItem(
      STATE_KEY,
      JSON.stringify({ version: STATE_SCHEMA_VERSION + 1, savedAt: '', state: createState() })
    );
    expect(await restoreState(adapter)).toBeNull();
  });
});

describe('Migration', () => {
  it('ergänzt Felder, die es in älteren Versionen nicht gab', () => {
    // State im Format vor der Erweiterung: kein messages/ceremonies, Tickets
    // ohne Refinement- und Protokollfelder
    const legacy = {
      initialized: true,
      tasks: [{ id: 't-1', title: 'Alt', description: 'x', column: 'todo' }],
    } as unknown as Partial<WorkerState>;

    const migrated = migrateState(legacy);

    expect(migrated.messages).toEqual([]);
    expect(migrated.ceremonies).toEqual([]);
    expect(migrated.completedSprints).toEqual([]);

    const task = migrated.tasks![0];
    expect(task.comments).toEqual([]);
    expect(task.decisions).toEqual([]);
    expect(task.acceptanceCriteria).toEqual([]);
    expect(task.links).toEqual([]);
    expect(task.refined).toBe(false);
    expect(task.type).toBe('story');
    // Der ursprüngliche Status bleibt erhalten
    expect(task.column).toBe('todo');
  });

  it('erhält vorhandene Zeitstempel bei der Migration', () => {
    const legacy = {
      tasks: [{ id: 't-1', title: 'Alt', description: '', createdAt: '2026-01-01T00:00:00.000Z' }],
    } as unknown as Partial<WorkerState>;

    expect(migrateState(legacy).tasks![0].createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('Backend-Erkennung', () => {
  it('bevorzugt die Paperclip-Host-API', () => {
    const host = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(detectStorageAdapter({ paperclipStorage: host, localStorage: host }).name).toBe(
      'paperclip-host'
    );
  });

  it('nutzt localStorage, wenn keine Host-API da ist', () => {
    const host = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(detectStorageAdapter({ localStorage: host }).name).toBe('localStorage');
  });

  it('fällt auf Memory zurück', () => {
    expect(detectStorageAdapter({}).name).toBe('memory');
  });

  it('kommt mit einer asynchronen Host-API zurecht', async () => {
    const store = new Map<string, string>();
    const adapter = new HostStorageAdapter('async-host', {
      getItem: async (k) => store.get(k) ?? null,
      setItem: async (k, v) => void store.set(k, v),
      removeItem: async (k) => void store.delete(k),
    });

    await persistState(adapter, createState());
    expect(await restoreState(adapter)).not.toBeNull();
  });
});

describe('DebouncedSaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('bündelt schnell aufeinanderfolgende Aufrufe zu einem Schreibvorgang', async () => {
    const adapter = new MemoryStorageAdapter();
    const spy = vi.spyOn(adapter, 'setItem');
    const saver = new DebouncedSaver(adapter, 100);

    saver.schedule(createState());
    saver.schedule(createState());
    saver.schedule(createState());
    expect(spy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('schreibt beim Flush sofort', async () => {
    const adapter = new MemoryStorageAdapter();
    const saver = new DebouncedSaver(adapter, 10_000);

    saver.schedule(createState({ tasks: [createScrumTask({ title: 'X', description: '' })] }));
    await saver.flush();

    expect(await restoreState(adapter)).not.toBeNull();
  });

  it('speichert den zuletzt übergebenen State', async () => {
    const adapter = new MemoryStorageAdapter();
    const saver = new DebouncedSaver(adapter, 50);

    saver.schedule(createState({ tasks: [createScrumTask({ title: 'alt', description: '' })] }));
    saver.schedule(createState({ tasks: [createScrumTask({ title: 'neu', description: '' })] }));
    await vi.advanceTimersByTimeAsync(80);

    const restored = await restoreState(adapter);
    expect(restored?.tasks?.[0].title).toBe('neu');
  });

  it('ist ein No-Op, wenn nichts aussteht', async () => {
    const adapter = new MemoryStorageAdapter();
    const spy = vi.spyOn(adapter, 'setItem');
    await new DebouncedSaver(adapter).flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it('lässt einen Schreibfehler nicht nach außen durchschlagen', async () => {
    const adapter = new MemoryStorageAdapter();
    vi.spyOn(adapter, 'setItem').mockRejectedValue(new Error('Speicher voll'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const saver = new DebouncedSaver(adapter, 10);

    saver.schedule(createState());
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
