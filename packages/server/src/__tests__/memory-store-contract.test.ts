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
import { EntityType, parseEntityNum, type Entity } from '@backlog-mcp/shared';
import { MemoryComposer, type MemoryEntry } from '@backlog-mcp/memory';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { IBacklogService } from '../storage/service-types.js';
import { BacklogMemoryStore } from '../memory/backlog-memory-store.js';
import { createDefaultComposer } from '../memory/bootstrap.js';
import { createItem } from '../core/create.js';
import { recall as coreRecall } from '../core/recall.js';
import type { WriteContext } from '../core/types.js';

/** Map-backed IBacklogService with real Orama-backed searchUnified. */
function fakeService(): IBacklogService {
  const store = new Map<string, Entity>();
  return {
    async get(id) { return store.get(id); },
    async getMarkdown() { return null; },
    async list(filter) {
      let out = [...store.values()];
      if (filter?.type) out = out.filter(e => (e.type ?? 'task') === filter.type);
      if (filter?.parent_id) out = out.filter(e => (e.parent_id ?? e.epic_id) === filter.parent_id);
      return out;
    },
    async add(task) { store.set(task.id, { ...task }); },
    async save(task) { store.set(task.id, { ...task }); },
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
    layer: 'episodic',
    source: 'test-agent',
    createdAt: Date.now(),
    ...overrides,
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
    expect(memo!.description).toContain('runtime-clean');
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

  // ── End-to-end: capture → durable entity → core recall ────────────

  it('E2E: implicit capture writes a durable MEMO entity recallable via core recall', async () => {
    const composer: MemoryComposer = createDefaultComposer(() => service);
    const ctx: WriteContext = {
      actor: { type: 'agent', name: 'claude' },
      operationLog: { append: () => {}, query: async () => [], countForTask: async () => 0 },
      memoryComposer: composer,
    };

    await createItem(service, {
      title: 'ADR 0092.3 memory experience design',
      type: 'artifact',
      description: 'Four verbs: wakeup, recall, remember, forget',
    }, ctx);

    const result = await coreRecall({ query: 'memory experience four verbs' }, { memoryComposer: composer });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]!.id).toMatch(/^MEMO-/);
    expect(result.items[0]!.entity_id).toMatch(/^ARTF-/);
    expect(result.items[0]!.kind).toBe('artifact');
  });
});
