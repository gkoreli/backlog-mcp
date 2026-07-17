/**
 * Core function invariant tests.
 *
 * These tests verify the behavioral contract of each core function
 * independent of transport (MCP/CLI). They are the regression safety
 * net for ADR-0090.
 *
 * Error contract:
 * - NotFoundError: thrown when a required entity doesn't exist (update, edit)
 * - ValidationError: thrown for invalid input (empty search query, empty id list)
 * - get: returns { id, content: null } for missing entities (not-found is normal for reads)
 * - delete: returns { id, deleted: boolean } so caller knows if it existed
 * - edit: returns { success: false, error } for operation failures (expected, not exceptional)
 */
import { describe, it, expect, vi } from 'vitest';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import {
  EntityType,
  EntitySchema,
  type AnyEntity,
  type Entity,
} from '@backlog-mcp/shared';
import { listItems } from '../core/list.js';
import { getItems } from '../core/get.js';
import { createEntity as createEntityCore } from '../core/create.js';
import { updateEntity as updateEntityCore } from '../core/update.js';
import { deleteItem as deleteItemCore } from '../core/delete.js';
import { searchItems } from '../core/search.js';
import { editItem as editItemCore } from '../core/edit.js';
import {
  NotFoundError,
  ValidationError,
  type CreateEntityParams,
  type DeleteParams,
  type EditParams,
  type MutationAttribution,
  type UpdateEntityParams,
  type WriteContext,
} from '../core/types.js';

const CREATE_ATTRIBUTION = {
  tool: 'backlog_create_work',
  mutation: 'create',
} as const satisfies MutationAttribution;

const UPDATE_ATTRIBUTION = {
  tool: 'backlog_complete_task',
  mutation: 'update',
} as const satisfies MutationAttribution;

const DELETE_ATTRIBUTION = {
  tool: 'backlog_delete',
  mutation: 'delete',
} as const satisfies MutationAttribution;

const RESOURCE_EDIT_ATTRIBUTION = {
  tool: 'write_resource',
  mutation: 'resource-edit',
} as const satisfies MutationAttribution;

type CreateParamsWithDefaultType =
  Omit<CreateEntityParams, 'type'> & { type?: CreateEntityParams['type'] };

function createEntity(
  service: IBacklogService,
  params: CreateParamsWithDefaultType,
  ctx: WriteContext,
) {
  return createEntityCore(
    service,
    { type: EntityType.Task, ...params },
    ctx,
    CREATE_ATTRIBUTION,
  );
}

function updateEntity(
  service: IBacklogService,
  params: UpdateEntityParams,
  ctx: WriteContext,
) {
  return updateEntityCore(service, params, ctx, UPDATE_ATTRIBUTION);
}

function deleteItem(
  service: IBacklogService,
  params: DeleteParams,
  ctx: WriteContext,
) {
  return deleteItemCore(service, params, ctx, DELETE_ATTRIBUTION);
}

function editItem(
  service: IBacklogService,
  params: EditParams,
  ctx: WriteContext,
) {
  return editItemCore(service, params, ctx, RESOURCE_EDIT_ATTRIBUTION);
}

// ── WriteContext for core tests ──
// Minimal ctx with a no-op operationLog and no event bus. Tests that
// assert logging behavior construct their own capture log; everything
// else just needs the calls to not throw.

function testCtx(): WriteContext {
  return {
    actor: { type: 'user', name: 'test' },
    operationLog: {
      append: () => {},
      query: async () => [],
      countForTask: async () => 0,
    },
  };
}

// ── Mock Service Factory ──

function makeEntity(overrides: Partial<Entity> & { id: string; title: string }): Entity {
  return {
    type: 'task',
    status: 'open',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Entity;
}

function mockService(entities: Entity[] = []): IBacklogService {
  const store = new Map(entities.map(e => [e.id, { ...e }]));

  return {
    get: vi.fn(async (id: string) => {
      const e = store.get(id);
      return e ? { ...e } : undefined;
    }),
    getMarkdown: vi.fn(async (id: string) => {
      const e = store.get(id);
      if (!e) return null;
      return `---\nid: ${e.id}\ntitle: ${e.title}\nstatus: ${e.status}\n---\n\n${e.content ?? ''}`;
    }),
    list: vi.fn(async (filter?: any) => {
      let result = [...store.values()];
      if (filter?.status) result = result.filter(e => filter.status.includes(e.status));
      if (filter?.type) result = result.filter(e => (e.type ?? 'task') === filter.type);
      if (filter?.parent_id) result = result.filter(e => e.parent_id === filter.parent_id);
      if (filter?.limit) result = result.slice(0, filter.limit);
      return result;
    }),
    add: vi.fn(async (candidate: AnyEntity) => {
      const entity = EntitySchema.parse(candidate);
      store.set(entity.id, { ...entity });
      return entity;
    }),
    save: vi.fn(async (candidate: AnyEntity) => {
      const entity = EntitySchema.parse(candidate);
      store.set(entity.id, { ...entity });
      return entity;
    }),
    delete: vi.fn(async (id: string) => { const had = store.has(id); store.delete(id); return had; }),
    counts: vi.fn(async () => ({
      total_tasks: [...store.values()].filter(e => (e.type ?? 'task') === 'task').length,
      total_epics: [...store.values()].filter(e => e.type === 'epic').length,
      by_status: { open: [...store.values()].filter(e => e.status === 'open').length, done: 0, in_progress: 0, blocked: 0, cancelled: 0 },
      by_type: { task: [...store.values()].filter(e => (e.type ?? 'task') === 'task').length },
    })),
    getMaxId: vi.fn(async () => store.size),
    searchUnified: vi.fn(async (query: string) => {
      const matches = [...store.values()].filter(e =>
        e.title.toLowerCase().includes(query.toLowerCase()) ||
        (e.content ?? '').toLowerCase().includes(query.toLowerCase())
      );
      return matches.map(e => ({
        item: e,
        score: 1.0,
        type: (e.type ?? 'task') as 'task' | 'epic' | 'resource',
        snippet: { text: e.title, matched_fields: ['title'] },
      }));
    }),
    isHybridSearchActive: vi.fn(() => false),
    getResource: vi.fn((uri: string) => {
      if (uri === 'mcp://backlog/resources/test.md') {
        return { content: '# Test Resource', mimeType: 'text/markdown' };
      }
      if (uri === 'mcp://backlog/README.md') {
        return { content: '# Readme', mimeType: 'text/markdown' };
      }
      if (uri === 'mcp://backlog/docs/adr/0001-example.md') {
        return { content: '# ADR 0001', mimeType: 'text/markdown' };
      }
      return undefined;
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════
// listItems
// ═══════════════════════════════════════════════════════════════════

describe('core/listItems', () => {
  it('returns tasks with normalized shape', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'First', parent_id: 'EPIC-0001' }),
      makeEntity({ id: 'TASK-0002', title: 'Second' }),
    ]);
    const result = await listItems(svc, {});
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).toEqual({
      id: 'TASK-0001', title: 'First', status: 'open', type: 'task', parent_id: 'EPIC-0001',
    });
    expect(result.tasks[1].parent_id).toBeUndefined();
  });

  it('passes the canonical parent_id filter through unchanged', async () => {
    const svc = mockService();
    await listItems(svc, { parent_id: 'EPIC-0001' });
    expect(svc.list).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'EPIC-0001' }));
  });

  it('includes counts only when requested', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    expect((await listItems(svc, {})).counts).toBeUndefined();
    expect((await listItems(svc, { counts: true })).counts).toBeDefined();
    expect((await listItems(svc, { counts: true })).counts!.total_tasks).toBe(1);
  });

  it('passes status, type, limit filters through to service', async () => {
    const svc = mockService();
    await listItems(svc, { status: ['done'], type: 'epic' as any, limit: 5 });
    expect(svc.list).toHaveBeenCalledWith(expect.objectContaining({ status: ['done'], type: 'epic', limit: 5 }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// getItems — returns structured data, null for missing
// ═══════════════════════════════════════════════════════════════════

describe('core/getItems', () => {
  it('returns structured items with content', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test' })]);
    const result = await getItems(svc, { ids: ['TASK-0001'] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('TASK-0001');
    expect(result.items[0].content).toContain('Test');
  });

  it('returns null content for missing task', async () => {
    const svc = mockService();
    const result = await getItems(svc, { ids: ['TASK-9999'] });
    expect(result.items[0]).toEqual({ id: 'TASK-9999', content: null });
  });

  it('batch fetches multiple IDs preserving order', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'First' }),
      makeEntity({ id: 'TASK-0002', title: 'Second' }),
    ]);
    const result = await getItems(svc, { ids: ['TASK-0001', 'TASK-0002'] });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe('TASK-0001');
    expect(result.items[1].id).toBe('TASK-0002');
  });

  it('handles resource URIs — returns raw content with metadata', async () => {
    const svc = mockService();
    const result = await getItems(svc, { ids: ['mcp://backlog/resources/test.md'] });
    expect(result.items[0].content).toBe('# Test Resource');
    expect(result.items[0].resource).toEqual({ content: '# Test Resource', mimeType: 'text/markdown' });
  });

  it('returns null with a clear not-found error for missing resource URI', async () => {
    const svc = mockService();
    const result = await getItems(svc, { ids: ['mcp://backlog/resources/missing.md'] });
    expect(result.items[0].content).toBeNull();
    expect(result.items[0].resource).toBeUndefined();
    expect(result.items[0].error).toContain('Not found: mcp://backlog/resources/missing.md');
  });

  // ── Bare-path alias (EXP-1 rerun P2): wakeup advertises root-relative
  // paths as "paths open with get" — the bare form must resolve exactly
  // like its mcp://backlog/... URI, and unknown paths must fail loudly.

  it('resolves a bare root path the same way as the mcp:// form', async () => {
    const svc = mockService();
    const bare = await getItems(svc, { ids: ['README.md'] });
    const uri = await getItems(svc, { ids: ['mcp://backlog/README.md'] });
    expect(bare.items[0].content).toBe('# Readme');
    expect(bare.items[0].content).toBe(uri.items[0].content);
    expect(bare.items[0].resource).toEqual(uri.items[0].resource);
  });

  it('resolves a nested docs path without the mcp:// prefix', async () => {
    const svc = mockService();
    const result = await getItems(svc, { ids: ['docs/adr/0001-example.md'] });
    expect(result.items[0].content).toBe('# ADR 0001');
    expect(result.items[0].resource?.mimeType).toBe('text/markdown');
  });

  it('returns a clear not-found error for an unknown bare path, never silent null', async () => {
    const svc = mockService();
    const result = await getItems(svc, { ids: ['docs/missing/nowhere.md'] });
    expect(result.items[0].content).toBeNull();
    expect(result.items[0].error).toContain('Not found: docs/missing/nowhere.md');
    expect(result.items[0].error).toContain('mcp://backlog/docs/missing/nowhere.md');
  });

  it('keeps the plain entity-miss contract for non-path ids', async () => {
    const svc = mockService();
    const result = await getItems(svc, { ids: ['TASK-9999'] });
    expect(result.items[0]).toEqual({ id: 'TASK-9999', content: null });
  });

  it('throws ValidationError on empty ID array', async () => {
    const svc = mockService();
    await expect(getItems(svc, { ids: [] })).rejects.toThrow(ValidationError);
  });

  it('mixes found and not-found in batch', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Found' })]);
    const result = await getItems(svc, { ids: ['TASK-0001', 'TASK-9999'] });
    expect(result.items[0].content).toContain('Found');
    expect(result.items[1].content).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// createEntity — no filesystem I/O, transport resolves source_path
// ═══════════════════════════════════════════════════════════════════

describe('core/createEntity', () => {
  it('generates sequential ID and adds to service', async () => {
    const svc = mockService();
    const result = await createEntity(svc, { title: 'New task' }, testCtx());
    expect(result.id).toBe('TASK-0001');
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({
      id: 'TASK-0001', title: 'New task',
    }));
    await expect(svc.get('TASK-0001')).resolves.toMatchObject({ status: 'open' });
  });

  it('generates type-specific ID prefix', async () => {
    const svc = mockService();
    expect((await createEntity(svc, { title: 'E', type: 'epic' as any }, testCtx())).id).toBe('EPIC-0001');
  });

  it('uses a service-owned allocator when available', async () => {
    const svc = mockService();
    svc.allocateId = vi.fn(async () => 'TASK-00009');

    expect((await createEntity(svc, { title: 'Claim-shaped' }, testCtx())).id).toBe('TASK-00009');
    expect(svc.getMaxId).not.toHaveBeenCalled();
  });

  it('sets parent_id when provided', async () => {
    const svc = mockService();
    const result = await createEntity(
      svc,
      { title: 'Child', parent_id: 'EPIC-0001' },
      testCtx(),
    );
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'EPIC-0001' }));
    expect(result).toEqual({ id: 'TASK-0001', parent_id: 'EPIC-0001' });
  });

  it('routes from the first referenced entity before session evidence', async () => {
    const svc = mockService([
      makeEntity({ id: 'EPIC-0001', title: 'Referenced epic', type: 'epic' }),
    ]);
    const ctx: WriteContext = {
      actor: { type: 'agent', name: 'agate' },
      operationLog: {
        append: () => {},
        query: async () => [{
          ts: new Date().toISOString(),
          tool: 'backlog_create_work',
          mutation: 'create',
          params: { parent_id: 'EPIC-0002' },
          result: {},
          actor: { type: 'agent', name: 'agate' },
        }],
        countForTask: async () => 0,
      },
    };

    const result = await createEntity(svc, {
      title: 'Referenced child',
      references: [{ url: 'mcp://backlog/tasks/EPIC-0001.md' }],
    }, ctx);

    expect(result).toEqual({
      id: 'TASK-0002',
      parent_id: 'EPIC-0001',
      routed_by: 'reference',
    });
  });

  it('uses bounded journal stickiness and records effective routing provenance', async () => {
    const entries: Array<{
      params: Record<string, unknown>;
      result: unknown;
    }> = [];
    const ctx: WriteContext = {
      actor: { type: 'agent', name: 'agate', taskContext: 'task-24' },
      operationLog: {
        append: (entry) => entries.push(entry),
        query: async () => [{
          ts: new Date().toISOString(),
          tool: 'backlog_create_work',
          mutation: 'create',
          params: {},
          result: { parent_id: 'EPIC-0003', routed_by: 'reference' },
          actor: { type: 'agent', name: 'agate', taskContext: 'task-24' },
        }],
        countForTask: async () => 0,
      },
    };

    const result = await createEntity(mockService(), { title: 'Burst task' }, ctx);

    expect(result).toEqual({
      id: 'TASK-0001',
      parent_id: 'EPIC-0003',
      routed_by: 'session',
    });
    expect(entries[0]).toMatchObject({
      params: { parent_id: 'EPIC-0003' },
      result,
    });
  });

  it('enforces required intake and applies a configured scope default', async () => {
    const svc = mockService();
    await expect(createEntity(svc, {
      title: 'Unattached artifact',
      type: EntityType.Artifact,
    }, testCtx())).rejects.toThrow(/requires an explicit parent_id/);

    const result = await createEntity(svc, {
      title: 'Scoped cron',
      type: EntityType.Cron,
      schedule: '0 9 * * 1',
      command: 'backlog wakeup',
    }, {
      ...testCtx(),
      scopeRoot: 'FLDR-0001',
    });
    expect(result).toEqual({
      id: 'CRON-0001',
      parent_id: 'FLDR-0001',
      routed_by: 'default',
    });
  });

  it('marks a parentless fallback as visibly unfiled', async () => {
    const result = await createEntity(
      mockService(),
      { title: 'Unfiled task' },
      testCtx(),
    );
    expect(result).toEqual({ id: 'TASK-0001', routed_by: 'default' });
  });

  it('accepts pre-resolved content (no source_path in core)', async () => {
    const svc = mockService();
    await createEntity(svc, { title: 'T', content: 'Content from file' }, testCtx());
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ content: 'Content from file' }));
  });

  it('includes references when provided', async () => {
    const svc = mockService();
    const refs = [{ url: 'https://example.com', title: 'Example' }];
    await createEntity(svc, { title: 'T', references: refs }, testCtx());
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ references: refs }));
  });

  it('named create params take precedence over generic fields', async () => {
    const svc = mockService();
    await createEntity(svc, {
      title: 'Named title',
      parent_id: 'FLDR-0001',
      fields: {
        title: 'Field title',
        parent_id: 'EPIC-0001',
      },
    }, testCtx());

    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Named title',
      parent_id: 'FLDR-0001',
    }));
  });

  it('records semantic create attribution, direct resource identity, and SSE class', async () => {
    const entries: unknown[] = [];
    const emit = vi.fn();
    const ctx: WriteContext = {
      actor: { type: 'agent', name: 'tester' },
      operationLog: {
        append: (entry) => entries.push(entry),
        query: async () => [],
        countForTask: async () => 0,
      },
      eventBus: { emit },
    };

    await createEntity(mockService(), { title: 'Tracked task' }, ctx);

    expect(entries).toEqual([
      expect.objectContaining({
        tool: 'backlog_create_work',
        mutation: 'create',
        resourceId: 'TASK-0001',
      }),
    ]);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'task_created',
      id: 'TASK-0001',
      tool: 'backlog_create_work',
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// updateEntity — consistent params object with id inside
// ═══════════════════════════════════════════════════════════════════

describe('core/updateEntity', () => {
  it('updates status', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    const result = await updateEntity(svc, { id: 'TASK-0001', status: 'done' }, testCtx());
    expect(result.id).toBe('TASK-0001');
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('throws NotFoundError for missing task', async () => {
    const svc = mockService();
    await expect(updateEntity(svc, { id: 'TASK-9999', status: 'done' }, testCtx())).rejects.toThrow(NotFoundError);
    await expect(updateEntity(svc, { id: 'TASK-9999' }, testCtx())).rejects.toThrow(NotFoundError);
  });

  it('null parent_id clears the canonical relationship field', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', parent_id: 'EPIC-0001' })]);
    await updateEntity(svc, { id: 'TASK-0001', parent_id: null }, testCtx());
    const saved = (svc.save as any).mock.calls[0][0];
    expect(saved.parent_id).toBeUndefined();
  });

  it('null due_date clears the field', async () => {
    const svc = mockService([makeEntity({ id: 'MLST-0001', title: 'M', type: 'milestone' as any, due_date: '2026-03-01' } as any)]);
    await updateEntity(svc, { id: 'MLST-0001', due_date: null }, testCtx());
    expect((svc.save as any).mock.calls[0][0].due_date).toBeUndefined();
  });

  it('sets due_date when string provided', async () => {
    const svc = mockService([makeEntity({ id: 'MLST-0001', title: 'M', type: 'milestone' as any })]);
    await updateEntity(svc, { id: 'MLST-0001', due_date: '2026-06-01' }, testCtx());
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ due_date: '2026-06-01' }));
  });

  it('updates evidence array', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    await updateEntity(svc, { id: 'TASK-0001', evidence: ['Fixed in PR #1'] }, testCtx());
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ evidence: ['Fixed in PR #1'] }));
  });

  it('named update params take precedence over generic fields', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    await updateEntity(svc, {
      id: 'TASK-0001',
      title: 'Named title',
      fields: {
        title: 'Field title',
        status: 'blocked',
      },
      status: 'done',
    }, testCtx());

    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Named title',
      status: 'done',
    }));
  });

  it('null in generic fields clears a substrate field', async () => {
    const svc = mockService([
      makeEntity({
        id: 'MLST-0001',
        title: 'M',
        type: 'milestone',
        due_date: '2026-03-01',
      } as Entity),
    ]);

    await updateEntity(svc, {
      id: 'MLST-0001',
      fields: { due_date: null },
    }, testCtx());

    expect(vi.mocked(svc.save).mock.calls[0]?.[0].due_date).toBeUndefined();
  });

  it('journals generic fields as effective top-level changes', async () => {
    const entries: Array<{ params: Record<string, unknown> }> = [];
    const ctx: WriteContext = {
      actor: { type: 'agent', name: 'tester' },
      operationLog: {
        append: (entry) => entries.push(entry),
        query: async () => [],
        countForTask: async () => 0,
      },
    };
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);

    await updateEntity(svc, {
      id: 'TASK-0001',
      fields: { status: 'done' },
    }, ctx);

    expect(entries[0]?.params).toEqual({
      id: 'TASK-0001',
      status: 'done',
    });
  });

  it('generic fields cannot replace server-owned identity', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);

    await updateEntity(svc, {
      id: 'TASK-0001',
      fields: {
        id: 'EPIC-9999',
        type: 'epic',
        created_at: '1900-01-01T00:00:00.000Z',
      },
    }, testCtx());

    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'TASK-0001',
      type: 'task',
      created_at: '2026-01-01T00:00:00.000Z',
    }));
  });

  it('records semantic update attribution and emits update-class SSE', async () => {
    const entries: unknown[] = [];
    const emit = vi.fn();
    const ctx: WriteContext = {
      actor: { type: 'agent', name: 'tester' },
      operationLog: {
        append: (entry) => entries.push(entry),
        query: async () => [],
        countForTask: async () => 0,
      },
      eventBus: { emit },
    };
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);

    await updateEntity(svc, { id: 'TASK-0001', status: 'done' }, ctx);

    expect(entries).toEqual([
      expect.objectContaining({
        tool: 'backlog_complete_task',
        mutation: 'update',
        resourceId: 'TASK-0001',
      }),
    ]);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'task_changed',
      id: 'TASK-0001',
      tool: 'backlog_complete_task',
    }));
  });

  it('always sets updated_at timestamp', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    await updateEntity(svc, { id: 'TASK-0001', title: 'New' }, testCtx());
    expect((svc.save as any).mock.calls[0][0].updated_at).not.toBe('2026-01-01T00:00:00.000Z');
  });
});

// ═══════════════════════════════════════════════════════════════════
// deleteItem — returns { id, deleted } boolean
// ═══════════════════════════════════════════════════════════════════

describe('core/deleteItem', () => {
  it('returns deleted=true when item existed', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    const result = await deleteItem(svc, { id: 'TASK-0001' }, testCtx());
    expect(result).toEqual({ id: 'TASK-0001', deleted: true });
    expect(svc.delete).toHaveBeenCalledWith('TASK-0001');
  });

  it('returns deleted=false when item did not exist', async () => {
    const svc = mockService();
    const result = await deleteItem(svc, { id: 'TASK-9999' }, testCtx());
    expect(result).toEqual({ id: 'TASK-9999', deleted: false });
  });
});

// ═══════════════════════════════════════════════════════════════════
// searchItems
// ═══════════════════════════════════════════════════════════════════

describe('core/searchItems', () => {
  it('returns formatted results with total and query', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Auth bug' })]);
    const result = await searchItems(svc, { query: 'auth' });
    expect(result.total).toBe(1);
    expect(result.query).toBe('auth');
    expect(result.search_mode).toBe('bm25');
    expect(result.results[0]).toMatchObject({ id: 'TASK-0001', title: 'Auth bug', type: 'task' });
  });

  it('throws ValidationError on empty query', async () => {
    const svc = mockService();
    await expect(searchItems(svc, { query: '  ' })).rejects.toThrow(ValidationError);
  });

  it('includes scores only when requested', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test' })]);
    expect((await searchItems(svc, { query: 'test' })).results[0].score).toBeUndefined();
    expect((await searchItems(svc, { query: 'test', include_scores: true })).results[0].score).toBeDefined();
  });

  it('includes content only when requested', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test', content: 'Full desc' })]);
    expect((await searchItems(svc, { query: 'test' })).results[0].content).toBeUndefined();
    expect((await searchItems(svc, { query: 'test', include_content: true })).results[0].content).toBe('Full desc');
  });

  it('includes snippet and matched_fields', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test' })]);
    const r = (await searchItems(svc, { query: 'test' })).results[0];
    expect(r.snippet).toBe('Test');
    expect(r.matched_fields).toEqual(['title']);
  });

  it('includes canonical parent_id', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'Test', parent_id: 'FLDR-0001' }),
      makeEntity({ id: 'TASK-0002', title: 'Test2' }),
    ]);
    const result = await searchItems(svc, { query: 'test' });
    expect(result.results[0].parent_id).toBe('FLDR-0001');
    expect(result.results[1].parent_id).toBeUndefined();
  });

  it('reports hybrid search mode when active', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test' })]);
    (svc.isHybridSearchActive as any).mockReturnValue(true);
    expect((await searchItems(svc, { query: 'test' })).search_mode).toBe('hybrid');
  });

  it('carries declared resource status into the search stub (BUG-0003)', async () => {
    const svc = mockService();
    (svc.searchUnified as any).mockResolvedValue([
      {
        item: { id: 'mcp://backlog/docs/issues/0016.md', path: 'docs/issues/0016.md', title: 'Issue 16', content: '…', status: 'Resolved (2026-07-01)' },
        score: 1,
        type: 'resource',
      },
      {
        item: { id: 'mcp://backlog/docs/notes/plain.md', path: 'docs/notes/plain.md', title: 'Plain', content: '…' },
        score: 0.5,
        type: 'resource',
      },
    ]);
    const result = await searchItems(svc, { query: 'issue' });
    expect(result.results[0].status).toBe('Resolved (2026-07-01)');
    expect(result.results[1].status).toBeUndefined();
  });

  it('passes all filters through to service', async () => {
    const svc = mockService();
    await searchItems(svc, { query: 'test', types: ['task'], status: ['open'], parent_id: 'EPIC-0001', sort: 'recent', limit: 5 });
    expect(svc.searchUnified).toHaveBeenCalledWith('test', {
      types: ['task'], status: ['open'], parent_id: 'EPIC-0001', sort: 'recent', limit: 5,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// editItem — throws NotFoundError, returns { success: false } for op errors
// ═══════════════════════════════════════════════════════════════════

describe('core/editItem', () => {
  it('applies str_replace operation', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', content: 'Hello world' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'str_replace', old_str: 'Hello', new_str: 'Goodbye' } }, testCtx());
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ content: 'Goodbye world' }));
  });

  it('applies append operation', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', content: 'Line 1' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'append', new_str: 'Line 2' } }, testCtx());
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ content: 'Line 1\nLine 2' }));
  });

  it('applies insert operation', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', content: 'Line 1\nLine 3' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'insert', insert_line: 1, new_str: 'Line 2' } }, testCtx());
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ content: 'Line 1\nLine 2\nLine 3' }));
  });

  it('throws NotFoundError for missing task', async () => {
    const svc = mockService();
    await expect(editItem(svc, { id: 'TASK-9999', operation: { type: 'append', new_str: 'text' } }, testCtx())).rejects.toThrow(NotFoundError);
  });

  it('returns { success: false } for failed str_replace (not found)', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', content: 'Hello' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'str_replace', old_str: 'MISSING', new_str: 'X' } }, testCtx());
    expect(result.success).toBe(false);
    expect(result.error).toContain('old_str not found');
  });

  it('returns { success: false } for non-unique str_replace', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', content: 'foo foo' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'str_replace', old_str: 'foo', new_str: 'bar' } }, testCtx());
    expect(result.success).toBe(false);
    expect(result.error).toContain('not unique');
  });

  it('handles empty content gracefully', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'append', new_str: 'First content' } }, testCtx());
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ content: 'First content' }));
  });

  it('sets updated_at on successful edit', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', content: 'text' })]);
    await editItem(svc, { id: 'TASK-0001', operation: { type: 'append', new_str: 'more' } }, testCtx());
    expect((svc.save as any).mock.calls[0][0].updated_at).not.toBe('2026-01-01T00:00:00.000Z');
  });
});


// ═══════════════════════════════════════════════════════════════════
// createEntity — cron entity
// ═══════════════════════════════════════════════════════════════════

describe('core/createEntity — cron entity', () => {
  it('creates CRON-0001 with schedule, command, and default enabled=true', async () => {
    const svc = mockService();
    const result = await createEntity(svc, {
      title: 'Review queue poll',
      type: 'cron' as any,
      schedule: '*/30 * * * *',
      command: 'studio-agents check-reviews',
    }, testCtx());
    expect(result.id).toBe('CRON-0001');
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({
      id: 'CRON-0001',
      title: 'Review queue poll',
      type: 'cron',
      schedule: '*/30 * * * *',
      command: 'studio-agents check-reviews',
    }));
    await expect(svc.get('CRON-0001')).resolves.toMatchObject({ enabled: true });
  });

  it('respects explicit enabled=false on creation', async () => {
    const svc = mockService();
    await createEntity(svc, {
      title: 'Staged cron',
      type: 'cron' as any,
      schedule: '*/15 * * * *',
      command: 'echo hi',
      enabled: false,
    }, testCtx());
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('rejects type=cron without schedule', async () => {
    const svc = mockService();
    await expect(createEntity(svc, {
      title: 'Bad', type: 'cron' as any, command: 'echo',
    }, testCtx())).rejects.toThrow(ValidationError);
    await expect(createEntity(svc, {
      title: 'Bad', type: 'cron' as any, command: 'echo',
    }, testCtx())).rejects.toThrow(/schedule/);
  });

  it('rejects type=cron without command', async () => {
    const svc = mockService();
    await expect(createEntity(svc, {
      title: 'Bad', type: 'cron' as any, schedule: '* * * * *',
    }, testCtx())).rejects.toThrow(ValidationError);
    await expect(createEntity(svc, {
      title: 'Bad', type: 'cron' as any, schedule: '* * * * *',
    }, testCtx())).rejects.toThrow(/command/);
  });

  it('rejects invalid cron expression', async () => {
    const svc = mockService();
    await expect(createEntity(svc, {
      title: 'Bad', type: 'cron' as any,
      schedule: 'garbage', command: 'echo',
    }, testCtx())).rejects.toThrow(/Invalid cron expression/);
  });

  it('rejects schedule/command/enabled on non-cron types', async () => {
    const svc = mockService();
    // Zod's discriminated-union + .strict() rejects unknown keys on the task branch.
    await expect(createEntity(svc, {
      title: 'Bad Task', schedule: '* * * * *',
    }, testCtx())).rejects.toThrow(/schedule/);
    await expect(createEntity(svc, {
      title: 'Bad Task', command: 'echo',
    }, testCtx())).rejects.toThrow(/command/);
    await expect(createEntity(svc, {
      title: 'Bad Task', enabled: true,
    }, testCtx())).rejects.toThrow(/enabled/);
  });

  it('allows cron parented under an epic', async () => {
    const svc = mockService();
    await createEntity(svc, {
      title: 'Review queue',
      type: 'cron' as any,
      schedule: '*/30 * * * *',
      command: 'studio-agents check-reviews',
      parent_id: 'EPIC-0043',
    }, testCtx());
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({
      parent_id: 'EPIC-0043',
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// updateEntity — cron entity
// ═══════════════════════════════════════════════════════════════════

describe('core/updateEntity — cron entity', () => {
  function makeCron(overrides: Partial<Entity> = {}) {
    return makeEntity({
      id: 'CRON-0001',
      title: 'Test cron',
      type: 'cron' as any,
      schedule: '*/30 * * * *',
      command: 'echo hi',
      enabled: true,
      ...overrides,
    });
  }

  it('updates schedule with valid expression', async () => {
    const svc = mockService([makeCron()]);
    await updateEntity(svc, { id: 'CRON-0001', schedule: '*/15 * * * *' } as any, testCtx());
    expect((svc.save as any).mock.calls[0][0].schedule).toBe('*/15 * * * *');
  });

  it('rejects invalid cron expression on update', async () => {
    const svc = mockService([makeCron()]);
    await expect(updateEntity(svc, {
      id: 'CRON-0001', schedule: 'garbage',
    } as any, testCtx())).rejects.toThrow(/Invalid cron expression/);
  });

  it('toggles enabled field', async () => {
    const svc = mockService([makeCron()]);
    await updateEntity(svc, { id: 'CRON-0001', enabled: false } as any, testCtx());
    expect((svc.save as any).mock.calls[0][0].enabled).toBe(false);
  });

  it('scheduler writes last_run and next_run', async () => {
    const svc = mockService([makeCron()]);
    await updateEntity(svc, {
      id: 'CRON-0001',
      last_run: '2026-04-28T22:00:00.000Z',
      next_run: '2026-04-28T22:30:00.000Z',
    } as any, testCtx());
    const saved = (svc.save as any).mock.calls[0][0];
    expect(saved.last_run).toBe('2026-04-28T22:00:00.000Z');
    expect(saved.next_run).toBe('2026-04-28T22:30:00.000Z');
  });

  it('null last_run clears the field', async () => {
    const svc = mockService([makeCron({ last_run: '2026-04-28T22:00:00.000Z' })]);
    await updateEntity(svc, { id: 'CRON-0001', last_run: null } as any, testCtx());
    expect((svc.save as any).mock.calls[0][0].last_run).toBeUndefined();
  });

  it('null next_run clears the field', async () => {
    const svc = mockService([makeCron({ next_run: '2026-04-28T22:30:00.000Z' })]);
    await updateEntity(svc, { id: 'CRON-0001', next_run: null } as any, testCtx());
    expect((svc.save as any).mock.calls[0][0].next_run).toBeUndefined();
  });

  it('updates command', async () => {
    const svc = mockService([makeCron()]);
    await updateEntity(svc, { id: 'CRON-0001', command: 'new-command --arg' } as any, testCtx());
    expect((svc.save as any).mock.calls[0][0].command).toBe('new-command --arg');
  });

  it('rejects cron fields on a non-cron entity', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    // Zod's TaskSchema.strict() rejects unknown keys (schedule, command, enabled, last_run).
    await expect(updateEntity(svc, {
      id: 'TASK-0001', schedule: '* * * * *',
    } as any, testCtx())).rejects.toThrow(/schedule/);
    await expect(updateEntity(svc, {
      id: 'TASK-0001', command: 'echo',
    } as any, testCtx())).rejects.toThrow(/command/);
    await expect(updateEntity(svc, {
      id: 'TASK-0001', enabled: true,
    } as any, testCtx())).rejects.toThrow(/enabled/);
    await expect(updateEntity(svc, {
      id: 'TASK-0001', last_run: '2026-04-28T22:00:00.000Z',
    } as any, testCtx())).rejects.toThrow(/last_run/);
  });

  it('allows title/status updates on a cron without touching cron fields', async () => {
    const svc = mockService([makeCron()]);
    await updateEntity(svc, { id: 'CRON-0001', title: 'Renamed', status: 'blocked' }, testCtx());
    const saved = (svc.save as any).mock.calls[0][0];
    expect(saved.title).toBe('Renamed');
    expect(saved.status).toBe('blocked');
    expect(saved.schedule).toBe('*/30 * * * *');
    expect(saved.command).toBe('echo hi');
    expect(saved.enabled).toBe(true);
  });
});
