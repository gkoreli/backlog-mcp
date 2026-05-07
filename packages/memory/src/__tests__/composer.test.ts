/**
 * Tests for MemoryComposer (ADR-0092 / 0092.2).
 *
 * Gap tests — the composer shipped without tests. Phase 3 is its first
 * production caller, so we lock behavior now.
 */
import { describe, it, expect } from 'vitest';
import { MemoryComposer } from '../composer.js';
import { InMemoryStore } from '../in-memory-store.js';
import type { MemoryEntry, MemoryLayer, MemoryStore } from '../types.js';

function entry(overrides: Partial<MemoryEntry> & { id: string; content: string; layer: MemoryLayer }): MemoryEntry {
  return {
    source: 'test',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('MemoryComposer', () => {
  it('routes store() to the matching layer store', async () => {
    const composer = new MemoryComposer();
    const episodic = new InMemoryStore();
    const semantic = new InMemoryStore();
    composer.register('episodic', episodic);
    composer.register('semantic', semantic);

    await composer.store(entry({ id: 'a', content: 'alpha', layer: 'episodic' }));

    expect(await episodic.size()).toBe(1);
    expect(await semantic.size()).toBe(0);
  });

  it('throws when storing to an unregistered layer', async () => {
    const composer = new MemoryComposer();
    composer.register('episodic', new InMemoryStore());

    await expect(
      composer.store(entry({ id: 'a', content: 'x', layer: 'semantic' })),
    ).rejects.toThrow(/No store registered for layer: semantic/);
  });

  it('recalls across all registered stores and merges by score', async () => {
    const composer = new MemoryComposer();
    const ep = new InMemoryStore();
    const se = new InMemoryStore();
    composer.register('episodic', ep);
    composer.register('semantic', se);

    await ep.store(entry({ id: 'ep-weak', content: 'alpha', layer: 'episodic' }));
    await se.store(entry({ id: 'se-strong', content: 'alpha beta gamma', layer: 'semantic' }));

    const results = await composer.recall({ query: 'alpha beta gamma' });
    expect(results.map(r => r.entry.id)).toEqual(['se-strong', 'ep-weak']);
  });

  it('filters recall to targeted layers only', async () => {
    const composer = new MemoryComposer();
    const ep = new InMemoryStore();
    const se = new InMemoryStore();
    composer.register('episodic', ep);
    composer.register('semantic', se);

    await ep.store(entry({ id: 'ep1', content: 'alpha', layer: 'episodic' }));
    await se.store(entry({ id: 'se1', content: 'alpha', layer: 'semantic' }));

    const results = await composer.recall({ query: 'alpha', layers: ['episodic'] });
    expect(results.map(r => r.entry.id)).toEqual(['ep1']);
  });

  it('dedupes by entry id across stores (first wins)', async () => {
    // Edge case: same id present in two stores (unusual, but contract-defined)
    const composer = new MemoryComposer();
    const ep = new InMemoryStore();
    const se = new InMemoryStore();
    composer.register('episodic', ep);
    composer.register('semantic', se);

    await ep.store(entry({ id: 'shared', content: 'alpha', layer: 'episodic' }));
    await se.store(entry({ id: 'shared', content: 'alpha', layer: 'semantic' }));

    const results = await composer.recall({ query: 'alpha' });
    expect(results).toHaveLength(1);
  });

  it('empty when no stores registered', async () => {
    const composer = new MemoryComposer();
    const results = await composer.recall({ query: 'anything' });
    expect(results).toEqual([]);
  });

  it('empty when targeted layers are not registered', async () => {
    const composer = new MemoryComposer();
    composer.register('episodic', new InMemoryStore());

    const results = await composer.recall({ query: 'alpha', layers: ['semantic'] });
    expect(results).toEqual([]);
  });

  it('respects defaultLimit from config', async () => {
    const composer = new MemoryComposer({ defaultLimit: 2 });
    const ep = new InMemoryStore();
    composer.register('episodic', ep);

    for (let i = 0; i < 5; i++) {
      await ep.store(entry({ id: `m${i}`, content: 'alpha', layer: 'episodic' }));
    }

    const results = await composer.recall({ query: 'alpha' });
    expect(results).toHaveLength(2);
  });

  it('query limit overrides default', async () => {
    const composer = new MemoryComposer({ defaultLimit: 2 });
    const ep = new InMemoryStore();
    composer.register('episodic', ep);

    for (let i = 0; i < 5; i++) {
      await ep.store(entry({ id: `m${i}`, content: 'alpha', layer: 'episodic' }));
    }

    const results = await composer.recall({ query: 'alpha', limit: 4 });
    expect(results).toHaveLength(4);
  });

  it('forget routed to targeted layer', async () => {
    const composer = new MemoryComposer();
    const ep = new InMemoryStore();
    const se = new InMemoryStore();
    composer.register('episodic', ep);
    composer.register('semantic', se);

    await ep.store(entry({ id: 'e1', content: 'x', layer: 'episodic' }));
    await se.store(entry({ id: 's1', content: 'x', layer: 'semantic' }));

    const removed = await composer.forget({ layer: 'episodic' });
    expect(removed).toBe(1);
    expect(await ep.size()).toBe(0);
    expect(await se.size()).toBe(1);
  });

  it('forget without layer applies to all stores (by ids)', async () => {
    const composer = new MemoryComposer();
    const ep = new InMemoryStore();
    const se = new InMemoryStore();
    composer.register('episodic', ep);
    composer.register('semantic', se);

    await ep.store(entry({ id: 'shared', content: 'x', layer: 'episodic' }));
    await se.store(entry({ id: 'shared', content: 'x', layer: 'semantic' }));

    const removed = await composer.forget({ ids: ['shared'] });
    expect(removed).toBe(2);
  });

  it('registered() returns map of layer → store name', () => {
    const composer = new MemoryComposer();
    const ep = new InMemoryStore();
    const custom: MemoryStore = {
      name: 'custom-store',
      store: async () => {},
      recall: async () => [],
      forget: async () => 0,
      size: async () => 0,
    };
    composer.register('episodic', ep);
    composer.register('semantic', custom);

    expect(composer.registered()).toEqual({
      episodic: 'in-memory',
      semantic: 'custom-store',
    });
  });
});
