/**
 * Tests for core/usage-series (ADR 0092.14).
 * Pure fold — tested with literal JSONL lines.
 */
import { describe, it, expect } from 'vitest';
import { usageSeries, hasUsage } from '../core/usage-series.js';

const NOW = Date.parse('2026-06-16T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('usageSeries', () => {
  it('counts events touching the id, scalar id and ids[] alike', () => {
    const lines = [
      JSON.stringify({ ts: iso(0), type: 'expand', id: 'MEMO-0001' }),
      JSON.stringify({ ts: iso(0), type: 'cite', ids: ['MEMO-0001', 'MEMO-0002'] }),
      JSON.stringify({ ts: iso(0), type: 'recall', query: 'x', ids: ['MEMO-0002'] }), // not ours
    ];
    const s = usageSeries(lines, 'MEMO-0001', { windowDays: 1, now: NOW });
    expect(s).toEqual([2]);
  });

  it('buckets by day, oldest first / newest last', () => {
    const lines = [
      JSON.stringify({ ts: iso(0 * DAY + 1000), type: 'expand', id: 'MEMO-0001' }),       // today
      JSON.stringify({ ts: iso(2 * DAY + 1000), type: 'expand', id: 'MEMO-0001' }),       // 2 days ago
      JSON.stringify({ ts: iso(2 * DAY + 2000), type: 'cite', ids: ['MEMO-0001'] }),      // 2 days ago
    ];
    const s = usageSeries(lines, 'MEMO-0001', { windowDays: 3, now: NOW });
    // index 0 = oldest (2 days ago) ... index 2 = today
    expect(s).toEqual([2, 0, 1]);
  });

  it('drops events outside the window and malformed lines', () => {
    const lines = [
      JSON.stringify({ ts: iso(0), type: 'expand', id: 'MEMO-0001' }),
      JSON.stringify({ ts: iso(100 * DAY), type: 'expand', id: 'MEMO-0001' }), // far past
      'not json',
      JSON.stringify({ type: 'expand', id: 'MEMO-0001' }), // no ts
    ];
    const s = usageSeries(lines, 'MEMO-0001', { windowDays: 5, now: NOW });
    expect(s.reduce((a, b) => a + b, 0)).toBe(1);
    expect(s).toHaveLength(5);
  });

  it('ignores usage summary checkpoints even if they carry event-shaped ids', () => {
    const lines = [
      JSON.stringify({ ts: iso(0), type: 'expand', id: 'MEMO-0001' }),
      JSON.stringify({
        ts: iso(0),
        type: 'usage_summary',
        id: 'MEMO-0001',
        memory_id: 'MEMO-0001',
        usage_count: 8,
      }),
    ];

    expect(usageSeries(
      lines,
      'MEMO-0001',
      { windowDays: 1, now: NOW },
    )).toEqual([1]);
  });

  it('returns an all-zero array of windowDays length when nothing matches', () => {
    const s = usageSeries([], 'MEMO-0001', { windowDays: 7, now: NOW });
    expect(s).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(hasUsage(s)).toBe(false);
  });

  it('hasUsage reflects any activity', () => {
    expect(hasUsage([0, 0, 1])).toBe(true);
    expect(hasUsage([0, 0, 0])).toBe(false);
  });
});
