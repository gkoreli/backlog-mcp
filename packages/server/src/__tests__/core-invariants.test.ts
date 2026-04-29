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
import type { IBacklogService } from '../storage/service-types.js';
import type { Entity } from '@backlog-mcp/shared';
import { listItems } from '../core/list.js';
import { getItems } from '../core/get.js';
import { createItem } from '../core/create.js';
import { updateItem } from '../core/update.js';
import { deleteItem } from '../core/delete.js';
import { searchItems } from '../core/search.js';
import { editItem } from '../core/edit.js';
import { NotFoundError, ValidationError, type WriteContext } from '../core/types.js';

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
      return `---\nid: ${e.id}\ntitle: ${e.title}\nstatus: ${e.status}\n---\n\n${e.description ?? ''}`;
    }),
    list: vi.fn(async (filter?: any) => {
      let result = [...store.values()];
      if (filter?.status) result = result.filter(e => filter.status.includes(e.status));
      if (filter?.type) result = result.filter(e => (e.type ?? 'task') === filter.type);
      if (filter?.parent_id) result = result.filter(e => e.parent_id === filter.parent_id || e.epic_id === filter.parent_id);
      if (filter?.limit) result = result.slice(0, filter.limit);
      return result;
    }),
    add: vi.fn(async (task: Entity) => { store.set(task.id, { ...task }); }),
    save: vi.fn(async (task: Entity) => { store.set(task.id, { ...task }); }),
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
        (e.description ?? '').toLowerCase().includes(query.toLowerCase())
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

  it('resolves parent_id from epic_id alias on entities', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', epic_id: 'EPIC-0001' })]);
    const result = await listItems(svc, {});
    expect(result.tasks[0].parent_id).toBe('EPIC-0001');
  });

  it('parent_id filter takes precedence over epic_id filter', async () => {
    const svc = mockService();
    await listItems(svc, { epic_id: 'EPIC-0001', parent_id: 'FLDR-0001' });
    expect(svc.list).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'FLDR-0001' }));
  });

  it('falls back to epic_id when parent_id filter not provided', async () => {
    const svc = mockService();
    await listItems(svc, { epic_id: 'EPIC-0001' });
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

  it('returns null for missing resource URI', async () => {
    const svc = mockService();
    const result = await getItems(svc, { ids: ['mcp://backlog/resources/missing.md'] });
    expect(result.items[0].content).toBeNull();
    expect(result.items[0].resource).toBeUndefined();
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
// createItem — no filesystem I/O, transport resolves source_path
// ═══════════════════════════════════════════════════════════════════

describe('core/createItem', () => {
  it('generates sequential ID and adds to service', async () => {
    const svc = mockService();
    const result = await createItem(svc, { title: 'New task' }, testCtx());
    expect(result.id).toBe('TASK-0001');
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({
      id: 'TASK-0001', title: 'New task', status: 'open',
    }));
  });

  it('generates type-specific ID prefix', async () => {
    const svc = mockService();
    expect((await createItem(svc, { title: 'E', type: 'epic' as any }, testCtx())).id).toBe('EPIC-0001');
  });

  it('sets parent_id when provided', async () => {
    const svc = mockService();
    await createItem(svc, { title: 'Child', parent_id: 'EPIC-0001' }, testCtx());
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'EPIC-0001' }));
  });

  it('parent_id takes precedence over epic_id', async () => {
    const svc = mockService();
    await createItem(svc, { title: 'T', epic_id: 'EPIC-0001', parent_id: 'FLDR-0001' }, testCtx());
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'FLDR-0001' }));
  });

  it('sets epic_id for backward compat when only epic_id provided', async () => {
    const svc = mockService();
    await createItem(svc, { title: 'T', epic_id: 'EPIC-0001' }, testCtx());
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ epic_id: 'EPIC-0001' }));
  });

  it('accepts pre-resolved description (no source_path in core)', async () => {
    const svc = mockService();
    await createItem(svc, { title: 'T', description: 'Content from file' }, testCtx());
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ description: 'Content from file' }));
  });

  it('includes references when provided', async () => {
    const svc = mockService();
    const refs = [{ url: 'https://example.com', title: 'Example' }];
    await createItem(svc, { title: 'T', references: refs }, testCtx());
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ references: refs }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// updateItem — consistent params object with id inside
// ═══════════════════════════════════════════════════════════════════

describe('core/updateItem', () => {
  it('updates status', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    const result = await updateItem(svc, { id: 'TASK-0001', status: 'done' }, testCtx());
    expect(result.id).toBe('TASK-0001');
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('throws NotFoundError for missing task', async () => {
    const svc = mockService();
    await expect(updateItem(svc, { id: 'TASK-9999', status: 'done' }, testCtx())).rejects.toThrow(NotFoundError);
    await expect(updateItem(svc, { id: 'TASK-9999' }, testCtx())).rejects.toThrow(NotFoundError);
  });

  it('parent_id takes precedence over epic_id', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    await updateItem(svc, { id: 'TASK-0001', epic_id: 'EPIC-0001', parent_id: 'FLDR-0001' }, testCtx());
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'FLDR-0001' }));
  });

  it('null parent_id clears both parent_id and epic_id', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', parent_id: 'EPIC-0001', epic_id: 'EPIC-0001' })]);
    await updateItem(svc, { id: 'TASK-0001', parent_id: null }, testCtx());
    const saved = (svc.save as any).mock.calls[0][0];
    expect(saved.parent_id).toBeUndefined();
    expect(saved.epic_id).toBeUndefined();
  });

  it('null epic_id clears both epic_id and parent_id', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', parent_id: 'EPIC-0001', epic_id: 'EPIC-0001' })]);
    await updateItem(svc, { id: 'TASK-0001', epic_id: null }, testCtx());
    const saved = (svc.save as any).mock.calls[0][0];
    expect(saved.parent_id).toBeUndefined();
    expect(saved.epic_id).toBeUndefined();
  });

  it('setting epic_id also sets parent_id', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    await updateItem(svc, { id: 'TASK-0001', epic_id: 'EPIC-0002' }, testCtx());
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ epic_id: 'EPIC-0002', parent_id: 'EPIC-0002' }));
  });

  it('null due_date clears the field', async () => {
    const svc = mockService([makeEntity({ id: 'MLST-0001', title: 'M', type: 'milestone' as any, due_date: '2026-03-01' } as any)]);
    await updateItem(svc, { id: 'MLST-0001', due_date: null }, testCtx());
    expect((svc.save as any).mock.calls[0][0].due_date).toBeUndefined();
  });

  it('sets due_date when string provided', async () => {
    const svc = mockService([makeEntity({ id: 'MLST-0001', title: 'M', type: 'milestone' as any })]);
    await updateItem(svc, { id: 'MLST-0001', due_date: '2026-06-01' }, testCtx());
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ due_date: '2026-06-01' }));
  });

  it('updates evidence array', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    await updateItem(svc, { id: 'TASK-0001', evidence: ['Fixed in PR #1'] }, testCtx());
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ evidence: ['Fixed in PR #1'] }));
  });

  it('always sets updated_at timestamp', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    await updateItem(svc, { id: 'TASK-0001', title: 'New' }, testCtx());
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
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test', description: 'Full desc' })]);
    expect((await searchItems(svc, { query: 'test' })).results[0].description).toBeUndefined();
    expect((await searchItems(svc, { query: 'test', include_content: true })).results[0].description).toBe('Full desc');
  });

  it('includes snippet and matched_fields', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test' })]);
    const r = (await searchItems(svc, { query: 'test' })).results[0];
    expect(r.snippet).toBe('Test');
    expect(r.matched_fields).toEqual(['title']);
  });

  it('includes parent_id from parent_id or epic_id', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'Test', parent_id: 'FLDR-0001' }),
      makeEntity({ id: 'TASK-0002', title: 'Test2', epic_id: 'EPIC-0001' }),
    ]);
    const result = await searchItems(svc, { query: 'test' });
    expect(result.results[0].parent_id).toBe('FLDR-0001');
    expect(result.results[1].parent_id).toBe('EPIC-0001');
  });

  it('reports hybrid search mode when active', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test' })]);
    (svc.isHybridSearchActive as any).mockReturnValue(true);
    expect((await searchItems(svc, { query: 'test' })).search_mode).toBe('hybrid');
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
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'Hello world' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'str_replace', old_str: 'Hello', new_str: 'Goodbye' } }, testCtx());
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ description: 'Goodbye world' }));
  });

  it('applies append operation', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'Line 1' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'append', new_str: 'Line 2' } }, testCtx());
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ description: 'Line 1\nLine 2' }));
  });

  it('applies insert operation', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'Line 1\nLine 3' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'insert', insert_line: 1, new_str: 'Line 2' } }, testCtx());
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ description: 'Line 1\nLine 2\nLine 3' }));
  });

  it('throws NotFoundError for missing task', async () => {
    const svc = mockService();
    await expect(editItem(svc, { id: 'TASK-9999', operation: { type: 'append', new_str: 'text' } }, testCtx())).rejects.toThrow(NotFoundError);
  });

  it('returns { success: false } for failed str_replace (not found)', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'Hello' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'str_replace', old_str: 'MISSING', new_str: 'X' } }, testCtx());
    expect(result.success).toBe(false);
    expect(result.error).toContain('old_str not found');
  });

  it('returns { success: false } for non-unique str_replace', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'foo foo' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'str_replace', old_str: 'foo', new_str: 'bar' } }, testCtx());
    expect(result.success).toBe(false);
    expect(result.error).toContain('not unique');
  });

  it('handles empty description gracefully', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    const result = await editItem(svc, { id: 'TASK-0001', operation: { type: 'append', new_str: 'First content' } }, testCtx());
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ description: 'First content' }));
  });

  it('sets updated_at on successful edit', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'text' })]);
    await editItem(svc, { id: 'TASK-0001', operation: { type: 'append', new_str: 'more' } }, testCtx());
    expect((svc.save as any).mock.calls[0][0].updated_at).not.toBe('2026-01-01T00:00:00.000Z');
  });
});


// ═══════════════════════════════════════════════════════════════════
// createItem — cron entity
// ═══════════════════════════════════════════════════════════════════

describe('core/createItem — cron entity', () => {
  it('creates CRON-0001 with schedule, command, and default enabled=true', async () => {
    const svc = mockService();
    const result = await createItem(svc, {
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
      enabled: true,
    }));
  });

  it('respects explicit enabled=false on creation', async () => {
    const svc = mockService();
    await createItem(svc, {
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
    await expect(createItem(svc, {
      title: 'Bad', type: 'cron' as any, command: 'echo',
    }, testCtx())).rejects.toThrow(ValidationError);
    await expect(createItem(svc, {
      title: 'Bad', type: 'cron' as any, command: 'echo',
    }, testCtx())).rejects.toThrow(/schedule/);
  });

  it('rejects type=cron without command', async () => {
    const svc = mockService();
    await expect(createItem(svc, {
      title: 'Bad', type: 'cron' as any, schedule: '* * * * *',
    }, testCtx())).rejects.toThrow(ValidationError);
    await expect(createItem(svc, {
      title: 'Bad', type: 'cron' as any, schedule: '* * * * *',
    }, testCtx())).rejects.toThrow(/command/);
  });

  it('rejects invalid cron expression', async () => {
    const svc = mockService();
    await expect(createItem(svc, {
      title: 'Bad', type: 'cron' as any,
      schedule: 'garbage', command: 'echo',
    }, testCtx())).rejects.toThrow(/Invalid cron expression/);
  });

  it('rejects schedule/command/enabled on non-cron types', async () => {
    const svc = mockService();
    // Zod's discriminated-union + .strict() rejects unknown keys on the task branch.
    await expect(createItem(svc, {
      title: 'Bad Task', schedule: '* * * * *',
    }, testCtx())).rejects.toThrow(/schedule/);
    await expect(createItem(svc, {
      title: 'Bad Task', command: 'echo',
    }, testCtx())).rejects.toThrow(/command/);
    await expect(createItem(svc, {
      title: 'Bad Task', enabled: true,
    }, testCtx())).rejects.toThrow(/enabled/);
  });

  it('allows cron parented under an epic', async () => {
    const svc = mockService();
    await createItem(svc, {
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
// updateItem — cron entity
// ═══════════════════════════════════════════════════════════════════

describe('core/updateItem — cron entity', () => {
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
    await updateItem(svc, { id: 'CRON-0001', schedule: '*/15 * * * *' } as any, testCtx());
    expect((svc.save as any).mock.calls[0][0].schedule).toBe('*/15 * * * *');
  });

  it('rejects invalid cron expression on update', async () => {
    const svc = mockService([makeCron()]);
    await expect(updateItem(svc, {
      id: 'CRON-0001', schedule: 'garbage',
    } as any, testCtx())).rejects.toThrow(/Invalid cron expression/);
  });

  it('toggles enabled field', async () => {
    const svc = mockService([makeCron()]);
    await updateItem(svc, { id: 'CRON-0001', enabled: false } as any, testCtx());
    expect((svc.save as any).mock.calls[0][0].enabled).toBe(false);
  });

  it('scheduler writes last_run and next_run', async () => {
    const svc = mockService([makeCron()]);
    await updateItem(svc, {
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
    await updateItem(svc, { id: 'CRON-0001', last_run: null } as any, testCtx());
    expect((svc.save as any).mock.calls[0][0].last_run).toBeUndefined();
  });

  it('null next_run clears the field', async () => {
    const svc = mockService([makeCron({ next_run: '2026-04-28T22:30:00.000Z' })]);
    await updateItem(svc, { id: 'CRON-0001', next_run: null } as any, testCtx());
    expect((svc.save as any).mock.calls[0][0].next_run).toBeUndefined();
  });

  it('updates command', async () => {
    const svc = mockService([makeCron()]);
    await updateItem(svc, { id: 'CRON-0001', command: 'new-command --arg' } as any, testCtx());
    expect((svc.save as any).mock.calls[0][0].command).toBe('new-command --arg');
  });

  it('rejects cron fields on a non-cron entity', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    // Zod's TaskSchema.strict() rejects unknown keys (schedule, command, enabled, last_run).
    await expect(updateItem(svc, {
      id: 'TASK-0001', schedule: '* * * * *',
    } as any, testCtx())).rejects.toThrow(/schedule/);
    await expect(updateItem(svc, {
      id: 'TASK-0001', command: 'echo',
    } as any, testCtx())).rejects.toThrow(/command/);
    await expect(updateItem(svc, {
      id: 'TASK-0001', enabled: true,
    } as any, testCtx())).rejects.toThrow(/enabled/);
    await expect(updateItem(svc, {
      id: 'TASK-0001', last_run: '2026-04-28T22:00:00.000Z',
    } as any, testCtx())).rejects.toThrow(/last_run/);
  });

  it('allows title/status updates on a cron without touching cron fields', async () => {
    const svc = mockService([makeCron()]);
    await updateItem(svc, { id: 'CRON-0001', title: 'Renamed', status: 'blocked' }, testCtx());
    const saved = (svc.save as any).mock.calls[0][0];
    expect(saved.title).toBe('Renamed');
    expect(saved.status).toBe('blocked');
    expect(saved.schedule).toBe('*/30 * * * *');
    expect(saved.command).toBe('echo hi');
    expect(saved.enabled).toBe(true);
  });
});
