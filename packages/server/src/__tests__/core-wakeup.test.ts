/**
 * Tests for core/wakeup (ADR-0092.1 Phase 2).
 *
 * Verifies the behavioral contract of the wake-up composer independent of
 * transport. The composer is pure over its injected IO (readIdentity,
 * readOperations) — tests pass deterministic stubs.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IBacklogService } from '../storage/service-types.js';
import type { Entity } from '@backlog-mcp/shared';
import { wakeup } from '../core/wakeup.js';
import { ValidationError } from '../core/types.js';

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
    get: vi.fn(async (id: string) => store.get(id)),
    getMarkdown: vi.fn(async () => null),
    list: vi.fn(async (filter?: any) => {
      let result = [...store.values()];
      if (filter?.status) result = result.filter(e => filter.status.includes(e.status));
      if (filter?.type) result = result.filter(e => (e.type ?? 'task') === filter.type);
      return result;
    }),
    add: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => true),
    counts: vi.fn(async () => ({ total_tasks: 0, total_epics: 0, by_status: {}, by_type: {} })),
    getMaxId: vi.fn(async () => 0),
    searchUnified: vi.fn(async () => []),
  };
}

describe('core/wakeup', () => {
  it('returns a minimal briefing for an empty backlog', async () => {
    const svc = mockService([]);
    const result = await wakeup(svc);
    expect(result.now.active_tasks).toEqual([]);
    expect(result.now.current_epics).toEqual([]);
    expect(result.recent.completions).toEqual([]);
    expect(result.recent.activity).toEqual([]);
    expect(result.identity).toBeUndefined();
    expect(result.metadata.identity_present).toBe(false);
  });

  it('includes identity when readIdentity returns a string', async () => {
    const svc = mockService([]);
    const result = await wakeup(svc, { readIdentity: () => 'I am Goga.' });
    expect(result.identity).toBe('I am Goga.');
    expect(result.metadata.identity_present).toBe(true);
  });

  it('omits identity when readIdentity returns undefined', async () => {
    const svc = mockService([]);
    const result = await wakeup(svc, { readIdentity: () => undefined });
    expect(result.identity).toBeUndefined();
    expect(result.metadata.identity_present).toBe(false);
  });

  it('L1 active_tasks: includes in_progress and blocked tasks, excludes epics', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'in prog', status: 'in_progress', updated_at: '2026-05-01T00:00:00.000Z' }),
      makeEntity({ id: 'TASK-0002', title: 'blocked', status: 'blocked', updated_at: '2026-05-02T00:00:00.000Z' }),
      makeEntity({ id: 'TASK-0003', title: 'open', status: 'open' }),
      makeEntity({ id: 'TASK-0004', title: 'done', status: 'done' }),
      makeEntity({ id: 'EPIC-0001', title: 'epic in prog', type: 'epic', status: 'in_progress' }),
    ]);
    const result = await wakeup(svc);
    const ids = result.now.active_tasks.map(t => t.id);
    expect(ids).toEqual(['TASK-0002', 'TASK-0001']);  // sorted by updated_at desc
    expect(ids).not.toContain('EPIC-0001');            // epic excluded from active_tasks
    expect(ids).not.toContain('TASK-0003');            // open excluded
    expect(ids).not.toContain('TASK-0004');            // done excluded
  });

  it('L1 current_epics: includes open and in_progress epics, sorted by updated_at desc', async () => {
    const svc = mockService([
      makeEntity({ id: 'EPIC-0001', title: 'open', type: 'epic', status: 'open', updated_at: '2026-05-01T00:00:00.000Z' }),
      makeEntity({ id: 'EPIC-0002', title: 'in_prog', type: 'epic', status: 'in_progress', updated_at: '2026-05-02T00:00:00.000Z' }),
      makeEntity({ id: 'EPIC-0003', title: 'done', type: 'epic', status: 'done' }),
    ]);
    const result = await wakeup(svc);
    const ids = result.now.current_epics.map(e => e.id);
    expect(ids).toEqual(['EPIC-0002', 'EPIC-0001']);
    expect(ids).not.toContain('EPIC-0003');
  });

  it('L2 completions: returns up to maxCompletions done items sorted by updated_at desc', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'old', status: 'done', updated_at: '2026-01-01T00:00:00.000Z' }),
      makeEntity({ id: 'TASK-0002', title: 'newer', status: 'done', updated_at: '2026-03-01T00:00:00.000Z' }),
      makeEntity({ id: 'TASK-0003', title: 'newest', status: 'done', updated_at: '2026-05-01T00:00:00.000Z' }),
    ]);
    const result = await wakeup(svc, { maxCompletions: 2 });
    expect(result.recent.completions.map(c => c.id)).toEqual(['TASK-0003', 'TASK-0002']);
  });

  it('L2 completions: snippet is the first evidence line, truncated to evidenceSnippetChars', async () => {
    const longEvidence = 'x'.repeat(300);
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 't', status: 'done', evidence: [longEvidence] }),
    ]);
    const result = await wakeup(svc, { evidenceSnippetChars: 50 });
    const completion = result.recent.completions[0]!;
    expect(completion.evidence_snippet).toHaveLength(50);
    expect(completion.evidence_snippet).toMatch(/…$/);  // truncation marker
  });

  it('L2 completions: missing evidence → no evidence_snippet field', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 't', status: 'done' }),
    ]);
    const result = await wakeup(svc);
    expect(result.recent.completions[0]!.evidence_snippet).toBeUndefined();
  });

  it('L2 activity: maps operation log entries, carrying tool, ts, actor, and derived entity_id', async () => {
    const svc = mockService([]);
    const readOperations = () => [
      {
        ts: '2026-05-07T10:00:00.000Z',
        tool: 'backlog_update',
        params: { id: 'TASK-0001', status: 'done' },
        actor: { type: 'agent', name: 'claude' },
      },
      {
        ts: '2026-05-07T09:00:00.000Z',
        tool: 'backlog_create',
        params: { title: 'new task' },
        resourceId: 'TASK-0042',
        actor: { type: 'user', name: 'goga' },
      },
    ];
    const result = await wakeup(svc, { readOperations });
    expect(result.recent.activity).toHaveLength(2);
    expect(result.recent.activity[0]).toEqual({
      ts: '2026-05-07T10:00:00.000Z',
      tool: 'backlog_update',
      entity_id: 'TASK-0001',
      actor: 'claude',
    });
    expect(result.recent.activity[1]!.entity_id).toBe('TASK-0042');  // fallback to resourceId
  });

  it('L2 activity: empty when readOperations is not provided', async () => {
    const svc = mockService([]);
    const result = await wakeup(svc);
    expect(result.recent.activity).toEqual([]);
    expect(result.metadata.activity_count).toBe(0);
  });

  it('metadata counts are accurate', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 't', status: 'in_progress' }),
      makeEntity({ id: 'EPIC-0001', title: 'e', type: 'epic', status: 'in_progress' }),
      makeEntity({ id: 'TASK-0002', title: 'done', status: 'done' }),
    ]);
    const result = await wakeup(svc, { readOperations: () => [
      { ts: '2026-05-07T10:00:00.000Z', tool: 'backlog_update', params: {}, actor: { type: 'agent', name: 'a' } },
    ]});
    expect(result.metadata.active_task_count).toBe(1);
    expect(result.metadata.epic_count).toBe(1);
    expect(result.metadata.completion_count).toBe(1);
    expect(result.metadata.activity_count).toBe(1);
  });

  it('parent_id resolution: uses parent_id when present, else epic_id alias', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'a', status: 'in_progress', parent_id: 'EPIC-0001' }),
      makeEntity({ id: 'TASK-0002', title: 'b', status: 'in_progress', epic_id: 'EPIC-0002' }),
    ]);
    const result = await wakeup(svc);
    const byId = Object.fromEntries(result.now.active_tasks.map(t => [t.id, t.parent_id]));
    expect(byId['TASK-0001']).toBe('EPIC-0001');
    expect(byId['TASK-0002']).toBe('EPIC-0002');
  });

  // ── scope: runtime validation + descendant filtering (ADR-0092.1) ──

  describe('scope', () => {
    it('rejects a malformed scope ID with ValidationError', async () => {
      const svc = mockService([]);
      await expect(wakeup(svc, { scope: 'not-an-id' })).rejects.toThrow(ValidationError);
      await expect(wakeup(svc, { scope: 'not-an-id' })).rejects.toThrow(/Invalid scope ID/);
    });

    it('rejects a non-container scope (task) with ValidationError', async () => {
      const svc = mockService([makeEntity({ id: 'TASK-0001', title: 't' })]);
      await expect(wakeup(svc, { scope: 'TASK-0001' })).rejects.toThrow(ValidationError);
      await expect(wakeup(svc, { scope: 'TASK-0001' })).rejects.toThrow(/container/);
    });

    it('rejects an artifact scope (non-container) with ValidationError', async () => {
      const svc = mockService([]);
      await expect(wakeup(svc, { scope: 'ARTF-0001' })).rejects.toThrow(/container/);
    });

    it('accepts a folder scope and filters results to its subtree', async () => {
      // Tree:
      //   FLDR-0001 (scope)
      //     ├── EPIC-0001 (in_progress)
      //     │     └── TASK-0001 (in_progress)   ← in scope
      //     └── TASK-0002 (in_progress)         ← in scope (direct child)
      //   FLDR-0002 (out of scope)
      //     └── TASK-0003 (in_progress)         ← NOT in scope
      const svc = mockService([
        makeEntity({ id: 'FLDR-0001', title: 'proj', type: 'folder' as any }),
        makeEntity({ id: 'FLDR-0002', title: 'other', type: 'folder' as any }),
        makeEntity({ id: 'EPIC-0001', title: 'ep', type: 'epic', status: 'in_progress', parent_id: 'FLDR-0001' }),
        makeEntity({ id: 'TASK-0001', title: 't1', status: 'in_progress', parent_id: 'EPIC-0001' }),
        makeEntity({ id: 'TASK-0002', title: 't2', status: 'in_progress', parent_id: 'FLDR-0001' }),
        makeEntity({ id: 'TASK-0003', title: 't3', status: 'in_progress', parent_id: 'FLDR-0002' }),
      ]);
      // mockService needs to support parent_id lookups for descendant walk:
      (svc.list as any).mockImplementation(async (filter?: any) => {
        const entities: Entity[] = [
          makeEntity({ id: 'FLDR-0001', title: 'proj', type: 'folder' as any }),
          makeEntity({ id: 'FLDR-0002', title: 'other', type: 'folder' as any }),
          makeEntity({ id: 'EPIC-0001', title: 'ep', type: 'epic', status: 'in_progress', parent_id: 'FLDR-0001' }),
          makeEntity({ id: 'TASK-0001', title: 't1', status: 'in_progress', parent_id: 'EPIC-0001' }),
          makeEntity({ id: 'TASK-0002', title: 't2', status: 'in_progress', parent_id: 'FLDR-0001' }),
          makeEntity({ id: 'TASK-0003', title: 't3', status: 'in_progress', parent_id: 'FLDR-0002' }),
        ];
        let result = entities;
        if (filter?.status) result = result.filter(e => filter.status.includes(e.status));
        if (filter?.type) result = result.filter(e => (e.type ?? 'task') === filter.type);
        if (filter?.parent_id) result = result.filter(e => e.parent_id === filter.parent_id);
        return result;
      });

      const result = await wakeup(svc, { scope: 'FLDR-0001' });
      const ids = result.now.active_tasks.map(t => t.id).sort();
      expect(ids).toEqual(['TASK-0001', 'TASK-0002']);  // TASK-0003 excluded
      expect(result.now.current_epics.map(e => e.id)).toEqual(['EPIC-0001']);
      expect(result.scope).toBe('FLDR-0001');
    });

    it('accepts an epic scope and narrows to that epic alone', async () => {
      (mockService([]).list as any);  // noop
      const entities: Entity[] = [
        makeEntity({ id: 'EPIC-0001', title: 'ep1', type: 'epic', status: 'in_progress' }),
        makeEntity({ id: 'TASK-0001', title: 't1', status: 'in_progress', parent_id: 'EPIC-0001' }),
        makeEntity({ id: 'TASK-0002', title: 't2', status: 'in_progress', parent_id: 'EPIC-0002' }),
      ];
      const svc = mockService(entities);
      (svc.list as any).mockImplementation(async (filter?: any) => {
        let result = entities;
        if (filter?.status) result = result.filter(e => filter.status.includes(e.status));
        if (filter?.type) result = result.filter(e => (e.type ?? 'task') === filter.type);
        if (filter?.parent_id) result = result.filter(e => e.parent_id === filter.parent_id);
        return result;
      });
      const result = await wakeup(svc, { scope: 'EPIC-0001' });
      expect(result.now.active_tasks.map(t => t.id)).toEqual(['TASK-0001']);
    });

    it('scope with no matching entities: all sections empty, scope echoed', async () => {
      const svc = mockService([
        makeEntity({ id: 'FLDR-0001', title: 'empty folder', type: 'folder' as any }),
      ]);
      const result = await wakeup(svc, { scope: 'FLDR-0001' });
      expect(result.now.active_tasks).toEqual([]);
      expect(result.now.current_epics).toEqual([]);
      expect(result.recent.completions).toEqual([]);
      expect(result.scope).toBe('FLDR-0001');
    });

    it('scoped activity filtered by entity_id in ops', async () => {
      const entities: Entity[] = [
        makeEntity({ id: 'FLDR-0001', title: 'f', type: 'folder' as any }),
        makeEntity({ id: 'TASK-0001', title: 't1', parent_id: 'FLDR-0001' }),
        makeEntity({ id: 'TASK-0002', title: 't2' }),  // outside scope
      ];
      const svc = mockService(entities);
      (svc.list as any).mockImplementation(async (filter?: any) => {
        let result = entities;
        if (filter?.parent_id) result = result.filter(e => e.parent_id === filter.parent_id);
        if (filter?.status) result = result.filter(e => filter.status.includes(e.status));
        if (filter?.type) result = result.filter(e => (e.type ?? 'task') === filter.type);
        return result;
      });
      const readOperations = () => [
        { ts: '2026-05-07T12:00:00.000Z', tool: 'backlog_update', params: { id: 'TASK-0001' }, actor: { type: 'user', name: 'g' } },
        { ts: '2026-05-07T11:00:00.000Z', tool: 'backlog_update', params: { id: 'TASK-0002' }, actor: { type: 'user', name: 'g' } },
        { ts: '2026-05-07T10:00:00.000Z', tool: 'backlog_create', params: {}, resourceId: 'TASK-0001', actor: { type: 'user', name: 'g' } },
      ];
      const result = await wakeup(svc, { scope: 'FLDR-0001', readOperations });
      expect(result.recent.activity.map(a => a.entity_id)).toEqual(['TASK-0001', 'TASK-0001']);
    });
  });
});
