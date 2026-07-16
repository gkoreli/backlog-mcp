/**
 * search-reconcile.test.ts — ADR 0101 Phase 1 invariants.
 *
 * Reconciliation must:
 *   1. Add entities present on disk but missing from the index (drift fix-up)
 *   2. Remove entities in the index but no longer on disk (deletion fix-up)
 *   3. Update entities whose updated_at changed (external edit fix-up)
 *   4. Be a no-op when the index already matches the input set
 *   5. Return accurate counts for logging
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { OramaSearchService, type Resource } from '@backlog-mcp/memory/search';
import type { Entity } from '@backlog-mcp/shared';

let cacheCounter = 0;
function freshCachePath(): string {
  return join(process.cwd(), 'test-data', '.cache', `reconcile-${++cacheCounter}-${Date.now()}.json`);
}

function makeEntity(overrides: Partial<Entity> & { id: string; title: string }): Entity {
  return {
    status: 'open',
    type: 'task',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    content: '',
    ...overrides,
  } as Entity;
}

describe('OramaSearchService.reconcile (ADR-0101)', () => {
  let service: OramaSearchService;

  const initialTasks: Entity[] = [
    makeEntity({ id: 'TASK-0001', title: 'First task', content: 'alpha' }),
    makeEntity({ id: 'TASK-0002', title: 'Second task', content: 'beta' }),
  ];

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index(initialTasks);
  });

  it('returns zero counts when index already matches input', async () => {
    const stats = await service.reconcile(initialTasks);
    expect(stats).toEqual({ added: 0, removed: 0, updated: 0 });
  });

  it('adds entities present in input but missing from index', async () => {
    const newTask = makeEntity({ id: 'TASK-0099', title: 'Drifted task', content: 'gamma' });
    const stats = await service.reconcile([...initialTasks, newTask]);

    expect(stats).toEqual({ added: 1, removed: 0, updated: 0 });

    // The new task is now searchable
    const results = await service.search('gamma');
    expect(results.some(r => r.task.id === 'TASK-0099')).toBe(true);
  });

  it('removes entities in index but missing from input', async () => {
    const stats = await service.reconcile([initialTasks[0]]);

    expect(stats).toEqual({ added: 0, removed: 1, updated: 0 });

    // TASK-0002 should no longer match
    const results = await service.search('beta');
    expect(results.some(r => r.task.id === 'TASK-0002')).toBe(false);
  });

  it('updates entities whose updated_at differs', async () => {
    const edited: Entity = {
      ...initialTasks[1],
      title: 'Externally edited title',
      updated_at: '2026-05-15T00:00:00.000Z',
    };

    const stats = await service.reconcile([initialTasks[0], edited]);

    expect(stats).toEqual({ added: 0, removed: 0, updated: 1 });

    const results = await service.search('Externally edited');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].task.title).toBe('Externally edited title');
  });

  it('handles all three drift modes in a single call', async () => {
    const newTask = makeEntity({ id: 'TASK-0099', title: 'Brand new', content: 'gamma' });
    const editedFirst: Entity = {
      ...initialTasks[0],
      title: 'First task — modified',
      updated_at: '2026-05-15T00:00:00.000Z',
    };
    // initialTasks[1] (TASK-0002) is dropped from input → should be removed

    const stats = await service.reconcile([editedFirst, newTask]);

    expect(stats).toEqual({ added: 1, removed: 1, updated: 1 });

    expect((await service.search('gamma')).some(r => r.task.id === 'TASK-0099')).toBe(true);
    expect((await service.search('beta')).some(r => r.task.id === 'TASK-0002')).toBe(false);
    const editedHits = await service.search('modified');
    expect(editedHits.some(r => r.task.id === 'TASK-0001')).toBe(true);
  });

  it('does not update when updated_at is unchanged', async () => {
    // Same updated_at, different title — reconcile should NOT propagate the change
    // (we trust updated_at as the modification signal per ADR 0101 Phase 1)
    const stale: Entity = { ...initialTasks[0], title: 'Should not be indexed' };
    const stats = await service.reconcile([stale, initialTasks[1]]);

    expect(stats.updated).toBe(0);

    // Index still has the original title
    const results = await service.search('First task');
    expect(results[0].task.title).toBe('First task');
  });

  it('returns zero counts when db is not yet initialized', async () => {
    const fresh = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    const stats = await fresh.reconcile([initialTasks[0]]);
    expect(stats).toEqual({ added: 0, removed: 0, updated: 0 });
  });
});

describe('OramaSearchService.reconcileResources (ADR-0112)', () => {
  const initialResources: Resource[] = [
    {
      id: 'mcp://backlog/resources/guides/alpha.md',
      path: 'resources/guides/alpha.md',
      title: 'Alpha guide',
      content: 'alpha original content',
    },
    {
      id: 'mcp://backlog/resources/guides/beta.md',
      path: 'resources/guides/beta.md',
      title: 'Beta guide',
      content: 'beta stale content',
    },
  ];

  async function createService(cachePath = freshCachePath()): Promise<OramaSearchService> {
    const service = new OramaSearchService({ cachePath, hybridSearch: false });
    await service.index([]);
    return service;
  }

  it('returns zero counts when indexed resources already match input', async () => {
    const service = await createService();
    await service.indexResources(initialResources);

    const stats = await service.reconcileResources(initialResources);

    expect(stats).toEqual({ added: 0, removed: 0, updated: 0 });
  });

  it.each([
    {
      field: 'path',
      change: { path: 'resources/reference/relocated-alpha.md' },
      query: 'relocated',
    },
    {
      field: 'title',
      change: { title: 'Renamed resource marker' },
      query: 'Renamed resource marker',
    },
    {
      field: 'content',
      change: { content: 'replacement body marker' },
      query: 'replacement body marker',
    },
  ] as const)('updates a resource when its $field changes', async ({ change, query }) => {
    const service = await createService();
    await service.indexResources([initialResources[0]]);
    const changed = { ...initialResources[0], ...change };

    const stats = await service.reconcileResources([changed]);

    expect(stats).toEqual({ added: 0, removed: 0, updated: 1 });
    const results = await service.searchResources(query);
    expect(results.map(result => result.resource)).toContainEqual(changed);
  });

  it('reconciles added, removed, and updated resources from a persisted stale cache', async () => {
    const cachePath = freshCachePath();
    const staleService = await createService(cachePath);
    await staleService.indexResources(initialResources);
    staleService.flush();

    const service = await createService(cachePath);
    const updatedAlpha: Resource = {
      ...initialResources[0],
      title: 'Alpha guide refreshed',
      content: 'alpha refreshed marker',
    };
    const addedGamma: Resource = {
      id: 'mcp://backlog/resources/guides/gamma.md',
      path: 'resources/guides/gamma.md',
      title: 'Gamma guide',
      content: 'gamma added marker',
    };

    const stats = await service.reconcileResources([updatedAlpha, addedGamma]);

    expect(stats).toEqual({ added: 1, removed: 1, updated: 1 });
    expect((await service.searchResources('refreshed marker')).map(result => result.resource.id))
      .toContain(updatedAlpha.id);
    expect((await service.searchResources('gamma added')).map(result => result.resource.id))
      .toContain(addedGamma.id);
    expect(await service.searchResources('beta stale')).toEqual([]);
  });
});
