/** Query intent, Orama retrieval/fusion and presentation over one captured index view. */
import { search, type Results } from '@orama/orama';
import type { AnyEntity } from '@backlog-mcp/shared';
import type {
  Resource, ResourceSearchResult, SearchEntityField, SearchOptions,
  SearchResult, SearchSnippet, SearchableType,
} from './types.js';
import { searchFieldText } from './search-document.js';
import { createSearchSelection, matchesSearchSelection, type SearchSelection } from './search-selection.js';
import { generateEntitySnippet, generateResourceSnippet } from './snippets.js';
import {
  type OramaDoc, type OramaDocWithEmbeddings, type OramaInstance,
  type OramaInstanceWithEmbeddings, TEXT_PROPERTIES, ENUM_FACETS,
  lowerSearchSelection, type OramaWhere,
} from './orama-schema.js';
import {
  rankNormalize, linearFusion, applyCoordinationBonus, applyTemporalDecay,
  applyExactTitlePin, type ScoredHit,
} from './scoring.js';
import { parseQueryIntent, canonicalizeIdQuery, type IdIntentSpec } from './query-intent.js';

/** Maps belong to the captured generation; incremental mutation semantics stay unchanged. */
export interface SearchQueryState {
  db: OramaInstance | OramaInstanceWithEmbeddings;
  tasks: ReadonlyMap<string, AnyEntity>;
  fields: ReadonlyMap<string, readonly SearchEntityField[]>;
  resources: ReadonlyMap<string, Resource>;
  hasEmbeddings: boolean;
}

export class OramaQueryReader {
  constructor(
    private readonly state: SearchQueryState,
    private readonly embedQuery: (query: string) => Promise<number[] | null>,
    private readonly idIntentSpecs: readonly IdIntentSpec[],
    private readonly halfLifeDays: number | undefined,
    private readonly now: number,
  ) {}

  // ── Independent retrievers (ADR-0081) ───────────────────────────

  /**
   * BM25 fulltext retriever — runs Orama in default mode (no `mode` param).
   * Returns raw BM25 scores (unbounded, higher = more relevant).
   */
  private async _executeBM25Search(state: SearchQueryState, params: {
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
  private async _executeVectorSearch(state: SearchQueryState, params: {
    query: string;
    limit: number;
    where?: OramaWhere;
  }): Promise<Results<OramaDoc | OramaDocWithEmbeddings> | null> {
    if (!state.hasEmbeddings) return null;
    const queryVector = await this.embedQuery(params.query);
    if (queryVector === null) return null;
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
   * BM25 and vector retrievers run independently. Results are rank-normalized
   * per-retriever, then combined: score = 0.7 * norm_bm25 + 0.3 * norm_vector.
   *
   * When embeddings are unavailable, degenerates to pure BM25 ranking.
   * There is deliberately no sort/bypass parameter here: every retrieval
   * flows through the same fusion pipeline. Sorting is a presentation
   * concern applied AFTER retrieval (see searchAll's recent mode) — the
   * old native-sortBy branch silently swapped hybrid retrieval for plain
   * BM25 and shrank the result set (docs/reports/0003 friction log).
   */
  private async _fusedSearch(state: SearchQueryState, params: {
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
      { halfLifeDays: this.halfLifeDays, now: this.now },
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
  private _getSearchableText(state: SearchQueryState, id: string): string {
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
    state: SearchQueryState,
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
  private _getTitle(state: SearchQueryState, id: string): string {
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
  private _reorderByRecency<Hit extends { id: string }>(state: SearchQueryState, hits: Hit[]): Hit[] {
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
  private _getCreatedAt(state: SearchQueryState, id: string): number | undefined {
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
    const state = this.state;
    if (!query.trim()) return [];

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
    const state = this.state;
    if (!query.trim()) return [];

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
  private _hasEntityOfType(state: SearchQueryState, type: string): boolean {
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
  private _buildIdLookupHit(state: SearchQueryState, canonicalId: string, originalQuery: string): { id: string; score: number; type: SearchableType; item: AnyEntity | Resource; snippet: SearchSnippet } | null {
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
    state: SearchQueryState,
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
    const state = this.state;
    if (!query.trim()) return [];

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

}
