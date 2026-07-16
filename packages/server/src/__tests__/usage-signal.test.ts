/**
 * Tests for the usage-signal multiplier and usage tracker (ADR 0092.9).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import type { Entity } from '@backlog-mcp/shared';
import { usageFactor, USAGE_FLOOR, USAGE_CEIL } from '../memory/usage-signal.js';
import { MemoryUsageOverlay } from '../memory/memory-usage-overlay.js';
import { MemoryUsageTracker, extractMemoCitations } from '../memory/usage-tracker.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';

const NOW = Date.parse('2026-06-10T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('usageFactor (R-15)', () => {
  it('grace period: young memories are neutral regardless of usage', () => {
    expect(usageFactor({ created_at: iso(3 * DAY), usage_count: 0 }, NOW)).toBe(1.0);
    expect(usageFactor({ created_at: iso(13 * DAY), usage_count: 8, last_used_at: iso(0) }, NOW)).toBe(1.0);
  });

  it('old + never used → floor (0.3), not zero — reorders, never hides', () => {
    expect(usageFactor({ created_at: iso(60 * DAY), usage_count: 0 }, NOW)).toBe(USAGE_FLOOR);
  });

  it('old + heavily and recently used → ceiling (1.5)', () => {
    const f = usageFactor({ created_at: iso(60 * DAY), usage_count: 8, last_used_at: iso(0) }, NOW);
    expect(f).toBeCloseTo(USAGE_CEIL, 5);
  });

  it('usage decays with idleness: 30 idle days halves the usage contribution', () => {
    const fresh = usageFactor({ created_at: iso(60 * DAY), usage_count: 8, last_used_at: iso(0) }, NOW);
    const idle30 = usageFactor({ created_at: iso(60 * DAY), usage_count: 8, last_used_at: iso(30 * DAY) }, NOW);
    expect(idle30 - USAGE_FLOOR).toBeCloseTo((fresh - USAGE_FLOOR) / 2, 5);
  });

  it('count saturates at 8 — repetition has diminishing returns', () => {
    const at8 = usageFactor({ created_at: iso(60 * DAY), usage_count: 8, last_used_at: iso(0) }, NOW);
    const at200 = usageFactor({ created_at: iso(60 * DAY), usage_count: 200, last_used_at: iso(0) }, NOW);
    expect(at200).toBe(at8);
  });
});

describe('extractMemoCitations', () => {
  it('finds unique MEMO- ids in markdown text', () => {
    expect(extractMemoCitations('Per MEMO-0007 and MEMO-0008 (see MEMO-0007 again), not TASK-0001'))
      .toEqual(['MEMO-0007', 'MEMO-0008']);
    expect(extractMemoCitations('no citations here')).toEqual([]);
  });
});

describe('MemoryUsageTracker (R-13/R-14/R-16)', () => {
  function setup(memory?: Partial<Entity> & { id: string }) {
    const store = new Map<string, Entity>();
    if (memory) {
      store.set(memory.id, {
        type: 'memory', layer: 'episodic', title: 't', usage_count: 0,
        created_at: iso(60 * DAY), updated_at: iso(60 * DAY), ...memory,
      } as Entity);
    }
    const saves: Entity[] = [];
    const lines: string[] = [];
    const service = {
      get: vi.fn(async (id: string) => store.get(id)),
      save: vi.fn(async (e: Entity) => { store.set(e.id, e); saves.push(e); }),
    } as unknown as IBacklogService;
    const tracker = new MemoryUsageTracker({
      getService: () => service,
      appendLine: (l) => lines.push(l),
      now: () => NOW,
    });
    return { tracker, saves, lines, store };
  }

  it('recordRecall appends one batched JSONL line, no entity writes (weak signal)', () => {
    const { tracker, saves, lines } = setup();
    tracker.recordRecall('how do we deploy', ['MEMO-0001', 'MEMO-0002']);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ type: 'recall', query: 'how do we deploy', ids: ['MEMO-0001', 'MEMO-0002'] });
    expect(saves).toHaveLength(0);
  });

  it('recordExpand bumps and flushes on the first use (bucket 1)', async () => {
    const { tracker, saves, lines } = setup({ id: 'MEMO-0001' });
    await tracker.recordExpand('MEMO-0001');
    expect(lines.some(l => l.includes('"expand"'))).toBe(true);
    expect(saves).toHaveLength(1);
    expect((saves[0] as { usage_count?: number }).usage_count).toBe(1);
    expect((saves[0] as { last_used_at?: string }).last_used_at).toBeDefined();
  });

  it('relatime gate: count 4 within 24h of last flush does NOT rewrite the file', async () => {
    const { tracker, saves } = setup({ id: 'MEMO-0001', usage_count: 3, last_used_at: iso(60 * 60 * 1000) } as never);
    await tracker.recordExpand('MEMO-0001');  // 3→4: not a bucket, not stale
    expect(saves).toHaveLength(0);
  });

  it('relatime gate: flushes when >24h stale even off-bucket', async () => {
    const { tracker, saves } = setup({ id: 'MEMO-0001', usage_count: 3, last_used_at: iso(2 * DAY) } as never);
    await tracker.recordExpand('MEMO-0001');  // 3→4: off-bucket but stale → flush
    expect(saves).toHaveLength(1);
    expect((saves[0] as { usage_count?: number }).usage_count).toBe(4);
  });

  it('recordExpand ignores non-memory ids and missing entities', async () => {
    const { tracker, saves, lines } = setup();
    await tracker.recordExpand('TASK-0001');
    await tracker.recordExpand('MEMO-9999');  // not in store
    expect(saves).toHaveLength(0);
    expect(lines.filter(l => l.includes('"expand"'))).toHaveLength(1);  // MEMO-9999 logged, TASK ignored
  });

  it('recordCitations bumps every cited memory from text and extra ids', async () => {
    const { tracker, saves, store } = setup({ id: 'MEMO-0001' });
    store.set('MEMO-0002', { id: 'MEMO-0002', type: 'memory', layer: 'semantic', title: 't', usage_count: 0, created_at: iso(60 * DAY), updated_at: iso(60 * DAY) } as Entity);
    await tracker.recordCitations(['Built on MEMO-0001 insights'], ['MEMO-0002', 'TASK-0042']);
    expect(saves.map(s => s.id).sort()).toEqual(['MEMO-0001', 'MEMO-0002']);
  });

  it('tracker failures never propagate', async () => {
    const tracker = new MemoryUsageTracker({
      getService: () => { throw new Error('boom'); },
      appendLine: () => { throw new Error('disk full'); },
      now: () => NOW,
    });
    await expect(tracker.recordExpand('MEMO-0001')).resolves.toBeUndefined();
    expect(() => tracker.recordRecall('q', ['MEMO-0001'])).not.toThrow();
  });
});

interface ProjectTrackerFixture {
  tracker: MemoryUsageTracker;
  overlay: MemoryUsageOverlay;
  save: ReturnType<typeof vi.fn>;
}

function createProjectTrackerFixture(
  name: string,
  summary: { usageCount: number; lastUsedAt: string },
): ProjectTrackerFixture {
  const memory = {
    id: 'MEMO-0001',
    type: 'memory',
    layer: 'episodic',
    title: 'Project memory',
    usage_count: 89,
    last_used_at: iso(60 * 60 * 1000),
    created_at: iso(60 * DAY),
    updated_at: iso(60 * DAY),
  } as Entity;
  const save = vi.fn(async function saveMemory() {});
  const service = {
    get: vi.fn(async function getMemory(id: string) {
      return id === memory.id ? memory : undefined;
    }),
    save,
  } as unknown as IBacklogService;
  const overlay = new MemoryUsageOverlay(
    join(tmpdir(), 'usage-signal-project', name, '.backlog'),
  );
  overlay.set(memory.id, summary);
  const tracker = new MemoryUsageTracker({
    getService: function getService() {
      return service;
    },
    appendLine: function appendUsageLine(line) {
      overlay.appendLine(line);
    },
    summaryStore: overlay,
    now: function getNow() {
      return NOW;
    },
  });
  return { tracker, overlay, save };
}

function usageSummaryCount(overlay: MemoryUsageOverlay): number {
  return overlay.readLines().filter(function isUsageSummary(line) {
    try {
      return (JSON.parse(line) as { type?: string }).type === 'usage_summary';
    } catch {
      return false;
    }
  }).length;
}

describe('MemoryUsageTracker project summary store', function describeProjectTracker() {
  it('derives the count from the overlay and checkpoints on a bucket', async function checkpointsBucket() {
    const fixture = createProjectTrackerFixture('bucket', {
      usageCount: 2,
      lastUsedAt: iso(60 * 60 * 1000),
    });

    await fixture.tracker.recordExpand('MEMO-0001');

    expect(fixture.overlay.get('MEMO-0001')).toEqual({
      usageCount: 3,
      lastUsedAt: new Date(NOW).toISOString(),
    });
    expect(usageSummaryCount(fixture.overlay)).toBe(2);
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it('keeps off-bucket increments lossy inside the stale window', async function keepsLossyGate() {
    const fixture = createProjectTrackerFixture('off-bucket', {
      usageCount: 3,
      lastUsedAt: iso(60 * 60 * 1000),
    });

    await fixture.tracker.recordExpand('MEMO-0001');

    expect(fixture.overlay.get('MEMO-0001')).toEqual({
      usageCount: 3,
      lastUsedAt: iso(60 * 60 * 1000),
    });
    expect(usageSummaryCount(fixture.overlay)).toBe(1);
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it('checkpoints an off-bucket count after the stale gate', async function checkpointsStaleSummary() {
    const fixture = createProjectTrackerFixture('stale', {
      usageCount: 3,
      lastUsedAt: iso(2 * DAY),
    });

    await fixture.tracker.recordExpand('MEMO-0001');

    expect(fixture.overlay.get('MEMO-0001')).toEqual({
      usageCount: 4,
      lastUsedAt: new Date(NOW).toISOString(),
    });
    expect(usageSummaryCount(fixture.overlay)).toBe(2);
    expect(fixture.save).not.toHaveBeenCalled();
  });
});
