/**
 * query-intent.test.ts — ADR 0083 #4: pre-search intent classifier.
 *
 * The parser routes queries to one of three retrieval strategies before
 * BM25 runs. These tests pin the routing rules so changes to the heuristic
 * are deliberate, not accidental.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  parseQueryIntent,
  canonicalizeIdQuery,
  extractLeadingFilters,
  OramaSearchService,
} from '@backlog-mcp/memory/search';
import type { Entity, Memory } from '@backlog-mcp/shared';
import { searchDocuments } from './helpers/search-document.js';

let cacheCounter = 0;
function freshCachePath(): string {
  return join(process.cwd(), 'test-data', '.cache', `intent-${++cacheCounter}-${Date.now()}.json`);
}

function makeEntity(overrides: { id: string; title: string; content?: string; status?: any; type?: any }): Entity {
  return {
    id: overrides.id,
    title: overrides.title,
    content: overrides.content ?? '',
    type: overrides.type ?? 'task',
    status: overrides.status ?? 'open',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  } as Entity;
}

// ── canonicalizeIdQuery ────────────────────────────────────────────

describe('canonicalizeIdQuery', () => {
  it('returns canonical form for already-canonical IDs', () => {
    expect(canonicalizeIdQuery('TASK-0596')).toBe('TASK-0596');
    expect(canonicalizeIdQuery('EPIC-0001')).toBe('EPIC-0001');
  });

  it('canonicalizes lowercase prefix', () => {
    expect(canonicalizeIdQuery('task-0596')).toBe('TASK-0596');
    expect(canonicalizeIdQuery('epic-0001')).toBe('EPIC-0001');
  });

  it('canonicalizes space-separated form', () => {
    expect(canonicalizeIdQuery('task 596')).toBe('TASK-0596');
    expect(canonicalizeIdQuery('TASK 596')).toBe('TASK-0596');
    expect(canonicalizeIdQuery('epic 1')).toBe('EPIC-0001');
  });

  it('canonicalizes no-separator form', () => {
    expect(canonicalizeIdQuery('task596')).toBe('TASK-0596');
    expect(canonicalizeIdQuery('TASK0596')).toBe('TASK-0596');
  });

  it('zero-pads to four digits', () => {
    expect(canonicalizeIdQuery('task 1')).toBe('TASK-0001');
    expect(canonicalizeIdQuery('epic 42')).toBe('EPIC-0042');
    expect(canonicalizeIdQuery('task 596')).toBe('TASK-0596');
  });

  it('preserves digits beyond four', () => {
    expect(canonicalizeIdQuery('task 12345')).toBe('TASK-12345');
  });

  it('handles all known prefixes', () => {
    expect(canonicalizeIdQuery('artf 1')).toBe('ARTF-0001');
    expect(canonicalizeIdQuery('fldr 1')).toBe('FLDR-0001');
    expect(canonicalizeIdQuery('mlst 1')).toBe('MLST-0001');
    expect(canonicalizeIdQuery('cron 1')).toBe('CRON-0001');
  });

  it('returns null for ambiguous bare numbers (no prefix)', () => {
    expect(canonicalizeIdQuery('596')).toBeNull();
    expect(canonicalizeIdQuery('0596')).toBeNull();
  });

  it('returns null when extra terms are present (real fulltext intent)', () => {
    expect(canonicalizeIdQuery('task 596 viewer')).toBeNull();
    expect(canonicalizeIdQuery('TASK-0596 details')).toBeNull();
  });

  it('returns null for unknown prefixes', () => {
    expect(canonicalizeIdQuery('foo 1')).toBeNull();
    expect(canonicalizeIdQuery('TASKS-0596')).toBeNull(); // pluralized prefix
  });

  it('returns null for empty / whitespace input', () => {
    expect(canonicalizeIdQuery('')).toBeNull();
    expect(canonicalizeIdQuery('   ')).toBeNull();
  });
});

// ── extractLeadingFilters ───────────────────────────────────────────

describe('extractLeadingFilters', () => {
  it('detects single status word', () => {
    expect(extractLeadingFilters('blocked')).toEqual({
      filters: { status: ['blocked'] },
      remaining: '',
    });
  });

  it('detects status + type combo', () => {
    expect(extractLeadingFilters('blocked tasks')).toEqual({
      filters: { status: ['blocked'], type: 'task' },
      remaining: '',
    });
    expect(extractLeadingFilters('open epics')).toEqual({
      filters: { status: ['open'], type: 'epic' },
      remaining: '',
    });
  });

  it('detects type-only intent', () => {
    expect(extractLeadingFilters('artifacts')).toEqual({
      filters: { type: 'artifact' },
      remaining: '',
    });
  });

  it('strips leading filter words and keeps the rest as fulltext', () => {
    expect(extractLeadingFilters('blocked tasks about database')).toEqual({
      filters: { status: ['blocked'], type: 'task' },
      remaining: 'about database',
    });
  });

  it('handles "in progress" two-word phrase', () => {
    expect(extractLeadingFilters('in progress tasks')).toEqual({
      filters: { status: ['in_progress'], type: 'task' },
      remaining: '',
    });
  });

  it('handles snake-case in_progress and hyphenated in-progress', () => {
    expect(extractLeadingFilters('in_progress tasks')?.filters.status).toEqual(['in_progress']);
    expect(extractLeadingFilters('in-progress epics')?.filters.status).toEqual(['in_progress']);
  });

  it('aliases done/closed/completed', () => {
    expect(extractLeadingFilters('closed tasks')?.filters.status).toEqual(['done']);
    expect(extractLeadingFilters('completed tasks')?.filters.status).toEqual(['done']);
  });

  it('aliases cancelled/canceled', () => {
    expect(extractLeadingFilters('canceled tasks')?.filters.status).toEqual(['cancelled']);
    expect(extractLeadingFilters('cancelled tasks')?.filters.status).toEqual(['cancelled']);
  });

  it('returns null when no leading filter word matches', () => {
    expect(extractLeadingFilters('how do I configure auth')).toBeNull();
    expect(extractLeadingFilters('database migration')).toBeNull();
  });

  it('stops stripping at first unknown word', () => {
    // "tasks I have blocked" — strips "tasks", then "i" is unknown → stop.
    // "blocked" stays in the remaining text.
    const result = extractLeadingFilters('tasks I have blocked');
    expect(result).toEqual({
      filters: { type: 'task' },
      remaining: 'I have blocked',
    });
  });

  it('first detected type wins (does not flip on later type words)', () => {
    expect(extractLeadingFilters('tasks epics')).toEqual({
      filters: { type: 'task' },
      remaining: 'epics',
    });
  });
});

// ── parseQueryIntent ────────────────────────────────────────────────

describe('parseQueryIntent', () => {
  it('routes ID-shaped queries to id_lookup', () => {
    expect(parseQueryIntent('task 596')).toMatchObject({ type: 'id_lookup', id: 'TASK-0596' });
    expect(parseQueryIntent('TASK-0596')).toMatchObject({ type: 'id_lookup', id: 'TASK-0596' });
    expect(parseQueryIntent('epic 1')).toMatchObject({ type: 'id_lookup', id: 'EPIC-0001' });
  });

  it('routes filter-shaped queries to filtered', () => {
    expect(parseQueryIntent('blocked tasks')).toMatchObject({
      type: 'filtered',
      filters: { status: ['blocked'], type: 'task' },
      query: '',
    });
  });

  it('routes mixed filter+text to filtered with query remainder', () => {
    expect(parseQueryIntent('blocked tasks about database')).toMatchObject({
      type: 'filtered',
      filters: { status: ['blocked'], type: 'task' },
      query: 'about database',
    });
  });

  it('routes plain queries to fulltext', () => {
    expect(parseQueryIntent('database migration')).toMatchObject({
      type: 'fulltext',
      query: 'database migration',
    });
  });

  it('routes ambiguous bare numbers to fulltext (no prefix → not an ID)', () => {
    expect(parseQueryIntent('596')).toMatchObject({ type: 'fulltext' });
  });

  it('routes ID + extra terms to fulltext (preserves user intent for body match)', () => {
    expect(parseQueryIntent('task 596 viewer')).toMatchObject({
      type: 'fulltext',
      query: 'task 596 viewer',
    });
  });
});

// ── End-to-end: searchAll integration ──────────────────────────────

describe('OramaSearchService.searchAll: intent routing', () => {
  it('id_lookup short-circuits to direct cache hit with score=1.0', async () => {
    const svc = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await svc.index(searchDocuments([
      makeEntity({ id: 'TASK-0596', title: 'Research: Fredrika Unified Diff Viewer' }),
      // Decoys that BM25 would otherwise rank higher
      makeEntity({ id: 'TASK-0001', title: 'TASK 596 mention in title to confuse ranker', content: 'task 596' }),
      makeEntity({ id: 'TASK-0002', title: 'task 596 again', content: 'task 596 task 596 task 596' }),
    ]));

    const results = await svc.searchAll('task 596', { limit: 5 });
    expect(results.length).toBe(1);
    expect(results[0]?.id).toBe('TASK-0596');
    expect(results[0]?.score).toBe(1.0);
  });

  it('id_lookup falls through to fulltext when canonical ID not in cache', async () => {
    const svc = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await svc.index(searchDocuments([
      makeEntity({ id: 'TASK-0001', title: 'A task that mentions task 999 in body' }),
    ]));

    // TASK-0999 doesn't exist; should fall through to fulltext.
    // The fulltext path may or may not return results — we just verify
    // we don't crash and the result shape is well-formed.
    const results = await svc.searchAll('task 999', { limit: 5 });
    expect(Array.isArray(results)).toBe(true);
  });

  it('filtered intent applies status filter without BM25', async () => {
    const svc = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await svc.index(searchDocuments([
      makeEntity({ id: 'TASK-0001', title: 'First', status: 'open' }),
      makeEntity({ id: 'TASK-0002', title: 'Second', status: 'blocked' }),
      makeEntity({ id: 'TASK-0003', title: 'Third', status: 'blocked' }),
      makeEntity({ id: 'TASK-0004', title: 'Fourth', status: 'done' }),
    ]));

    const results = await svc.searchAll('blocked tasks', { limit: 10 });
    const ids = results.map(r => r.id).sort();
    expect(ids).toEqual(['TASK-0002', 'TASK-0003']);
  });

  it('keeps memories out of generic filtered lists unless explicitly requested', async () => {
    const svc = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    const memory: Memory = {
      id: 'MEMO-0001',
      type: 'memory',
      title: 'Private project memory',
      content: 'Memory-only context',
      layer: 'semantic',
      created_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
    };
    await svc.index(searchDocuments([
      makeEntity({ id: 'TASK-0001', title: 'Open work', status: 'open' }),
      memory,
    ]));

    function resultId(result: { id: string }): string {
      return result.id;
    }

    // BacklogService supplies an options object whose absent filter values are
    // undefined. That still exercises the no-BM25 filtered-list branch.
    expect((await svc.searchAll('open', {
      limit: 10,
      filters: { status: undefined },
    })).map(resultId)).toEqual(['TASK-0001']);
    expect((await svc.searchAll('memories', { limit: 10 })).map(resultId))
      .toEqual(['MEMO-0001']);
  });

  it('filtered intent with residual text runs BM25 scoped to filter', async () => {
    const svc = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await svc.index(searchDocuments([
      makeEntity({ id: 'TASK-0001', title: 'database migration', status: 'open' }),
      makeEntity({ id: 'TASK-0002', title: 'database migration', status: 'blocked' }),
      makeEntity({ id: 'TASK-0003', title: 'database migration', status: 'blocked' }),
      makeEntity({ id: 'TASK-0004', title: 'unrelated task', status: 'blocked' }),
    ]));

    const results = await svc.searchAll('blocked tasks database', { limit: 10 });
    const ids = results.map(r => r.id);
    expect(ids).toContain('TASK-0002');
    expect(ids).toContain('TASK-0003');
    expect(ids).not.toContain('TASK-0001'); // status filter excludes
    expect(ids).not.toContain('TASK-0004'); // no "database" match
  });

  it('caller filters override intent filters', async () => {
    const svc = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await svc.index(searchDocuments([
      makeEntity({ id: 'TASK-0001', title: 'task one', status: 'open' }),
      makeEntity({ id: 'TASK-0002', title: 'task two', status: 'blocked' }),
    ]));

    // Caller passes status:['open'], query says "blocked tasks" — caller wins.
    const results = await svc.searchAll('blocked tasks', {
      limit: 10,
      filters: { status: ['open'] },
    });
    const ids = results.map(r => r.id);
    expect(ids).toContain('TASK-0001');
    expect(ids).not.toContain('TASK-0002');
  });

  it('fulltext path unchanged for plain queries', async () => {
    const svc = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await svc.index(searchDocuments([
      makeEntity({ id: 'TASK-0001', title: 'database migration to postgres' }),
      makeEntity({ id: 'TASK-0002', title: 'unrelated task' }),
    ]));

    const results = await svc.searchAll('database migration', { limit: 5 });
    expect(results[0]?.id).toBe('TASK-0001');
  });
});
