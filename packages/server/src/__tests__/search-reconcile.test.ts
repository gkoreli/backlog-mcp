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
import { OramaSearchService } from '@backlog-mcp/memory/search';
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
    description: '',
    ...overrides,
  } as Entity;
}

describe('OramaSearchService.reconcile (ADR-0101)', () => {
  let service: OramaSearchService;

  const initialTasks: Entity[] = [
    makeEntity({ id: 'TASK-0001', title: 'First task', description: 'alpha' }),
    makeEntity({ id: 'TASK-0002', title: 'Second task', description: 'beta' }),
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
    const newTask = makeEntity({ id: 'TASK-0099', title: 'Drifted task', description: 'gamma' });
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
    const newTask = makeEntity({ id: 'TASK-0099', title: 'Brand new', description: 'gamma' });
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
