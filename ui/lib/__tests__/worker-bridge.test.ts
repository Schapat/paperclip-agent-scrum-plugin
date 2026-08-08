/**
 * Tests für die Worker-Brücke
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginMessage } from '@shared/types';
import {
  ScrumBridge,
  createHostTransport,
  createWorkerTransport,
  type WorkerTransport,
} from '../worker-bridge';

/**
 * Transport-Attrappe: `emit` simuliert eine Nachricht vom Worker.
 */
function createFakeTransport() {
  const handlers = new Set<(m: PluginMessage) => void>();
  const posted: PluginMessage[] = [];
  let disposed = false;

  const transport: WorkerTransport = {
    name: 'fake',
    post: (m) => void posted.push(m),
    subscribe: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    dispose: () => {
      disposed = true;
      handlers.clear();
    },
  };

  return {
    transport,
    posted,
    get disposed() {
      return disposed;
    },
    get listenerCount() {
      return handlers.size;
    },
    emit(message: PluginMessage) {
      handlers.forEach((h) => h(message));
    },
  };
}

describe('ScrumBridge', () => {
  it('sendet Nachrichten über den Transport', () => {
    const fake = createFakeTransport();
    new ScrumBridge(fake.transport).post('GET_STATE', { a: 1 });

    expect(fake.posted).toEqual([{ type: 'GET_STATE', payload: { a: 1 } }]);
  });

  it('ruft nur Handler für den passenden Typ auf', () => {
    const fake = createFakeTransport();
    const bridge = new ScrumBridge(fake.transport);
    const handler = vi.fn();

    bridge.on('STATE_UPDATE', handler);
    fake.emit({ type: 'ANDERES', payload: {} });
    expect(handler).not.toHaveBeenCalled();

    fake.emit({ type: 'STATE_UPDATE', payload: { x: 1 } });
    expect(handler).toHaveBeenCalledWith({ x: 1 });
  });

  it('meldet Handler wieder ab', () => {
    const fake = createFakeTransport();
    const bridge = new ScrumBridge(fake.transport);
    const handler = vi.fn();

    const off = bridge.on('X', handler);
    off();
    fake.emit({ type: 'X', payload: {} });

    expect(handler).not.toHaveBeenCalled();
    expect(fake.listenerCount).toBe(0);
  });
});

describe('ScrumBridge.request', () => {
  it('löst mit der passenden Antwort auf', async () => {
    const fake = createFakeTransport();
    const bridge = new ScrumBridge(fake.transport);

    const promise = bridge.request('GET_STATE', 'STATE_UPDATE');
    fake.emit({ type: 'STATE_UPDATE', payload: { ok: true } });

    await expect(promise).resolves.toEqual({ type: 'STATE_UPDATE', payload: { ok: true } });
  });

  it('akzeptiert auch den Fehler-Antworttyp', async () => {
    const fake = createFakeTransport();
    const bridge = new ScrumBridge(fake.transport);

    const promise = bridge.request('MOVE_TASK', ['TASK_MOVED', 'TASK_MOVE_FAILED']);
    fake.emit({ type: 'TASK_MOVE_FAILED', payload: { error: 'verboten' } });

    const result = await promise;
    expect(result.type).toBe('TASK_MOVE_FAILED');
  });

  it('ignoriert Antworten zu einem anderen Ticket', async () => {
    const fake = createFakeTransport();
    const bridge = new ScrumBridge(fake.transport);

    const promise = bridge.request('MOVE_TASK', 'TASK_MOVED', {}, {
      match: (payload) => payload.taskId === 'meins',
    });

    fake.emit({ type: 'TASK_MOVED', payload: { taskId: 'fremd' } });
    fake.emit({ type: 'TASK_MOVED', payload: { taskId: 'meins' } });

    await expect(promise).resolves.toEqual({
      type: 'TASK_MOVED',
      payload: { taskId: 'meins' },
    });
  });

  it('meldet den Listener nach dem Auflösen ab', async () => {
    const fake = createFakeTransport();
    const bridge = new ScrumBridge(fake.transport);

    const promise = bridge.request('A', 'B');
    fake.emit({ type: 'B', payload: {} });
    await promise;

    expect(fake.listenerCount).toBe(0);
  });

  describe('Timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('bricht ab, wenn keine Antwort kommt', async () => {
      const fake = createFakeTransport();
      const bridge = new ScrumBridge(fake.transport);

      const promise = bridge.request('A', 'B', {}, { timeoutMs: 1000 });
      const assertion = expect(promise).rejects.toThrow(/nicht innerhalb von 1000ms/);

      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
      expect(fake.listenerCount).toBe(0);
    });
  });
});

describe('Transport-Erkennung', () => {
  it('nutzt die Host-Bridge, wenn sie vorhanden ist', () => {
    const host = { postMessage: vi.fn(), onMessage: vi.fn() };
    expect(createWorkerTransport({ paperclipPlugin: host }).name).toBe('host-bridge');
  });

  it('ignoriert eine unvollständige Host-Bridge', () => {
    // Ohne onMessage ist die Bridge unbrauchbar — der Aufruf darf nicht
    // fälschlich als Host-Transport durchgehen. (Kein Worker in der
    // Testumgebung, deshalb wird der Fallback-Pfad nur bis zum Wurf geprüft.)
    expect(() => createWorkerTransport({ paperclipPlugin: { postMessage: vi.fn() } })).toThrow();
  });

  it('leitet Host-Nachrichten an die Abonnenten weiter', () => {
    let captured: ((m: PluginMessage) => void) | null = null;
    const host = {
      postMessage: vi.fn(),
      onMessage: (h: (m: PluginMessage) => void) => {
        captured = h;
      },
    };

    const transport = createHostTransport(host);
    const handler = vi.fn();
    transport.subscribe(handler);

    captured!({ type: 'X', payload: { a: 1 } });
    expect(handler).toHaveBeenCalledWith({ type: 'X', payload: { a: 1 } });

    transport.post({ type: 'Y', payload: {} });
    expect(host.postMessage).toHaveBeenCalledWith({ type: 'Y', payload: {} });
  });

  it('räumt beim Dispose die Host-Registrierung ab', () => {
    const unsubscribe = vi.fn();
    const transport = createHostTransport({
      postMessage: vi.fn(),
      onMessage: () => unsubscribe,
    });

    transport.dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
