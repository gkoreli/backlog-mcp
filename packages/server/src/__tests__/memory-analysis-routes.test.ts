/** Driving adapters sample observation time once and keep analysis local to their selected home. */
import { describe, expect, it, vi } from 'vitest';
import type { Memory } from '@backlog-mcp/shared';
import { MemoryComposer, type MemoryEntry } from '@backlog-mcp/memory';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createApp } from '../server/hono-app.js';
import type { IBacklogService } from '../core/backlog-service.contract.js';
import type { AppRequestRuntime } from '../composition/app-request-runtime.types.js';
import { mintMemoryEntry } from '../core/memory-entry.js';
import { registerBacklogContradictionsTool } from '../tools/backlog-contradictions.js';
import { registerBacklogRememberTool } from '../tools/backlog-remember.js';
import { registerBacklogConsolidationTool } from '../tools/backlog-consolidation.js';

const NOW = Date.parse('2026-10-04T00:00:00Z');
function memory(id: string, title: string): Memory {
  return { id, title, content: title, type: 'memory', layer: 'episodic', status: 'open', state_key: 'db', parent_id: 'CTX-1', usage_count: 99, last_used_at: 'old', created_at: 'invalid', updated_at: new Date(NOW - 1).toISOString(), valid_until: new Date(NOW + 10).toISOString() };
}
function service(memories: Memory[]): IBacklogService {
  const reads = {
    get: vi.fn(async function get(id: string) { return memories.find(m => m.id === id); }),
    getMarkdown: vi.fn(async function raw() { return '# Native body\n'; }),
    list: vi.fn(async function list(filter?: { parent_id?: string }) { return filter?.parent_id === undefined ? memories : []; }),
    scan: vi.fn(async function scan() { return memories; }),
    searchUnified: vi.fn(async function search() { return memories.map(item => ({ id: item.id, type: 'memory' as const, item, score: 1 })); }),
  };
  return reads as IBacklogService;
}
function gate() {
  let release = function uninitialized() {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

describe('memory analysis adapters', function adapters() {
  it('keeps detail validity, usage and minted age on one time across delayed corpus and search', async function delayed() {
    const memories = [memory('MEMO-1', 'Cache policy'), memory('MEMO-2', 'Cache policy')];
    const selected = service(memories);
    let clockTime = NOW;
    const clock = vi.fn(function clock() { return clockTime; });
    const corpusGate = gate(); const corpusEntered = gate();
    const searchGate = gate(); const searchEntered = gate();
    vi.spyOn(selected, 'scan').mockImplementation(async function delayedCorpus() { corpusEntered.release(); await corpusGate.promise; return memories; });
    vi.spyOn(selected, 'searchUnified').mockImplementation(async function delayedSearch() {
      searchEntered.release(); await searchGate.promise;
      return memories.map(item => ({ id: item.id, type: 'memory' as const, item, score: 1 }));
    });
    const mintedTimes: number[] = [];
    const runtime: AppRequestRuntime = {
      service: selected, clock, intentRegistrationMode: 'unavailable',
      readUsageLines: function lines() { return [JSON.stringify({ id: 'MEMO-1', type: 'expand', ts: new Date(NOW - 86400000).toISOString() })]; },
      mintMemoryEntry: function mint(m, now) {
        if (now === undefined) throw new Error('Missing supplied projection time');
        mintedTimes.push(now);
        const entry = mintMemoryEntry(m, { usageCount: 3 }, now);
        expect(entry.createdAt).toBe(now);
        return entry;
      },
    };
    const app = createApp(selected, { resolveRuntime: async function resolve() { return runtime; } });
    const pending = app.request('/tasks/MEMO-1');
    await corpusEntered.promise; clockTime = NOW + 10; corpusGate.release();
    await searchEntered.promise; clockTime = NOW + 86400001; searchGate.release();
    const response = await pending;
    expect(response.status).toBe(200);
    const detail = await response.json();
    expect(detail.contradicts).toEqual(['MEMO-2']);
    expect(detail.collision_candidates[0]?.id).toBe('MEMO-2');
    expect(detail.usage_series.at(-2)).toBe(1);
    expect(detail.usage_series.at(-1)).toBe(0);
    expect(detail.usage_count).toBe(3);
    expect(detail).not.toHaveProperty('last_used_at');
    expect(clock).toHaveBeenCalledOnce(); expect(mintedTimes).toEqual([NOW]);
    expect(selected.scan).toHaveBeenCalledOnce();
    const expired = await app.request('/tasks/MEMO-1');
    expect(await expired.json()).not.toHaveProperty('contradicts');
  });

  it('keeps same IDs, state keys and analysis local across two selected homes', async function homes() {
    const first = service([memory('MEMO-1', 'First cache'), memory('MEMO-2', 'First cache')]);
    const second = service([memory('MEMO-1', 'Second cache'), memory('MEMO-3', 'Second cache')]);
    const app = createApp(first, { resolveRuntime: async function select(selection) {
      const selected = selection.home === 'global' ? second : first;
      const root = selection.home === 'global' ? '/second' : '/first';
      return { service: selected, clock: () => NOW, intentRegistrationMode: 'unavailable', home: { id: root, root, kind: 'project', documentsDir: `${root}/docs`, controlDir: `${root}/.backlog` } };
    } });
    const [a, b] = await Promise.all([
      app.request('/tasks/MEMO-1', { headers: { 'x-backlog-home': 'project', 'x-backlog-project-root': '/first' } }),
      app.request('/tasks/MEMO-1', { headers: { 'x-backlog-home': 'global' } }),
    ]);
    expect(await a.json()).toMatchObject({ title: 'First cache', contradicts: ['MEMO-2'], collision_candidates: [{ id: 'MEMO-2' }], home_id: '/first' });
    expect(await b.json()).toMatchObject({ title: 'Second cache', contradicts: ['MEMO-3'], collision_candidates: [{ id: 'MEMO-3' }], home_id: '/second' });
    expect(first.scan).toHaveBeenCalledOnce(); expect(second.scan).toHaveBeenCalledOnce();
  });

  it('preserves authoritative unkeyed HTTP detail and fails required keyed analysis without a corpus', async function unavailable() {
    const memories = [memory('MEMO-1', 'Cache policy')];
    delete memories[0].state_key;
    const selected = service(memories); delete selected.scan;
    const app = createApp(selected, { clock: () => NOW, logError: () => {} });
    const unkeyed = await app.request('/tasks/MEMO-1');
    expect(unkeyed.status).toBe(200);
    expect(await unkeyed.json()).not.toHaveProperty('collision_candidates');
    memories[0].state_key = 'db';
    const keyed = await app.request('/tasks/MEMO-1');
    expect(keyed.status).toBe(500);
  });

  it('uses one supplied remember time for delayed storage, journal and post-commit collision review', async function rememberTime() {
    const memories = [memory('MEMO-0001', 'Cache policy'), memory('MEMO-0002', 'Cache policy')];
    const selected = service(memories);
    const composer = new MemoryComposer();
    const waiting = gate(); const entered = gate();
    let clockTime = NOW;
    const clock = vi.fn(function clock() { return clockTime; });
    const store = vi.spyOn(composer, 'store').mockImplementation(async function store(entry: MemoryEntry) {
      entered.release(); await waiting.promise;
      memories.push(memory('MEMO-0003', entry.title));
      return { ...entry, id: 'MEMO-0003' };
    });
    const append = vi.fn(); const emit = vi.fn(); const register = vi.fn();
    registerBacklogRememberTool({ registerTool: register } as unknown as McpServer, {
      clock, service: selected, memoryComposer: composer,
      actor: { type: 'agent', name: 'unit' }, operationLog: { append, query: async () => [] }, eventBus: { emit },
    });
    const handler = register.mock.calls[0]?.[2];
    if (typeof handler !== 'function') throw new Error('Missing remember handler');
    const pending = handler({ title: 'Cache policy', content: 'Cache policy' });
    await entered.promise; clockTime = NOW + 10; waiting.release();
    const response = await pending;
    const receipt = JSON.parse(response.content[0].text);
    expect(store.mock.calls[0]?.[0].createdAt).toBe(NOW);
    expect(receipt.created_at).toBe(new Date(NOW).toISOString());
    expect(receipt.collision_candidates.map((candidate: { id: string }) => candidate.id)).toEqual(['MEMO-0001', 'MEMO-0002']);
    expect(append).toHaveBeenCalledOnce();
    expect(append.mock.calls[0]?.[0].ts).toBe(new Date(NOW).toISOString());
    expect(emit.mock.calls[0]?.[0].ts).toBe(new Date(NOW).toISOString());
    expect(clock).toHaveBeenCalledOnce(); expect(selected.scan).toHaveBeenCalledOnce();
  });

  it.each(['structural', 'collision', 'consolidation'])('samples time once for a cold MCP %s read', async function mcp(kind) {
    const register = vi.fn();
    const server = { registerTool: register } as unknown as McpServer;
    const selected = service([memory('MEMO-1', 'Cache policy'), memory('MEMO-2', 'Cache policy')]);
    const clock = vi.fn(function now() { return NOW; });
    if (kind === 'consolidation') registerBacklogConsolidationTool(server, selected, { clock });
    else registerBacklogContradictionsTool(server, selected, { clock });
    const handler = register.mock.calls[0]?.[2];
    if (typeof handler !== 'function') throw new Error('Missing registered handler');
    const result = await handler(kind === 'consolidation' ? { min_count: 1, min_age_days: 0 } : { candidates: kind === 'collision' });
    const data = JSON.parse(result.content[0].text);
    if (kind === 'structural') expect(data.total_live_keyed).toBe(2);
    if (kind === 'collision') expect(data.total_live_memories).toBe(2);
    if (kind === 'consolidation') expect(data.total_episodic).toBe(2);
    expect(clock).toHaveBeenCalledOnce(); expect(selected.scan).toHaveBeenCalledOnce();
  });
});
