/**
 * getItems + context stubs (ADR 0114) — the `backlog_get(context: true)` shape,
 * and graceful degradation when the service lacks sync storage access (D1).
 */
import { describe, it, expect } from 'vitest';
import type { Entity } from '@backlog-mcp/shared';
import type { IBacklogService } from '../../storage/backlog-service.contract.js';
import { getItems } from '../get.js';

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

/** Local-shaped service: sync storage access present. */
function makeLocalService(entities: Entity[]): IBacklogService {
  const byId = new Map(entities.map(e => [e.id, e]));
  return {
    getMarkdown: async (id: string) => byId.has(id) ? `# ${id} body` : null,
    getSync: (id: string) => byId.get(id),
    listSync: (filter?: { parent_id?: string }) => {
      const all = [...byId.values()];
      if (filter?.parent_id !== undefined) {
        return all.filter(e => (e.parent_id ?? e.epic_id) === filter.parent_id);
      }
      return all;
    },
    searchUnified: async () => [],
  } as unknown as IBacklogService;
}

/** Remote-shaped service: no getSync/listSync (D1 posture). */
function makeRemoteService(entities: Entity[]): IBacklogService {
  const byId = new Map(entities.map(e => [e.id, e]));
  return {
    getMarkdown: async (id: string) => byId.has(id) ? `# ${id} body` : null,
    searchUnified: async () => [],
  } as unknown as IBacklogService;
}

const GRAPH = [
  makeEntity('EPIC-0001', { type: 'epic' }),
  makeEntity('TASK-0001', { parent_id: 'EPIC-0001' }),
  makeEntity('TASK-0002', { parent_id: 'EPIC-0001' }),
];

describe('getItems with context', () => {
  it('attaches role-grouped stubs alongside the full body', async () => {
    const result = await getItems(makeLocalService(GRAPH), { ids: ['TASK-0001'], context: true });
    const item = result.items[0];
    expect(item?.content).toBe('# TASK-0001 body');
    expect(item?.context?.parent?.id).toBe('EPIC-0001');
    expect(item?.context?.siblings?.map(s => s.id)).toEqual(['TASK-0002']);
  });

  it('omits context entirely when not requested — plain get path unchanged', async () => {
    const result = await getItems(makeLocalService(GRAPH), { ids: ['TASK-0001'] });
    expect(result.items[0]).toEqual({ id: 'TASK-0001', content: '# TASK-0001 body' });
  });

  it('degrades gracefully to no context when sync deps are absent (remote/D1)', async () => {
    const result = await getItems(makeRemoteService(GRAPH), { ids: ['TASK-0001'], context: true });
    const item = result.items[0];
    expect(item?.content).toBe('# TASK-0001 body');
    expect(item?.context).toBeUndefined();
  });

  it('skips context for not-found entities', async () => {
    const result = await getItems(makeLocalService(GRAPH), { ids: ['TASK-9999'], context: true });
    expect(result.items[0]).toEqual({ id: 'TASK-9999', content: null });
  });

  it('composes context per entity on batch fetch', async () => {
    const result = await getItems(makeLocalService(GRAPH), { ids: ['TASK-0001', 'TASK-0002'], context: true });
    expect(result.items[0]?.context?.siblings?.map(s => s.id)).toEqual(['TASK-0002']);
    expect(result.items[1]?.context?.siblings?.map(s => s.id)).toEqual(['TASK-0001']);
  });
});
