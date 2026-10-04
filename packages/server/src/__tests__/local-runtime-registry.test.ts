import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import { describe, expect, it, vi } from 'vitest';
import { createBacklogHome } from '../storage/local/backlog-home.js';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type {
  DocsTreeReconcileCallback,
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
  DocsTreeWatcherSubscription,
} from '../storage/local/docs-tree-watcher.contract.js';
import { LocalRuntimeRegistry, LocalRuntimeDrainingError, LocalRuntimeConfigurationError } from '../storage/local/local-runtime-registry.js';
import {
  createLocalRuntime,
  type LocalRuntime,
} from '../storage/local/local-runtime.js';

interface FakeWatcherOptions {
  beforeSubscribe?: () => Promise<void>;
  subscribeError?: Error;
  onUnsubscribe?: () => void;
}

class FakeDocsTreeWatcher implements DocsTreeWatcher {
  subscribeCount = 0;
  unsubscribeCount = 0;

  constructor(private readonly options: FakeWatcherOptions = {}) {}

  async subscribe(
    _documentsDir: string,
    _onReconcile: DocsTreeReconcileCallback,
    _onError?: DocsTreeWatcherErrorCallback,
  ): Promise<DocsTreeWatcherSubscription> {
    this.subscribeCount += 1;
    await this.options.beforeSubscribe?.();

    const subscribeError = this.options.subscribeError;
    if (subscribeError !== undefined) throw subscribeError;

    const watcher = this;
    return {
      async unsubscribe(): Promise<void> {
        watcher.unsubscribeCount += 1;
        watcher.options.onUnsubscribe?.();
      },
    };
  }
}

interface Gate {
  wait: () => Promise<void>;
  open: () => void;
}

function createGate(): Gate {
  let release: (() => void) | undefined;
  const pending = new Promise<void>(function captureRelease(resolve) {
    release = resolve;
  });

  return {
    async wait(): Promise<void> {
      await pending;
    },
    open(): void {
      release?.();
    },
  };
}

function createHome(name: string): BacklogHome {
  return createBacklogHome({
    kind: 'project',
    root: join(tmpdir(), 'local-runtime-registry', name),
  });
}

function createBm25Search(home: BacklogHome): OramaSearchService {
  return new OramaSearchService({
    cachePath: join(home.controlDir, 'cache', 'search-index.json'),
    hybridSearch: false,
    halfLifeDays: 30,
  });
}

function createTestRuntime(
  home: BacklogHome,
  watcher: DocsTreeWatcher,
): LocalRuntime {
  return createLocalRuntime(home, {
    watcher,
    createSearch: createBm25Search,
  });
}

describe('LocalRuntimeRegistry', function describeLocalRuntimeRegistry() {
  it('lazily shares one in-flight runtime per canonical root', async function sharesInFlightRuntime() {
    const home = createHome('shared');
    const gate = createGate();
    const watcher = new FakeDocsTreeWatcher({ beforeSubscribe: gate.wait });
    const runtime = createTestRuntime(home, watcher);
    const factory = vi.fn(function createRuntime(): LocalRuntime {
      return runtime;
    });
    const registry = new LocalRuntimeRegistry(factory);

    expect(factory).not.toHaveBeenCalled();

    const first = registry.get(home);
    const second = registry.get({ ...home });

    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(watcher.subscribeCount).toBe(1);

    gate.open();
    const [firstRuntime, secondRuntime] = await Promise.all([first, second]);
    expect(firstRuntime).toBe(runtime);
    expect(secondRuntime).toBe(runtime);
    expect(await registry.get(home)).toBe(runtime);

    await registry.close(home);
  });

  it('creates independent runtimes for independent roots', async function createsIndependentRuntimes() {
    const alpha = createHome('alpha');
    const beta = createHome('beta');
    const factory = vi.fn(function createRuntime(home: BacklogHome) {
      return createTestRuntime(home, new FakeDocsTreeWatcher());
    });
    const registry = new LocalRuntimeRegistry(factory);

    const [alphaRuntime, betaRuntime] = await Promise.all([
      registry.get(alpha),
      registry.get(beta),
    ]);

    expect(alphaRuntime).not.toBe(betaRuntime);
    expect(alphaRuntime.home.root).toBe(alpha.root);
    expect(betaRuntime.home.root).toBe(beta.root);
    expect(factory).toHaveBeenCalledTimes(2);

    await registry.closeAll();
  });

  it('evicts a failed start so the next get retries', async function retriesFailedStart() {
    const home = createHome('retry');
    let attempts = 0;
    const successfulWatcher = new FakeDocsTreeWatcher();
    function createRuntime(selectedHome: BacklogHome): LocalRuntime {
      attempts += 1;
      const watcher = attempts === 1
        ? new FakeDocsTreeWatcher({
          subscribeError: new Error('start failed'),
        })
        : successfulWatcher;
      return createTestRuntime(selectedHome, watcher);
    }
    const registry = new LocalRuntimeRegistry(createRuntime);

    await expect(registry.get(home)).rejects.toThrow('start failed');

    const runtime = await registry.get(home);
    expect(runtime.home.root).toBe(home.root);
    expect(attempts).toBe(2);
    expect(successfulWatcher.subscribeCount).toBe(1);

    await registry.close(home);
  });

  it('awaits in-flight creation, stops once, and removes the entry', async function closesInFlightRuntime() {
    const home = createHome('close');
    const gate = createGate();
    const watcher = new FakeDocsTreeWatcher({ beforeSubscribe: gate.wait });
    const runtime = createTestRuntime(home, watcher);
    const registry = new LocalRuntimeRegistry(function createRuntime() {
      return runtime;
    });

    const creation = registry.get(home);
    const close = registry.close(home);
    let closed = false;
    void close.then(function markClosed() {
      closed = true;
    });
    await Promise.resolve();

    expect(closed).toBe(false);
    expect(watcher.unsubscribeCount).toBe(0);

    gate.open();
    expect(await creation).toBe(runtime);
    expect(await close).toBe(true);
    expect(watcher.unsubscribeCount).toBe(1);
    expect(await registry.close(home)).toBe(false);
  });

  it('closes all runtimes in sorted root-key order and clears the registry', async function closesAllInOrder() {
    const zeta = createHome('zeta');
    const alpha = createHome('alpha');
    const middle = createHome('middle');
    const stopOrder: string[] = [];
    function createRuntime(home: BacklogHome): LocalRuntime {
      const watcher = new FakeDocsTreeWatcher({
        onUnsubscribe: function recordStop() {
          stopOrder.push(home.root);
        },
      });
      return createTestRuntime(home, watcher);
    }
    const registry = new LocalRuntimeRegistry(createRuntime);
    await Promise.all([
      registry.get(zeta),
      registry.get(alpha),
      registry.get(middle),
    ]);

    await registry.closeAll();

    expect(stopOrder).toEqual([alpha.root, middle.root, zeta.root]);
    expect(await registry.close(alpha)).toBe(false);
    expect(await registry.close(middle)).toBe(false);
    expect(await registry.close(zeta)).toBe(false);
  });
  it('rejects get during close, shares retirement, and admits a replacement only afterwards', async function guardsRetirement() {
    const home = createHome('drain-one');
    const gate = createGate();
    const factory = vi.fn(function create(home: BacklogHome) { return createTestRuntime(home, new FakeDocsTreeWatcher()); });
    const registry = new LocalRuntimeRegistry(factory);
    const old = await registry.get(home);
    const stop = old.stop.bind(old);
    const stopping = vi.spyOn(old, 'stop').mockImplementation(async function deferredStop() { await gate.wait(); await stop(); });
    const firstClose = registry.close(home);
    const secondClose = registry.close(home);
    expect(firstClose).toBe(secondClose);
    await expect(registry.get(home)).rejects.toBeInstanceOf(LocalRuntimeDrainingError);
    expect(factory).toHaveBeenCalledTimes(1);
    const independent = await registry.get(createHome('drain-independent'));
    expect(independent).not.toBe(old);
    gate.open();
    await firstClose;
    expect(stopping).toHaveBeenCalledTimes(1);
    expect(await registry.get(home)).not.toBe(old);
    await registry.closeAll();
  });

  it('rejects all admission while closeAll drains and attempts other roots after a stop failure', async function guardsAllRetirement() {
    const registry = new LocalRuntimeRegistry(function create(home) { return createTestRuntime(home, new FakeDocsTreeWatcher()); });
    const alpha = createHome('all-alpha');
    const beta = createHome('all-beta');
    const gate = createGate();
    const first = await registry.get(alpha);
    const second = await registry.get(beta);
    const stop = vi.spyOn(first, 'stop').mockImplementationOnce(async function deferredFailure() { await gate.wait(); throw new Error('stop failed'); });
    const stopSecond = vi.spyOn(second, 'stop');
    const closing = registry.closeAll();
    expect(registry.closeAll()).toBe(closing);
    await expect(registry.get(createHome('new-during-drain'))).rejects.toBeInstanceOf(LocalRuntimeDrainingError);
    gate.open();
    await expect(closing).rejects.toThrow('stop failed');
    expect(stopSecond).toHaveBeenCalledTimes(1);
    await expect(registry.get(alpha)).rejects.toBeInstanceOf(LocalRuntimeDrainingError);
    await registry.close(alpha); // Retry the actual stop before admitting another graph.
    expect(stop).toHaveBeenCalledTimes(2);
    expect(await registry.get(alpha)).not.toBe(first);
    await registry.closeAll();
  });

  it('rejects incompatible document/control descriptors for the same root', async function validatesDescriptor() {
    const home = createHome('descriptor');
    const factory = vi.fn(function create(home: BacklogHome) { return createTestRuntime(home, new FakeDocsTreeWatcher()); });
    const registry = new LocalRuntimeRegistry(factory);
    const runtime = await registry.get(home);
    for (const changed of [{ ...home, documentsDir: join(home.root, 'other-docs') }, { ...home, controlDir: join(home.root, '.other-control') }]) {
      await expect(registry.get(changed)).rejects.toBeInstanceOf(LocalRuntimeConfigurationError);
    }
    expect(factory).toHaveBeenCalledTimes(1);
    expect(await registry.get({ ...home })).toBe(runtime);
    await registry.closeAll();
  });

  it('rejects changed family facts for a cached worktree instead of serving stale grounding', async function familyDescriptor() {
    const home = { ...createHome('family-descriptor'), family: { root: '/family', name: 'project', branch: 'feature', defaultBranch: 'main' } };
    const registry = new LocalRuntimeRegistry(function create(home) { return createTestRuntime(home, new FakeDocsTreeWatcher()); });
    const original = await registry.get(home);
    await expect(registry.get({ ...home, family: { ...home.family, branch: 'another-branch' } })).rejects.toBeInstanceOf(LocalRuntimeConfigurationError);
    await expect(registry.get({ ...home, family: { ...home.family, defaultBranch: 'develop' } })).rejects.toBeInstanceOf(LocalRuntimeConfigurationError);
    expect(await registry.get({ ...home, family: { ...home.family } })).toBe(original);
    await registry.closeAll();
  });

  it('retains a watcher subscription when unsubscribe fails so retirement can retry', async function retriesUnsubscribe() {
    const home = createHome('unsubscribe-retry');
    let failed = false;
    const watcher = new FakeDocsTreeWatcher({ onUnsubscribe: function failOnce() { if (!failed) { failed = true; throw new Error('unsubscribe failed'); } } });
    const runtime = createTestRuntime(home, watcher);
    const registry = new LocalRuntimeRegistry(function create() { return runtime; });
    await registry.get(home);
    await expect(registry.close(home)).rejects.toThrow('unsubscribe failed');
    await expect(registry.get(home)).rejects.toBeInstanceOf(LocalRuntimeDrainingError);
    expect(watcher.unsubscribeCount).toBe(1);
    await registry.close(home);
    expect(watcher.unsubscribeCount).toBe(2);
  });

});
