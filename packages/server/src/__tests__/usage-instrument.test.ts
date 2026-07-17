import { describe, expect, it } from 'vitest';
import { mineUsage } from '../core/usage-instrument.js';

function source(path: string, lines: string[]) {
  return { path, status: 'available' as const, lines };
}

describe('mineUsage', function describeMineUsage() {
  it('counts write intents and normalizes known legacy mutation classes', function countsWrites() {
    const report = mineUsage({
      operations: source('/operations.jsonl', [
        JSON.stringify({
          ts: '2026-07-16T20:00:00.000Z',
          tool: 'backlog_create',
          params: {},
          result: { id: 'TASK-0001' },
          actor: { type: 'agent', name: 'basalt' },
        }),
        JSON.stringify({
          ts: '2026-07-16T20:01:00.000Z',
          tool: 'backlog_complete_task',
          mutation: 'update',
          params: {},
          result: { id: 'TASK-0001' },
          actor: { type: 'agent', name: 'basalt' },
        }),
        JSON.stringify({ ts: 'not-a-date', tool: 'ignored' }),
        '{bad json',
      ]),
      usage: source('/memory-usage.jsonl', []),
    });

    expect(report.successful_writes).toEqual({
      total: 2,
      by_intent: {
        backlog_complete_task: 1,
        backlog_create: 1,
      },
      by_mutation: { create: 1, update: 1 },
    });
    expect(report.sources.operations).toMatchObject({
      nonempty_lines: 4,
      valid_events: 2,
      malformed_or_unsupported_lines: 2,
    });
    expect(report.coverage.successful_write_counts.status).toBe('partial');
  });

  it('pairs returned-memory expands only until the next recall', function pairsHydration() {
    const report = mineUsage({
      operations: source('/operations.jsonl', []),
      usage: source('/memory-usage.jsonl', [
        JSON.stringify({
          ts: '2026-07-16T20:00:00.000Z',
          type: 'recall',
          query: 'private query is not reported',
          ids: ['MEMO-0001', 'MEMO-0002'],
        }),
        JSON.stringify({ ts: '2026-07-16T20:00:01.000Z', type: 'expand', id: 'MEMO-0001' }),
        JSON.stringify({
          ts: '2026-07-16T20:00:02.000Z',
          type: 'recall',
          query: 'next segment',
          ids: ['MEMO-0003'],
        }),
        JSON.stringify({ ts: '2026-07-16T20:00:03.000Z', type: 'expand', id: 'MEMO-0001' }),
        JSON.stringify({ ts: '2026-07-16T20:00:04.000Z', type: 'expand', id: 'MEMO-0003' }),
        JSON.stringify({ ts: '2026-07-16T20:00:05.000Z', type: 'cite', ids: ['MEMO-0003'] }),
      ]),
    });

    expect(report.memory_usage).toMatchObject({
      observed_hit_recalls: 2,
      returned_memory_ids: 3,
      expands: 3,
      citations: 1,
      recall_to_hydration: {
        candidate_chains: 2,
        recalls_with_candidate_hydration: 2,
        returned_ids_hydrated: 2,
        unmatched_expands: 1,
      },
      hit_vs_miss: {
        observed_hits: 2,
        observed_misses: null,
        hit_rate: null,
      },
    });
    expect(JSON.stringify(report)).not.toContain('private query');
  });

  it('keeps missing and unavailable distinct from observed zero', function reportsCoverage() {
    const report = mineUsage({
      operations: { path: '/missing-operations.jsonl', status: 'missing', lines: [] },
      usage: { path: '/missing-usage.jsonl', status: 'missing', lines: [] },
    });

    expect(report.sources.operations.status).toBe('missing');
    expect(report.successful_writes.total).toBe(0);
    expect(report.coverage.successful_write_counts.status).toBe('unavailable');
    expect(report.coverage.observed_recall_hits.status).toBe('unavailable');
    expect(report.coverage.recall_to_hydration.status).toBe('unavailable');
    expect(report.coverage.all_tool_call_counts.status).toBe('unavailable');
    expect(report.coverage.recall_misses_and_hit_rate.status).toBe('unavailable');
    expect(report.coverage.wakeup_section_usage.status).toBe('unavailable');
    expect(report.memory_usage.hit_vs_miss.hit_rate).toBeNull();
    expect(report.section_usage.observed_sections).toBeNull();
  });

  it('skips malformed and unsupported usage lines deterministically', function skipsMalformedUsage() {
    const report = mineUsage({
      operations: source('/operations.jsonl', []),
      usage: source('/memory-usage.jsonl', [
        '{bad json',
        JSON.stringify({ ts: '2026-07-16T20:00:00.000Z', type: 'recall', ids: 'MEMO-0001' }),
        JSON.stringify({ ts: '2026-07-16T20:00:01.000Z', type: 'unknown' }),
        JSON.stringify({
          ts: '2026-07-16T20:00:02.000Z',
          type: 'usage_summary',
          memory_id: 'MEMO-0001',
          usage_count: 3,
        }),
      ]),
    });

    expect(report.sources.usage).toMatchObject({
      nonempty_lines: 4,
      valid_events: 1,
      malformed_or_unsupported_lines: 3,
    });
    expect(report.memory_usage.usage_summaries).toBe(1);
    expect(report.coverage.observed_recall_hits.status).toBe('partial');
  });

  it('rejects read calls and impossible empty hit recalls as evidence', function rejectsFalseEvidence() {
    const report = mineUsage({
      operations: source('/operations.jsonl', [
        JSON.stringify({
          ts: '2026-07-16T20:00:00.000Z',
          tool: 'backlog_search',
          params: {},
          result: [],
          actor: { type: 'agent', name: 'basalt' },
        }),
      ]),
      usage: source('/memory-usage.jsonl', [
        JSON.stringify({
          ts: '2026-07-16T20:00:01.000Z',
          type: 'recall',
          query: 'missing answer',
          ids: [],
        }),
      ]),
    });

    expect(report.successful_writes.total).toBe(0);
    expect(report.memory_usage.observed_hit_recalls).toBe(0);
    expect(report.sources.operations.malformed_or_unsupported_lines).toBe(1);
    expect(report.sources.usage.malformed_or_unsupported_lines).toBe(1);
    expect(report.coverage.successful_write_counts.status).toBe('partial');
    expect(report.coverage.observed_recall_hits.status).toBe('partial');
  });
});
