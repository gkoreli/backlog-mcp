import { describe, expect, it, vi } from 'vitest';
import { ParcelDocsTreeWatcher } from '../storage/local/parcel-docs-tree-watcher.js';

type WatcherCallback = (
  error: Error | null,
  events: readonly unknown[],
) => unknown;

function createWatcherHarness() {
  let callback: WatcherCallback | undefined;
  const unsubscribe = vi.fn(async function unsubscribe(): Promise<void> {});
  const subscribe = vi.fn(async function subscribe(
    _documentsDir: string,
    nextCallback: WatcherCallback,
  ) {
    callback = nextCallback;
    return { unsubscribe };
  });
  const watcher = new ParcelDocsTreeWatcher({ subscribe });

  function emit(error: Error | null, events: readonly unknown[]): void {
    if (!callback) {
      throw new Error('Watcher callback is not registered');
    }
    callback(error, events);
  }

  return { emit, subscribe, unsubscribe, watcher };
}

describe('ParcelDocsTreeWatcher', () => {
  it('subscribes recursively through Parcel and returns its async unsubscribe handle', async () => {
    const harness = createWatcherHarness();
    const subscription = await harness.watcher.subscribe(
      '/project/docs',
      vi.fn(),
    );

    expect(harness.subscribe).toHaveBeenCalledWith(
      '/project/docs',
      expect.any(Function),
    );

    await subscription.unsubscribe();

    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  it('forwards watcher errors without reconciling', async () => {
    const harness = createWatcherHarness();
    const onReconcile = vi.fn();
    const onError = vi.fn();
    const watcherError = new Error('watch failed');
    await harness.watcher.subscribe('/project/docs', onReconcile, onError);

    harness.emit(watcherError, [{}]);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(watcherError);
    expect(onReconcile).not.toHaveBeenCalled();
  });

  it('ignores an empty event batch', async () => {
    const harness = createWatcherHarness();
    const onReconcile = vi.fn();
    await harness.watcher.subscribe('/project/docs', onReconcile);

    harness.emit(null, []);

    expect(onReconcile).not.toHaveBeenCalled();
  });

  it('reconciles exactly once for each non-empty event batch', async () => {
    const harness = createWatcherHarness();
    const onReconcile = vi.fn();
    await harness.watcher.subscribe('/project/docs', onReconcile);

    harness.emit(null, [{}, {}, {}]);

    expect(onReconcile).toHaveBeenCalledOnce();
  });

  it('forwards rejected async reconciliation to the error callback', async () => {
    const harness = createWatcherHarness();
    const reconciliationError = new Error('reconciliation failed');
    const onReconcile = vi.fn().mockRejectedValue(reconciliationError);
    const onError = vi.fn();
    await harness.watcher.subscribe('/project/docs', onReconcile, onError);

    harness.emit(null, [{}]);

    await vi.waitFor(function reconciliationFailureWasReported() {
      expect(onError).toHaveBeenCalledWith(reconciliationError);
    });
    expect(onReconcile).toHaveBeenCalledOnce();
  });
});
