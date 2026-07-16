import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { MemoryComposer } from '@backlog-mcp/memory';
import type { EntityType } from '@backlog-mcp/shared';
import type { BacklogHome } from '../../core/backlog-home.types.js';
import { createDefaultComposer } from '../../memory/bootstrap.js';
import {
  createOperationLogger,
  type OperationLogger,
} from '../../operations/logger.js';
import { ResourceManager } from '../../resources/manager.js';
import { BacklogService } from './backlog-service.js';
import { BuiltinSubstrateStorageCatalog } from './builtin-substrate-storage-catalog.js';
import { DocsNativeFilesystemStorage } from './docs-native-filesystem-storage.js';
import type {
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
  DocsTreeWatcherSubscription,
} from './docs-tree-watcher.contract.js';
import type { LocalRuntimeDependencies } from './local-runtime.types.js';
import { ParcelDocsTreeWatcher } from './parcel-docs-tree-watcher.js';
import { nextStorageDocumentId } from '../storage-identity.js';

const SEARCH_HALF_LIFE_DAYS = 30;

function createSearch(home: BacklogHome): OramaSearchService {
  return new OramaSearchService({
    cachePath: join(home.controlDir, 'cache', 'search-index.json'),
    halfLifeDays: SEARCH_HALF_LIFE_DAYS,
  });
}

function ensureRuntimeDirectories(home: BacklogHome): void {
  mkdirSync(home.documentsDir, { recursive: true });
  mkdirSync(home.controlDir, { recursive: true });
}

/**
 * The complete local service graph for one canonical backlog home.
 *
 * Markdown under `home.documentsDir` remains authoritative. The watcher only
 * requests full reconciliation; it never applies event-level mutations.
 */
export class LocalRuntime {
  private subscription: DocsTreeWatcherSubscription | undefined;
  private startPromise: Promise<void> | undefined;
  private reconciliation: Promise<void> | undefined;
  private reconcilePending = false;
  private started = false;

  constructor(
    readonly home: BacklogHome,
    readonly storage: DocsNativeFilesystemStorage,
    readonly search: OramaSearchService,
    readonly resourceManager: ResourceManager,
    readonly service: BacklogService,
    readonly operationLogger: OperationLogger,
    readonly memoryComposer: MemoryComposer,
    private readonly watcher: DocsTreeWatcher,
    private readonly onWatcherError?: DocsTreeWatcherErrorCallback,
  ) {}

  /** Subscribe before the initial full reconciliation so startup changes queue. */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.startPromise !== undefined) {
      await this.startPromise;
      return;
    }

    const startPromise = this.startOnce();
    this.startPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = undefined;
      }
    }
  }

  /**
   * Request a full docs-tree reconciliation.
   *
   * Bursts collapse into one pending pass while preserving a final pass for
   * changes that arrive during an in-flight reconciliation.
   */
  async reconcile(): Promise<void> {
    this.reconcilePending = true;
    if (this.reconciliation !== undefined) {
      await this.reconciliation;
      return;
    }

    const reconciliation = this.drainReconciliation();
    this.reconciliation = reconciliation;
    try {
      await reconciliation;
    } finally {
      if (this.reconciliation === reconciliation) {
        this.reconciliation = undefined;
      }
    }
  }

  /** Stop watching and flush this home's derived search cache. */
  async stop(): Promise<void> {
    if (this.startPromise !== undefined) {
      await this.startPromise;
    }

    const subscription = this.subscription;
    this.subscription = undefined;
    this.started = false;
    if (subscription !== undefined) {
      await subscription.unsubscribe();
    }
    if (this.reconciliation !== undefined) {
      await this.reconciliation;
    }
    this.service.flush();
  }

  private async startOnce(): Promise<void> {
    ensureRuntimeDirectories(this.home);
    const subscription = await this.watcher.subscribe(
      this.home.documentsDir,
      this.requestWatcherReconciliation,
      this.onWatcherError,
    );
    this.subscription = subscription;

    try {
      await this.reconcile();
      this.started = true;
    } catch (error) {
      this.subscription = undefined;
      await subscription.unsubscribe();
      throw error;
    }
  }

  private readonly requestWatcherReconciliation = (): Promise<void> => {
    return this.reconcile();
  };

  private async drainReconciliation(): Promise<void> {
    while (this.reconcilePending) {
      this.reconcilePending = false;
      await this.service.reconcile();
    }
  }
}

/** Construct, but do not start, one isolated docs-native local runtime. */
export function createLocalRuntime(
  home: BacklogHome,
  deps: LocalRuntimeDependencies = {},
): LocalRuntime {
  const catalog = deps.catalog ?? new BuiltinSubstrateStorageCatalog();
  const storage = new DocsNativeFilesystemStorage(home, catalog);
  const search = deps.createSearch?.(home) ?? createSearch(home);
  const resourceManager = new ResourceManager(home.documentsDir);
  function allocateId(type: EntityType, currentMaxId: number): string {
    return nextStorageDocumentId(catalog, type, currentMaxId);
  }
  const service = new BacklogService({
    storage,
    search,
    resourceManager,
    allocateId,
  });
  const operationLogger = createOperationLogger(
    join(home.controlDir, 'state', 'operations.jsonl'),
  );
  const memoryComposer = createDefaultComposer(function getRuntimeService() {
    return service;
  });

  return new LocalRuntime(
    home,
    storage,
    search,
    resourceManager,
    service,
    operationLogger,
    memoryComposer,
    deps.watcher ?? new ParcelDocsTreeWatcher(),
    deps.onWatcherError,
  );
}
