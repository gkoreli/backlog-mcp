/** Supplied-data/time analysis, complete-read reuse and advisory failure contracts. */
import { describe, expect, it, vi } from 'vitest';
import matter from 'gray-matter';
import type { Memory, AnyEntity } from '@backlog-mcp/shared';
import { createMemoryAnalysisView } from '../core/memory-analysis-view.js';
import { collisionPairsInView } from '../core/collision-candidates.js';
import { consolidationCandidates, demandCounts } from '../core/consolidation.js';
import { readEntityDetail, type EntityDetailReader } from '../core/entity-detail.js';
import { mintMemoryEntry } from '../core/memory-entry.js';
import { CorpusReadUnavailableError } from '../core/entity-corpus.js';
import { groupByStateKey } from '../core/contradictions.js';

const NOW = Date.parse('2026-10-04T00:00:00Z');
const DAY = 86400000;
function memory(id: string, extras: Partial<Memory> = {}): Memory {
  return { id, title: 'Cache policy', content: 'Cache policy', type: 'memory', layer: 'episodic', parent_id: 'CTX-1', status: 'open', created_at: new Date(NOW - 10 * DAY).toISOString(), updated_at: new Date(NOW - 10 * DAY).toISOString(), usage_count: 89, ...extras };
}
function ranked(memories: readonly Memory[]) {
  return memories.map(function hit(item) { return { id: item.id, type: 'memory' as const, item, score: 1 }; });
}
function reader(memories: Memory[]): EntityDetailReader {
  return {
    get: vi.fn(async function get(id) { return memories.find(function matches(m) { return m.id === id; }); }),
    getMarkdown: vi.fn(async function markdown() { return '---\nunknown: preserved\n---\n\nRaw native Markdown\n'; }),
    list: vi.fn(async function children() { return []; }),
    scan: vi.fn(async function corpus() { return memories; }),
    searchUnified: vi.fn(async function search() { return ranked(memories); }),
  };
}
function observation() { return { now: NOW, childLimit: 1000 }; }
function gate() {
  let release = function releaseUninitialized() {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

describe('memory analysis observation', function observed() {
  it('copies open payloads and indexes only memory holders without exposing mutable indexes', function immutable() {
    const custom = { nested: { native: true } };
    const source = [memory('__proto__', { state_key: '__proto__', entity_refs: ['SOURCE-1'], custom }), memory('MEMO-2', { state_key: '__proto__' })];
    const unrelated: AnyEntity = { id: 'TASK-1', title: 'Task', type: 'custom', state_key: '__proto__' };
    const view = createMemoryAnalysisView([...source, unrelated], NOW);
    source[0].title = 'Changed later'; custom.nested.native = false; source.push(memory('MEMO-3'));
    expect(view.memories).toHaveLength(2);
    expect(view.get('__proto__')).toMatchObject({ title: 'Cache policy', custom: { nested: { native: true } } });
    expect(view.holders('__proto__').map(m => m.id)).toEqual(['__proto__', 'MEMO-2']);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.get('__proto__')?.entity_refs)).toBe(true);
    expect(Object.isFrozen(view.holders('__proto__'))).toBe(true);
    expect(view.get('TASK-1')).toBeUndefined();
  });

  it('retains native YAML binary and timestamp fields without making the corpus unreadable', async function nativePayloads() {
    const parsed = matter('---\ncustom_binary: !!binary SGVsbG8=\ncustom_date: 2026-10-04\ncustom_list:\n  - native\n---\nBody');
    const focal = memory('MEMO-1', { ...parsed.data, state_key: 'db' });
    const other = memory('MEMO-2', { state_key: 'db' });
    const view = createMemoryAnalysisView([focal, other], NOW);
    const observed = view.get('MEMO-1');
    const binary = observed?.custom_binary;
    const date = observed?.custom_date;
    expect(binary).toBeInstanceOf(Uint8Array);
    expect(date).toBeInstanceOf(Date);
    if (!(binary instanceof Uint8Array) || !(date instanceof Date)) throw new Error('Missing native payload');
    parsed.data.custom_binary[0] = 0;
    parsed.data.custom_date.setTime(0);
    expect(new TextDecoder().decode(binary)).toBe('Hello');
    expect(date.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(Object.isFrozen(observed?.custom_list)).toBe(true);
    const service = reader([focal, other]);
    const detail = await readEntityDetail(service, focal.id, observation());
    expect(detail?.contradicts).toEqual(['MEMO-2']);
    expect(detail?.entity.custom_binary).toBeInstanceOf(Uint8Array);
  });

  it('preserves invalid expiry diagnostics, age-zero creation and the exact expiry boundary', function validity() {
    const malformed = memory('MEMO-1', { created_at: 'invalid', valid_until: 'invalid', state_key: 'db' });
    const exact = memory('MEMO-2', { valid_until: new Date(NOW).toISOString(), state_key: 'db' });
    const future = memory('MEMO-3', { valid_until: new Date(NOW + 1).toISOString(), state_key: 'db' });
    const view = createMemoryAnalysisView([malformed, exact, future], NOW);
    expect(view.live.map(m => m.id)).toEqual(['MEMO-1', 'MEMO-3']);
    expect(groupByStateKey([malformed, exact, future], { now: NOW })[0]?.count).toBe(2);
    const entry = mintMemoryEntry(malformed, undefined, NOW);
    expect(entry.createdAt).toBe(NOW);
    expect(entry.metadata?.invalid_valid_until).toBe('invalid');
  });

  it('uses one complete corpus for consolidation and every collision focal despite later mutation', async function oneCorpus() {
    const memories = [memory('MEMO-1'), memory('MEMO-2'), memory('MEMO-3')];
    const service = reader(memories);
    const search = vi.spyOn(service, 'searchUnified').mockImplementation(async function hits() {
      const result = ranked(memories);
      memories[1].title = 'Search raced native edit';
      return result;
    });
    const result = await consolidationCandidates(service, { min_count: 1, min_age_days: 0 }, { now: NOW });
    expect(service.scan).toHaveBeenCalledOnce();
    expect(service.list).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(3);
    expect(result.bundles[0]?.digests).toEqual(['Cache policy', 'Cache policy', 'Cache policy']);
    expect(result.collision_candidates).toHaveLength(3);
    expect(result.collision_candidates.flatMap(pair => pair.members.map(member => member.title))).not.toContain('Search raced native edit');
  });

  it('treats ranked payloads as references, skipping missing hits and retaining observed payloads across delayed search', async function references() {
    const memories = [memory('MEMO-1'), memory('MEMO-2')];
    const view = createMemoryAnalysisView(memories, NOW);
    const waiting = gate();
    const service = { searchUnified: vi.fn(async function search() {
      await waiting.promise;
      return ranked([memory('MISSING'), memory('MEMO-2', { title: 'Untrusted hit payload' }), memory('MEMO-2')]);
    }) };
    const result = collisionPairsInView(service, view, { focalIds: ['MEMO-1', 'MISSING'] });
    memories[1].valid_until = new Date(NOW).toISOString();
    waiting.release();
    const pairs = await result;
    expect(service.searchUnified).toHaveBeenCalledOnce();
    expect(pairs.focal_count).toBe(1);
    expect(pairs.pairs[0]?.members[1]).toMatchObject({ id: 'MEMO-2', title: 'Cache policy' });
  });

  it('keeps the inclusive demand window and its existing future-event policy', function demandWindow() {
    const lines = [NOW - DAY, NOW - DAY - 1, NOW + 1].map(function event(ts) {
      return JSON.stringify({ type: 'recall', ids: ['MEMO-1'], ts: new Date(ts).toISOString() });
    });
    expect(demandCounts(lines, { now: NOW, windowDays: 1 }).get('MEMO-1')).toBe(2);
  });
});

describe('authoritative detail and advisory analysis', function detailReads() {
  it('shares one observation for structural and collision analysis, usage and projection', async function detail() {
    const memories = [memory('MEMO-1', { state_key: 'db' }), memory('MEMO-2', { state_key: 'db' })];
    const service = reader(memories);
    const mint = vi.fn(function project(m: Memory, now: number) { return mintMemoryEntry(m, { usageCount: 3 }, now); });
    const usage = vi.fn(function lines() { return [JSON.stringify({ type: 'expand', id: 'MEMO-1', ts: new Date(NOW - 1).toISOString() })]; });
    const result = await readEntityDetail(service, 'MEMO-1', { ...observation(), readUsageLines: usage, mintMemoryEntry: mint });
    expect(result?.contradicts).toEqual(['MEMO-2']);
    expect(result?.collision_candidates?.[0]?.id).toBe('MEMO-2');
    expect(result?.usage_series?.at(-1)).toBe(1);
    expect(result?.entity.usage_count).toBe(3);
    expect(result?.entity).not.toHaveProperty('last_used_at');
    expect(mint).toHaveBeenCalledWith(memories[0], NOW);
    expect(usage).toHaveBeenCalledOnce();
    expect(service.scan).toHaveBeenCalledOnce();
    expect(result?.raw).toContain('unknown: preserved');
  });

  it.each(['unkeyed', 'expired', 'malformed'])('preserves %s authority when advisory complete reads are unavailable', async function unavailable(kind) {
    const focal = memory('MEMO-1', kind === 'expired' ? { state_key: 'db', valid_until: new Date(NOW).toISOString() } : kind === 'malformed' ? { valid_until: 'invalid' } : {});
    const service = reader([focal]); delete service.scan;
    const result = await readEntityDetail(service, focal.id, observation());
    expect(result?.entity).toEqual(focal);
    expect(result).not.toHaveProperty('collision_candidates');
    expect(service.searchUnified).not.toHaveBeenCalled();
    expect(service.list).toHaveBeenCalledOnce(); // children only, never a corpus substitute
  });

  it('fails visibly for a live keyed detail requiring an unavailable complete corpus', async function required() {
    const service = reader([memory('MEMO-1', { state_key: 'db' })]); delete service.scan;
    await expect(readEntityDetail(service, 'MEMO-1', observation())).rejects.toBeInstanceOf(CorpusReadUnavailableError);
    expect(service.searchUnified).not.toHaveBeenCalled();
    expect(service.list).toHaveBeenCalledOnce();
  });

  it('retains structural conflicts and raw detail after an advisory search failure', async function searchFailure() {
    const service = reader([memory('MEMO-1', { state_key: 'db' }), memory('MEMO-2', { state_key: 'db' })]);
    vi.spyOn(service, 'searchUnified').mockRejectedValue(new Error('search unavailable'));
    const result = await readEntityDetail(service, 'MEMO-1', observation());
    expect(result?.contradicts).toEqual(['MEMO-2']);
    expect(result).not.toHaveProperty('collision_candidates');
    expect(result?.raw).toContain('Raw native Markdown');
    expect(service.scan).toHaveBeenCalledOnce();
  });

  it('preserves raced/missing focal detail while complete analysis reports no current focal', async function disappeared() {
    const service = reader([memory('MEMO-1'), memory('MEMO-2')]);
    vi.spyOn(service, 'scan').mockResolvedValue([memory('MEMO-2')]);
    const result = await readEntityDetail(service, 'MEMO-1', observation());
    expect(result?.entity.id).toBe('MEMO-1');
    expect(result?.collision_candidates).toEqual([]);
    expect(service.searchUnified).not.toHaveBeenCalled();
  });

  it('coalesces a self-parent reference and preserves receiver binding', async function bound() {
    const focal = memory('MEMO-1', { parent_id: 'MEMO-1' });
    const service = reader([focal]);
    const get = vi.spyOn(service, 'get').mockImplementation(async function get(this: EntityDetailReader, id) {
      expect(this).toBe(service); return id === focal.id ? focal : undefined;
    });
    const scan = vi.spyOn(service, 'scan').mockImplementation(async function scan(this: EntityDetailReader) {
      expect(this).toBe(service); return [focal];
    });
    expect((await readEntityDetail(service, focal.id, observation()))?.parentTitle).toBe(focal.title);
    expect(get).toHaveBeenCalledOnce(); expect(scan).toHaveBeenCalledOnce();
  });

  it('returns absent detail before attempting other reads, and tolerates a missing parent', async function missing() {
    const service = reader([memory('MEMO-1')]);
    expect(await readEntityDetail(service, 'MISSING', observation())).toBeUndefined();
    expect(service.getMarkdown).not.toHaveBeenCalled(); expect(service.scan).not.toHaveBeenCalled();
    expect((await readEntityDetail(service, 'MEMO-1', observation()))?.parentTitle).toBeUndefined();
  });
});
