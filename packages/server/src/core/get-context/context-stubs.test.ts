import { describe, it, expect } from 'vitest';
import type { Entity } from '@backlog-mcp/shared';
import { composeContextStubs, type ComposeContextDeps } from './context-stubs.js';

function makeEntity(id: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    title: `Title of ${id}`,
    type: 'task',
    status: 'open',
    created_at: '2026-07-16T00:00:00.000Z',
    updated_at: '2026-07-16T00:00:00.000Z',
    ...overrides,
  } as Entity;
}

/** In-memory graph the composer deps read from. */
function makeDeps(entities: Entity[]): ComposeContextDeps {
  const byId = new Map(entities.map(e => [e.id, e]));
  return {
    getTask: (id) => byId.get(id),
    listTasks: (filter) => {
      const all = [...byId.values()];
      if (filter.parent_id !== undefined) {
        return all.filter(e => (e.parent_id ?? e.epic_id) === filter.parent_id);
      }
      return all;
    },
  };
}

describe('composeContextStubs', () => {
  it('groups parent, children, and siblings by role as minimal stubs', async () => {
    const entities = [
      makeEntity('EPIC-0001', { type: 'epic', title: 'The epic' }),
      makeEntity('TASK-0001', { parent_id: 'EPIC-0001' }),
      makeEntity('TASK-0002', { parent_id: 'EPIC-0001' }),
      makeEntity('TASK-0003', { parent_id: 'TASK-0001' }),
    ];
    const focal = entities[1] as Entity;

    const stubs = await composeContextStubs(focal, 1, makeDeps(entities));

    expect(stubs.parent).toEqual({ id: 'EPIC-0001', title: 'The epic', type: 'epic', status: 'open' });
    expect(stubs.children?.map(s => s.id)).toEqual(['TASK-0003']);
    expect(stubs.siblings?.map(s => s.id)).toEqual(['TASK-0002']);
    // Stubs carry no bodies or timestamps
    const child = stubs.children?.[0] as Record<string, unknown>;
    expect(child.content).toBeUndefined();
    expect(child.created_at).toBeUndefined();
  });

  it('omits empty role groups entirely', async () => {
    const focal = makeEntity('TASK-0001');
    const stubs = await composeContextStubs(focal, 1, makeDeps([focal]));
    expect(stubs).toEqual({});
  });

  it('resolves forward references from the focal references[] field', async () => {
    const entities = [
      makeEntity('TASK-0001', { references: [{ url: 'TASK-0002' }, { url: 'https://x.test/EPIC-0003' }] }),
      makeEntity('TASK-0002'),
      makeEntity('EPIC-0003', { type: 'epic' }),
    ];
    const stubs = await composeContextStubs(entities[0] as Entity, 1, makeDeps(entities));
    expect(stubs.references?.map(s => s.id).sort()).toEqual(['EPIC-0003', 'TASK-0002']);
  });

  it('resolves reverse references (who references me)', async () => {
    const entities = [
      makeEntity('TASK-0001'),
      makeEntity('TASK-0002', { references: [{ url: 'TASK-0001' }] }),
      makeEntity('TASK-0003', { references: [{ url: 'see TASK-0001 for details' }] }),
    ];
    const stubs = await composeContextStubs(entities[0] as Entity, 1, makeDeps(entities));
    expect(stubs.referenced_by?.map(s => s.id).sort()).toEqual(['TASK-0002', 'TASK-0003']);
  });

  it('dedups: an entity already in a relational role never repeats in references or related', async () => {
    // TASK-0002 is both a child of focal AND referenced by focal — child wins.
    const entities = [
      makeEntity('TASK-0001', { references: [{ url: 'TASK-0002' }] }),
      makeEntity('TASK-0002', { parent_id: 'TASK-0001' }),
    ];
    const stubs = await composeContextStubs(entities[0] as Entity, 1, makeDeps(entities));
    expect(stubs.children?.map(s => s.id)).toEqual(['TASK-0002']);
    expect(stubs.references).toBeUndefined();
  });

  it('caps children at 20 stubs', async () => {
    const focal = makeEntity('TASK-0001');
    const children = Array.from({ length: 30 }, (_, i) =>
      makeEntity(`TASK-${String(i + 100)}`, { parent_id: 'TASK-0001' }));
    const stubs = await composeContextStubs(focal, 1, makeDeps([focal, ...children]));
    expect(stubs.children).toHaveLength(20);
  });

  it('caps forward references at 10 (stage cap preserved)', async () => {
    const refs = Array.from({ length: 15 }, (_, i) => ({ url: `TASK-${String(i + 1000)}` }));
    const focal = makeEntity('TASK-0001', { references: refs });
    const targets = refs.map(r => makeEntity(r.url));
    const stubs = await composeContextStubs(focal, 1, makeDeps([focal, ...targets]));
    expect(stubs.references).toHaveLength(10);
  });

  it('includes ancestors and descendants only at depth 2', async () => {
    const entities = [
      makeEntity('FLDR-0001', { type: 'folder', status: undefined }),
      makeEntity('EPIC-0001', { type: 'epic', parent_id: 'FLDR-0001' }),
      makeEntity('TASK-0001', { parent_id: 'EPIC-0001' }),
      makeEntity('TASK-0002', { parent_id: 'TASK-0001' }),
      makeEntity('TASK-0003', { parent_id: 'TASK-0002' }),
    ];
    const focal = entities[2] as Entity;
    const deps = makeDeps(entities);

    const shallow = await composeContextStubs(focal, 1, deps);
    expect(shallow.ancestors).toBeUndefined();
    expect(shallow.descendants).toBeUndefined();

    const deep = await composeContextStubs(focal, 2, deps);
    expect(deep.ancestors?.map(s => s.id)).toEqual(['FLDR-0001']);
    expect(deep.ancestors?.[0]?.graph_depth).toBe(2);
    expect(deep.descendants?.map(s => s.id)).toEqual(['TASK-0003']);
  });

  it('clamps depth to at most 2', async () => {
    const entities = [
      makeEntity('EPIC-0001', { type: 'epic' }),
      makeEntity('TASK-0001', { parent_id: 'EPIC-0001' }),
      makeEntity('TASK-0002', { parent_id: 'TASK-0001' }),
      makeEntity('TASK-0003', { parent_id: 'TASK-0002' }),
      makeEntity('TASK-0004', { parent_id: 'TASK-0003' }),
    ];
    const stubs = await composeContextStubs(entities[1] as Entity, 5, makeDeps(entities));
    // Depth 3 descendant excluded by the clamp
    expect(stubs.descendants?.map(s => s.id)).toEqual(['TASK-0003']);
  });

  it('fills related from searchUnified, deduped against relational roles', async () => {
    const entities = [
      makeEntity('TASK-0001', { parent_id: 'EPIC-0001' }),
      makeEntity('EPIC-0001', { type: 'epic' }),
      makeEntity('TASK-0009', { title: 'Semantically close' }),
    ];
    const deps: ComposeContextDeps = {
      ...makeDeps(entities),
      searchUnified: async () => [
        { item: entities[1] as Entity, score: 0.9, type: 'epic' },   // already parent → deduped
        { item: entities[2] as Entity, score: 0.8, type: 'task' },
      ],
    };
    const stubs = await composeContextStubs(entities[0] as Entity, 1, deps);
    expect(stubs.related?.map(s => s.id)).toEqual(['TASK-0009']);
    expect(stubs.related?.[0]?.relevance_score).toBe(0.8);
  });

  it('skips the related group when searchUnified is absent', async () => {
    const focal = makeEntity('TASK-0001');
    const stubs = await composeContextStubs(focal, 1, makeDeps([focal]));
    expect(stubs.related).toBeUndefined();
  });
});
