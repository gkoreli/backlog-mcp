/** Orama index lifecycle, mutations and embedding resources (ADR 0136). */
import { OramaQueryReader } from './orama-query-reader.js';
import { entityEmbeddingText, resourceEmbeddingText, projectEntitySearchDocument, projectResourceSearchDocument, type EntityProjectionSource } from './search-document.js';
import { isDeepStrictEqual } from 'node:util';
import { create, count, getByID, insert, insertMultiple, remove, save, load } from '@orama/orama';
import { SearchIndexCache } from './search-index-cache.js';
import type { SearchIndexSnapshot } from './search-index-snapshot.js';
import type { AnyEntity } from '@backlog-mcp/shared';
import type {
  IndexableEntity,
  Resource,
  ResourceSearchResult,
  SearchEntityField,
  SearchOptions,
  SearchResult,
  SearchService,
  SearchSnippet,
  SearchableType,
} from './types.js';
import { EmbeddingService, EMBEDDING_DIMENSIONS } from './embedding-service.js';
import { compoundWordTokenizer } from './tokenizer.js';
import {
  type OramaDoc, type OramaDocWithEmbeddings,
  type OramaInstance, type OramaInstanceWithEmbeddings,
  schema, schemaWithEmbeddings,
  INDEX_VERSION, UNSORTABLE_PROPERTIES,
} from './orama-schema.js';
import {
  idIntentSpecsFromIdentities,
  BUILTIN_ID_INTENT_SPECS,
  type IdentityDeclaration,
  type IdIntentSpec,
} from './query-intent.js';

export interface OramaSearchOptions {
  cachePath: string;
  /** Enable hybrid search with local embeddings. Default: true */
  hybridSearch?: boolean;
  /**
   * Half-life in days for post-fusion temporal decay (ADR-0092.1).
   * Undefined or ≤0 → decay disabled (current behavior preserved).
   */
  halfLifeDays?: number;
}

/** One coherent active index and its returned payload/filter projections. */
interface SearchIndexState {
  db: OramaInstance | OramaInstanceWithEmbeddings | null;
  tasks: Map<string, AnyEntity>;
  fields: Map<string, readonly SearchEntityField[]>;
  resources: Map<string, Resource>;
  hasEmbeddings: boolean;
}

type ReadySearchIndexState = SearchIndexState & { db: OramaInstance | OramaInstanceWithEmbeddings };

/** A delayed build may not replace a newer index or mutation (ADR 0136 R6). */
export class SearchIndexBuildSupersededError extends Error {
  constructor() {
    super('Search state changed while rebuilding; retry reconciliation from the current corpus.');
    this.name = 'SearchIndexBuildSupersededError';
  }
}

/**
 * Orama-backed search service with independent BM25 + vector retrievers
 * fused via linear combination (ADR-0081).
 *
 * Gracefully falls back to BM25-only if embeddings fail to load.
 * Uses native filtering (ADR-0079) and facets (ADR-0080).
 */
export class OramaSearchService implements SearchService {
  private state: SearchIndexState = {
    db: null, tasks: new Map(), fields: new Map(), resources: new Map(), hasEmbeddings: false,
  };
  private generation = 0;
  private mutationsInFlight = 0;
  private readonly cache: SearchIndexCache;

  private get db() { return this.state.db; }
  private get taskCache() { return this.state.tasks; }
  private get entityFieldCache() { return this.state.fields; }
  private get resourceCache() { return this.state.resources; }
  private get hasEmbeddingsInIndex() { return this.state.hasEmbeddings; }

  // Embedding state
  private readonly hybridEnabled: boolean;
  private embedder: EmbeddingService | null = null;
  private embeddingsReady = false;
  private embeddingsInitPromise: Promise<boolean> | null = null;

  // Temporal decay (ADR-0092.1) — undefined/≤0 → disabled
  private readonly halfLifeDays: number | undefined;

  // Exact-ID navigation rules — built-in prefixes until a registry configures
  // the declared vocabulary (nav-01 plumbing fix, ADR 0121 R9).
  private idIntentSpecs: readonly IdIntentSpec[] = BUILTIN_ID_INTENT_SPECS;

  constructor(options: OramaSearchOptions) {
    const service = this;
    this.cache = new SearchIndexCache(options.cachePath, INDEX_VERSION, function currentSnapshot() { return service.snapshot(); });
    this.hybridEnabled = options.hybridSearch ?? true;
    this.halfLifeDays = options.halfLifeDays;
  }

  /**
   * Derive the exact-ID fast-path vocabulary from the ACTIVE substrate
   * registry's identity declarations (nav-01 plumbing bug, ADR 0121 R9).
   *
   * Docs-native substrates mint display ids the built-in prefix list never
   * matched ("ADR 0116", "REF-0004"), so their ID queries fell through to
   * BM25 where thread children and citations swamp the entity itself.
   * Replaces the rule set: the registry already includes the built-ins.
   */
  configureIdIntent(identities: readonly IdentityDeclaration[]): void {
    this.idIntentSpecs = idIntentSpecsFromIdentities(identities);
  }

  /**
   * Lazy-load embedding service. Returns true if embeddings are available.
   */
  private async ensureEmbeddings(): Promise<boolean> {
    if (!this.hybridEnabled) return false;
    if (this.embeddingsReady) return true;
    if (this.embeddingsInitPromise) return this.embeddingsInitPromise;

    this.embeddingsInitPromise = (async () => {
      try {
        this.embedder = new EmbeddingService();
        await this.embedder.init();
        this.embeddingsReady = true;
        return true;
      } catch (e) {
        // Graceful fallback - embeddings unavailable, use BM25 only
        this.embedder = null;
        this.embeddingsReady = false;
        return false;
      }
    })();

    return this.embeddingsInitPromise;
  }

  // ── Document conversion ─────────────────────────────────────────

  private async embedText(text: string): Promise<number[]> {
    const embedder = this.embedder;
    if (embedder === null) throw new Error('Embedding inputs require the initialized embedding capability');
    return embedder.embed(text);
  }

  private async taskToDocWithEmbeddings(
    task: EntityProjectionSource,
  ): Promise<OramaDocWithEmbeddings> {
    const doc = projectEntitySearchDocument(task);
    const embeddings = await this.embedText(entityEmbeddingText(task));
    return { ...doc, embeddings };
  }

  private async resourceToDocWithEmbeddings(resource: Resource): Promise<OramaDocWithEmbeddings> {
    const doc = projectResourceSearchDocument(resource);
    const embeddings = await this.embedText(resourceEmbeddingText(resource));
    return { ...doc, embeddings };
  }

  // ── Index lifecycle ─────────────────────────────────────────────

  private snapshot(): SearchIndexSnapshot | undefined {
    const state = this.state;
    if (state.db === null) return undefined;
    return {
      version: INDEX_VERSION,
      index: save(state.db),
      tasks: Object.fromEntries(state.tasks),
      entityFields: Object.fromEntries(state.fields),
      resources: Object.fromEntries(state.resources),
      hasEmbeddings: state.hasEmbeddings,
    };
  }

  private publish(state: SearchIndexState, generation: number): void {
    if (this.generation !== generation || this.mutationsInFlight > 0) throw new SearchIndexBuildSupersededError();
    this.state = state;
    this.generation += 1;
  }

  /**
   * Create an Orama instance with the correct schema and components (ADR-0080).
   * Centralizes create() config: tokenizer, unsortableProperties.
   */
  private createOramaInstance(useEmbeddings: boolean) {
    const schemaToUse = useEmbeddings ? schemaWithEmbeddings : schema;
    return create({
      schema: schemaToUse,
      components: { tokenizer: compoundWordTokenizer },
      sort: { unsortableProperties: [...UNSORTABLE_PROPERTIES] },  // ADR-0080: memory optimization
    });
  }

  private async loadFromDisk(): Promise<SearchIndexState | undefined> {
    const snapshot = this.cache.read();
    if (snapshot === undefined) return undefined;
    // ADR 0083 #7: a BM25-only cache cannot silently disable requested hybrid search.
    if (this.hybridEnabled && !snapshot.hasEmbeddings && await this.ensureEmbeddings()) return undefined;
    try {
      const db = await this.createOramaInstance(snapshot.hasEmbeddings);
      load(db, snapshot.index);
      const ids = [...Object.keys(snapshot.tasks), ...Object.keys(snapshot.resources)];
      if (count(db) !== ids.length || ids.some(function missing(id) { return getByID(db, id) === undefined; })) return undefined;
      if (snapshot.hasEmbeddings && ids.some(function missingVector(id) {
        const indexed = getByID(db, id);
        const embeddings = indexed !== undefined && 'embeddings' in indexed ? indexed.embeddings : undefined;
        return !Array.isArray(embeddings) || embeddings.length !== EMBEDDING_DIMENSIONS
          || !embeddings.every(function finite(value) { return typeof value === 'number' && Number.isFinite(value); });
      })) return undefined;
      for (const [id, entity] of Object.entries(snapshot.tasks)) {
        const indexed = getByID(db, id);
        const expected = projectEntitySearchDocument({ entity, fields: snapshot.entityFields[id] ?? [] });
        const keys = Object.hasOwn(snapshot.entityFields, id)
          ? Object.keys(expected)
          : ['id', 'type', 'status', 'parent_id', 'updated_at'];
        if (indexed === undefined || keys.some(function differs(key) {
          return indexed[key as keyof typeof indexed] !== expected[key as keyof typeof expected];
        })) return undefined;
      }
      for (const resource of Object.values(snapshot.resources)) {
        const indexed = getByID(db, resource.id);
        const expected = projectResourceSearchDocument(resource);
        if (indexed === undefined || Object.keys(expected).some(function differs(key) {
          return indexed[key as keyof typeof indexed] !== expected[key as keyof typeof expected];
        })) return undefined;
      }
      return {
        db,
        tasks: new Map(Object.entries(snapshot.tasks)),
        fields: new Map(Object.entries(snapshot.entityFields)),
        resources: new Map(Object.entries(snapshot.resources)),
        hasEmbeddings: snapshot.hasEmbeddings,
      };
    } catch {
      return undefined;
    }
  }

  /** Stage load/build before publishing; concurrent mutations invalidate a delayed build. */
  async index(tasks: IndexableEntity[]): Promise<void> {
    if (this.mutationsInFlight > 0) throw new SearchIndexBuildSupersededError();
    const generation = this.generation;
    const resources = new Map(this.state.resources);
    const cached = await this.loadFromDisk();
    if (cached !== undefined) {
      this.publish(cached, generation);
      return;
    }
    const useEmbeddings = await this.ensureEmbeddings();
    const db = await this.createOramaInstance(useEmbeddings);
    const state: SearchIndexState = { db, tasks: new Map(), fields: new Map(), resources, hasEmbeddings: useEmbeddings };
    for (const document of tasks) {
      state.tasks.set(document.entity.id, document.entity);
      state.fields.set(document.entity.id, document.fields);
    }
    if (useEmbeddings) {
      for (const document of tasks) await insert(db as OramaInstanceWithEmbeddings, await this.taskToDocWithEmbeddings(document));
      for (const resource of resources.values()) await insert(db as OramaInstanceWithEmbeddings, await this.resourceToDocWithEmbeddings(resource));
    } else {
      await insertMultiple(db as OramaInstance, [
        ...tasks.map(projectEntitySearchDocument),
        ...Array.from(resources.values()).map(projectResourceSearchDocument),
      ]);
    }
    this.publish(state, generation);
    this.cache.persist();
  }

  /** Capture the selected database and projections across asynchronous retrieval. */
  private readState(): ReadySearchIndexState | undefined {
    const state = this.state;
    return state.db === null ? undefined : { ...state, db: state.db };
  }

  /** Capture query facts before any asynchronous retriever work. */
  private queryReader(): OramaQueryReader | undefined {
    const state = this.readState();
    if (state === undefined) return undefined;
    const service = this;
    async function embedQuery(query: string): Promise<number[] | null> {
      if (!(await service.ensureEmbeddings())) return null;
      return service.embedText(query);
    }
    return new OramaQueryReader(state, embedQuery, this.idIntentSpecs, this.halfLifeDays, Date.now());
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return this.queryReader()?.search(query, options) ?? [];
  }

  async searchAll(query: string, options?: SearchOptions): Promise<Array<{ id: string; score: number; type: SearchableType; item: AnyEntity | Resource; snippet: SearchSnippet }>> {
    return this.queryReader()?.searchAll(query, options) ?? [];
  }

  async searchResources(query: string, options?: { limit?: number }): Promise<ResourceSearchResult[]> {
    return this.queryReader()?.searchResources(query, options) ?? [];
  }

  /**
   * Check if hybrid search is currently active.
   */
  isHybridSearchActive(): boolean {
    return this.hasEmbeddingsInIndex && this.embeddingsReady;
  }

  /**
   * Force-persist the index to disk immediately (ADR-0101 Phase 3).
   * Called on process shutdown to prevent cache loss.
   */
  flush(): void {
    this.cache.flush();
  }

  /**
   * Reconcile the in-memory index against the current filesystem state.
   * Adds missing entities, removes stale ones, updates modified ones.
   * Called after index() to fix cache drift without a full rebuild.
   */
  async reconcile(currentTasks: IndexableEntity[]): Promise<{ added: number; removed: number; updated: number }> {
    if (!this.db) return { added: 0, removed: 0, updated: 0 };

    const documents = currentTasks;
    const currentIds = new Set(documents.map(document => document.entity.id));
    const cachedIds = new Set(this.taskCache.keys());
    let added = 0, removed = 0, updated = 0;

    for (const document of documents) {
      if (!cachedIds.has(document.entity.id)) {
        await this.addDocument(document);
        added++;
      }
    }

    for (const id of cachedIds) {
      if (!currentIds.has(id)) {
        await this.removeDocument(id);
        removed++;
      }
    }

    for (const document of documents) {
      const entity = document.entity;
      if (cachedIds.has(entity.id)) {
        const cached = this.taskCache.get(entity.id);
        const cachedFields = this.entityFieldCache.get(entity.id);
        const currentFields = document.fields;
        if (
          cached
          && (
            !isDeepStrictEqual(cached, entity)
            || !isDeepStrictEqual(cachedFields, currentFields)
          )
        ) {
          await this.updateDocument(document);
          updated++;
        }
      }
    }

    if (added + removed + updated > 0) {
      this.cache.persist();
    }

    return { added, removed, updated };
  }

  /**
   * Reconcile indexed resources against the current documents tree.
   * Adds missing resources, removes stale ones, and updates changed content.
   */
  async reconcileResources(currentResources: Resource[]): Promise<{ added: number; removed: number; updated: number }> {
    if (!this.db) return { added: 0, removed: 0, updated: 0 };

    const currentIds = new Set(currentResources.map(resource => resource.id));
    const cachedIds = new Set(this.resourceCache.keys());
    let added = 0, removed = 0, updated = 0;

    for (const resource of currentResources) {
      if (!cachedIds.has(resource.id)) {
        await this.addResource(resource);
        added++;
      }
    }

    for (const id of cachedIds) {
      if (!currentIds.has(id)) {
        await this.removeResource(id);
        removed++;
      }
    }

    for (const resource of currentResources) {
      if (cachedIds.has(resource.id)) {
        const cached = this.resourceCache.get(resource.id);
        const changed = cached
          && (cached.path !== resource.path
            || cached.title !== resource.title
            || cached.content !== resource.content
            || cached.status !== resource.status);
        if (changed) {
          await this.updateResource(resource);
          updated++;
        }
      }
    }

    if (added + removed + updated > 0) {
      this.cache.persist();
    }

    return { added, removed, updated };
  }

  /** Builds never publish across an incremental mutation, including failed mutations. */
  private async mutate(action: () => Promise<void>): Promise<void> {
    this.mutationsInFlight += 1;
    this.generation += 1;
    try { await action(); }
    finally {
      this.mutationsInFlight -= 1;
      this.generation += 1;
    }
  }

  async addDocument(task: IndexableEntity): Promise<void> {
    if (this.db === null) return;
    const service = this;
    return this.mutate(function applyMutation() { return service.addDocumentInState(task); });
  }

  async removeDocument(id: string): Promise<void> {
    if (this.db === null) return;
    const service = this;
    return this.mutate(function applyMutation() { return service.removeDocumentInState(id); });
  }

  async updateDocument(task: IndexableEntity): Promise<void> {
    if (this.db === null) return;
    const service = this;
    return this.mutate(function applyMutation() { return service.updateDocumentInState(task); });
  }

  async indexResources(resources: Resource[]): Promise<void> {
    if (this.db === null) return;
    const service = this;
    return this.mutate(function applyMutation() { return service.indexResourcesInState(resources); });
  }

  async addResource(resource: Resource): Promise<void> {
    if (this.db === null) return;
    const service = this;
    return this.mutate(function applyMutation() { return service.addResourceInState(resource); });
  }

  async removeResource(id: string): Promise<void> {
    if (this.db === null) return;
    const service = this;
    return this.mutate(function applyMutation() { return service.removeResourceInState(id); });
  }

  async updateResource(resource: Resource): Promise<void> {
    if (this.db === null) return;
    const service = this;
    return this.mutate(function applyMutation() { return service.updateResourceInState(resource); });
  }

  // ── Document CRUD ───────────────────────────────────────────────

  private async addDocumentInState(task: IndexableEntity): Promise<void> {
    if (!this.db) return;
    const document = task;
    const entity = document.entity;
    const previous = this.taskCache.get(entity.id);
    const previousFields = this.entityFieldCache.get(entity.id);
    this.taskCache.set(entity.id, entity);
    this.entityFieldCache.set(entity.id, document.fields);

    try {
      if (this.hasEmbeddingsInIndex && (await this.ensureEmbeddings())) {
        const doc = await this.taskToDocWithEmbeddings(document);
        await insert(this.db as OramaInstanceWithEmbeddings, doc);
      } else {
        await insert(this.db as OramaInstance, projectEntitySearchDocument(document));
      }
    } catch (e: any) {
      if (previous) {
        this.taskCache.set(entity.id, previous);
        if (previousFields !== undefined) {
          this.entityFieldCache.set(entity.id, previousFields);
        } else {
          this.entityFieldCache.delete(entity.id);
        }
      } else {
        this.taskCache.delete(entity.id);
        this.entityFieldCache.delete(entity.id);
      }
      if (e?.code === 'DOCUMENT_ALREADY_EXISTS') {
        await this.updateDocument(task);
        return;
      }
      throw e;
    }
    this.cache.schedule();
  }

  private async removeDocumentInState(id: string): Promise<void> {
    if (!this.db) return;
    this.taskCache.delete(id);
    this.entityFieldCache.delete(id);
    try {
      await remove(this.db, id);
      this.cache.schedule();
    } catch {
      // Ignore if document doesn't exist
    }
  }

  private async updateDocumentInState(task: IndexableEntity): Promise<void> {
    // Pre-initialization no-op (ADR 0116 Phase 1A): before the first index
    // build there is nothing to update — initialization reads the storage
    // snapshot afterward, which already reflects this write.
    if (!this.db) return;
    // ADR-0083 #2: atomic remove → insert. If the insert fails (e.g.
    // embedding service error), restore the previous document so the index
    // and taskCache don't drift apart.
    const document = task;
    const entity = document.entity;
    const prev = this.taskCache.get(entity.id);
    const prevFields = this.entityFieldCache.get(entity.id);
    const previousIndexed = getByID(this.db as OramaInstanceWithEmbeddings, entity.id);
    if (prev !== undefined && isDeepStrictEqual(
      projectEntitySearchDocument({ entity: prev, fields: prevFields ?? [] }),
      projectEntitySearchDocument(document),
    )) {
      // Payload-only edits must be visible, but have no index/embedding work.
      this.taskCache.set(entity.id, entity);
      this.entityFieldCache.set(entity.id, document.fields);
      this.cache.schedule();
      return;
    }
    const unchangedEmbeddingText = prev !== undefined
      && entityEmbeddingText({ entity: prev, fields: prevFields ?? [] }) === entityEmbeddingText(document);
    await this.removeDocument(entity.id);
    this.taskCache.set(entity.id, entity);
    this.entityFieldCache.set(entity.id, document.fields);

    try {
      if (this.hasEmbeddingsInIndex && (await this.ensureEmbeddings())) {
        const doc = unchangedEmbeddingText && previousIndexed?.embeddings !== undefined
          ? { ...projectEntitySearchDocument(document), embeddings: previousIndexed.embeddings }
          : await this.taskToDocWithEmbeddings(document);
        await insert(this.db as OramaInstanceWithEmbeddings, doc);
      } else {
        await insert(this.db as OramaInstance, projectEntitySearchDocument(document));
      }
    } catch (err) {
      if (prev) {
        const restored = {
          entity: prev,
          fields: prevFields ?? [],
        };
        this.taskCache.set(entity.id, prev);
        this.entityFieldCache.set(entity.id, restored.fields);
        try { await insert(this.db as OramaInstance, previousIndexed ?? projectEntitySearchDocument(restored)); } catch { /* index unrecoverable for this doc */ }
      } else {
        this.taskCache.delete(entity.id);
        this.entityFieldCache.delete(entity.id);
      }
      throw err;
    }
    this.cache.schedule();
  }

  // ── Resource CRUD ───────────────────────────────────────────────

  /**
   * Index resources into the search index.
   * Should be called after index() to add resources to existing index.
   */
  private async indexResourcesInState(resources: Resource[]): Promise<void> {
    if (!this.db) return;

    for (const resource of resources) {
      this.resourceCache.set(resource.id, resource);
    }

    if (this.hasEmbeddingsInIndex && (await this.ensureEmbeddings())) {
      // Sequential: each doc needs async embedding call
      for (const resource of resources) {
        try {
          const doc = await this.resourceToDocWithEmbeddings(resource);
          await insert(this.db as OramaInstanceWithEmbeddings, doc);  // ADR-0083 #1
        } catch (e: any) {
          if (e?.code === 'DOCUMENT_ALREADY_EXISTS') {
            await this.updateResource(resource);
          }
          // Ignore other errors - continue indexing
        }
      }
    } else {
      // Batch insert for BM25-only mode (ADR-0079)
      const docs = resources.map(r => projectResourceSearchDocument(r));
      try {
        await insertMultiple(this.db as OramaInstance, docs);  // ADR-0083 #1
      } catch {
        // Fallback to individual inserts if batch fails (e.g. duplicates)
        for (const resource of resources) {
          try {
            await insert(this.db as OramaInstance, projectResourceSearchDocument(resource));  // ADR-0083 #1
          } catch (e: any) {
            if (e?.code === 'DOCUMENT_ALREADY_EXISTS') {
              await this.updateResource(resource);
            }
          }
        }
      }
    }
    this.cache.schedule();
  }

  private async addResourceInState(resource: Resource): Promise<void> {
    if (!this.db) return;
    this.resourceCache.set(resource.id, resource);

    try {
      if (this.hasEmbeddingsInIndex && (await this.ensureEmbeddings())) {
        const doc = await this.resourceToDocWithEmbeddings(resource);
        await insert(this.db as OramaInstanceWithEmbeddings, doc);
      } else {
        await insert(this.db as OramaInstance, projectResourceSearchDocument(resource));
      }
    } catch (e: any) {
      if (e?.code === 'DOCUMENT_ALREADY_EXISTS') {
        await this.updateResource(resource);
        return;
      }
      throw e;
    }
    this.cache.schedule();
  }

  private async removeResourceInState(id: string): Promise<void> {
    if (!this.db) return;
    this.resourceCache.delete(id);
    try {
      await remove(this.db, id);
      this.cache.schedule();
    } catch {
      // Ignore if document doesn't exist
    }
  }

  private async updateResourceInState(resource: Resource): Promise<void> {
    // Pre-initialization no-op (ADR 0116 Phase 1A): see updateDocument.
    if (!this.db) return;
    // ADR-0083 #2: atomic remove → insert (see updateDocument).
    const prev = this.resourceCache.get(resource.id);
    await this.removeResource(resource.id);
    this.resourceCache.set(resource.id, resource);

    try {
      if (this.hasEmbeddingsInIndex && (await this.ensureEmbeddings())) {
        const doc = await this.resourceToDocWithEmbeddings(resource);
        await insert(this.db as OramaInstanceWithEmbeddings, doc);
      } else {
        await insert(this.db as OramaInstance, projectResourceSearchDocument(resource));
      }
    } catch (err) {
      if (prev) {
        this.resourceCache.set(resource.id, prev);
        try { await insert(this.db as OramaInstance, projectResourceSearchDocument(prev)); } catch { /* index unrecoverable for this doc */ }
      } else {
        this.resourceCache.delete(resource.id);
      }
      throw err;
    }
    this.cache.schedule();
  }
}
