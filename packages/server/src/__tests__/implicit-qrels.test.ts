/**
 * Extraction-fold tests for scripts/implicit-qrels.mjs (implicit-qrels
 * candidate miner — docs/proposals/implicit-qrels-from-journal-2026-07.md).
 *
 * The miner is read-only and deterministic: these tests drive the exported
 * pure fold with in-memory journal lines and never touch the filesystem.
 */

import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/no-relative-packages -- the miner script is repo-level, not a package export
import { mineImplicitQrels } from '../../../../scripts/implicit-qrels.mjs';

interface SourceInput {
  path: string;
  status: 'available' | 'missing';
  sha256?: string | null;
  lines: string[];
}

interface HomeInput {
  home: string;
  operations: SourceInput;
  usage: SourceInput;
}

function homeInput(usageLines: string[], operationsLines: string[] = []): HomeInput {
  return {
    home: '/test/.backlog',
    operations: {
      path: '/test/.backlog/state/operations.jsonl',
      status: operationsLines.length > 0 ? 'available' : 'missing',
      lines: operationsLines,
    },
    usage: {
      path: '/test/.backlog/state/memory-usage.jsonl',
      status: usageLines.length > 0 ? 'available' : 'missing',
      lines: usageLines,
    },
  };
}

function recallLine(ts: string, query: string, ids: string[]): string {
  return JSON.stringify({ ts, type: 'recall', query, ids });
}

function expandLine(ts: string, id: string): string {
  return JSON.stringify({ ts, type: 'expand', id });
}

const WINDOW = { sessionWindowMinutes: 30 };

describe('implicit-qrels extraction fold', () => {
  it('links an expand to the preceding recall and emits candidate query and qrels', () => {
    const mined = mineImplicitQrels([homeInput([
      recallLine('2026-07-16T10:00:00.000Z', 'fusion law', ['MEMO-0001', 'MEMO-0002']),
      expandLine('2026-07-16T10:05:00.000Z', 'MEMO-0001'),
    ])], WINDOW);

    expect(mined.counts.recall_hit_events).toBe(1);
    expect(mined.counts.recall_events_with_hydration).toBe(1);
    expect(mined.counts.matched_hydrations).toBe(1);
    expect(mined.candidate_queries).toHaveLength(1);

    const query = mined.candidate_queries[0]!;
    expect(query.record).toBe('candidate_query');
    expect(query.surface).toBe('recall');
    expect(query.class).toBe('memory-recall');
    expect(query.query).toBe('fusion law');
    // Fail-closed: a mined assessor must never satisfy the reviewed: gate.
    expect(query.assessor).not.toContain('reviewed:');

    expect(mined.candidate_qrels).toHaveLength(2);
    const positive = mined.candidate_qrels.find(q => q.document_id === 'MEMO-0001')!;
    expect(positive.signal).toBe('hydrated');
    expect(positive.proposed_grade).toBe(2);
    expect(positive.provenance).toBe('implicit-journal');
    expect(positive).not.toHaveProperty('grade');
    expect(positive.assessor).not.toContain('reviewed:');

    const negative = mined.candidate_qrels.find(q => q.document_id === 'MEMO-0002')!;
    expect(negative.signal).toBe('returned-not-hydrated');
    expect(negative.proposed_grade).toBe(0);
  });

  it('upgrades repeated hydration across distinct sessions to a strong positive', () => {
    const mined = mineImplicitQrels([homeInput([
      recallLine('2026-07-16T10:00:00.000Z', 'fusion law', ['MEMO-0001']),
      expandLine('2026-07-16T10:01:00.000Z', 'MEMO-0001'),
      recallLine('2026-07-16T14:00:00.000Z', 'fusion law', ['MEMO-0001']),
      expandLine('2026-07-16T14:01:00.000Z', 'MEMO-0001'),
    ])], WINDOW);

    expect(mined.candidate_qrels).toHaveLength(1);
    const qrel = mined.candidate_qrels[0]!;
    expect(qrel.signal).toBe('repeat-hydrated');
    expect(qrel.proposed_grade).toBe(3);
    expect(qrel.evidence.sessions).toBe(2);
    expect(qrel.evidence.chains).toBe(2);
  });

  it('keeps two hydrations inside one window as a single session', () => {
    const mined = mineImplicitQrels([homeInput([
      recallLine('2026-07-16T10:00:00.000Z', 'fusion law', ['MEMO-0001']),
      expandLine('2026-07-16T10:01:00.000Z', 'MEMO-0001'),
      recallLine('2026-07-16T10:10:00.000Z', 'fusion law', ['MEMO-0001']),
      expandLine('2026-07-16T10:11:00.000Z', 'MEMO-0001'),
    ])], WINDOW);

    const qrel = mined.candidate_qrels[0]!;
    expect(qrel.signal).toBe('hydrated');
    expect(qrel.proposed_grade).toBe(2);
    expect(qrel.evidence.sessions).toBe(1);
    expect(qrel.evidence.expands).toBe(2);
  });

  it('rejects expands outside the session window and beyond the latest recall', () => {
    const mined = mineImplicitQrels([homeInput([
      recallLine('2026-07-16T10:00:00.000Z', 'stale query', ['MEMO-0001']),
      // 31 minutes later: right id, expired window.
      expandLine('2026-07-16T10:31:00.000Z', 'MEMO-0001'),
      recallLine('2026-07-16T12:00:00.000Z', 'other query', ['MEMO-0009']),
      // Belongs to the older recall's ids: adjacency law says unmatched.
      expandLine('2026-07-16T12:01:00.000Z', 'MEMO-0001'),
    ])], WINDOW);

    expect(mined.counts.matched_hydrations).toBe(0);
    expect(mined.counts.window_expired_expands).toBe(1);
    expect(mined.counts.unmatched_expands).toBe(1);
    // No hydration chain, no candidates: hydration-free recalls prove nothing.
    expect(mined.candidate_queries).toHaveLength(0);
    expect(mined.candidate_qrels).toHaveLength(0);
  });

  it('counts operations journal mutations but mines zero chains from them', () => {
    const operations = [
      JSON.stringify({
        ts: '2026-07-16T10:00:00.000Z',
        tool: 'backlog create',
        mutation: 'create',
        params: { title: 'x' },
        result: { id: 'TASK-0001' },
        resourceId: 'TASK-0001',
        actor: { type: 'agent', name: 'onyx' },
      }),
      'not json at all',
    ];
    const mined = mineImplicitQrels([homeInput([], operations)], WINDOW);

    expect(mined.counts.operations_valid_mutations).toBe(1);
    expect(mined.homes[0]!.operations.by_mutation).toEqual({ create: 1 });
    expect(mined.homes[0]!.operations.malformed_or_unsupported_lines).toBe(1);
    expect(mined.homes[0]!.operations.read_surface_events).toBe(0);
    expect(mined.candidate_queries).toHaveLength(0);
    expect(mined.coverage.operations_journal_read_surface.status).toBe('unavailable');
  });

  it('handles missing sources without throwing and reports them missing', () => {
    const mined = mineImplicitQrels([homeInput([])], WINDOW);

    expect(mined.homes[0]!.usage.status).toBe('missing');
    expect(mined.homes[0]!.operations.status).toBe('missing');
    expect(mined.counts.recall_hit_events).toBe(0);
    expect(mined.coverage.recall_to_hydration_chains.status).toBe('unavailable');
  });

  it('is deterministic over identical journal bytes', () => {
    const lines = [
      recallLine('2026-07-16T10:00:00.000Z', 'b query', ['MEMO-0002', 'MEMO-0003']),
      expandLine('2026-07-16T10:02:00.000Z', 'MEMO-0003'),
      recallLine('2026-07-16T11:00:00.000Z', 'a query', ['MEMO-0001']),
      expandLine('2026-07-16T11:01:00.000Z', 'MEMO-0001'),
    ];
    const first = mineImplicitQrels([homeInput(lines)], WINDOW);
    const second = mineImplicitQrels([homeInput(lines)], WINDOW);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    // Output order is sorted, not arrival order: 'a query' precedes 'b query'.
    expect(first.candidate_queries.map(q => q.query)).toEqual(['a query', 'b query']);
  });
});
