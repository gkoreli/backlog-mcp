import { join } from 'node:path';
import type { Entity, Status, EntityType } from '@backlog-mcp/shared';
import { FilesystemStorage } from './task-storage.js';
import type { StorageAdapter } from './storage-adapter.js';
import { OramaSearchService, type UnifiedSearchResult, type SearchableType, type SearchSnippet } from '@backlog-mcp/memory/search';
import type { Resource } from '@backlog-mcp/memory/search';
import { resourceManager } from '../resources/manager.js';
import { paths } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import type { IBacklogService } from './service-types.js';

/**
 * Composes a StorageAdapter + SearchService + ResourceManager.
 * Orchestrates storage operations and search index updates.
 *
 * Depends on the StorageAdapter *interface* (not the concrete class) so the
 * local path mirrors the D1 path's dependency inversion (ADR 0106.3 §A).
 */
class BacklogService implements IBacklogService {
  private static instance: BacklogService;
  private storage: StorageAdapter = new FilesystemStorage();
  private search: OramaSearchService;
  private searchReady = false;
  private pendingOps: Array<{ op: 'add' | 'update' | 'remove'; entity?: Entity; id?: string }> = [];

  private constructor() {
    this.search = new OramaSearchService({
      cachePath: join(paths.backlogDataDir, '.cache', 'search-index.json'),
      halfLifeDays: 30,  // ADR-0092.1 Phase 1 — recent work ranks above old work
    });
  }

  static getInstance(): BacklogService {
    if (!BacklogService.instance) {
      BacklogService.instance = new BacklogService();
    }
    return BacklogService.instance;
  }

  private async ensureSearchReady(): Promise<void> {
    if (this.searchReady) return;
    const allEntities = Array.from(this.storage.iterateEntities());
    await this.search.index(allEntities);
    const stats = await this.search.reconcile(allEntities);
    if (stats.added + stats.removed + stats.updated > 0) {
      logger.info('Search index reconciled', { added: stats.added, removed: stats.removed, updated: stats.updated });
    }
    // Drain any mutations that occurred before first search (ADR-0101 Phase 2)
    for (const op of this.pendingOps) {
      if (op.op === 'add' && op.entity) await this.search.addDocument(op.entity);
      else if (op.op === 'update' && op.entity) await this.search.updateDocument(op.entity);
      else if (op.op === 'remove' && op.id) await this.search.removeDocument(op.id);
    }
    this.pendingOps = [];
    const resources = resourceManager.list();
    if (resources.length > 0) {
      await this.search.indexResources(resources);
    }
    this.searchReady = true;
  }

  getFilePath(id: string): string | null {
    return this.storage.getFilePath(id);
  }

  getSync(id: string): Entity | undefined {
    return this.storage.get(id);
  }

  async get(id: string): Promise<Entity | undefined> {
    return this.storage.get(id);
  }

  async getMarkdown(id: string): Promise<string | null> {
    return this.storage.getMarkdown(id);
  }

  async list(filter?: { status?: Status[]; type?: EntityType; epic_id?: string; parent_id?: string; query?: string; limit?: number }): Promise<Entity[]> {
    const { query, ...storageFilter } = filter ?? {};

    if (query) {
      await this.ensureSearchReady();
      const results = await this.search.search(query, {
        filters: { status: storageFilter.status, type: storageFilter.type, epic_id: storageFilter.epic_id, parent_id: storageFilter.parent_id },
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
    /** Filter by status (tasks/epics only) */
    status?: Status[];
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
      return resourceManager.read(uri);
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

  async add(task: Entity): Promise<void> {
    this.storage.add(task);
    if (this.searchReady) {
      this.search.addDocument(task);
    } else {
      this.pendingOps.push({ op: 'add', entity: task });
    }
  }

  async save(task: Entity): Promise<void> {
    this.storage.save(task);
    if (this.searchReady) {
      this.search.updateDocument(task);
    } else {
      this.pendingOps.push({ op: 'update', entity: task });
    }
  }

  async delete(id: string): Promise<boolean> {
    const deleted = this.storage.delete(id);
    if (deleted) {
      if (this.searchReady) {
        this.search.removeDocument(id);
      } else {
        this.pendingOps.push({ op: 'remove', id });
      }
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
  listSync(filter?: { status?: Status[]; type?: EntityType; parent_id?: string; limit?: number }): Entity[] {
    return this.storage.list(filter);
  }

  async getMaxId(type?: EntityType): Promise<number> {
    return this.storage.getMaxId(type);
  }

  flush(): void {
    if (this.searchReady) this.search.flush();
  }
}

export { BacklogService };
export const storage: BacklogService = BacklogService.getInstance();
