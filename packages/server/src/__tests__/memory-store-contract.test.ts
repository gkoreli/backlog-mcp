/**
 * BacklogMemoryStore — the R1–R5 recall-correctness contract (ADR 0092.3).
 *
 * R1 Durable:  memory stored through one store instance is recallable from a
 *              fresh instance over the same service (the in-process analogue
 *              of CLI↔MCP cross-process recall through the shared data dir).
 * R2 Ranked:   recall rides the same hybrid pipeline as backlog_search.
 * R3 Exact:    recall by MEMO- id, by referenced entity id, and by
 *              distinctive phrase surfaces the right memory at rank 1.
 * R4 Scoped:   context/layers/tags filter correctly.
 * R5 Time:     expired memories are excluded; forget is soft by default,
 *              hard for already-expired (GC path).
 *
 * The service is a realistic fake: a Map-backed entity store whose
 * searchUnified runs the REAL OramaSearchService over the live corpus —
 * so ranking behavior here is the production pipeline, not a stub.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  EntitySchema,
  EntityType,
  parseEntityNum,
  type Entity,
  type Memory,
} from '@backlog-mcp/shared';
import { MemoryComposer, type MemoryEntry } from '@backlog-mcp/memory';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { BacklogMemoryStore } from '../memory/backlog-memory-store.js';
import { createDefaultComposer } from '../memory/bootstrap.js';
import type {
  MemoryUsageSummary,
  MemoryUsageSummaryStore,
} from '../memory/memory-usage.contract.js';
import { createEntity } from '../core/create.js';
import { recall as coreRecall } from '../core/recall.js';
import { remember as coreRemember } from '../core/remember.js';
import { forget as coreForget } from '../core/forget.js';
import { consolidationCandidates } from '../core/consolidation.js';
import type { MutationAttribution, WriteContext } from '../core/types.js';

const CREATE_ATTRIBUTION = {
  tool: 'backlog_attach_artifact',
  mutation: 'create',
} as const satisfies MutationAttribution;

/** Map-backed IBacklogService with real Orama-backed searchUnified. */
function fakeService(): IBacklogService {
  const store = new Map<string, Entity>();
  return {
    async get(id) { return store.get(id); },
    async getMarkdown() { return null; },
    async list(filter) {
      let out = [...store.values()];
      if (filter?.type) out = out.filter(e => (e.type ?? 'task') === filter.type);
      if (filter?.parent_id) out = out.filter(e => e.parent_id === filter.parent_id);
      return out;
    },
    async add(candidate) {
      const entity = EntitySchema.parse(candidate);
      store.set(entity.id, { ...entity });
      return entity;
    },
    async save(candidate) {
      const entity = EntitySchema.parse(candidate);
      store.set(entity.id, { ...entity });
      return entity;
    },
    async delete(id) { return store.delete(id); },
    async counts() { return { total_tasks: store.size, total_epics: 0, by_status: {}, by_type: {} }; },
    async getMaxId(type) {
      let max = 0;
      for (const id of store.keys()) {
        const num = parseEntityNum(id);
        if (num !== null && (!type || id.startsWith(`${type === EntityType.Memory ? 'MEMO' : 'TASK'}-`))) {
          if (type !== EntityType.Memory || id.startsWith('MEMO-')) max = Math.max(max, num);
        }
      }
      return max;
    },
    async searchUnified(query, options) {
      const search = new OramaSearchService({
        cachePath: join(tmpdir(), `mem-contract-${Date.now()}-${Math.random().toString(36).slice(2)}.json`),
        hybridSearch: false,
      });
      await search.index([...store.values()]);
      const results = await search.searchAll(query, {
        docTypes: options?.types,
        limit: options?.limit ?? 20,
      });
      return results.map(r => ({ item: r.item, score: r.score, type: r.type, snippet: r.snippet }));
    },
  };
}

function entry(overrides: Partial<MemoryEntry> & { id: string; content: string }): MemoryEntry {
  return {
    title: 'Test memory',
    layer: 'episodic',
    source: 'test-agent',
    createdAt: Date.now(),
    ...overrides,
  };
}

function memorySummaryStore(): MemoryUsageSummaryStore & {
  summaries: Map<string, MemoryUsageSummary>;
} {
  const summaries = new Map<string, MemoryUsageSummary>();
  return {
    summaries,
    get(id) {
      return summaries.get(id);
    },
    set(id, summary) {
      summaries.set(id, summary);
    },
  };
}

describe('BacklogMemoryStore — R1–R5 contract (ADR 0092.3)', () => {
  let service: IBacklogService;
  let store: BacklogMemoryStore;

  beforeEach(() => {
    service = fakeService();
    store = new BacklogMemoryStore(() => service);
  });

  // ── R1: Durable ────────────────────────────────────────────────────

  it('R1: memory stored via one instance is recallable from a fresh instance', async () => {
    await store.store(entry({ id: 'x', content: 'Fixed auth by adding refresh middleware to the OAuth flow' }));

    const freshStore = new BacklogMemoryStore(() => service);
    const results = await freshStore.recall({ query: 'auth middleware' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.entry.content).toContain('refresh middleware');
    expect(results[0]!.entry.id).toMatch(/^MEMO-\d{4,}$/);
  });

  it('R1: memories are real entities — gettable by MEMO- id via the service', async () => {
    await store.store(entry({ id: 'x', content: 'Worker bundle must stay runtime-clean' }));
    const memo = await service.get('MEMO-0001');
    expect(memo).toBeDefined();
    expect((memo as { layer?: string }).layer).toBe('episodic');
    expect(memo!.content).toContain('runtime-clean');
  });

  it('R1: memory ids use the service-owned allocator when available', async () => {
    service.allocateId = async function allocateMemoryId(type) {
      expect(type).toBe(EntityType.Memory);
      return 'MEMO-00009';
    };

    await store.store(entry({ id: 'x', content: 'Claim-shaped memory id' }));

    expect(await service.get('MEMO-00009')).toBeDefined();
  });

  it('R1: project stores omit committed usage and mint overlay truth', async () => {
    const summaries = memorySummaryStore();
    const projectStore = new BacklogMemoryStore(() => service, summaries);

    const stored = await projectStore.store(entry({
      id: 'x',
      content: 'Project usage belongs outside committed Markdown',
      metadata: { usageCount: 99 },
    }));
    const entity = await service.get(stored.id);

    expect(entity).not.toHaveProperty('usage_count');
    expect(stored.metadata?.usageCount).toBe(0);

    summaries.set(stored.id, {
      usageCount: 5,
      lastUsedAt: '2026-07-16T12:00:00.000Z',
    });
    const refreshed = projectStore.toMemoryEntry(entity as Memory);
    expect(refreshed.metadata).toMatchObject({
      usageCount: 5,
      last_used_at: '2026-07-16T12:00:00.000Z',
    });
  });

  it('R2: project recall ranks from overlay usage and ignores stale frontmatter', async () => {
    const summaries = memorySummaryStore();
    const projectStore = new BacklogMemoryStore(() => service, summaries);
    const now = Date.now();
    const createdAt = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
    const lastUsedAt = new Date(now).toISOString();
    const staleFrontmatterWinner = {
      id: 'MEMO-0001',
      type: 'memory',
      title: 'Stale frontmatter winner',
      content: 'same query phrase',
      layer: 'semantic',
      usage_count: 255,
      last_used_at: lastUsedAt,
      created_at: createdAt,
      updated_at: createdAt,
    } satisfies Memory;
    const overlayWinner = {
      id: 'MEMO-0002',
      type: 'memory',
      title: 'Overlay winner',
      content: 'same query phrase',
      layer: 'semantic',
      usage_count: 0,
      created_at: createdAt,
      updated_at: createdAt,
    } satisfies Memory;
    await service.add(staleFrontmatterWinner);
    await service.add(overlayWinner);
    service.searchUnified = async function equalSearchResults() {
      return [
        {
          item: staleFrontmatterWinner,
          score: 1,
          type: 'memory',
          snippet: staleFrontmatterWinner.content,
        },
        {
          item: overlayWinner,
          score: 1,
          type: 'memory',
          snippet: overlayWinner.content,
        },
      ];
    };
    summaries.set(staleFrontmatterWinner.id, { usageCount: 0 });
    summaries.set(overlayWinner.id, { usageCount: 8, lastUsedAt });

    const results = await projectStore.recall({
      query: 'same query phrase',
      limit: 2,
    });

    expect(results.map(result => result.entry.id)).toEqual([
      overlayWinner.id,
      staleFrontmatterWinner.id,
    ]);
    expect(results[0]?.entry.metadata?.usageCount).toBe(8);
    expect(results[1]?.entry.metadata?.usageCount).toBe(0);
  });

  // ── R2: Ranked ─────────────────────────────────────────────────────

  it('R2: recall ranks by relevance through the production pipeline', async () => {
    await store.store(entry({ id: 'a', content: 'Release process: typecheck, test, tag, publish to npm' }));
    await store.store(entry({ id: 'b', content: 'Viewer uses signals-based web components' }));
    await store.store(entry({ id: 'c', content: 'The release tag must match package.json version' }));

    const results = await store.recall({ query: 'release process publish' });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]!.entry.content).toContain('Release process');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  // ── R3: Exact ──────────────────────────────────────────────────────

  it('R3: recall by MEMO- id surfaces that memory at rank 1', async () => {
    await store.store(entry({ id: 'a', content: 'First memory about deployment' }));
    await store.store(entry({ id: 'b', content: 'Second memory about testing' }));

    const results = await store.recall({ query: 'MEMO-0002' });
    expect(results[0]!.entry.id).toBe('MEMO-0002');
  });

  it('R3: recall by referenced entity id finds the memory (entity_refs indexed)', async () => {
    await store.store(entry({
      id: 'a',
      content: 'Search ranking bug fixed via rank normalization',
      metadata: { entity_id: 'TASK-0676', kind: 'completion' },
    }));
    await store.store(entry({ id: 'b', content: 'Unrelated note about the viewer' }));

    const results = await store.recall({ query: 'TASK-0676' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.entry.metadata?.entity_id).toBe('TASK-0676');
  });

  // ── R4: Scoped ─────────────────────────────────────────────────────

  it('R4: context, layers, and tags filters compose', async () => {
    await store.store(entry({ id: 'a', content: 'Deploy procedure alpha', layer: 'procedural', context: 'FLDR-0001', tags: ['deploy'] }));
    await store.store(entry({ id: 'b', content: 'Deploy episode alpha', layer: 'episodic', context: 'FLDR-0002' }));

    const byContext = await store.recall({ query: 'deploy alpha', context: 'FLDR-0001' });
    expect(byContext.map(r => r.entry.context)).toEqual(['FLDR-0001']);

    const byLayer = await store.recall({ query: 'deploy alpha', layers: ['procedural'] });
    expect(byLayer).toHaveLength(1);
    expect(byLayer[0]!.entry.layer).toBe('procedural');

    const byTag = await store.recall({ query: 'deploy alpha', tags: ['deploy'] });
    expect(byTag).toHaveLength(1);
    expect(byTag[0]!.entry.tags).toContain('deploy');
  });

  it('R4: session layer is never persisted and never recalled', async () => {
    await expect(store.store(entry({ id: 'x', content: 'transient', layer: 'session' }))).rejects.toThrow(/session/);
    expect(await store.recall({ query: 'transient', layers: ['session'] })).toEqual([]);
  });

  // ── R5: Time-honest ────────────────────────────────────────────────

  it('R5: expired memories are excluded from recall and size', async () => {
    await store.store(entry({ id: 'a', content: 'Stale fact about the old build system', expiresAt: Date.now() - 1000 }));
    await store.store(entry({ id: 'b', content: 'Current fact about the build system' }));

    const results = await store.recall({ query: 'build system fact' });
    expect(results).toHaveLength(1);
    expect(results[0]!.entry.content).toContain('Current');
    expect(await store.size()).toBe(1);
  });

  it('R5: forget is soft by default (expires, keeps the entity)', async () => {
    await store.store(entry({ id: 'a', content: 'Soon to be forgotten knowledge' }));
    const forgotten = await store.forget({ ids: ['MEMO-0001'] });
    expect(forgotten).toBe(1);

    expect(await store.recall({ query: 'forgotten knowledge' })).toEqual([]);
    // The entity still exists — the viewer can audit it.
    const memo = await service.get('MEMO-0001');
    expect(memo).toBeDefined();
    expect((memo as { valid_until?: string }).valid_until).toBeDefined();
  });

  it('R5: forget({ expired: true }) hard-deletes — the GC path', async () => {
    await store.store(entry({ id: 'a', content: 'Already expired memory', expiresAt: Date.now() - 1000 }));
    const removed = await store.forget({ expired: true });
    expect(removed).toBe(1);
    expect(await service.get('MEMO-0001')).toBeUndefined();
  });

  // ── Phase C: ADD-only correction semantics (ADR 0092.5 R-1/R-2) ───

  it('R-1: supersedes soft-expires the predecessor and records lineage', async () => {
    await store.store(entry({ id: 'a', content: 'Bundler is rollup' }));
    const stored = await store.store(entry({
      id: 'b',
      content: 'Bundler is tsdown',
      metadata: { supersedes: 'MEMO-0001' },
    }));
    expect(stored.id).toBe('MEMO-0002');

    // Predecessor expired (gone from recall), still present as an entity.
    const results = await store.recall({ query: 'bundler' });
    expect(results.map(r => r.entry.id)).toEqual(['MEMO-0002']);
    const old = await service.get('MEMO-0001');
    expect((old as { valid_until?: string }).valid_until).toBeDefined();
    // Lineage on the successor.
    expect((await service.get('MEMO-0002') as { supersedes?: string }).supersedes).toBe('MEMO-0001');
  });

  it('R-2: state_key closes every live previous holder', async () => {
    await store.store(entry({ id: 'a', content: 'Primary DB is SQLite', metadata: { state_key: 'db.primary' } }));
    await store.store(entry({ id: 'b', content: 'Unrelated note about CI' }));
    await store.store(entry({ id: 'c', content: 'Primary DB is Postgres', metadata: { state_key: 'db.primary' } }));

    const results = await store.recall({ query: 'primary DB' });
    const ids = results.map(r => r.entry.id);
    expect(ids).toContain('MEMO-0003');
    expect(ids).not.toContain('MEMO-0001');  // closed by the new state holder
    expect((await service.get('MEMO-0002') as { valid_until?: string }).valid_until).toBeUndefined();  // unrelated untouched
  });

  it('R-3/R-4: kind and occurred_at round-trip through frontmatter', async () => {
    await store.store(entry({
      id: 'a',
      content: 'The viewer is read-only by tenet',
      layer: 'semantic',
      metadata: { memory_kind: 'timeless', occurred_at: '2026-01-15' },
    }));
    const m = await service.get('MEMO-0001') as { kind?: string; occurred_at?: string };
    expect(m.kind).toBe('timeless');
    expect(m.occurred_at).toBe('2026-01-15');
    const recalled = await store.recall({ query: 'viewer read-only' });
    expect(recalled[0]?.entry.metadata?.memory_kind).toBe('timeless');
  });

  // ── Phase C: stub recall + token budget (ADR 0092.5 R-5) ──────────

  it('R-5: core recall returns stubs by default, bodies with full:true', async () => {
    const composer = createDefaultComposer(() => service);
    await store.store(entry({ id: 'a', content: 'Deploy procedure\n\nStep 1: typecheck\nStep 2: test\nStep 3: publish' }));

    const stubs = await coreRecall({ query: 'deploy procedure' }, { memoryComposer: composer });
    expect(stubs.items[0]?.digest).toBe('Deploy procedure');
    expect(stubs.items[0]?.content).toBeUndefined();

    const full = await coreRecall({ query: 'deploy procedure', full: true }, { memoryComposer: composer });
    expect(full.items[0]?.content).toContain('Step 3: publish');
  });

  it('R-5: token_budget packs greedily and flags truncation', async () => {
    const composer = createDefaultComposer(() => service);
    for (let i = 0; i < 6; i++) {
      await store.store(entry({ id: `m${i}`, content: `Deployment note number ${i} about the worker pipeline and bundler configuration` }));
    }
    const result = await coreRecall({ query: 'deployment worker bundler', token_budget: 120 }, { memoryComposer: composer });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items.length).toBeLessThan(6);
    expect(result.truncated).toBe(true);
  });

  // ── Phase D: provenance invariant + consolidation loop (ADR 0092.7) ─

  it('D1/R-8: derived memories require entity_refs; provenance round-trips', async () => {
    const composer = createDefaultComposer(() => service);

    await expect(coreRemember(
      { content: 'Unfounded conclusion', title: 'Unfounded', derived: true },
      { memoryComposer: composer },
    )).rejects.toThrow(/entity_refs is required/);

    const ok = await coreRemember(
      { content: 'Founded conclusion', title: 'Founded conclusion', derived: true, entity_refs: ['TASK-0042'], layer: 'semantic' },
      { memoryComposer: composer },
    );
    const stored = await service.get(ok.id) as { derived?: boolean; entity_refs?: string[] };
    expect(stored.derived).toBe(true);
    expect(stored.entity_refs).toEqual(['TASK-0042']);
  });

  it('E2E consolidation loop: episodes → candidates → derived knowledge → retired members → empty candidates', async () => {
    const composer = createDefaultComposer(() => service);
    const oldIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Three aged episodics in one context (backdate created_at via save).
    for (let i = 0; i < 3; i++) {
      const r = await coreRemember(
        { content: `Episode ${i}: fixed a flaky SSE case`, title: `Episode ${i}`, layer: 'episodic', context: 'FLDR-0001', entity_refs: ['TASK-0001'] },
        { memoryComposer: composer },
      );
      const e = await service.get(r.id);
      await service.save({ ...e, created_at: oldIso } as Entity);
    }

    // 1. Candidates: one ripe bundle.
    const before = await consolidationCandidates(service, {});
    expect(before.ripe_count).toBe(1);
    const bundle = before.bundles[0]!;
    expect(bundle.key).toBe('context:FLDR-0001');
    expect(bundle.member_ids).toHaveLength(3);

    // 2. Consolidator writes ONE derived narrative citing the members.
    const knowledge = await coreRemember(
      {
        content: 'SSE reconnects flake under load; the fix pattern is reconnect backoff. Seen 3×.',
        title: 'SSE reconnect backoff pattern',
        layer: 'semantic', derived: true, context: 'FLDR-0001',
        entity_refs: [...bundle.member_ids, 'TASK-0001'],
      },
      { memoryComposer: composer },
    );

    // 3. Retire the members.
    const retired = await coreForget({ ids: bundle.member_ids }, { memoryComposer: composer });
    expect(retired.forgotten).toBe(3);

    // 4. Candidates now empty (retired members self-exclude); knowledge recallable.
    const after = await consolidationCandidates(service, {});
    expect(after.total_episodic).toBe(0);
    const recalled = await coreRecall({ query: 'SSE flaky fix pattern' }, { memoryComposer: composer });
    expect(recalled.items[0]?.id).toBe(knowledge.id);
  });

  // ── Mandatory title (TASK-0687 + follow-up) ──────────────────────

  it('explicit title is used verbatim; body stays the full content', async () => {
    const composer = createDefaultComposer(() => service);
    const r = await coreRemember(
      { content: 'A single paragraph fact with no line breaks that would otherwise become the title.', title: 'Clean Title', layer: 'semantic' },
      { memoryComposer: composer },
    );
    const m = await service.get(r.id) as { title?: string; content?: string };
    expect(m.title).toBe('Clean Title');
    expect(m.content).toBe('A single paragraph fact with no line breaks that would otherwise become the title.');
  });

  it('title is mandatory on the explicit remember path — absent title is rejected', async () => {
    const composer = createDefaultComposer(() => service);
    await expect(coreRemember(
      // @ts-expect-error — title is required; this asserts the runtime guard too.
      { content: 'First line is the title\n\nSecond paragraph is the body.', layer: 'semantic' },
      { memoryComposer: composer },
    )).rejects.toThrow(/title is required/);
  });

  it('whitespace-only title is rejected (treated as absent)', async () => {
    const composer = createDefaultComposer(() => service);
    await expect(coreRemember(
      { content: 'Derived heading here\n\nrest of body', title: '   ', layer: 'semantic' },
      { memoryComposer: composer },
    )).rejects.toThrow(/title is required/);
  });

  // ── End-to-end: capture → durable entity → core recall ────────────

  it('E2E: implicit capture writes a durable MEMO entity recallable via core recall', async () => {
    const composer: MemoryComposer = createDefaultComposer(() => service);
    const ctx: WriteContext = {
      actor: { type: 'agent', name: 'claude' },
      operationLog: { append: () => {}, query: async () => [], countForTask: async () => 0 },
      memoryComposer: composer,
    };

    await createEntity(service, {
      title: 'ADR 0092.3 memory experience design',
      type: 'artifact',
      content: 'Four verbs: wakeup, recall, remember, forget',
    }, ctx, CREATE_ATTRIBUTION);

    const result = await coreRecall({ query: 'memory experience four verbs' }, { memoryComposer: composer });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]!.id).toMatch(/^MEMO-/);
    expect(result.items[0]!.entity_id).toMatch(/^ARTF-/);
    expect(result.items[0]!.kind).toBe('artifact');
  });
});
