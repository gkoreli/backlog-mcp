/**
 * Tests for core/consolidation (ADR 0092.7 Phase D).
 *
 * bucketEpisodics is pure — tested with literal Memory objects.
 * consolidationCandidates filtering (live, non-derived, episodic-only) is
 * tested against a Map-backed service mock.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Entity, Memory } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/service-types.js';
import { bucketEpisodics, consolidationCandidates } from '../core/consolidation.js';
import { ValidationError } from '../core/types.js';

const NOW = Date.parse('2026-06-10T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function mem(id: string, overrides: Partial<Memory> = {}): Memory {
  const created = new Date(NOW - 10 * DAY).toISOString();
  return {
    id,
    type: 'memory',
    title: `digest of ${id}`,
    layer: 'episodic',
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

describe('bucketEpisodics (pure)', () => {
  const opts = { minCount: 3, minAgeDays: 7, maxDigests: 10, now: NOW };

  it('buckets by context first, then first entity_ref, then unscoped', () => {
    const bundles = bucketEpisodics([
      mem('MEMO-0001', { parent_id: 'FLDR-0001' }),
      mem('MEMO-0002', { parent_id: 'FLDR-0001' }),
      mem('MEMO-0003', { entity_refs: ['TASK-0042'] }),
      mem('MEMO-0004', {}),
    ], opts);

    const keys = bundles.map(b => b.key).sort();
    expect(keys).toEqual(['context:FLDR-0001', 'entity:TASK-0042', 'unscoped']);
  });

  it('ripeness requires BOTH min_count and min_age_days', () => {
    const old = new Date(NOW - 30 * DAY).toISOString();
    const fresh = new Date(NOW - 1 * DAY).toISOString();

    const bundles = bucketEpisodics([
      // 3 old members in FLDR-0001 → ripe
      mem('MEMO-0001', { parent_id: 'FLDR-0001', created_at: old }),
      mem('MEMO-0002', { parent_id: 'FLDR-0001', created_at: old }),
      mem('MEMO-0003', { parent_id: 'FLDR-0001', created_at: old }),
      // 3 fresh members in FLDR-0002 → too young
      mem('MEMO-0004', { parent_id: 'FLDR-0002', created_at: fresh }),
      mem('MEMO-0005', { parent_id: 'FLDR-0002', created_at: fresh }),
      mem('MEMO-0006', { parent_id: 'FLDR-0002', created_at: fresh }),
      // 2 old members in FLDR-0003 → too small
      mem('MEMO-0007', { parent_id: 'FLDR-0003', created_at: old }),
      mem('MEMO-0008', { parent_id: 'FLDR-0003', created_at: old }),
    ], opts);

    const byKey = Object.fromEntries(bundles.map(b => [b.key, b.ripe]));
    expect(byKey['context:FLDR-0001']).toBe(true);
    expect(byKey['context:FLDR-0002']).toBe(false);
    expect(byKey['context:FLDR-0003']).toBe(false);
  });

  it('orders ripe bundles first, members oldest-first, unions entity_refs', () => {
    const old = new Date(NOW - 30 * DAY).toISOString();
    const older = new Date(NOW - 40 * DAY).toISOString();
    const bundles = bucketEpisodics([
      mem('MEMO-0002', { parent_id: 'FLDR-0001', created_at: old, entity_refs: ['TASK-0002'] }),
      mem('MEMO-0001', { parent_id: 'FLDR-0001', created_at: older, entity_refs: ['TASK-0001'] }),
      mem('MEMO-0003', { parent_id: 'FLDR-0001', created_at: old, entity_refs: ['TASK-0001'] }),
      mem('MEMO-0009', { parent_id: 'FLDR-0009', created_at: old }),  // too small → not ripe
    ], opts);

    expect(bundles[0]?.key).toBe('context:FLDR-0001');
    expect(bundles[0]?.ripe).toBe(true);
    expect(bundles[0]?.member_ids).toEqual(['MEMO-0001', 'MEMO-0002', 'MEMO-0003']);
    expect(bundles[0]?.entity_refs.sort()).toEqual(['TASK-0001', 'TASK-0002']);
    expect(bundles[1]?.ripe).toBe(false);
  });

  it('bounds digests by maxDigests', () => {
    const members = Array.from({ length: 5 }, (_, i) => mem(`MEMO-000${i + 1}`, { parent_id: 'FLDR-0001' }));
    const bundles = bucketEpisodics(members, { ...opts, minCount: 1, maxDigests: 2 });
    expect(bundles[0]?.digests).toHaveLength(2);
    expect(bundles[0]?.member_ids).toHaveLength(5);  // ids stay complete
  });
});

describe('consolidationCandidates (service-backed)', () => {
  it('considers only live, non-derived, episodic memories', async () => {
    const old = new Date(NOW - 30 * DAY).toISOString();
    const svc = mockService([
      mem('MEMO-0001', { parent_id: 'FLDR-0001', created_at: old }),
      mem('MEMO-0002', { parent_id: 'FLDR-0001', created_at: old, valid_until: '2000-01-01T00:00:00.000Z' }),  // expired
      mem('MEMO-0003', { parent_id: 'FLDR-0001', created_at: old, derived: true, entity_refs: ['MEMO-0001'] }), // inference
      mem('MEMO-0004', { parent_id: 'FLDR-0001', created_at: old, layer: 'semantic' }),                        // not episodic
      { id: 'TASK-0001', type: 'task', title: 't', status: 'open', created_at: old, updated_at: old } as Entity,
    ]);

    const result = await consolidationCandidates(svc, { min_count: 1, min_age_days: 0 });
    expect(result.total_episodic).toBe(1);
    expect(result.bundles[0]?.member_ids).toEqual(['MEMO-0001']);
  });

  it('filters by context and validates params', async () => {
    const old = new Date(NOW - 30 * DAY).toISOString();
    const svc = mockService([
      mem('MEMO-0001', { parent_id: 'FLDR-0001', created_at: old }),
      mem('MEMO-0002', { parent_id: 'FLDR-0002', created_at: old }),
    ]);

    const scoped = await consolidationCandidates(svc, { context: 'FLDR-0001', min_count: 1, min_age_days: 0 });
    expect(scoped.bundles).toHaveLength(1);
    expect(scoped.bundles[0]?.context).toBe('FLDR-0001');

    await expect(consolidationCandidates(svc, { min_count: 0 })).rejects.toThrow(ValidationError);
  });
});
