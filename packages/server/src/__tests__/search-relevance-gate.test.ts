import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EntityType, parseEntityNum, type Entity } from '@backlog-mcp/shared';
import {
  OramaSearchService,
  evaluateQuery,
  summarizeEvaluations,
  type EvaluationSummary,
  type QueryEvaluation,
} from '@backlog-mcp/memory/search';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { BacklogMemoryStore } from '../memory/backlog-memory-store.js';
import {
  SEARCH_RELEVANCE_ENTITIES,
  SEARCH_RELEVANCE_FIXTURE_NOW,
  SEARCH_RELEVANCE_FIXTURE_VERSION,
  SEARCH_RELEVANCE_QUERIES,
  type JudgedRecallQuery,
  type JudgedRelevanceQuery,
  type JudgedSearchQuery,
  type RelevanceQueryClass,
} from './fixtures/search-relevance-v1.js';

vi.mock('@huggingface/transformers', () => {
  const dimensions = 384;
  const topicGroups = [
    ['authentication', 'oauth', 'login', 'credentials', 'account'],
    ['deployment', 'delivery', 'shipping', 'publish', 'release', 'staging', 'production'],
    ['database', 'persistence', 'query', 'queries', 'slow', 'sluggish', 'latency'],
    ['rerank', 'reranker', 'scorer', 'scoring', 'relevance', 'cross', 'encoder'],
    ['chunk', 'chunks', 'split', 'sections', 'heading', 'markdown', 'tail'],
    ['embedding', 'embeddings', 'semantic', 'meaning', 'vector'],
    ['fixture', 'evaluation', 'benchmark', 'judged', 'judgment', 'metrics', 'qrels'],
    ['watcher', 'reconcile', 'reconciliation', 'docs', 'native', 'home'],
  ];

  function tokenize(text: string): string[] {
    return text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function tokenDimension(token: string): number {
    let hash = 2166136261;
    for (const char of token) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash) % 320;
  }

  function embed(text: string): Float32Array {
    const vector = new Float32Array(dimensions);
    const tokens = new Set(tokenize(text));
    for (const token of tokens) vector[tokenDimension(token)] += 1;

    topicGroups.forEach((group, index) => {
      if (group.some(token => tokens.has(token))) vector[320 + index] = 4;
    });

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0) return vector;
    return vector.map(value => value / norm);
  }

  return {
    pipeline: async () => async (text: string) => ({ data: embed(text) }),
  };
});

const CACHE_PATH = join(tmpdir(), 'backlog-mcp-search-relevance-v1.json');
const EXPECTED_CLASSES: RelevanceQueryClass[] = [
  'navigation',
  'exact-title',
  'lexical',
  'compound',
  'filtered',
  'aboutness',
  'tail',
  'memory-recall',
];

const QUALITY_FLOORS = {
  overall: {
    ndcgAt10: 0.93,
    reciprocalRank: 0.96,
    successAt1: 0.95,
    recallAt20: 0.96,
  },
  ndcgAt10ByClass: {
    navigation: 0.97,
    'exact-title': 0.93,
    lexical: 0.95,
    compound: 0.88,
    filtered: 0.78,
    aboutness: 0.97,
    tail: 0.98,
    'memory-recall': 0.98,
  },
  recallAt20ByClass: {
    navigation: 0.98,
    'exact-title': 0.98,
    lexical: 0.98,
    compound: 0.98,
    filtered: 0.88,
    aboutness: 0.98,
    tail: 0.98,
    'memory-recall': 0.98,
  },
} as const;

interface EvaluatedQuery {
  fixture: JudgedRelevanceQuery;
  rankedIds: string[];
  metrics: QueryEvaluation;
}

interface SearchRequest {
  query: string;
  options?: Parameters<IBacklogService['searchUnified']>[1];
}

/**
 * Static service adapter that exercises the production Orama search engine
 * through the same `IBacklogService.searchUnified` seam recall consumes.
 */
class FixtureBacklogService implements IBacklogService {
  readonly searchRequests: SearchRequest[] = [];
  private readonly entities = new Map(SEARCH_RELEVANCE_ENTITIES.map(entity => [entity.id, entity]));
  private readonly search = new OramaSearchService({
    cachePath: CACHE_PATH,
    hybridSearch: true,
    halfLifeDays: 30,
  });

  async initialize(): Promise<void> {
    await this.search.index([...this.entities.values()]);
  }

  isHybridActive(): boolean {
    return this.search.isHybridSearchActive();
  }

  async get(id: string): Promise<Entity | undefined> {
    return this.entities.get(id);
  }

  async getMarkdown(): Promise<string | null> {
    return null;
  }

  async list(filter?: Parameters<IBacklogService['list']>[0]): Promise<Entity[]> {
    let entities = [...this.entities.values()];
    if (filter?.type) entities = entities.filter(entity => entity.type === filter.type);
    if (filter?.parent_id) entities = entities.filter(entity => entity.parent_id === filter.parent_id);
    if (filter?.status) entities = entities.filter(entity => entity.status && filter.status?.includes(entity.status));
    return entities;
  }

  async add(entity: Entity): Promise<void> {
    this.entities.set(entity.id, entity);
    await this.search.addDocument(entity);
  }

  async save(entity: Entity): Promise<void> {
    this.entities.set(entity.id, entity);
    await this.search.updateDocument(entity);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = this.entities.delete(id);
    if (deleted) await this.search.removeDocument(id);
    return deleted;
  }

  async counts(): Promise<{
    total_tasks: number;
    total_epics: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
  }> {
    return {
      total_tasks: [...this.entities.values()].filter(entity => entity.type === 'task').length,
      total_epics: [...this.entities.values()].filter(entity => entity.type === 'epic').length,
      by_status: {},
      by_type: {},
    };
  }

  async getMaxId(type?: EntityType): Promise<number> {
    return [...this.entities.values()]
      .filter(entity => type === undefined || entity.type === type)
      .reduce((max, entity) => Math.max(max, parseEntityNum(entity.id) ?? 0), 0);
  }

  async searchUnified(
    query: string,
    options?: Parameters<IBacklogService['searchUnified']>[1],
  ) {
    this.searchRequests.push({ query, options });
    const results = await this.search.searchAll(query, {
      docTypes: options?.types,
      limit: options?.limit ?? 20,
      sort: options?.sort === 'recent' ? 'recent' : 'relevant',
      filters: {
        status: options?.status,
        parent_id: options?.parent_id,
      },
    });
    return results.map(result => ({
      item: result.item,
      score: result.score,
      type: result.type,
      snippet: result.snippet,
    }));
  }
}

function summarizeByClass(evaluated: readonly EvaluatedQuery[]): Record<RelevanceQueryClass, EvaluationSummary> {
  return Object.fromEntries(EXPECTED_CLASSES.map(queryClass => [
    queryClass,
    summarizeEvaluations(
      evaluated
        .filter(result => result.fixture.class === queryClass)
        .map(result => result.metrics),
    ),
  ])) as Record<RelevanceQueryClass, EvaluationSummary>;
}

function relevantHitInTop(
  evaluated: EvaluatedQuery,
  cutoff: number,
): boolean {
  const relevantIds = new Set(
    evaluated.fixture.judgments
      .filter(judgment => judgment.grade >= 2)
      .map(judgment => judgment.id),
  );
  return evaluated.rankedIds.slice(0, cutoff).some(id => relevantIds.has(id));
}

describe('ADR 0116 judged relevance gate', () => {
  let service: FixtureBacklogService;
  let memoryStore: BacklogMemoryStore;
  let evaluated: EvaluatedQuery[];

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(SEARCH_RELEVANCE_FIXTURE_NOW));

    service = new FixtureBacklogService();
    await service.initialize();
    memoryStore = new BacklogMemoryStore(() => service);

    async function retrieve(fixture: JudgedRelevanceQuery): Promise<string[]> {
      if (fixture.surface === 'recall') {
        const recallFixture: JudgedRecallQuery = fixture;
        const results = await memoryStore.recall({
          query: recallFixture.query,
          limit: recallFixture.options?.limit ?? 20,
          layers: recallFixture.options?.layers,
          context: recallFixture.options?.context,
          tags: recallFixture.options?.tags,
        });
        return results.map(result => result.entry.id);
      }

      const searchFixture: JudgedSearchQuery = fixture;
      const results = await service.searchUnified(searchFixture.query, {
        types: searchFixture.options?.types,
        status: searchFixture.options?.status,
        parent_id: searchFixture.options?.parent_id,
        limit: searchFixture.options?.limit ?? 20,
      });
      return results.map(result => result.item.id);
    }

    evaluated = [];
    for (const fixture of SEARCH_RELEVANCE_QUERIES) {
      const rankedIds = await retrieve(fixture);
      const repeatedIds = await retrieve(fixture);
      expect(repeatedIds, `non-deterministic ranking for ${fixture.id}`).toEqual(rankedIds);
      evaluated.push({
        fixture,
        rankedIds,
        metrics: evaluateQuery(rankedIds, fixture.judgments),
      });
    }
  }, 30_000);

  afterAll(() => {
    vi.useRealTimers();
  });

  it('keeps the versioned fixture complete and reviewable', () => {
    expect(SEARCH_RELEVANCE_FIXTURE_VERSION).toBe(1);
    expect(SEARCH_RELEVANCE_QUERIES).toHaveLength(40);
    expect(new Set(SEARCH_RELEVANCE_QUERIES.map(query => query.id)).size).toBe(40);

    const entityIds = new Set(SEARCH_RELEVANCE_ENTITIES.map(entity => entity.id));
    for (const queryClass of EXPECTED_CLASSES) {
      expect(
        SEARCH_RELEVANCE_QUERIES.filter(query => query.class === queryClass),
        `${queryClass} fixture count`,
      ).toHaveLength(5);
    }
    for (const fixture of SEARCH_RELEVANCE_QUERIES) {
      expect(fixture.judgments.some(judgment => judgment.grade >= 2), fixture.id).toBe(true);
      for (const judgment of fixture.judgments) {
        expect(entityIds.has(judgment.id), `${fixture.id} judgment ${judgment.id}`).toBe(true);
      }
    }
  });

  it('runs the full hybrid ranking path without network or model state', () => {
    expect(service.isHybridActive()).toBe(true);
  });

  it('exercises recall over-fetch and JavaScript post-filters on the real path', () => {
    const recallRequests = service.searchRequests.filter(request => request.options?.types?.includes('memory'));
    expect(recallRequests).toHaveLength(10);
    for (const request of recallRequests) {
      expect(request.options?.limit).toBe(60);
    }

    const superseded = evaluated.find(result => result.fixture.id === 'recall-01');
    const wrongContext = evaluated.find(result => result.fixture.id === 'recall-04');
    expect(superseded?.rankedIds).not.toContain('MEMO-0008');
    expect(wrongContext?.rankedIds).not.toContain('MEMO-0009');
  });

  it('keeps every judged information need represented in the top ten', () => {
    for (const result of evaluated) {
      expect(relevantHitInTop(result, 10), result.fixture.id).toBe(true);
    }
  });

  it('preserves navigational and memory-recall success at rank one', () => {
    const critical = evaluated.filter(result => (
      result.fixture.class === 'navigation' ||
      result.fixture.class === 'memory-recall'
    ));
    for (const result of critical) {
      expect(result.metrics.successAt1, result.fixture.id).toBe(1);
    }
  });

  it('meets the frozen Phase 0 aggregate quality floors', () => {
    const overall = summarizeEvaluations(evaluated.map(result => result.metrics));
    const byClass = summarizeByClass(evaluated);

    expect(overall.queryCount).toBe(40);
    expect(overall.ndcgAt10).toBeGreaterThanOrEqual(QUALITY_FLOORS.overall.ndcgAt10);
    expect(overall.reciprocalRank).toBeGreaterThanOrEqual(QUALITY_FLOORS.overall.reciprocalRank);
    expect(overall.successAt1).toBeGreaterThanOrEqual(QUALITY_FLOORS.overall.successAt1);
    expect(overall.recallAt20).toBeGreaterThanOrEqual(QUALITY_FLOORS.overall.recallAt20);

    for (const queryClass of EXPECTED_CLASSES) {
      expect(byClass[queryClass].ndcgAt10, `${queryClass} nDCG@10`)
        .toBeGreaterThanOrEqual(QUALITY_FLOORS.ndcgAt10ByClass[queryClass]);
      expect(byClass[queryClass].recallAt20, `${queryClass} Recall@20`)
        .toBeGreaterThanOrEqual(QUALITY_FLOORS.recallAt20ByClass[queryClass]);
    }
  });
});
