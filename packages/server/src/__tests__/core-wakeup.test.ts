/**
 * Tests for core/wakeup (ADR-0092.1 Phase 2).
 *
 * Verifies the behavioral contract of the wake-up composer independent of
 * transport. The composer is pure over its injected IO (readIdentity,
 * readOperations) — tests pass deterministic stubs.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { Entity } from '@backlog-mcp/shared';
import { wakeup } from '../core/wakeup.js';
import { ValidationError } from '../core/types.js';
import { BacklogMemoryStore } from '../memory/backlog-memory-store.js';

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
      if (filter?.parent_id) result = result.filter(e => e.parent_id === filter.parent_id);
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
    expect(result.metadata.unfiled_count).toBe(0);
  });

  it('reports parentless work while exempting parents, containers, memories, and non-parentable documents', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'Unfiled open task' }),
      makeEntity({ id: 'TASK-0002', title: 'Unfiled done task', status: 'done' }),
      makeEntity({ id: 'TASK-0003', title: 'Filed task', parent_id: 'EPIC-0001' }),
      makeEntity({ id: 'ARTF-0001', title: 'Unfiled artifact', type: 'artifact', status: undefined }),
      makeEntity({
        id: 'CRON-0001',
        title: 'Unfiled cron',
        type: 'cron',
        schedule: '0 9 * * 1',
        command: 'backlog wakeup',
        enabled: true,
      } as Entity),
      makeEntity({ id: 'EPIC-0001', title: 'Container', type: 'epic' }),
      makeEntity({ id: 'FLDR-0001', title: 'Container', type: 'folder', status: undefined }),
      makeEntity({ id: 'MEMO-0001', title: 'Unscoped memory', type: 'memory', status: undefined } as Entity),
      makeEntity({ id: 'ADR 0119', title: 'Project document', type: 'adr', status: 'proposed' } as Entity),
      makeEntity({ id: 'NOTE-0001', title: 'Unfiled project note', type: 'note' } as Entity),
      makeEntity({ id: 'NOTE-0002', title: 'Filed project note', type: 'note', parent_id: 'EPIC-0001' } as Entity),
    ]);

    const result = await wakeup(svc, {
      acceptsParent: type => type === 'note',
    });

    expect(result.metadata.unfiled_count).toBe(5);
    expect(svc.list).toHaveBeenCalledWith({ limit: 100_000 });
  });

  it('includes identity when readIdentity returns a string', async () => {
    const svc = mockService([]);
    const result = await wakeup(svc, { readIdentity: () => 'I am Goga.' });
    expect(result.identity).toBe('I am Goga.');
  });

  it('omits identity when readIdentity returns undefined', async () => {
    const svc = mockService([]);
    const result = await wakeup(svc, { readIdentity: () => undefined });
    expect(result.identity).toBeUndefined();
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
    expect(result.recent.activity).toHaveLength(0);
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
    // Section sizes are the arrays' own lengths — metadata carries only
    // what the payload cannot derive (Slice C budget discipline).
    expect(result.now.active_tasks).toHaveLength(1);
    expect(result.now.current_epics).toHaveLength(1);
    expect(result.recent.completions).toHaveLength(1);
    expect(result.recent.activity).toHaveLength(1);
  });

  it('parent_id resolution uses the canonical relationship field', async () => {
    const svc = mockService([
      makeEntity({ id: 'TASK-0001', title: 'a', status: 'in_progress', parent_id: 'EPIC-0001' }),
      makeEntity({ id: 'TASK-0002', title: 'b', status: 'in_progress' }),
    ]);
    const result = await wakeup(svc);
    const byId = Object.fromEntries(result.now.active_tasks.map(t => [t.id, t.parent_id]));
    expect(byId['TASK-0001']).toBe('EPIC-0001');
    expect(byId['TASK-0002']).toBeUndefined();
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

  describe('knowledge section (ADR-0092.5 R-6)', () => {
    const mem = (id: string, over: Record<string, unknown> = {}) => makeEntity({
      id, title: `knowledge ${id}`, type: 'memory', layer: 'semantic',
      content: `knowledge body ${id}`,
      status: undefined, entity_refs: ['TASK-0676'], ...over,
    } as any);

    it('surfaces semantic/procedural memories with source pointers', async () => {
      const svc = mockService([
        mem('MEMO-0001'),
        mem('MEMO-0002', { layer: 'procedural', kind: 'timeless', entity_refs: undefined }),
        mem('MEMO-0003', { layer: 'episodic' }),               // episodic → excluded
      ]);
      const result = await wakeup(svc);
      const ids = result.knowledge.map(k => k.id);
      expect(ids).toContain('MEMO-0001');
      expect(ids).toContain('MEMO-0002');
      expect(ids).not.toContain('MEMO-0003');
      const k1 = result.knowledge.find(k => k.id === 'MEMO-0001');
      expect(k1?.source_ref).toBe('TASK-0676');
      const k2 = result.knowledge.find(k => k.id === 'MEMO-0002');
      expect(k2?.kind).toBe('timeless');
      expect(result.knowledge).toHaveLength(2);
      // Provenance (ADR 0115 R-4): same age/usage grammar as recall stubs.
      expect(typeof k1?.age_days).toBe('number');
      expect(k1?.uses).toBe(0);
    });

    it('reads provenance through the store mint — corrupt created_at reads age 0, not epoch (ADR 0115 R-5)', async () => {
      const svc = mockService([
        mem('MEMO-0001', { created_at: 'not-a-date', updated_at: 'not-a-date' }),
      ]);
      const result = await wakeup(svc);
      const k = result.knowledge.find(x => x.id === 'MEMO-0001');
      // The single malformed-date policy lives in toMemoryEntry: corrupt
      // created_at normalizes to "now", so age_days is 0 — never ~56 years.
      expect(k?.age_days).toBe(0);
    });

    it('anchors age_days on occurred_at and surfaces usage_count as uses (ADR 0115 R-4)', async () => {
      const DAY = 24 * 60 * 60 * 1000;
      const svc = mockService([
        mem('MEMO-0001', {
          usage_count: 4,
          occurred_at: new Date(Date.now() - 10 * DAY).toISOString(),
        }),
      ]);
      const result = await wakeup(svc);
      const k = result.knowledge.find(x => x.id === 'MEMO-0001');
      expect(k?.age_days).toBe(10);
      expect(k?.uses).toBe(4);
    });

    it('uses the selected store mint for project overlay usage', async () => {
      const svc = mockService([
        mem('MEMO-0001', { usage_count: 89 }),
      ]);
      const store = new BacklogMemoryStore(
        function getWakeupService() {
          return svc;
        },
        {
          get(id) {
            return id === 'MEMO-0001'
              ? {
                  usageCount: 3,
                  lastUsedAt: '2026-07-16T12:00:00.000Z',
                }
              : undefined;
          },
          set() {},
        },
      );
      function mintMemoryEntry(memory: Parameters<typeof store.toMemoryEntry>[0]) {
        return store.toMemoryEntry(memory);
      }

      const result = await wakeup(svc, { mintMemoryEntry });

      expect(result.knowledge[0]?.uses).toBe(3);
    });

    it('excludes expired memories and respects maxKnowledge', async () => {
      const svc = mockService([
        mem('MEMO-0001', { valid_until: '2000-01-01T00:00:00.000Z' }),  // expired
        mem('MEMO-0002'),
        mem('MEMO-0003'),
      ]);
      const result = await wakeup(svc, { maxKnowledge: 1 });
      expect(result.knowledge).toHaveLength(1);
      expect(result.knowledge[0]?.id).not.toBe('MEMO-0001');
    });

    it('maxKnowledge: 0 omits the section entirely', async () => {
      const svc = mockService([mem('MEMO-0001')]);
      const result = await wakeup(svc, { maxKnowledge: 0 });
      expect(result.knowledge).toEqual([]);
      expect(result.knowledge).toHaveLength(0);
    });
  });

  describe('constraints section (ADR 0113.1 R-2)', () => {
    const req = (id: string, fields: Record<string, unknown> = {}) => makeEntity({
      id, title: `need ${id}`, type: 'requirement', status: 'ruled',
      ...fields,
    } as never);

    it('surfaces live requirements worst-first with the stable total order', async () => {
      const svc = mockService([
        req('REQ-0004', { compliance: 'satisfied', checked_at: '2026-07-01T00:00:00.000Z', checked_by: 'goga' }),
        req('REQ-0003', { compliance: 'unchecked' }),
        req('REQ-0001', { compliance: 'violated', checked_at: '2026-07-10T00:00:00.000Z', checked_by: 'goga', violated_by: ['ADR-0117'] }),
        req('REQ-0002', { compliance: 'at_risk', checked_at: '2026-07-10T00:00:00.000Z', checked_by: 'goga' }),
      ]);
      const result = await wakeup(svc, { maxConstraints: 5 });
      expect(result.constraints.map(c => c.id)).toEqual(['REQ-0001', 'REQ-0002', 'REQ-0003', 'REQ-0004']);
      expect(result.constraints[0]?.violations).toEqual({ count: 1, ids: ['ADR-0117'] });
      expect(result.metadata.constraints_omitted).toBe(0);
    });

    it('excludes dropped/not_applicable, reports omitted count on truncation, 0 disables', async () => {
      const reqs = [
        req('REQ-0009', { status: 'dropped' }),
        ...Array.from({ length: 7 }, (_, i) => req(`REQ-000${i + 1}`)),
      ];
      const svc = mockService(reqs);
      const result = await wakeup(svc);
      expect(result.constraints).toHaveLength(3);              // default bound (Slice C)
      expect(result.metadata.constraints_omitted).toBe(4);     // 7 live − 3 shown; dropped never counts
      const disabled = await wakeup(svc, { maxConstraints: 0 });
      expect(disabled.constraints).toEqual([]);
      expect(disabled.metadata.constraints_omitted).toBe(0);
    });

    it('is absent-cheap: no requirements → empty section, zero omitted', async () => {
      const result = await wakeup(mockService([]));
      expect(result.constraints).toEqual([]);
      expect(result.metadata.constraints_omitted).toBe(0);
    });

    it('a REQ parented directly to the scope container appears in the scoped wakeup (load-bearing clause)', async () => {
      // descendantSet deletes the scope id from the filter set, so this
      // inclusion is carried ONLY by the parent_id === params.scope clause
      // in the constraints fold. A reviewer already once flagged that clause
      // as dead code — this test is the protection against the next one.
      const svc = mockService([
        makeEntity({ id: 'FLDR-0001', title: 'proj', type: 'folder', status: undefined }),
        req('REQ-0001', { parent_id: 'FLDR-0001' }),
      ]);
      const result = await wakeup(svc, { scope: 'FLDR-0001' });
      expect(result.constraints.map(c => c.id)).toEqual(['REQ-0001']);
    });

    it('home-wide constraints (no parent_id) survive a scoped wakeup; parented ones follow scope', async () => {
      const svc = mockService([
        makeEntity({ id: 'FLDR-0001', title: 'proj', type: 'folder', status: undefined }),
        makeEntity({ id: 'FLDR-0002', title: 'other', type: 'folder', status: undefined }),
        req('REQ-0001', {}),                                   // home-wide
        req('REQ-0002', { parent_id: 'FLDR-0002' }),           // other scope
      ]);
      const result = await wakeup(svc, { scope: 'FLDR-0001' });
      expect(result.constraints.map(c => c.id)).toEqual(['REQ-0001']);
    });
  });

  describe('orientation map + vision discovery (first-impression Slice A)', () => {
    const doc = (path: string, role: 'readme' | 'agents' | 'vision' | 'index', title = path) =>
      ({ path, role, title });

    it('budgets pointers in role order and truncates titles — paths and titles only, never bodies', async () => {
      const result = await wakeup(mockService([]), {
        readGrounding: () => ({
          orientation: [
            doc('docs/z/README.md', 'index'),
            doc('docs/a/README.md', 'index'),
            doc('docs/b/README.md', 'index'),
            doc('docs/c/README.md', 'index'),
            doc('docs/d/README.md', 'index'),
            doc('AGENTS.md', 'agents'),
            doc('README.md', 'readme', 'T'.repeat(120)),
          ],
          visionCandidates: [],
          indexedDocuments: 7,
        }),
      });
      const docs = result.orientation?.docs ?? [];
      expect(docs.map(d => d.path)).toEqual([
        'README.md', 'AGENTS.md',
        'docs/a/README.md', 'docs/b/README.md', 'docs/c/README.md', 'docs/d/README.md',
      ]);                                                     // 6-pointer budget, stable order
      expect(docs[0]?.title).toHaveLength(80);                // char-bounded like knowledge
      expect(result.orientation?.indexed_documents).toBe(7);
    });

    it('a single vision candidate becomes the vision pointer and never repeats in the pointer line', async () => {
      const result = await wakeup(mockService([]), {
        readGrounding: () => ({
          orientation: [doc('NORTH_STAR.md', 'vision', 'The Vision')],
          visionCandidates: ['NORTH_STAR.md'],
          indexedDocuments: 0,
        }),
      });
      expect(result.vision).toEqual({ path: 'NORTH_STAR.md', title: 'The Vision' });
      expect(result.orientation?.docs).toEqual([]);
      expect(result.metadata.vision_candidates).toBeUndefined();
    });

    it('multiple vision candidates surface as a diagnostic — never a silent choice', async () => {
      const result = await wakeup(mockService([]), {
        readGrounding: () => ({
          orientation: [],
          visionCandidates: ['docs/NORTH-STAR.md', 'NORTH_STAR.md'],
          indexedDocuments: 0,
        }),
      });
      expect(result.vision).toBeUndefined();
      expect(result.metadata.vision_candidates).toEqual(['NORTH_STAR.md', 'docs/NORTH-STAR.md']);
    });

    it('an ungrounded briefing over an indexed corpus says so and names the first places to open', async () => {
      const result = await wakeup(mockService([]), {
        readGrounding: () => ({
          orientation: [doc('README.md', 'readme'), doc('docs/issues/README.md', 'index')],
          visionCandidates: [],
          indexedDocuments: 59,
        }),
      });
      expect(result.orientation?.note).toContain('59 existing documents are indexed and searchable');
      expect(result.orientation?.note).toContain('README.md');
    });

    it('project grounding suppresses the note, but the pointer line remains — no self-state classifier', async () => {
      const result = await wakeup(
        mockService([makeEntity({ id: 'TASK-0001', title: 'live', status: 'in_progress' })]),
        {
          readGrounding: () => ({
            orientation: [doc('README.md', 'readme')],
            visionCandidates: [],
            indexedDocuments: 59,
          }),
        },
      );
      expect(result.orientation?.note).toBeUndefined();
      expect(result.orientation?.docs.map(d => d.path)).toEqual(['README.md']);
    });
  });

  describe('worktree meta line (LATTICE W1)', () => {
    it('a linked-worktree home briefs its family, branch, and divergence in one meta line', async () => {
      const result = await wakeup(mockService([]), {
        readGrounding: () => ({
          orientation: [],
          visionCandidates: [],
          indexedDocuments: 0,
          worktree: {
            family: 'backlog-mcp',
            branch: 'feat/lattice-w1',
            defaultBranch: 'main',
            behind: 3,
          },
        }),
      });
      expect(result.metadata.worktree).toBe('backlog-mcp @ feat/lattice-w1, 3 behind main');
    });

    it('a main-checkout briefing carries no worktree line — absent stays absent-cheap', async () => {
      const result = await wakeup(mockService([]), {
        readGrounding: () => ({
          orientation: [],
          visionCandidates: [],
          indexedDocuments: 0,
        }),
      });
      expect(result.metadata.worktree).toBeUndefined();
      expect(JSON.stringify(result.metadata)).not.toContain('worktree');
    });
  });

  describe('visible quarantine (EXP-1 B-3)', () => {
    it('names claimed-but-uncompilable documents so no section implies completeness', async () => {
      const svc = mockService([]);
      (svc as any).listClaimQuarantines = () => [{
        type: 'requirement',
        sourcePath: 'requirements/REQ-0004-being-aime-one-mind.md',
        reason: 'frontmatter cannot parse: bad mapping',
      }];
      const result = await wakeup(svc);
      expect(result.metadata.quarantined).toEqual([{
        type: 'requirement',
        path: 'requirements/REQ-0004-being-aime-one-mind.md',
      }]);
      // Path + type only — the verbose parse reason never rides the briefing.
      expect(JSON.stringify(result)).not.toContain('bad mapping');
    });

    it('stays absent-cheap when nothing is quarantined', async () => {
      const result = await wakeup(mockService([]));
      expect(result.metadata.quarantined).toBeUndefined();
    });
  });

  describe('registry-declared sections + vision (ADR 0113 C.2)', () => {
    const DECISIONS = {
      type: 'adr',
      wakeup: {
        section: 'decisions',
        includeStatuses: ['proposed', 'accepted', 'living'],
        limit: 2,
        projection: ['id', 'title', 'status'],
      },
    };
    const withDisclosures = (svc: IBacklogService, declared = [DECISIONS]) => {
      (svc as any).listWakeupDisclosures = () => declared;
      return svc;
    };
    const adr = (id: string, over: Record<string, unknown> = {}) => makeEntity({
      id, title: `decision ${id}`, type: 'adr', status: 'accepted', ...over,
    } as never);

    it('folds declared sections as projection stubs with includeStatuses + limit + omitted count', async () => {
      const svc = withDisclosures(mockService([
        adr('ADR 0001', { updated_at: '2026-07-10T00:00:00.000Z' }),
        adr('ADR 0002', { updated_at: '2026-07-12T00:00:00.000Z' }),
        adr('ADR 0003', { updated_at: '2026-07-11T00:00:00.000Z' }),
        adr('ADR 0004', { status: 'rejected' }),          // filtered by includeStatuses
      ]));
      const result = await wakeup(svc);
      const decisions = result.sections['decisions'] ?? [];
      expect(decisions.map(d => d.id)).toEqual(['ADR 0002', 'ADR 0003']);  // updated_at desc, limit 2
      expect(decisions[0]).toEqual({ id: 'ADR 0002', title: 'decision ADR 0002', status: 'accepted' });
      expect(result.metadata.sections_omitted['decisions']).toBe(1);       // ADR 0001 cut, rejected never counted
    });

    it('timestamp-less corpora order by injected observed recency; without it, stable id order (Slice B / B-2)', async () => {
      // Real-shape Aime fixture: legacy ADRs carry no managed updated_at.
      const corpus = [
        adr('ADR 0001', { updated_at: undefined }),
        adr('ADR 0004', { updated_at: undefined }),
        adr('ADR 0006', { updated_at: undefined }),
        adr('ADR 0025', { updated_at: undefined }),
        adr('ADR 0027', { updated_at: undefined }),
        adr('ADR 0028', { updated_at: undefined }),
      ];

      // Stage 1 — frontmatter only: everything ties, oldest IDs win (the bug).
      const stale = await wakeup(withDisclosures(mockService(corpus)));
      expect((stale.sections['decisions'] ?? []).map(d => d.id))
        .toEqual(['ADR 0001', 'ADR 0004']);

      // Stage 2 — injected observed recency: newest applicable decisions
      // surface; the omitted count states the exact remainder.
      const observedRecency = {
        'ADR 0001': '2026-07-09T00:00:00.000Z',
        'ADR 0004': '2026-07-09T12:00:00.000Z',
        'ADR 0006': '2026-07-10T00:00:00.000Z',
        'ADR 0025': '2026-07-15T00:00:00.000Z',
        'ADR 0027': '2026-07-15T12:00:00.000Z',
        'ADR 0028': '2026-07-15T18:00:00.000Z',
      };
      const current = await wakeup(withDisclosures(mockService(corpus)), {
        readGrounding: () => ({ observedRecency }),
      });
      expect((current.sections['decisions'] ?? []).map(d => d.id))
        .toEqual(['ADR 0028', 'ADR 0027']);
      expect(current.metadata.sections_omitted['decisions']).toBe(4);
    });

    it('a valid frontmatter updated_at stays authoritative over the injected map (Slice B tier order)', async () => {
      const svc = withDisclosures(mockService([
        adr('ADR 0001', { updated_at: '2026-07-16T00:00:00.000Z' }),  // explicit, newest
        adr('ADR 0002', { updated_at: 'not-a-date' }),                // invalid → falls through
        adr('ADR 0003', { updated_at: undefined }),
      ]));
      const result = await wakeup(svc, {
        readGrounding: () => ({
          observedRecency: {
            'ADR 0001': '2026-01-01T00:00:00.000Z',  // must be ignored — updated_at wins
            'ADR 0002': '2026-07-15T00:00:00.000Z',
            'ADR 0003': '2026-07-14T00:00:00.000Z',
          },
        }),
      });
      expect((result.sections['decisions'] ?? []).map(d => d.id))
        .toEqual(['ADR 0001', 'ADR 0002']);
    });

    it('freeform human statuses disclose by leading token; unlisted and missing stay excluded (repair #4)', async () => {
      // Real-corpus shapes from this very repo: 24 "Accepted", 18 "Proposed",
      // "Accepted (goga, 2026-07-16)", "Accepted, amended 2026-04-14".
      const svc = withDisclosures(mockService([
        adr('ADR 0001', { status: 'Accepted (goga, 2026-07-16)', updated_at: '2026-07-16T00:00:00.000Z' }),
        adr('ADR 0002', { status: 'Accepted, amended 2026-04-14', updated_at: '2026-07-15T00:00:00.000Z' }),
        adr('ADR 0003', { status: 'PARKED, ONLY EXPLORATION', updated_at: '2026-07-14T00:00:00.000Z' }),
        adr('ADR 0004', { status: undefined, updated_at: '2026-07-13T00:00:00.000Z' }),
      ]));
      const result = await wakeup(svc);
      const decisions = (result.sections['decisions'] ?? []).map(d => d.id);
      expect(decisions).toEqual(['ADR 0001', 'ADR 0002']);   // tokens match 'accepted'
      expect(result.metadata.sections_omitted['decisions']).toBe(0); // parked/missing never counted
    });

    it('the requirement constraints declaration is satisfied by the specialized fold, never duplicated', async () => {
      const svc = withDisclosures(
        mockService([makeEntity({ id: 'REQ-0001', title: 'need', type: 'requirement', status: 'ruled' } as never)]),
        [{ type: 'requirement', wakeup: { section: 'constraints', includeStatuses: [], limit: 5, projection: ['id', 'title'] } }],
      );
      const result = await wakeup(svc);
      expect(result.sections['constraints']).toBeUndefined();
      expect(result.constraints.map(c => c.id)).toEqual(['REQ-0001']);
    });

    it('legacy services (no disclosure surface) degrade to empty sections', async () => {
      const result = await wakeup(mockService([]));
      expect(result.sections).toEqual({});
      expect(result.metadata.sections_omitted).toEqual({});
    });

    it('vision pointer: path + first-heading title, never the body; absent without readVision', async () => {
      const withVision = await wakeup(mockService([]), {
        readVision: () => '# North Star — Demo\n\nLots of body text that must not inline.',
      });
      expect(withVision.vision).toEqual({ path: 'NORTH-STAR.md', title: 'North Star — Demo' });
      expect(JSON.stringify(withVision)).not.toContain('must not inline');

      const without = await wakeup(mockService([]));
      expect(without.vision).toBeUndefined();
    });
  });
});
