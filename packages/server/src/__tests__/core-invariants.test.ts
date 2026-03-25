/**
 * Core function invariant tests.
 *
 * These tests verify the behavioral contract of each core function
 * independent of transport (MCP/CLI). They serve as the regression
 * safety net for the refactoring in ADR-0090.
 *
 * Every invariant here must hold regardless of how the function is called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IBacklogService } from '../storage/service-types.js';
import type { Entity } from '@backlog-mcp/shared';
import { listItems } from '../core/list.js';
import { getItems } from '../core/get.js';
import { createItem } from '../core/create.js';
import { updateItem } from '../core/update.js';
import { deleteItem } from '../core/delete.js';
import { searchItems } from '../core/search.js';
import { writeBody } from '../core/write.js';
import { NotFoundError } from '../core/types.js';

// ── Mock Service Factory ──

function makeEntity(overrides: Partial<Entity> & { id: string; title: string }): Entity {
  return {
    status: 'open',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
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
    searchUnified: vi.fn(async (query: string, options?: any) => {
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

// ── listItems ──

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
    // No parent_id → undefined in output
    expect(result.tasks[1].parent_id).toBeUndefined();
  });

  it('resolves parent_id from epic_id alias', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'T', epic_id: 'EPIC-0001' }),
    ]);
    const result = await listItems(svc, {});
    expect(result.tasks[0].parent_id).toBe('EPIC-0001');
  });

  it('parent_id takes precedence over epic_id in filter', async () => {
    const svc = mockService();
    await listItems(svc, { epic_id: 'EPIC-0001', parent_id: 'FLDR-0001' });
    expect(svc.list).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'FLDR-0001' }));
  });

  it('falls back to epic_id when parent_id not provided', async () => {
    const svc = mockService();
    await listItems(svc, { epic_id: 'EPIC-0001' });
    expect(svc.list).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'EPIC-0001' }));
  });

  it('includes counts only when requested', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    const without = await listItems(svc, {});
    expect(without.counts).toBeUndefined();

    const with_ = await listItems(svc, { counts: true });
    expect(with_.counts).toBeDefined();
    expect(with_.counts!.total_tasks).toBe(1);
  });

  it('passes status filter through', async () => {
    const svc = mockService();
    await listItems(svc, { status: ['done'] });
    expect(svc.list).toHaveBeenCalledWith(expect.objectContaining({ status: ['done'] }));
  });

  it('passes type filter through', async () => {
    const svc = mockService();
    await listItems(svc, { type: 'epic' as any });
    expect(svc.list).toHaveBeenCalledWith(expect.objectContaining({ type: 'epic' }));
  });

  it('passes limit through', async () => {
    const svc = mockService();
    await listItems(svc, { limit: 5 });
    expect(svc.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
  });
});

// ── getItems ──

describe('core/getItems', () => {
  it('returns markdown for a single task', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test' })]);
    const result = await getItems(svc, ['TASK-0001']);
    expect(result.content).toContain('TASK-0001');
    expect(result.content).toContain('Test');
  });

  it('returns "Not found" for missing task', async () => {
    const svc = mockService();
    const result = await getItems(svc, ['TASK-9999']);
    expect(result.content).toBe('Not found: TASK-9999');
  });

  it('batch fetches multiple IDs with separator', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'First' }),
      makeEntity({ id: 'TASK-0002', title: 'Second' }),
    ]);
    const result = await getItems(svc, ['TASK-0001', 'TASK-0002']);
    expect(result.content).toContain('First');
    expect(result.content).toContain('Second');
    expect(result.content).toContain('---');
  });

  it('handles resource URIs', async () => {
    const svc = mockService();
    const result = await getItems(svc, ['mcp://backlog/resources/test.md']);
    expect(result.content).toContain('# Resource: mcp://backlog/resources/test.md');
    expect(result.content).toContain('MIME: text/markdown');
    expect(result.content).toContain('# Test Resource');
  });

  it('returns "Not found" for missing resource URI', async () => {
    const svc = mockService();
    const result = await getItems(svc, ['mcp://backlog/resources/missing.md']);
    expect(result.content).toContain('Not found: mcp://backlog/resources/missing.md');
  });

  it('throws on empty ID array', async () => {
    const svc = mockService();
    await expect(getItems(svc, [])).rejects.toThrow('Required: id');
  });
});

// ── createItem ──

describe('core/createItem', () => {
  it('generates sequential ID and adds to service', async () => {
    const svc = mockService();
    const result = await createItem(svc, { title: 'New task' });
    expect(result.id).toBe('TASK-0001');
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({
      id: 'TASK-0001', title: 'New task', status: 'open',
    }));
  });

  it('generates epic ID for type=epic', async () => {
    const svc = mockService();
    const result = await createItem(svc, { title: 'New epic', type: 'epic' as any });
    expect(result.id).toBe('EPIC-0001');
  });

  it('sets parent_id when provided', async () => {
    const svc = mockService();
    await createItem(svc, { title: 'Child', parent_id: 'EPIC-0001' });
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'EPIC-0001' }));
  });

  it('parent_id takes precedence over epic_id', async () => {
    const svc = mockService();
    await createItem(svc, { title: 'T', epic_id: 'EPIC-0001', parent_id: 'FLDR-0001' });
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'FLDR-0001' }));
  });

  it('sets epic_id for backward compat when only epic_id provided', async () => {
    const svc = mockService();
    await createItem(svc, { title: 'T', epic_id: 'EPIC-0001' });
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ epic_id: 'EPIC-0001' }));
  });

  it('throws when both description and source_path provided', async () => {
    const svc = mockService();
    await expect(createItem(svc, {
      title: 'T', description: 'desc', source_path: '/some/file.md',
    })).rejects.toThrow('Cannot provide both description and source_path');
  });

  it('includes references when provided', async () => {
    const svc = mockService();
    const refs = [{ url: 'https://example.com', title: 'Example' }];
    await createItem(svc, { title: 'T', references: refs });
    expect(svc.add).toHaveBeenCalledWith(expect.objectContaining({ references: refs }));
  });
});

// ── updateItem ──

describe('core/updateItem', () => {
  it('updates status', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    const result = await updateItem(svc, 'TASK-0001', { status: 'done' });
    expect(result.id).toBe('TASK-0001');
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('throws NotFoundError for missing task', async () => {
    const svc = mockService();
    await expect(updateItem(svc, 'TASK-9999', { status: 'done' })).rejects.toThrow(NotFoundError);
  });

  it('parent_id takes precedence over epic_id', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    await updateItem(svc, 'TASK-0001', { epic_id: 'EPIC-0001', parent_id: 'FLDR-0001' });
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'FLDR-0001' }));
  });

  it('null parent_id clears both parent_id and epic_id', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', parent_id: 'EPIC-0001', epic_id: 'EPIC-0001' })]);
    await updateItem(svc, 'TASK-0001', { parent_id: null });
    const saved = (svc.save as any).mock.calls[0][0];
    expect(saved.parent_id).toBeUndefined();
    expect(saved.epic_id).toBeUndefined();
  });

  it('null epic_id clears both epic_id and parent_id', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', parent_id: 'EPIC-0001', epic_id: 'EPIC-0001' })]);
    await updateItem(svc, 'TASK-0001', { epic_id: null });
    const saved = (svc.save as any).mock.calls[0][0];
    expect(saved.parent_id).toBeUndefined();
    expect(saved.epic_id).toBeUndefined();
  });

  it('setting epic_id also sets parent_id', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    await updateItem(svc, 'TASK-0001', { epic_id: 'EPIC-0002' });
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({
      epic_id: 'EPIC-0002', parent_id: 'EPIC-0002',
    }));
  });

  it('null due_date clears the field', async () => {
    const svc = mockService([makeEntity({ id: 'MLST-0001', title: 'M', due_date: '2026-03-01' })]);
    await updateItem(svc, 'MLST-0001', { due_date: null });
    const saved = (svc.save as any).mock.calls[0][0];
    expect(saved.due_date).toBeUndefined();
  });

  it('sets due_date when string provided', async () => {
    const svc = mockService([makeEntity({ id: 'MLST-0001', title: 'M' })]);
    await updateItem(svc, 'MLST-0001', { due_date: '2026-06-01' });
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ due_date: '2026-06-01' }));
  });

  it('updates evidence array', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    await updateItem(svc, 'TASK-0001', { evidence: ['Fixed in PR #1'] });
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ evidence: ['Fixed in PR #1'] }));
  });

  it('sets updated_at timestamp', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    await updateItem(svc, 'TASK-0001', { title: 'New' });
    const saved = (svc.save as any).mock.calls[0][0];
    expect(saved.updated_at).not.toBe('2026-01-01T00:00:00.000Z');
  });
});

// ── deleteItem ──

describe('core/deleteItem', () => {
  it('calls service.delete and returns id', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    const result = await deleteItem(svc, 'TASK-0001');
    expect(result.id).toBe('TASK-0001');
    expect(svc.delete).toHaveBeenCalledWith('TASK-0001');
  });
});

// ── searchItems ──

describe('core/searchItems', () => {
  it('returns formatted results with total and query', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Auth bug' })]);
    const result = await searchItems(svc, { query: 'auth' });
    expect(result.total).toBe(1);
    expect(result.query).toBe('auth');
    expect(result.search_mode).toBe('bm25');
    expect(result.results[0]).toMatchObject({ id: 'TASK-0001', title: 'Auth bug', type: 'task' });
  });

  it('throws on empty query', async () => {
    const svc = mockService();
    await expect(searchItems(svc, { query: '  ' })).rejects.toThrow('Query must not be empty');
  });

  it('includes scores only when requested', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test' })]);
    const without = await searchItems(svc, { query: 'test' });
    expect(without.results[0].score).toBeUndefined();

    const with_ = await searchItems(svc, { query: 'test', include_scores: true });
    expect(with_.results[0].score).toBeDefined();
  });

  it('includes content only when requested', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test', description: 'Full desc' })]);
    const without = await searchItems(svc, { query: 'test' });
    expect(without.results[0].description).toBeUndefined();

    const with_ = await searchItems(svc, { query: 'test', include_content: true });
    expect(with_.results[0].description).toBe('Full desc');
  });

  it('includes snippet and matched_fields', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'Test' })]);
    const result = await searchItems(svc, { query: 'test' });
    expect(result.results[0].snippet).toBe('Test');
    expect(result.results[0].matched_fields).toEqual(['title']);
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
    const result = await searchItems(svc, { query: 'test' });
    expect(result.search_mode).toBe('hybrid');
  });

  it('passes filters through to service', async () => {
    const svc = mockService();
    await searchItems(svc, { query: 'test', types: ['task'], status: ['open'], parent_id: 'EPIC-0001', sort: 'recent', limit: 5 });
    expect(svc.searchUnified).toHaveBeenCalledWith('test', {
      types: ['task'], status: ['open'], parent_id: 'EPIC-0001', sort: 'recent', limit: 5,
    });
  });
});

// ── writeBody ──

describe('core/writeBody', () => {
  it('applies str_replace operation', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'Hello world' })]);
    const result = await writeBody(svc, {
      id: 'TASK-0001',
      operation: { type: 'str_replace', old_str: 'Hello', new_str: 'Goodbye' },
    });
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ description: 'Goodbye world' }));
  });

  it('applies append operation', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'Line 1' })]);
    const result = await writeBody(svc, {
      id: 'TASK-0001',
      operation: { type: 'append', new_str: 'Line 2' },
    });
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ description: 'Line 1\nLine 2' }));
  });

  it('applies insert operation', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'Line 1\nLine 3' })]);
    const result = await writeBody(svc, {
      id: 'TASK-0001',
      operation: { type: 'insert', insert_line: 1, new_str: 'Line 2' },
    });
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ description: 'Line 1\nLine 2\nLine 3' }));
  });

  it('throws NotFoundError for missing task', async () => {
    const svc = mockService();
    await expect(writeBody(svc, {
      id: 'TASK-9999',
      operation: { type: 'append', new_str: 'text' },
    })).rejects.toThrow(NotFoundError);
  });

  it('returns error for failed str_replace (not found)', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'Hello' })]);
    const result = await writeBody(svc, {
      id: 'TASK-0001',
      operation: { type: 'str_replace', old_str: 'MISSING', new_str: 'X' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('old_str not found');
  });

  it('returns error for non-unique str_replace', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'foo foo' })]);
    const result = await writeBody(svc, {
      id: 'TASK-0001',
      operation: { type: 'str_replace', old_str: 'foo', new_str: 'bar' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not unique');
  });

  it('handles empty description gracefully', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T' })]);
    const result = await writeBody(svc, {
      id: 'TASK-0001',
      operation: { type: 'append', new_str: 'First content' },
    });
    expect(result.success).toBe(true);
    expect(svc.save).toHaveBeenCalledWith(expect.objectContaining({ description: 'First content' }));
  });

  it('sets updated_at on successful write', async () => {
    const svc = mockService([makeEntity({ id: 'TASK-0001', title: 'T', description: 'text' })]);
    await writeBody(svc, {
      id: 'TASK-0001',
      operation: { type: 'append', new_str: 'more' },
    });
    const saved = (svc.save as any).mock.calls[0][0];
    expect(saved.updated_at).not.toBe('2026-01-01T00:00:00.000Z');
  });
});
