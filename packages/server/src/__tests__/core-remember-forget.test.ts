/**
 * Tests for core/remember and core/forget (ADR 0092.3 Phase C).
 *
 * Validation behavior (ADR 0092.5 R-7: strict ISO dates, inverted-interval
 * rejection, id-shape checks) is tested against an InMemoryStore composer —
 * core semantics are store-agnostic. Closing semantics (supersedes /
 * state_key, R-1/R-2) are store behavior and live in
 * memory-store-contract.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryComposer, InMemoryStore } from '@backlog-mcp/memory';
import { remember } from '../core/remember.js';
import { forget } from '../core/forget.js';
import { ValidationError } from '../core/types.js';

describe('core/remember', () => {
  let composer: MemoryComposer;
  let store: InMemoryStore;

  beforeEach(() => {
    composer = new MemoryComposer();
    store = new InMemoryStore();
    composer.register('semantic', store);
    composer.register('procedural', store);
    composer.register('episodic', store);
  });

  it('stores with default layer semantic and returns the stored id', async () => {
    const result = await remember(
      { content: 'This repo deploys via wrangler', title: 'Deploy via wrangler' },
      { memoryComposer: composer, actorName: 'claude' },
    );
    expect(result.layer).toBe('semantic');
    expect(result.id).toBeTruthy();
    expect(await store.size()).toBe(1);
  });

  it('respects an explicit layer and passes source through', async () => {
    await remember(
      { content: 'Release = typecheck → test → tag → publish', title: 'Release steps', layer: 'procedural', source: 'goga' },
      { memoryComposer: composer },
    );
    const recalled = await store.recall({ query: 'release publish' });
    expect(recalled[0]?.entry.layer).toBe('procedural');
    expect(recalled[0]?.entry.source).toBe('goga');
  });

  it('carries kind/state_key/occurred_at/entity_refs in metadata', async () => {
    await remember(
      {
        content: 'Bundler is tsdown',
        title: 'Bundler is tsdown',
        kind: 'current',
        state_key: 'build.bundler',
        occurred_at: '2026-06-01',
        entity_refs: ['TASK-0629'],
      },
      { memoryComposer: composer },
    );
    const recalled = await store.recall({ query: 'bundler' });
    const meta = recalled[0]?.entry.metadata ?? {};
    expect(meta.memory_kind).toBe('current');
    expect(meta.state_key).toBe('build.bundler');
    expect(meta.occurred_at).toBe('2026-06-01');
    expect(meta.entity_refs).toEqual(['TASK-0629']);
  });

  it('returns scanned-clean advisory candidates after committing the memory', async () => {
    const finder = vi.fn(async function findCandidates() { return []; });
    const result = await remember(
      { content: 'Production deploys locally', title: 'Production deployment' },
      { memoryComposer: composer, findCollisionCandidates: finder },
    );
    expect(await store.size()).toBe(1);
    expect(finder).toHaveBeenCalledWith(result.id);
    expect(result.collision_candidates).toEqual([]);
  });

  it('returns advisory collision candidates after committing the memory', async () => {
    const candidates = [{
      id: 'MEMO-0002', title: 'Conflicting deployment', digest: 'Production uses a VPS.',
      pair_priority: 0.9,
      signals: { neighbor_rank: 1, lexical_overlap: 0.5, scope: 1, epistemic_shape: 1 },
    }];
    const result = await remember(
      { content: 'Production deploys locally', title: 'Production deployment' },
      { memoryComposer: composer, findCollisionCandidates: async function findCandidates() { return candidates; } },
    );
    expect(await store.size()).toBe(1);
    expect(result.collision_candidates).toEqual(candidates);
  });

  it('keeps the durable write successful when its advisory scan fails', async () => {
    const result = await remember(
      { content: 'Production deploys locally', title: 'Production deployment' },
      {
        memoryComposer: composer,
        findCollisionCandidates: async function failScan() {
          throw new Error('search unavailable');
        },
      },
    );
    expect(await store.size()).toBe(1);
    expect(result).not.toHaveProperty('collision_candidates');
  });

  it('rejects empty content', async () => {
    await expect(remember({ content: '   ', title: 't' }, { memoryComposer: composer })).rejects.toThrow(ValidationError);
  });

  it('rejects empty title', async () => {
    await expect(remember({ content: 'x', title: '   ' }, { memoryComposer: composer })).rejects.toThrow(/title is required/);
  });

  it('rejects when no composer is configured', async () => {
    await expect(remember({ content: 'x', title: 't' }, {})).rejects.toThrow(/no memory store/i);
  });

  it('rejects malformed context and entity_refs ids', async () => {
    await expect(remember({ content: 'x', title: 't', context: 'not-an-id' }, { memoryComposer: composer }))
      .rejects.toThrow(/context/);
    await expect(remember({ content: 'x', title: 't', entity_refs: ['TASK-1', 'bogus'] }, { memoryComposer: composer }))
      .rejects.toThrow(/entity_refs/);
  });

  it('rejects supersedes that is not a MEMO- id', async () => {
    await expect(remember({ content: 'x', title: 't', supersedes: 'TASK-0001' }, { memoryComposer: composer }))
      .rejects.toThrow(/MEMO-/);
  });

  it('rejects non-ISO dates with explicit errors (R-7)', async () => {
    await expect(remember({ content: 'x', title: 't', occurred_at: 'March 2026' }, { memoryComposer: composer }))
      .rejects.toThrow(/occurred_at must be an ISO/);
    await expect(remember({ content: 'x', title: 't', valid_until: 'next week' }, { memoryComposer: composer }))
      .rejects.toThrow(/valid_until must be an ISO/);
  });

  it('rejects inverted validity intervals (R-7: silently-invisible facts)', async () => {
    await expect(remember(
      { content: 'x', title: 't', occurred_at: '2026-06-10', valid_until: '2026-06-01' },
      { memoryComposer: composer },
    )).rejects.toThrow(/must be after/);
  });
});

describe('core/forget', () => {
  let composer: MemoryComposer;
  let store: InMemoryStore;

  beforeEach(async () => {
    composer = new MemoryComposer();
    store = new InMemoryStore();
    composer.register('episodic', store);
    await store.store({ id: 'MEMO-0001', layer: 'episodic', content: 'alpha', source: 's', createdAt: 1_000 });
    await store.store({ id: 'MEMO-0002', layer: 'episodic', content: 'beta', source: 's', createdAt: 2_000 });
  });

  it('requires at least one criterion', async () => {
    await expect(forget({}, { memoryComposer: composer })).rejects.toThrow(/at least one criterion/);
  });

  it('forgets by ids and reports the count', async () => {
    const result = await forget({ ids: ['MEMO-0001'] }, { memoryComposer: composer });
    expect(result.forgotten).toBe(1);
    expect(await store.size()).toBe(1);
  });

  it('rejects non-MEMO ids', async () => {
    await expect(forget({ ids: ['TASK-0001'] }, { memoryComposer: composer })).rejects.toThrow(/MEMO-/);
  });

  it('parses older_than as ISO and rejects garbage', async () => {
    const result = await forget({ older_than: '1970-01-01T00:00:01.500Z' }, { memoryComposer: composer });
    expect(result.forgotten).toBe(1);  // MEMO-0001 (createdAt 1000ms) only
    await expect(forget({ older_than: 'yesterday' }, { memoryComposer: composer }))
      .rejects.toThrow(/older_than must be an ISO/);
  });

  it('returns zero without a composer instead of failing', async () => {
    const result = await forget({ ids: ['MEMO-0001'] }, {});
    expect(result.forgotten).toBe(0);
  });
});
