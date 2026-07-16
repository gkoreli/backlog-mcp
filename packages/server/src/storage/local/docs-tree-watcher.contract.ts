export type DocsTreeReconcileCallback = () => void | Promise<void>;
export type DocsTreeWatcherErrorCallback = (error: Error) => void;

/**
 * An active recursive documents-tree subscription.
 */
export interface DocsTreeWatcherSubscription {
  unsubscribe(): Promise<void>;
}

/**
 * Watches a documents tree and requests full reconciliation after changes.
 */
export interface DocsTreeWatcher {
  subscribe(
    documentsDir: string,
    onReconcile: DocsTreeReconcileCallback,
    onError?: DocsTreeWatcherErrorCallback,
  ): Promise<DocsTreeWatcherSubscription>;
}
