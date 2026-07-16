/**
 * Golden Recall Benchmark (ADR 0115 R-2 — the suite ADR 0092.3 promised:
 * "recall works properly" as a contract with tests, not a hope).
 *
 * Mirrors search-golden.test.ts: a fixed memory corpus recalled through the
 * REAL chain — OramaSearchService (hybrid ranking) → BacklogMemoryStore
 * (filters + usage multiplier) → MemoryComposer → core/recall (stubs).
 * When recall behavior changes, these tests reveal the impact; a failure
 * prompts "regression or improvement?", not blind fixing.
 *
 * Fixture dates are RELATIVE to the real clock at build time — never freeze
 * a fixture clock while production reads Date.now() (the ADR 0115 R-3 bug).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import { MemoryComposer } from '@backlog-mcp/memory';
import type { Entity, Memory } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { BacklogMemoryStore } from '../memory/backlog-memory-store.js';
import { recall } from '../core/recall.js';
import { searchDocuments } from './helpers/search-document.js';

const TEST_CACHE_PATH = join(process.cwd(), 'test-data', '.cache', 'recall-golden.json');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function makeMemory(overrides: Partial<Memory> & { id: string; title: string; content: string }): Memory {
  return {
    type: 'memory',
    layer: 'semantic',
    usage_count: 0,
    created_at: daysAgo(30),
    updated_at: daysAgo(30),
    ...overrides,
  } as Memory;
}

/**
 * Golden memory corpus — realistic knowledge with deliberate contrasts:
 * used vs unused, young vs aged, live vs expired, correction lineage.
 */
const GOLDEN_MEMORIES: Memory[] = [
  // Deploy cluster: the correction survives, its predecessor is expired.
  makeMemory({
    id: 'MEMO-0001', layer: 'procedural', title: 'Deploy procedure',
    content: 'Release = typecheck → test → tag → npm publish via CI trusted publishing.',
    created_at: daysAgo(60), updated_at: daysAgo(60),
    usage_count: 6, last_used_at: daysAgo(2), supersedes: 'MEMO-0002',
  }),
  makeMemory({
    id: 'MEMO-0002', layer: 'procedural', title: 'Old deploy procedure',
    content: 'Release = manual npm publish from a maintainer laptop.',
    created_at: daysAgo(120), updated_at: daysAgo(60), valid_until: daysAgo(60),
  }),
  // Usage-reordering cluster: equally relevant, only usage differs (both aged past grace).
  makeMemory({
    id: 'MEMO-0003', title: 'Shiki bundle imports (fine-grained, A)',
    content: 'Shiki bundle imports must be fine-grained — variant A.',
    created_at: daysAgo(40), updated_at: daysAgo(40),
    usage_count: 5, last_used_at: daysAgo(2),
  }),
  makeMemory({
    id: 'MEMO-0004', title: 'Shiki bundle imports (fine-grained, B)',
    content: 'Shiki bundle imports must be fine-grained — variant B.',
    created_at: daysAgo(40), updated_at: daysAgo(40),
  }),
  // Grace cluster: both unused, only age differs — youth is neutral, aged-unused sinks.
  makeMemory({
    id: 'MEMO-0005', title: 'Vitest memfs discipline (new)',
    content: 'Vitest memfs discipline: mock node:fs globally — variant new.',
    created_at: daysAgo(3), updated_at: daysAgo(3),
  }),
  makeMemory({
    id: 'MEMO-0006', title: 'Vitest memfs discipline (old)',
    content: 'Vitest memfs discipline: mock node:fs globally — variant old.',
    created_at: daysAgo(50), updated_at: daysAgo(50),
  }),
  // Episodic cluster: a live completion and an expired investigation.
  makeMemory({
    id: 'MEMO-0007', layer: 'episodic', title: 'Fixed OOM in worker build',
    content: 'Fixed OOM in worker build by splitting tsc declarations from bundling.',
    created_at: daysAgo(20), updated_at: daysAgo(20),
    tags: ['completion'], entity_refs: ['TASK-0588'], parent_id: 'FLDR-0001',
  }),
  makeMemory({
    id: 'MEMO-0008', layer: 'episodic', title: 'OOM investigation notes',
    content: 'OOM in worker build: suspecting tsdown declaration pass.',
    created_at: daysAgo(25), updated_at: daysAgo(21), valid_until: daysAgo(21),
  }),
  // Scoping cluster: same topic as MEMO-0001, different context + tag.
  makeMemory({
    id: 'MEMO-0009', layer: 'procedural', title: 'Viewer deploy quirk',
    content: 'Deploy of the viewer requires copying dist into the server package first.',
    created_at: daysAgo(15), updated_at: daysAgo(15),
    tags: ['deploy'], parent_id: 'FLDR-0002',
  }),
];

describe('Recall Golden Benchmark', () => {
  let composer: MemoryComposer;

  beforeAll(async () => {
    const search = new OramaSearchService({ cachePath: TEST_CACHE_PATH });
    await search.index(searchDocuments(GOLDEN_MEMORIES as Entity[]));

    // Minimal service: recall's read path only touches searchUnified.
    const service = {
      searchUnified: async (query: string, options?: { types?: string[]; limit?: number }) => {
        const results = await search.searchAll(query, {
          docTypes: options?.types as never,
          limit: options?.limit ?? 20,
        });
        return results.map(r => ({ item: r.item, score: r.score, type: r.type }));
      },
    } as unknown as IBacklogService;

    const store = new BacklogMemoryStore(() => service);
    composer = new MemoryComposer();
    composer.register('episodic', store);
    composer.register('semantic', store);
    composer.register('procedural', store);
  });

  const topIds = async (query: string, params: Record<string, unknown> = {}) => {
    const result = await recall({ query, ...params }, { memoryComposer: composer });
    return result.items.map(i => i.id);
  };

  it('topical recall: "how do we deploy" surfaces the deploy procedure in the top results', async () => {
    // Containment, not an exact rank pin — exact ordering churns under
    // ranking work (0116); the contract is "surfaced prominently".
    const ids = await topIds('how do we deploy a release');
    expect(ids.slice(0, 3)).toContain('MEMO-0001');
  });

  it('expired and superseded memories never surface; the correction carries lineage', async () => {
    const result = await recall({ query: 'deploy release publish' }, { memoryComposer: composer });
    const ids = result.items.map(i => i.id);
    expect(ids).not.toContain('MEMO-0002');   // superseded → expired
    expect(ids).not.toContain('MEMO-0008');   // plain expired
    const winner = result.items.find(i => i.id === 'MEMO-0001');
    expect(winner?.supersedes).toBe('MEMO-0002');
  });

  it('layer filtering: episodic-only excludes semantic/procedural and vice versa', async () => {
    const episodic = await topIds('OOM worker build', { layers: ['episodic'] });
    expect(episodic).toContain('MEMO-0007');
    expect(episodic.every(id => id === 'MEMO-0007')).toBe(true);

    const procedural = await topIds('OOM worker build', { layers: ['procedural'] });
    expect(procedural).not.toContain('MEMO-0007');
  });

  it('usage reordering: past grace, an earned memory outranks its unused twin (ADR 0092.9 R-15)', async () => {
    const ids = await topIds('shiki bundle imports fine-grained');
    const used = ids.indexOf('MEMO-0003');
    const unused = ids.indexOf('MEMO-0004');
    expect(used).toBeGreaterThanOrEqual(0);
    expect(unused).toBeGreaterThanOrEqual(0);
    expect(used).toBeLessThan(unused);
  });

  it('grace period: a young unused memory is not penalized against an aged unused twin', async () => {
    const ids = await topIds('vitest memfs discipline');
    const young = ids.indexOf('MEMO-0005');   // 3d — inside 14d grace, factor 1.0
    const aged = ids.indexOf('MEMO-0006');    // 50d unused — floor 0.3
    expect(young).toBeGreaterThanOrEqual(0);
    expect(aged).toBeGreaterThanOrEqual(0);
    expect(young).toBeLessThan(aged);
  });

  it('context scoping filters to memories captured under that entity', async () => {
    const ids = await topIds('deploy', { context: 'FLDR-0002' });
    expect(ids).toEqual(['MEMO-0009']);
  });

  it('tag filtering behaves as documented', async () => {
    const ids = await topIds('deploy', { tags: ['deploy'] });
    expect(ids).toEqual(['MEMO-0009']);
  });

  it('stubs are provenance-bearing and bodies appear only under full:true (ADR 0115 R-1)', async () => {
    const stubs = await recall({ query: 'deploy release' }, { memoryComposer: composer });
    for (const item of stubs.items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(typeof item.age_days).toBe('number');
      expect(typeof item.uses).toBe('number');
      expect(item.content).toBeUndefined();
    }
    const winner = stubs.items.find(i => i.id === 'MEMO-0001');
    expect(winner?.uses).toBe(6);
    expect(winner?.idle_days).toBe(2);
    expect(winner?.age_days).toBe(60);

    const full = await recall({ query: 'deploy release', full: true }, { memoryComposer: composer });
    const fullWinner = full.items.find(i => i.id === 'MEMO-0001');
    expect(fullWinner?.content).toContain('typecheck');
  });
});
