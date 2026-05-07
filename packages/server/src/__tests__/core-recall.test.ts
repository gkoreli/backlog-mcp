/**
 * Tests for core/recall (ADR 0092.2 Phase 3b).
 *
 * Verifies the composer-backed recall contract: layer filtering,
 * context filtering, empty behavior when no composer wired, and the
 * shape of RecallItem (metadata surfaced as top-level convenience
 * fields like entity_id, kind).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryComposer, InMemoryStore } from '@backlog-mcp/memory';
import { recall } from '../core/recall.js';
import { ValidationError } from '../core/types.js';

function composerWith(store: InMemoryStore): MemoryComposer {
  const c = new MemoryComposer();
  c.register('episodic', store);
  return c;
}

describe('core/recall', () => {
  let store: InMemoryStore;
  let composer: MemoryComposer;

  beforeEach(() => {
    store = new InMemoryStore();
    composer = composerWith(store);
  });

  it('returns empty when no composer is wired', async () => {
    const result = await recall({ query: 'anything' }, {});
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.query).toBe('anything');
  });

  it('rejects an empty query with ValidationError', async () => {
    await expect(recall({ query: '' }, { memoryComposer: composer })).rejects.toThrow(ValidationError);
    await expect(recall({ query: '   ' }, { memoryComposer: composer })).rejects.toThrow(/query is required/);
  });

  it('returns matching episodic memories', async () => {
    await store.store({
      id: 'mem-TASK-0001-1',
      layer: 'episodic',
      content: 'Fix auth bug — added JWT middleware',
      source: 'goga',
      createdAt: 1_700_000_000_000,
      metadata: { entity_id: 'TASK-0001', kind: 'completion' },
    });

    const result = await recall({ query: 'auth' }, { memoryComposer: composer });
    expect(result.total).toBe(1);
    const item = result.items[0]!;
    expect(item.content).toMatch(/auth/i);
    expect(item.entity_id).toBe('TASK-0001');
    expect(item.kind).toBe('completion');
    expect(item.layer).toBe('episodic');
    expect(item.created_at).toBe(new Date(1_700_000_000_000).toISOString());
    expect(item.score).toBeGreaterThan(0);
  });

  it('filters by context (parent_id)', async () => {
    await store.store({
      id: 'm1', layer: 'episodic', content: 'alpha', source: 's', createdAt: 1,
      context: 'FLDR-0001',
    });
    await store.store({
      id: 'm2', layer: 'episodic', content: 'alpha', source: 's', createdAt: 1,
      context: 'FLDR-0002',
    });

    const result = await recall({ query: 'alpha', context: 'FLDR-0001' }, { memoryComposer: composer });
    expect(result.items.map(i => i.id)).toEqual(['m1']);
  });

  it('filters by tags', async () => {
    await store.store({
      id: 'art', layer: 'episodic', content: 'alpha', source: 's', createdAt: 1,
      tags: ['artifact'],
    });
    await store.store({
      id: 'tsk', layer: 'episodic', content: 'alpha', source: 's', createdAt: 1,
      tags: ['task'],
    });

    const result = await recall({ query: 'alpha', tags: ['artifact'] }, { memoryComposer: composer });
    expect(result.items.map(i => i.id)).toEqual(['art']);
  });

  it('defaults to layer=[episodic] when layers param is absent', async () => {
    // Register a semantic store too, seed both with matching content,
    // and verify semantic is NOT returned by default.
    const sem = new InMemoryStore();
    composer.register('semantic', sem);
    await store.store({ id: 'ep', layer: 'episodic', content: 'alpha', source: 's', createdAt: 1 });
    await sem.store({ id: 'se', layer: 'semantic', content: 'alpha', source: 's', createdAt: 1 });

    const result = await recall({ query: 'alpha' }, { memoryComposer: composer });
    expect(result.items.map(i => i.id)).toEqual(['ep']);
  });

  it('respects explicit layers filter', async () => {
    const sem = new InMemoryStore();
    composer.register('semantic', sem);
    await store.store({ id: 'ep', layer: 'episodic', content: 'alpha', source: 's', createdAt: 1 });
    await sem.store({ id: 'se', layer: 'semantic', content: 'alpha', source: 's', createdAt: 1 });

    const result = await recall({ query: 'alpha', layers: ['semantic'] }, { memoryComposer: composer });
    expect(result.items.map(i => i.id)).toEqual(['se']);
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await store.store({ id: `m${i}`, layer: 'episodic', content: 'alpha', source: 's', createdAt: 1 });
    }
    const result = await recall({ query: 'alpha', limit: 2 }, { memoryComposer: composer });
    expect(result.items).toHaveLength(2);
  });

  it('surfaces metadata.entity_id and metadata.kind as RecallItem fields; omits when absent', async () => {
    await store.store({
      id: 'withMeta', layer: 'episodic', content: 'alpha', source: 's', createdAt: 1,
      metadata: { entity_id: 'TASK-0042', kind: 'completion' },
    });
    await store.store({
      id: 'noMeta', layer: 'episodic', content: 'alpha', source: 's', createdAt: 1,
    });
    const result = await recall({ query: 'alpha' }, { memoryComposer: composer });
    const byId = Object.fromEntries(result.items.map(i => [i.id, i]));
    expect(byId['withMeta']!.entity_id).toBe('TASK-0042');
    expect(byId['withMeta']!.kind).toBe('completion');
    expect(byId['noMeta']!.entity_id).toBeUndefined();
    expect(byId['noMeta']!.kind).toBeUndefined();
  });
});
