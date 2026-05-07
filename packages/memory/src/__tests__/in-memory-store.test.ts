/**
 * Tests for InMemoryStore (ADR-0092 / 0092.2).
 *
 * Gap tests — this store shipped without tests. Phase 3 is its first
 * production use, so we lock the contract now.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryStore } from '../in-memory-store.js';
import type { MemoryEntry } from '../types.js';

function entry(overrides: Partial<MemoryEntry> & { id: string; content: string }): MemoryEntry {
  return {
    layer: 'episodic',
    source: 'test',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('InMemoryStore', () => {
  it('starts empty', async () => {
    const store = new InMemoryStore();
    expect(await store.size()).toBe(0);
    expect(await store.recall({ query: 'anything' })).toEqual([]);
  });

  it('stores and recalls an entry by keyword match', async () => {
    const store = new InMemoryStore();
    await store.store(entry({ id: 'm1', content: 'fixed the auth bug by adding middleware' }));

    const results = await store.recall({ query: 'auth middleware' });
    expect(results).toHaveLength(1);
    expect(results[0]!.entry.id).toBe('m1');
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('scores by fraction of query terms that match', async () => {
    const store = new InMemoryStore();
    await store.store(entry({ id: 'm-two', content: 'alpha beta' }));           // 2/3 match
    await store.store(entry({ id: 'm-one', content: 'alpha' }));                 // 1/3 match
    await store.store(entry({ id: 'm-three', content: 'alpha beta gamma' }));    // 3/3 match

    const results = await store.recall({ query: 'alpha beta gamma' });
    expect(results.map(r => r.entry.id)).toEqual(['m-three', 'm-two', 'm-one']);
  });

  it('ignores entries that match zero query terms', async () => {
    const store = new InMemoryStore();
    await store.store(entry({ id: 'hit', content: 'alpha' }));
    await store.store(entry({ id: 'miss', content: 'beta' }));

    const results = await store.recall({ query: 'alpha' });
    expect(results.map(r => r.entry.id)).toEqual(['hit']);
  });

  it('upserts on duplicate id', async () => {
    const store = new InMemoryStore();
    await store.store(entry({ id: 'same', content: 'first' }));
    await store.store(entry({ id: 'same', content: 'second' }));

    expect(await store.size()).toBe(1);
    const [result] = await store.recall({ query: 'second' });
    expect(result!.entry.content).toBe('second');
  });

  it('filters by layer', async () => {
    const store = new InMemoryStore();
    await store.store(entry({ id: 'ep', content: 'alpha', layer: 'episodic' }));
    await store.store(entry({ id: 'sem', content: 'alpha', layer: 'semantic' }));

    const episodic = await store.recall({ query: 'alpha', layers: ['episodic'] });
    expect(episodic.map(r => r.entry.id)).toEqual(['ep']);
  });

  it('filters by context', async () => {
    const store = new InMemoryStore();
    await store.store(entry({ id: 'fldr1', content: 'alpha', context: 'FLDR-0001' }));
    await store.store(entry({ id: 'fldr2', content: 'alpha', context: 'FLDR-0002' }));
    await store.store(entry({ id: 'none', content: 'alpha' }));

    const results = await store.recall({ query: 'alpha', context: 'FLDR-0001' });
    expect(results.map(r => r.entry.id)).toEqual(['fldr1']);
  });

  it('filters by tags (any-match)', async () => {
    const store = new InMemoryStore();
    await store.store(entry({ id: 'a', content: 'alpha', tags: ['task', 'urgent'] }));
    await store.store(entry({ id: 'b', content: 'alpha', tags: ['artifact'] }));
    await store.store(entry({ id: 'c', content: 'alpha' }));

    const results = await store.recall({ query: 'alpha', tags: ['artifact'] });
    expect(results.map(r => r.entry.id)).toEqual(['b']);
  });

  it('skips expired entries on recall', async () => {
    const store = new InMemoryStore();
    await store.store(entry({ id: 'live', content: 'alpha' }));
    await store.store(entry({ id: 'dead', content: 'alpha', expiresAt: Date.now() - 1000 }));

    const results = await store.recall({ query: 'alpha' });
    expect(results.map(r => r.entry.id)).toEqual(['live']);
  });

  it('respects limit', async () => {
    const store = new InMemoryStore();
    for (let i = 0; i < 5; i++) {
      await store.store(entry({ id: `m${i}`, content: 'alpha' }));
    }
    const results = await store.recall({ query: 'alpha', limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('forget removes entries by id', async () => {
    const store = new InMemoryStore();
    await store.store(entry({ id: 'keep', content: 'alpha' }));
    await store.store(entry({ id: 'drop', content: 'alpha' }));

    const removed = await store.forget({ ids: ['drop'] });
    expect(removed).toBe(1);
    expect(await store.size()).toBe(1);
  });

  it('forget removes all entries in a layer when no ids given', async () => {
    const store = new InMemoryStore();
    await store.store(entry({ id: 'ep1', content: 'a', layer: 'episodic' }));
    await store.store(entry({ id: 'ep2', content: 'b', layer: 'episodic' }));
    await store.store(entry({ id: 'sem', content: 'c', layer: 'semantic' }));

    const removed = await store.forget({ layer: 'episodic' });
    expect(removed).toBe(2);
    expect(await store.size()).toBe(1);
  });

  it('forget prunes expired entries when expired=true', async () => {
    const store = new InMemoryStore();
    await store.store(entry({ id: 'live', content: 'a' }));
    await store.store(entry({ id: 'dead', content: 'b', expiresAt: Date.now() - 1 }));

    const removed = await store.forget({ expired: true });
    expect(removed).toBe(1);
    expect(await store.size()).toBe(1);
  });
});
