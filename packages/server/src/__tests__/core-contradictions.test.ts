/**
 * Tests for core/contradictions (ADR 0092.13, R-9).
 *
 * groupByStateKey is pure — tested with literal Memory objects.
 * detectContradictions / contradictsFor are tested against a Map-backed
 * service mock (same shape as core-consolidation.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import type { Entity, Memory } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/service-types.js';
import { groupByStateKey, detectContradictions, contradictsFor } from '../core/contradictions.js';

const NOW = Date.parse('2026-06-16T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function mem(id: string, overrides: Partial<Memory> = {}): Memory {
  const created = new Date(NOW - 10 * DAY).toISOString();
  return {
    id,
    type: 'memory',
    title: `digest of ${id}`,
    layer: 'semantic',
    usage_count: 0,
    created_at: created,
    updated_at: created,
    ...overrides,
  } as Memory;
}

function mockService(entities: Entity[]): IBacklogService {
  return {
    get: vi.fn(async (id: string) => entities.find(e => e.id === id)),
    getMarkdown: vi.fn(async () => null),
    list: vi.fn(async (filter?: { type?: string }) =>
      filter?.type ? entities.filter(e => (e.type ?? 'task') === filter.type) : entities),
    add: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => true),
    counts: vi.fn(async () => ({ total_tasks: 0, total_epics: 0, by_status: {}, by_type: {} })),
    getMaxId: vi.fn(async () => 0),
    searchUnified: vi.fn(async () => []),
  };
}

describe('groupByStateKey (pure)', () => {
  it('flags ≥2 live holders of one state_key, newest member first', () => {
    const old = new Date(NOW - 5 * DAY).toISOString();
    const newer = new Date(NOW - 1 * DAY).toISOString();
    const groups = groupByStateKey([
      mem('MEMO-0001', { state_key: 'db.primary', created_at: old, title: 'Primary DB is SQLite' }),
      mem('MEMO-0002', { state_key: 'db.primary', created_at: newer, title: 'Primary DB is Postgres' }),
    ], { now: NOW });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.state_key).toBe('db.primary');
    expect(groups[0]?.count).toBe(2);
    expect(groups[0]?.members.map(m => m.id)).toEqual(['MEMO-0002', 'MEMO-0001']); // newest first
    expect(groups[0]?.newest_created_at).toBe(newer);
  });

  it('does not flag a single live holder (the invariant holding)', () => {
    const groups = groupByStateKey([
      mem('MEMO-0001', { state_key: 'db.primary' }),
      mem('MEMO-0002', { state_key: 'build.bundler' }),
    ], { now: NOW });
    expect(groups).toHaveLength(0);
  });

  it('excludes expired holders — only LIVE memories contradict', () => {
    const groups = groupByStateKey([
      mem('MEMO-0001', { state_key: 'db.primary' }),
      mem('MEMO-0002', { state_key: 'db.primary', valid_until: '2000-01-01T00:00:00.000Z' }), // expired predecessor
    ], { now: NOW });
    expect(groups).toHaveLength(0); // R-2 worked: predecessor closed, one live holder
  });

  it('ignores memories without a state_key', () => {
    const groups = groupByStateKey([
      mem('MEMO-0001'),
      mem('MEMO-0002'),
    ], { now: NOW });
    expect(groups).toHaveLength(0);
  });

  it('orders multiple conflicted keys most-recent-first', () => {
    const t1 = new Date(NOW - 9 * DAY).toISOString();
    const t2 = new Date(NOW - 2 * DAY).toISOString();
    const groups = groupByStateKey([
      mem('MEMO-0001', { state_key: 'old.key', created_at: t1 }),
      mem('MEMO-0002', { state_key: 'old.key', created_at: t1 }),
      mem('MEMO-0003', { state_key: 'fresh.key', created_at: t2 }),
      mem('MEMO-0004', { state_key: 'fresh.key', created_at: t2 }),
    ], { now: NOW });
    expect(groups.map(g => g.state_key)).toEqual(['fresh.key', 'old.key']);
  });
});

describe('detectContradictions (service-backed)', () => {
  it('considers only memory entities and reports counts', async () => {
    const svc = mockService([
      mem('MEMO-0001', { state_key: 'db.primary' }),
      mem('MEMO-0002', { state_key: 'db.primary' }),
      mem('MEMO-0003', { state_key: 'solo.key' }),
      { id: 'TASK-0001', type: 'task', title: 't', status: 'open', created_at: '', updated_at: '' } as Entity,
    ]);
    const result = await detectContradictions(svc);
    expect(result.contradiction_count).toBe(1);
    expect(result.total_live_keyed).toBe(3);
    expect(result.groups[0]?.members).toHaveLength(2);
  });

  it('returns no groups when every key has one holder', async () => {
    const svc = mockService([
      mem('MEMO-0001', { state_key: 'a' }),
      mem('MEMO-0002', { state_key: 'b' }),
    ]);
    const result = await detectContradictions(svc);
    expect(result.contradiction_count).toBe(0);
    expect(result.groups).toEqual([]);
  });
});

describe('contradictsFor (per-memory viewer field)', () => {
  it('lists the OTHER live holders of the memory\'s state_key', async () => {
    const a = mem('MEMO-0001', { state_key: 'db.primary' });
    const svc = mockService([
      a,
      mem('MEMO-0002', { state_key: 'db.primary' }),
      mem('MEMO-0003', { state_key: 'db.primary', valid_until: '2000-01-01T00:00:00.000Z' }), // expired, excluded
      mem('MEMO-0004', { state_key: 'other' }),
    ]);
    expect(await contradictsFor(svc, a, NOW)).toEqual(['MEMO-0002']);
  });

  it('returns [] for a memory with no state_key or no conflict', async () => {
    const a = mem('MEMO-0001');
    const b = mem('MEMO-0002', { state_key: 'solo' });
    const svc = mockService([a, b]);
    expect(await contradictsFor(svc, a, NOW)).toEqual([]);
    expect(await contradictsFor(svc, b, NOW)).toEqual([]);
  });
});
