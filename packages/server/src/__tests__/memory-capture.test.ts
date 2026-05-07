/**
 * Integration tests for memory capture (ADR 0092.2 Phase 3a).
 *
 * Verifies that `updateItem` and `createItem` emit `layer: 'episodic'`
 * memories into the composer on the expected transitions, carry the
 * right actor attribution, and silently drop on failures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Entity } from '@backlog-mcp/shared';
import { MemoryComposer, InMemoryStore } from '@backlog-mcp/memory';
import type { IBacklogService } from '../storage/service-types.js';
import { updateItem } from '../core/update.js';
import { createItem } from '../core/create.js';
import type { WriteContext } from '../core/types.js';
import { buildCompletionEntry, buildArtifactEntry } from '../memory/capture.js';

function makeEntity(overrides: Partial<Entity> & { id: string; title: string }): Entity {
  return {
    type: 'task',
    status: 'open',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Entity;
}

function mockService(initial: Entity[] = []): IBacklogService {
  const store = new Map(initial.map(e => [e.id, { ...e }]));
  return {
    get: vi.fn(async (id: string) => {
      const e = store.get(id);
      return e ? { ...e } : undefined;
    }),
    getMarkdown: vi.fn(async () => null),
    list: vi.fn(async () => [...store.values()]),
    add: vi.fn(async (task: Entity) => { store.set(task.id, { ...task }); }),
    save: vi.fn(async (task: Entity) => { store.set(task.id, { ...task }); }),
    delete: vi.fn(async () => true),
    counts: vi.fn(async () => ({ total_tasks: store.size, total_epics: 0, by_status: {}, by_type: {} })),
    getMaxId: vi.fn(async () => store.size),
    searchUnified: vi.fn(async () => []),
  };
}

function makeCtx(composer?: MemoryComposer): WriteContext {
  return {
    actor: { type: 'user', name: 'goga' },
    operationLog: {
      append: () => {},
      query: async () => [],
      countForTask: async () => 0,
    },
    ...(composer ? { memoryComposer: composer } : {}),
  };
}

describe('memory capture — update → done', () => {
  let composer: MemoryComposer;
  let store: InMemoryStore;

  beforeEach(() => {
    composer = new MemoryComposer();
    store = new InMemoryStore();
    composer.register('episodic', store);
  });

  it('captures an episodic memory when status → done', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'Fix auth', status: 'in_progress', evidence: ['Added JWT middleware'] }),
    ]);

    await updateItem(svc, { id: 'TASK-0001', status: 'done' }, makeCtx(composer));

    expect(await store.size()).toBe(1);
    const [result] = await store.recall({ query: 'auth' });
    expect(result!.entry.layer).toBe('episodic');
    expect(result!.entry.content).toBe('Fix auth — Added JWT middleware');
    expect(result!.entry.source).toBe('goga');
    expect(result!.entry.metadata).toMatchObject({
      entity_id: 'TASK-0001',
      kind: 'completion',
      actor_type: 'user',
      usageCount: 0,
    });
  });

  it('does not capture when status is unchanged (stays open)', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 't', status: 'open' }),
    ]);
    await updateItem(svc, { id: 'TASK-0001', title: 'new title' }, makeCtx(composer));
    expect(await store.size()).toBe(0);
  });

  it('does not capture when done → done (idempotent re-write)', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 't', status: 'done' }),
    ]);
    await updateItem(svc, { id: 'TASK-0001', status: 'done' }, makeCtx(composer));
    expect(await store.size()).toBe(0);
  });

  it('does not capture when done → open (re-opened)', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 't', status: 'done' }),
    ]);
    await updateItem(svc, { id: 'TASK-0001', status: 'open' }, makeCtx(composer));
    expect(await store.size()).toBe(0);
  });

  it('omits composer = no capture, no error', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 't', status: 'open' }),
    ]);
    await expect(
      updateItem(svc, { id: 'TASK-0001', status: 'done' }, makeCtx()),
    ).resolves.toBeDefined();
  });

  it('carries parent_id as memory context', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 't', status: 'open', parent_id: 'FLDR-0001' }),
    ]);
    await updateItem(svc, { id: 'TASK-0001', status: 'done' }, makeCtx(composer));
    const [result] = await store.recall({ query: 't' });
    expect(result!.entry.context).toBe('FLDR-0001');
  });

  it('tolerates entities with no evidence (digest = title only)', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'Plain task', status: 'open' }),
    ]);
    await updateItem(svc, { id: 'TASK-0001', status: 'done' }, makeCtx(composer));
    const [result] = await store.recall({ query: 'plain' });
    expect(result!.entry.content).toBe('Plain task');
  });

  it('does not fail the update when capture throws', async () => {
    const brokenComposer = new MemoryComposer();  // no episodic store registered
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 't', status: 'open' }),
    ]);
    const result = await updateItem(
      svc,
      { id: 'TASK-0001', status: 'done' },
      makeCtx(brokenComposer),
    );
    expect(result.id).toBe('TASK-0001');  // update still succeeded
  });
});

describe('memory capture — create artifact', () => {
  let composer: MemoryComposer;
  let store: InMemoryStore;

  beforeEach(() => {
    composer = new MemoryComposer();
    store = new InMemoryStore();
    composer.register('episodic', store);
  });

  it('captures on artifact creation', async () => {
    const svc = mockService();
    await createItem(
      svc,
      { title: 'Review Notes', description: 'Detailed review of the PR', type: 'artifact' as any, parent_id: 'TASK-0629' },
      makeCtx(composer),
    );

    expect(await store.size()).toBe(1);
    const [result] = await store.recall({ query: 'review' });
    expect(result!.entry.layer).toBe('episodic');
    expect(result!.entry.metadata).toMatchObject({
      kind: 'artifact',
      actor_type: 'user',
      usageCount: 0,
    });
    expect(result!.entry.context).toBe('TASK-0629');
  });

  it('does not capture on task creation', async () => {
    const svc = mockService();
    await createItem(
      svc,
      { title: 'A task', description: 'some desc' },
      makeCtx(composer),
    );
    expect(await store.size()).toBe(0);
  });

  it('does not capture on epic creation', async () => {
    const svc = mockService();
    await createItem(
      svc,
      { title: 'An epic', type: 'epic' as any },
      makeCtx(composer),
    );
    expect(await store.size()).toBe(0);
  });
});

describe('memory entry builders', () => {
  const NOW = 1746723000000;

  it('buildCompletionEntry uses title + first evidence, capped at 200 chars', () => {
    const entity = {
      id: 'TASK-0001',
      title: 'x'.repeat(180),
      type: 'task',
      status: 'done',
      evidence: ['y'.repeat(180)],
      created_at: '', updated_at: '',
    } as Entity;
    const entry = buildCompletionEntry(entity, { type: 'agent', name: 'claude' }, NOW);
    expect(entry.content).toHaveLength(200);
    expect(entry.content.startsWith('x'.repeat(180))).toBe(true);
  });

  it('buildCompletionEntry id = mem-<entity>-<now>', () => {
    const e = { id: 'TASK-0042', title: 't', type: 'task', status: 'done', created_at: '', updated_at: '' } as Entity;
    const entry = buildCompletionEntry(e, { type: 'user', name: 'g' }, NOW);
    expect(entry.id).toBe(`mem-TASK-0042-${NOW}`);
  });

  it('buildArtifactEntry uses description when present', () => {
    const e = { id: 'ARTF-0001', title: 'Short', type: 'artifact', description: 'Some useful description.', created_at: '', updated_at: '' } as Entity;
    const entry = buildArtifactEntry(e, { type: 'user', name: 'g' }, NOW);
    expect(entry.content).toBe('Short — Some useful description.');
    expect(entry.metadata?.kind).toBe('artifact');
  });

  it('buildArtifactEntry falls back to title only when description absent', () => {
    const e = { id: 'ARTF-0001', title: 'Titleonly', type: 'artifact', created_at: '', updated_at: '' } as Entity;
    const entry = buildArtifactEntry(e, { type: 'user', name: 'g' }, NOW);
    expect(entry.content).toBe('Titleonly');
  });

  it('instrumentation: usageCount starts at 0, expiresAt omitted', () => {
    const e = { id: 'TASK-0001', title: 't', type: 'task', status: 'done', created_at: '', updated_at: '' } as Entity;
    const entry = buildCompletionEntry(e, { type: 'user', name: 'g' }, NOW);
    expect(entry.metadata?.usageCount).toBe(0);
    expect(entry.expiresAt).toBeUndefined();
  });
});
