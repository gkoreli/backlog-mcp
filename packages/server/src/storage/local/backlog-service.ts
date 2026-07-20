import {
  EntityType,
  nextEntityId,
  type AnyEntity,
  type Status,
  type SubstrateType,
} from '@backlog-mcp/shared';
import type {
  ClaimQuarantine,
  DocumentStorageAdapter,
  StorageSaveOptions,
  StorageAdapter,
} from '../storage-adapter.js';
import {
  OramaSearchService,
  type SearchableType,
  type UnifiedSearchResult,
} from '@backlog-mcp/memory/search';
import { logger } from '../../utils/logger.js';
import {
  createSearchEntityDocument,
  isBuiltinSubstrateType,
} from '../../core/substrates/index.js';
import type { IBacklogService } from '../backlog-service.contract.js';
import type {
  BacklogReconciliationResult,
  BacklogServiceDependencies,
  SearchReconciliationStats,
} from './backlog-service.types.js';

function isDocumentStorageAdapter(
  storageAdapter: StorageAdapter,
): storageAdapter is DocumentStorageAdapter {
  return 'iterateDocuments' in storageAdapter
    && typeof storageAdapter.iterateDocuments === 'function';
}

/**
 * Typed entity Markdown is indexed through the entity collection. Excluding
 * its source path here prevents one document from appearing again as a
 * generic resource in docs-native homes.
 */
function listIndexableResources(
  storageAdapter: StorageAdapter,
  manager: BacklogServiceDependencies['resourceManager'],
) {
  const resources = manager.list();
  if (!isDocumentStorageAdapter(storageAdapter)) return resources;

  // Entity source paths are documents-dir-relative; resource paths are
  // root-relative — align through the manager's scan prefix.
  const scanPrefix = manager.scanPrefix;
  const entitySourcePaths = new Set(Array.from(
    storageAdapter.iterateDocuments(),
  ).map(function getCompiledSourcePath(document) {
    return scanPrefix === ''
      ? document.sourcePath
      : `${scanPrefix}/${document.sourcePath}`;
  }));
  return resources.filter(function isGenericResource(resource) {
    return !entitySourcePaths.has(resource.path);
  });
}

function hasChanges(stats: SearchReconciliationStats): boolean {
  return stats.added + stats.removed + stats.updated > 0;
}

/**
 * Composes a StorageAdapter + SearchService + ResourceManager.
 * Orchestrates storage operations and search index updates.
 *
 * Depends on the StorageAdapter *interface* (not the concrete class) so the
 * local path mirrors the D1 path's dependency inversion (ADR 0106.3 §A).
 */
export class BacklogService implements IBacklogService {
  private readonly storage: StorageAdapter;
  private readonly search: OramaSearchService;
  private readonly resourceManager: BacklogServiceDependencies['resourceManager'];
  private readonly getSearchFields: BacklogServiceDependencies['getSearchFields'];
  readonly listDisclosureRelations: NonNullable<BacklogServiceDependencies['listDisclosureRelations']> | undefined;
  readonly listWakeupDisclosures: NonNullable<BacklogServiceDependencies['listWakeupDisclosures']> | undefined;
  private readonly allocateEntityId: BacklogServiceDependencies['allocateId'];
  private searchReady = false;
  /** Single-flight first initialization — concurrent first searches share it. */
  private searchInitialization: Promise<BacklogReconciliationResult> | null = null;
  /** Tail of the ordered search mutation chain (ADR 0116 Phase 1A). */
  private searchOperationTail: Promise<unknown> = Promise.resolve();

  constructor(dependencies: BacklogServiceDependencies) {
    this.storage = dependencies.storage;
    this.search = dependencies.search;
    this.resourceManager = dependencies.resourceManager;
    this.getSearchFields = dependencies.getSearchFields;
    this.listDisclosureRelations = dependencies.listDisclosureRelations;
    this.listWakeupDisclosures = dependencies.listWakeupDisclosures;
    this.allocateEntityId = dependencies.allocateId;
  }

  /**
   * Append one search-index operation to the ordered mutation chain
   * (ADR 0116 Phase 1A).
   *
   * Every index write — full reconciliation included — runs through this
   * chain, so operations apply in submission order and an awaited ack means
   * the index accepted the mutation. A failed operation rejects its own
   * caller without stalling later operations.
   *
   * Before the first index build, document-level operations no-op on the
   * unmaterialized index; that is sound because initialization reads the
   * storage snapshot afterward, which already contains every acknowledged
   * write, and reconciliation runs through this same chain so it cannot
   * interleave with individual mutations.
   */
  private enqueueSearchOperation<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.searchOperationTail.then(operation);
    this.searchOperationTail = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  private async ensureSearchReady(): Promise<void> {
    if (this.searchReady) return;
    // Single-flight (ADR 0116 Phase 1A): concurrent first searches share one
    // initialization instead of racing duplicate index builds. A failed
    // initialization clears the slot so the next search can retry.
    this.searchInitialization ??= this.reconcile().finally(() => {
      this.searchInitialization = null;
    });
    await this.searchInitialization;
  }

  /**
   * Reconcile the complete home view into its search index.
   *
   * This is the watcher-facing refresh boundary: entity and generic-resource
   * drift are repaired together, including stale removals and native edits.
   * The pass runs on the ordered mutation chain, so it serializes against
   * individual index mutations instead of interleaving with them.
   */
  async reconcile(): Promise<BacklogReconciliationResult> {
    return this.enqueueSearchOperation(() => this.reconcileSearchIndex());
  }

  private async reconcileSearchIndex(): Promise<BacklogReconciliationResult> {
    // Watcher-driven refresh boundary: an external edit changed the markdown
    // tree, so the storage read model must rebuild from disk before we index
    // it (ADR 0127 R3). Local writes invalidate themselves; this covers the
    // external-edit path the watcher funnels through here.
    if (isDocumentStorageAdapter(this.storage)) {
      this.storage.invalidate?.();
    }
    this.resourceManager.invalidate();
    const allEntities = Array.from(this.storage.iterateEntities()).flatMap(
      (entity) => {
        const document = createSearchEntityDocument(entity, this.getSearchFields);
        return document === undefined ? [] : [document];
      },
    );
    if (!this.searchReady) {
      await this.search.index(allEntities);
    }
    const entityStats = await this.search.reconcile(allEntities);
    if (hasChanges(entityStats)) {
      logger.info('Search index reconciled', entityStats);
    }

    const resources = listIndexableResources(
      this.storage,
      this.resourceManager,
    );
    const resourceStats = await this.search.reconcileResources(resources);
    if (hasChanges(resourceStats)) {
      logger.info('Resource search index reconciled', resourceStats);
    }

    this.searchReady = true;
    return {
      entities: entityStats,
      resources: resourceStats,
    };
  }

  getFilePath(id: string): string | null {
    return this.storage.getFilePath(id);
  }

  /** Visible downgrade record (EXP-1 B-3) — empty for non-document storage. */
  listClaimQuarantines(): ClaimQuarantine[] {
    if (!isDocumentStorageAdapter(this.storage)) return [];
    return this.storage.listClaimQuarantines?.() ?? [];
  }

  getSync(id: string): AnyEntity | undefined {
    return this.storage.get(id);
  }

  async get(id: string): Promise<AnyEntity | undefined> {
    return this.storage.get(id);
  }

  async getMarkdown(id: string): Promise<string | null> {
    return this.storage.getMarkdown(id);
  }

  async list(filter?: {
    status?: string[];
    type?: SubstrateType;
    parent_id?: string;
    query?: string;
    limit?: number;
  }): Promise<AnyEntity[]> {
    const { query, ...storageFilter } = filter ?? {};

    if (query) {
      await this.ensureSearchReady();
      const results = await this.search.search(query, {
        filters: {
          status: storageFilter.status,
          type: storageFilter.type,
          parent_id: storageFilter.parent_id,
        },
        limit: storageFilter.limit,
      });
      return results.map(r => ({ ...r.task, score: r.score }));
    }

    return this.storage.list(storageFilter);
  }

  /**
   * Canonical search method — the single entry point for all search operations.
   * Both MCP tools (backlog_search) and HTTP endpoints (GET /search) MUST call
   * this method. This ensures MCP and UI always get identical results from the
   * same code path. (ADR-0073: MCP-first unified search architecture)
   *
   * Returns UnifiedSearchResult[] with item, score, type, and server-side snippet.
   * Supports searching tasks, epics, and resources.
   */
  async searchUnified(query: string, options?: {
    types?: SearchableType[];
    limit?: number;
    sort?: 'relevant' | 'recent';
    /** Filter by canonical status string. */
    status?: string[];
    /** Scope to parent (epic/folder) */
    parent_id?: string;
  }): Promise<UnifiedSearchResult[]> {
    await this.ensureSearchReady();

    const results = await this.search.searchAll(query, {
      docTypes: options?.types,
      limit: options?.limit ?? 20,
      sort: options?.sort,
      filters: {
        status: options?.status,
        parent_id: options?.parent_id,
      },
    });

    return results.map(r => ({
      item: r.item,
      score: r.score,
      type: r.type,
      snippet: r.snippet,
    }));
  }

  /**
   * Read a resource by MCP URI. Returns the resource content or undefined.
   * This provides read access to resources for MCP tools (ADR-0073).
   */
  getResource(uri: string): { content: string; frontmatter?: Record<string, any>; mimeType: string } | undefined {
    try {
      return this.resourceManager.read(uri);
    } catch {
      return undefined;
    }
  }

  /**
   * Check if hybrid (BM25 + vector) search is active.
   * Useful for diagnostics and for MCP tool responses.
   */
  isHybridSearchActive(): boolean {
    return this.search.isHybridSearchActive();
  }

  async add(candidate: AnyEntity): Promise<AnyEntity> {
    const entity = this.storage.add(candidate);
    // The new entity document is also a catalog resource (ADR 0127 R2).
    this.resourceManager.invalidate();
    const document = createSearchEntityDocument(entity, this.getSearchFields);
    if (document !== undefined) {
      await this.enqueueSearchOperation(() => this.search.addDocument(document));
    }
    return entity;
  }

  async save(
    candidate: AnyEntity,
    options?: StorageSaveOptions,
  ): Promise<AnyEntity> {
    const entity = this.storage.save(candidate, options);
    // The saved document's catalog projection (title/status) may have changed.
    this.resourceManager.invalidate();
    const document = createSearchEntityDocument(entity, this.getSearchFields);
    if (document !== undefined) {
      await this.enqueueSearchOperation(() => this.search.updateDocument(document));
    }
    return entity;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = this.storage.delete(id);
    if (deleted) {
      this.resourceManager.invalidate();
      await this.enqueueSearchOperation(() => this.search.removeDocument(id));
    }
    return deleted;
  }

  async counts(): Promise<{ total_tasks: number; total_epics: number; by_status: Record<Status, number>; by_type: Record<string, number> }> {
    return this.storage.counts();
  }

  /**
   * Synchronous task listing — filtering only, no search.
   * Used by ContextHydrationService (ADR-0074) which needs synchronous
   * access for the relational expansion pipeline.
   *
   * For search-based listing, use the async list() method instead.
   */
  listSync(filter?: {
    status?: string[];
    type?: SubstrateType;
    parent_id?: string;
    limit?: number;
  }): AnyEntity[] {
    return this.storage.list(filter);
  }

  async getMaxId(type: SubstrateType = EntityType.Task): Promise<number> {
    return this.storage.getMaxId(type);
  }

  /** Allocate an id through this runtime's storage identity policy. */
  async allocateId(type: SubstrateType): Promise<string> {
    const currentMaxId = await this.getMaxId(type);
    if (this.allocateEntityId !== undefined) {
      return this.allocateEntityId(type, currentMaxId);
    }
    if (!isBuiltinSubstrateType(type)) {
      throw new Error(`No storage identity allocator for substrate type: ${type}`);
    }
    return nextEntityId(currentMaxId, type);
  }

  flush(): void {
    if (this.searchReady) this.search.flush();
  }
}
