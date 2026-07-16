import * as parcelWatcher from '@parcel/watcher';
import type {
  DocsTreeReconcileCallback,
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
  DocsTreeWatcherSubscription,
} from './docs-tree-watcher.contract.js';

type ParcelWatcherCallback = (
  error: Error | null,
  events: readonly unknown[],
) => unknown;

interface ParcelWatcherApi {
  subscribe(
    documentsDir: string,
    callback: ParcelWatcherCallback,
  ): Promise<DocsTreeWatcherSubscription>;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function reportError(
  error: unknown,
  onError: DocsTreeWatcherErrorCallback | undefined,
): void {
  onError?.(normalizeError(error));
}

function requestReconciliation(
  onReconcile: DocsTreeReconcileCallback,
  onError: DocsTreeWatcherErrorCallback | undefined,
): void {
  try {
    const reconciliation = onReconcile();
    void Promise.resolve(reconciliation).catch(function reportReconciliationError(error) {
      reportError(error, onError);
    });
  } catch (error) {
    reportError(error, onError);
  }
}

/**
 * Recursive docs-tree watcher backed by Parcel's native watcher.
 */
export class ParcelDocsTreeWatcher implements DocsTreeWatcher {
  constructor(private readonly watcher: ParcelWatcherApi = parcelWatcher) {}

  async subscribe(
    documentsDir: string,
    onReconcile: DocsTreeReconcileCallback,
    onError?: DocsTreeWatcherErrorCallback,
  ): Promise<DocsTreeWatcherSubscription> {
    function handleWatcherBatch(
      error: Error | null,
      events: readonly unknown[],
    ): void {
      if (error) {
        reportError(error, onError);
        return;
      }
      if (events.length === 0) {
        return;
      }
      requestReconciliation(onReconcile, onError);
    }

    return this.watcher.subscribe(documentsDir, handleWatcherBatch);
  }
}
