/** Orama index lifecycle and retrieval; pure projection/selection have separate owners (ADR 0136). */
import { entityEmbeddingText, resourceEmbeddingText, projectEntitySearchDocument, projectResourceSearchDocument, searchFieldText, type EntityProjectionSource } from './search-document.js';
import { createSearchSelection, matchesSearchSelection, type SearchSelection } from './search-selection.js';
import { isDeepStrictEqual } from 'node:util';
import { create, count, getByID, insert, insertMultiple, remove, search, save, load, type Results } from '@orama/orama';
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
  generateEntitySnippet,
  generateResourceSnippet,
} from './snippets.js';
import {
  type OramaDoc, type OramaDocWithEmbeddings,
  type OramaInstance, type OramaInstanceWithEmbeddings,
  schema, schemaWithEmbeddings,
  INDEX_VERSION, TEXT_PROPERTIES, UNSORTABLE_PROPERTIES, ENUM_FACETS,
  lowerSearchSelection, type OramaWhere,
} from './orama-schema.js';
import { rankNormalize, linearFusion, applyCoordinationBonus, applyTemporalDecay, applyExactTitlePin, type ScoredHit } from './scoring.js';
import {
  parseQueryIntent,
  canonicalizeIdQuery,
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

  // ── Independent retrievers (ADR-0081) ───────────────────────────

  /**
   * BM25 fulltext retriever — runs Orama in default mode (no `mode` param).
   * Returns raw BM25 scores (unbounded, higher = more relevant).
   */
  private async _executeBM25Search(state: ReadySearchIndexState, params: {
    query: string;
    limit: number;
    boost: Record<string, number>;
    where?: OramaWhere;
  }): Promise<Results<OramaDoc | OramaDocWithEmbeddings>> {
    const { query, limit, boost, where } = params;
    return search(state.db, {
      term: query,
      properties: [...TEXT_PROPERTIES],
      limit,
      boost,
      tolerance: 1,
      where,
      facets: ENUM_FACETS,  // ADR-0080: free facet counts
    });
  }

  /**
   * Vector retriever — runs Orama in vector-only mode.
   * Returns similarity scores [0,1]. Returns null if embeddings unavailable.
   */
  private async _executeVectorSearch(state: ReadySearchIndexState, params: {
    query: string;
    limit: number;
    where?: OramaWhere;
  }): Promise<Results<OramaDoc | OramaDocWithEmbeddings> | null> {
    const canUseVector = state.hasEmbeddings && (await this.ensureEmbeddings());
    if (!canUseVector) return null;

    const queryVector = await this.embedText(params.query);
    return search(state.db as OramaInstanceWithEmbeddings, {
      mode: 'vector',
      vector: { value: queryVector, property: 'embeddings' },
      similarity: 0.2,
      limit: params.limit,
      where: params.where,
    });
  }

  /**
   * Run independent retrievers and fuse results via linear combination (ADR-0081).
   *
   * BM25 and vector retrievers run independently. Results are MinMax-normalized
   * per-retriever, then combined: score = 0.7 * norm_bm25 + 0.3 * norm_vector.
   *
   * When embeddings are unavailable, degenerates to pure BM25 ranking.
   * There is deliberately no sort/bypass parameter here: every retrieval
   * flows through the same fusion pipeline. Sorting is a presentation
   * concern applied AFTER retrieval (see searchAll's recent mode) — the
   * old native-sortBy branch silently swapped hybrid retrieval for plain
   * BM25 and shrank the result set (docs/reports/0003 friction log).
   */
  private async _fusedSearch(state: ReadySearchIndexState, params: {
    query: string;
    limit: number;
    boost: Record<string, number>;
    where?: OramaWhere;
  }): Promise<{ hits: Array<{ id: string; score: number }>; bm25Results: Results<OramaDoc | OramaDocWithEmbeddings> }> {
    const { query, limit, boost, where } = params;

    // Over-fetch for better fusion coverage
    const fetchLimit = limit * 2;

    // Run retrievers independently
    const [bm25Results, vectorResults] = await Promise.all([
      this._executeBM25Search(state, { query, limit: fetchLimit, boost, where }),
      this._executeVectorSearch(state, { query, limit: fetchLimit, where }),
    ]);

    // Extract scored hits for fusion
    const bm25Hits: ScoredHit[] = bm25Results.hits.map(h => ({ id: h.document.id, score: h.score }));
    const vectorHits: ScoredHit[] = vectorResults
      ? vectorResults.hits.map(h => ({ id: h.document.id, score: h.score }))
      : [];

    // Rank-normalize each retriever independently, then fuse (ADR-0083 #10:
    // rank normalization replaces MinMax, which mapped the lowest scorer to
    // 0.0 and annihilated relevant-but-low-BM25 documents)
    const fused = linearFusion(rankNormalize(bm25Hits), rankNormalize(vectorHits));

    // Post-fusion temporal decay (ADR-0092.1) — no-op when halfLifeDays is
    // unset, so existing behavior is preserved until callers opt in.
    const decayed = applyTemporalDecay(
      fused,
      id => this._getCreatedAt(state, id),
      { halfLifeDays: this.halfLifeDays },
    );

    // Post-fusion coordination bonus for multi-term queries (ADR-0081)
    const coordinated = applyCoordinationBonus(
      decayed, query,
      id => this._getSearchableText(state, id),
      id => this._getTitle(state, id),
    );

    // Exact/phrase title-match pin (ADR-0083 #8) — final stage, so
    // navigational queries beat decay and coordination noise.
    const pinned = applyExactTitlePin(coordinated, query, id => this._getTitle(state, id));

    return { hits: pinned.slice(0, limit), bm25Results };
  }

  // ── Search methods ──────────────────────────────────────────────

  /**
   * Get searchable text for a document (task or resource) by ID.
   * Used by post-fusion coordination bonus to check term presence.
   */
  private _getSearchableText(state: SearchIndexState, id: string): string {
    const task = state.tasks.get(id);
    if (task) {
      return (state.fields.get(id) ?? [])
        .filter(function isCoordinationField(field) {
          return field.name === 'title'
            || field.name === 'content'
            || field.name === 'evidence';
        })
        .map(function fieldText(field) {
          return searchFieldText(field.value);
        }).join(' ');
    }
    const resource = state.resources.get(id);
    if (resource) {
      return [resource.title, resource.content].join(' ');
    }
    return '';
  }

  private generateEntitySearchSnippet(
    state: SearchIndexState,
    id: string,
    entity: AnyEntity,
    query: string,
  ): SearchSnippet {
    return generateEntitySnippet(
      entity,
      state.fields.get(id) ?? [],
      query,
    );
  }

  /** Get title for a document by ID. Used by coordination bonus for title weighting. */
  private _getTitle(state: SearchIndexState, id: string): string {
    return state.tasks.get(id)?.title || state.resources.get(id)?.title || '';
  }

  /**
   * Reorder an already-retrieved hit list by document recency (sort=recent).
   *
   * Recency is a presentation order over the SAME retrieval set that
   * sort=relevant returns — it must never swap engines or shrink the set
   * (docs/reports/0003 friction log: hybrid 10 results silently became
   * BM25's 2). Documents without an updated_at (resources) sort after all
   * dated documents; ties keep their fused relevance order (stable sort).
   */
  private _reorderByRecency<Hit extends { id: string }>(state: SearchIndexState, hits: Hit[]): Hit[] {
    const updatedAt = (id: string): string => {
      const value = state.tasks.get(id)?.updated_at;
      return typeof value === 'string' ? value : '';
    };
    return [...hits].sort((a, b) => updatedAt(b.id).localeCompare(updatedAt(a.id)));
  }

  /**
   * Get creation timestamp for a document by ID, as epoch ms.
   * Used by post-fusion temporal decay (ADR-0092.1).
   *
   * Resources don't carry ``created_at`` today, and tasks without a
   * ``created_at`` string simply opt out of decay — ``applyTemporalDecay``
   * treats ``undefined`` as "no decay for this doc".
   */
  private _getCreatedAt(state: SearchIndexState, id: string): number | undefined {
    const task = state.tasks.get(id);
    if (!task?.created_at) return undefined;

    // ADR-0092.5 R-3/R-4: memory-substrate decay rules.
    //  - semantic/procedural layers and kind: 'timeless' are EXEMPT from
    //    decay (uniform decay over stable knowledge is a bug — Mem0 and
    //    Hindsight both flag it independently): return undefined → no decay.
    //  - episodic memories decay on occurred_at ?? created_at, so a memory
    //    ABOUT an old event doesn't rank as fresh.
    if ((task.type as string) === 'memory') {
      const mem = task as { layer?: string; kind?: string; occurred_at?: string };
      if (mem.layer === 'semantic' || mem.layer === 'procedural' || mem.kind === 'timeless') {
        return undefined;
      }
      if (mem.occurred_at) {
        const occurred = Date.parse(mem.occurred_at);
        if (!Number.isNaN(occurred)) return occurred;
      }
    }

    const t = Date.parse(task.created_at);
    return Number.isNaN(t) ? undefined : t;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const state = this.readState();
    if (state === undefined || !query.trim()) return [];

    const limit = options?.limit ?? 20;

    // ID-shaped queries short-circuit to a direct cache hit (ADR-0083 #4) —
    // with `id` removed from TEXT_PROPERTIES, this is the canonical ID path
    // for the task-only method, mirroring searchAll()'s intent routing.
    const canonicalId = canonicalizeIdQuery(query, this.idIntentSpecs);
    if (canonicalId) {
      const task = state.tasks.get(canonicalId);
      if (task) return matchesSearchSelection(task, task.type, createSearchSelection(options?.filters, options?.docTypes, { entityOnly: true }))
        ? [{ id: canonicalId, score: 1.0, task }] : [];
      // Cache miss → fall through to fulltext as a fuzzy safety net.
    }

    // ADR-0083 #3: this is the task-only search method — exclude resources
    // natively in the where clause (ADR-0079) instead of JS post-filtering.
    // ADR-0092.3: memories are excluded from generic search by default —
    // backlog_recall is their dedicated read surface.
    const where = lowerSearchSelection(createSearchSelection(options?.filters, options?.docTypes, { entityOnly: true, defaultExcludedTypes: ['memory'] }));

    const { hits } = await this._fusedSearch(state, {
      query,
      limit,
      boost: options?.boost ?? { title: 3 },  // ADR-0083 #4: id boost removed
      where,
    });

    return hits
      .flatMap(function taskHit(hit) {
        const task = state.tasks.get(hit.id);
        return task === undefined ? [] : [{ id: hit.id, score: hit.score, task }];
      });
  }

  /**
   * Search all document types with optional type filtering.
   * Returns results sorted by relevance across all types.
   *
   * This is the canonical search method — both MCP tools and HTTP endpoints
   * should call this (via BacklogService.searchUnified). (ADR-0073)
   *
   * ADR-0081: independent retrievers + linear fusion for every mode.
   * "recent" reorders the fused result list by updated_at — same set and
   * engine as "relevant" (docs/reports/0003 friction-log fix).
   */
  async searchAll(query: string, options?: SearchOptions): Promise<Array<{ id: string; score: number; type: SearchableType; item: AnyEntity | Resource; snippet: SearchSnippet }>> {
    const state = this.readState();
    if (state === undefined || !query.trim()) return [];

    const limit = options?.limit ?? 20;
    const sortMode = options?.sort ?? 'relevant';

    // ── Pre-search intent routing (ADR 0083 #4) ────────────────────
    // Classify the query *before* invoking BM25. ID-shaped queries
    // short-circuit to a direct cache lookup; leading status/type words
    // become native `where` filters so the fusion pipeline doesn't waste
    // BM25 time on tokens that are really filter intent.
    let intent = parseQueryIntent(query, this.idIntentSpecs);

    if (intent.type === 'id_lookup' && intent.id) {
      const hit = this._buildIdLookupHit(state, intent.id, query);
      if (hit) return matchesSearchSelection(hit.item, hit.type, createSearchSelection(options?.filters, options?.docTypes)) ? [hit] : [];
      // Fall through to fulltext if the canonical ID isn't in the cache —
      // the user may have typed a near-miss and the existing fusion
      // pipeline (with tolerance) is the correct fallback.
    }

    // Fail-open type-word guard (structural-suite evidence: ADR 0096's own
    // exact title returned zero results because its leading word became a
    // type:cron filter over a corpus with no crons). A type-word reading
    // that would produce an empty universe cannot be filter intent — the
    // word is content, so the full query runs as fulltext. Only applies
    // when the parsed type would actually govern the result set: caller
    // docTypes or an explicit type filter override intent and keep their
    // exact (fail-closed) semantics.
    if (
      intent.type === 'filtered'
      && intent.filters?.type !== undefined
      && options?.docTypes === undefined
      && options?.filters?.type === undefined
      && !this._hasEntityOfType(state, intent.filters.type)
    ) {
      intent = { type: 'fulltext', query: query.trim() };
    }

    // Merge filters from intent with caller-supplied options.
    // Caller filters take precedence (explicit overrides parsed intent).
    const mergedFilters: SearchOptions['filters'] = {
      ...(intent.type === 'filtered' ? intent.filters : {}),
      ...options?.filters,
    };
    // Caller-supplied docTypes override any type intent we parsed.
    const mergedDocTypes = options?.docTypes;

    const selection = createSearchSelection(mergedFilters, mergedDocTypes, { defaultExcludedTypes: ['memory'] });
    const where = lowerSearchSelection(selection);

    // The query text passed to BM25 is the intent's residual text.
    // For 'filtered' intent with empty residual, we don't run BM25 at all —
    // we list everything matching the where clause from the local caches.
    const bm25Query = intent.query;

    if (intent.type === 'filtered' && !bm25Query.trim()) {
      return this._listMatchingFilters(state, selection, limit);
    }

    const { hits } = await this._fusedSearch(state, {
      query: bm25Query,
      limit,
      boost: options?.boost ?? { title: 3 },  // ADR-0083 #4: id boost removed
      where,
    });

    // Recency reorders the fused result list — same retrieval set and
    // engine as sort=relevant, different presentation order (0003 fix).
    const ordered = sortMode === 'recent' ? this._reorderByRecency(state, hits) : hits;

    return ordered
      .map(h => {
        const task = state.tasks.get(h.id);
        const resource = state.resources.get(h.id);
        const item = task || resource;
        if (!item) return null;
        const isResource = !task;
        const docType = (isResource ? 'resource' : (item as AnyEntity).type || 'task') as SearchableType;
        const snippet = isResource
          ? generateResourceSnippet(item as Resource, bm25Query || query)
          : this.generateEntitySearchSnippet(
            state,
            h.id,
            item as AnyEntity,
            bm25Query || query,
          );
        return { id: h.id, score: h.score, type: docType, item, snippet };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);
  }

  /** Whether any indexed entity carries this substrate type. */
  private _hasEntityOfType(state: SearchIndexState, type: string): boolean {
    for (const task of state.tasks.values()) {
      if ((task.type || 'task') === type) return true;
    }
    return false;
  }

  /**
   * Build a single-result hit for an ID-lookup intent (ADR 0083 #4).
   * Returns null if the canonical ID is not present in either cache so the
   * caller can fall through to fulltext.
   */
  private _buildIdLookupHit(state: SearchIndexState, canonicalId: string, originalQuery: string): { id: string; score: number; type: SearchableType; item: AnyEntity | Resource; snippet: SearchSnippet } | null {
    const task = state.tasks.get(canonicalId);
    if (task) {
      return {
        id: canonicalId,
        score: 1.0,                 // top of the [0,1] linear-fusion range
        type: (task.type || 'task') as SearchableType,
        item: task,
        snippet: this.generateEntitySearchSnippet(
            state,
          canonicalId,
          task,
          originalQuery,
        ),
      };
    }
    const resource = state.resources.get(canonicalId);
    if (resource) {
      return {
        id: canonicalId,
        score: 1.0,
        type: 'resource',
        item: resource,
        snippet: generateResourceSnippet(resource, originalQuery),
      };
    }
    return null;
  }

  /**
   * List entities matching a filter set without running BM25 (ADR 0083 #4).
   * Used when intent parsing decomposes the entire query into filters
   * (e.g. "blocked tasks" → status: blocked, no residual text).
   *
   * Returns matches sorted by `updated_at` desc to give stable, predictable
   * ordering — relevance has no meaning when there is no query term.
   */
  private _listMatchingFilters(
    state: SearchIndexState,
    selection: SearchSelection,
    limit: number,
  ): Array<{ id: string; score: number; type: SearchableType; item: AnyEntity | Resource; snippet: SearchSnippet }> {
    const out: Array<{ id: string; score: number; type: SearchableType; item: AnyEntity | Resource; snippet: SearchSnippet }> = [];

    for (const task of state.tasks.values()) {
      if (!matchesSearchSelection(task, task.type, selection)) continue;
      out.push({
        id: task.id,
        score: 1.0,
        type: ((task.type || 'task') as SearchableType),
        item: task,
        snippet: this.generateEntitySearchSnippet(state, task.id, task, ''),
      });
    }

    // Resources have no substrate type or parent to filter, but they may
    // declare a frontmatter status (BUG-0003) — a status filter keeps the
    // resources whose declared status token matches, fail-closed otherwise.
    for (const resource of state.resources.values()) {
      if (!matchesSearchSelection(resource, 'resource', selection)) continue;
      out.push({
        id: resource.id,
        score: 1.0,
        type: 'resource',
        item: resource,
        snippet: generateResourceSnippet(resource, ''),
      });
    }

    // Sort: most-recently-updated first, then by id for stability.
    out.sort((a, b) => {
      const ua = (a.item as AnyEntity).updated_at;
      const ub = (b.item as AnyEntity).updated_at;
      const leftUpdated = typeof ua === 'string' ? ua : '';
      const rightUpdated = typeof ub === 'string' ? ub : '';
      if (leftUpdated !== rightUpdated) {
        return rightUpdated.localeCompare(leftUpdated);
      }
      return a.id.localeCompare(b.id);
    });

    return out.slice(0, limit);
  }

  /**
   * Search for resources only.
   */
  async searchResources(query: string, options?: { limit?: number }): Promise<ResourceSearchResult[]> {
    const state = this.readState();
    if (state === undefined || !query.trim()) return [];

    const limit = options?.limit ?? 20;
    const { hits } = await this._fusedSearch(state, {
      query,
      limit,
      boost: { title: 2, content: 1 },
      where: { type: { eq: 'resource' } },
    });

    return hits
      .flatMap(function resourceHit(hit) {
        const resource = state.resources.get(hit.id);
        return resource === undefined ? [] : [{ id: hit.id, score: hit.score, resource }];
      });
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
