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
  idIntentSpecsFromIdentities,
  OramaSearchService,
  type IdentityDeclaration,
  type SearchEntityDocument,
} from '@backlog-mcp/memory/search';
import type { AnyEntity, Entity, Memory } from '@backlog-mcp/shared';
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

/**
 * Docs-native identity declarations, mirroring the active registry's storage
 * claims: threaded space-form ADRs, numbered space-form PROMPTs, and
 * hyphen-form prefixed REF/AGENT ids — plus one built-in claim.
 */
const DOCS_NATIVE_IDENTITIES: IdentityDeclaration[] = [
  { strategy: 'prefixed-number', prefix: 'TASK', minimumDigits: 4, displayTemplate: 'TASK-{key}' },
  { strategy: 'numbered-threaded', minimumDigits: 4, displayTemplate: 'ADR {key}' },
  { strategy: 'numbered', minimumDigits: 4, displayTemplate: 'PROMPT {key}' },
  { strategy: 'prefixed-number', prefix: 'REF', minimumDigits: 4, displayTemplate: 'REF-{key}' },
  { strategy: 'prefixed-number', prefix: 'AGENT', minimumDigits: 4, displayTemplate: 'AGENT-{key}' },
];
const DOCS_NATIVE_SPECS = idIntentSpecsFromIdentities(DOCS_NATIVE_IDENTITIES);

/**
 * Docs-native entities are registry-projected, not built-in — project them
 * the way the production registry does (declared search fields), without
 * routing through the built-in-only test helper.
 */
function docsNativeDocument(entity: AnyEntity): SearchEntityDocument {
  return {
    kind: 'entity-document',
    entity,
    fields: [
      { name: 'title', value: entity.title },
      { name: 'content', value: entity.content },
    ],
  };
}

function docsNativeEntity(overrides: { id: string; title: string; content?: string; type: string; status?: string }): AnyEntity {
  return {
    id: overrides.id,
    title: overrides.title,
    content: overrides.content ?? '',
    type: overrides.type,
    status: overrides.status ?? 'Accepted',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  } as AnyEntity;
}

// ── idIntentSpecsFromIdentities ────────────────────────────────────

describe('idIntentSpecsFromIdentities', () => {
  it('derives a space-form spec from a numbered-threaded display template', () => {
    const specs = idIntentSpecsFromIdentities([
      { strategy: 'numbered-threaded', minimumDigits: 4, displayTemplate: 'ADR {key}' },
    ]);
    expect(specs).toEqual([
      { word: 'ADR', idPrefix: 'ADR ', minimumDigits: 4, threaded: true },
    ]);
  });

  it('derives a hyphen-form spec from a prefixed-number claim without a template', () => {
    const specs = idIntentSpecsFromIdentities([
      { strategy: 'prefixed-number', prefix: 'REF', minimumDigits: 4 },
    ]);
    expect(specs).toEqual([
      { word: 'REF', idPrefix: 'REF-', minimumDigits: 4, threaded: false },
    ]);
  });

  it('skips identities whose display ids carry no prefix word', () => {
    // A bare numbered substrate ("0092.md") mints digit-only ids — there is
    // no word to recognize, so no ID-intent rule can exist for it.
    expect(idIntentSpecsFromIdentities([
      { strategy: 'numbered', minimumDigits: 4 },
    ])).toEqual([]);
  });

  it('skips identities whose template places text after the key', () => {
    expect(idIntentSpecsFromIdentities([
      { strategy: 'numbered', minimumDigits: 4, displayTemplate: 'X {key} Y' },
    ])).toEqual([]);
  });

  it('defaults minimumDigits to 1 when the claim omits it', () => {
    expect(idIntentSpecsFromIdentities([
      { strategy: 'prefixed-number', prefix: 'OP' },
    ])).toEqual([
      { word: 'OP', idPrefix: 'OP-', minimumDigits: 1, threaded: false },
    ]);
  });
});

// ── canonicalizeIdQuery: registry-declared prefixes ────────────────

describe('canonicalizeIdQuery with registry-derived specs', () => {
  it('canonicalizes both forms of a space-form docs-native id', () => {
    expect(canonicalizeIdQuery('ADR 0116', DOCS_NATIVE_SPECS)).toBe('ADR 0116');
    expect(canonicalizeIdQuery('ADR-0116', DOCS_NATIVE_SPECS)).toBe('ADR 0116');
    expect(canonicalizeIdQuery('adr 116', DOCS_NATIVE_SPECS)).toBe('ADR 0116');
    expect(canonicalizeIdQuery('adr0116', DOCS_NATIVE_SPECS)).toBe('ADR 0116');
  });

  it('canonicalizes thread-child keys for numbered-threaded substrates', () => {
    expect(canonicalizeIdQuery('ADR 0092.1', DOCS_NATIVE_SPECS)).toBe('ADR 0092.1');
    expect(canonicalizeIdQuery('ADR-0092.1', DOCS_NATIVE_SPECS)).toBe('ADR 0092.1');
    expect(canonicalizeIdQuery('adr 92.13', DOCS_NATIVE_SPECS)).toBe('ADR 0092.13');
  });

  it('rejects dotted keys for non-threaded substrates', () => {
    expect(canonicalizeIdQuery('PROMPT 2.1', DOCS_NATIVE_SPECS)).toBeNull();
    expect(canonicalizeIdQuery('REF 4.2', DOCS_NATIVE_SPECS)).toBeNull();
  });

  it('canonicalizes both forms of a hyphen-form docs-native id', () => {
    expect(canonicalizeIdQuery('REF 4', DOCS_NATIVE_SPECS)).toBe('REF-0004');
    expect(canonicalizeIdQuery('ref-0004', DOCS_NATIVE_SPECS)).toBe('REF-0004');
    expect(canonicalizeIdQuery('AGENT 0001', DOCS_NATIVE_SPECS)).toBe('AGENT-0001');
    expect(canonicalizeIdQuery('agent-0001', DOCS_NATIVE_SPECS)).toBe('AGENT-0001');
  });

  it('canonicalizes space-form numbered substrates', () => {
    expect(canonicalizeIdQuery('PROMPT 0002', DOCS_NATIVE_SPECS)).toBe('PROMPT 0002');
    expect(canonicalizeIdQuery('prompt-2', DOCS_NATIVE_SPECS)).toBe('PROMPT 0002');
  });

  it('still resolves built-in claims through the same registry path', () => {
    expect(canonicalizeIdQuery('task 596', DOCS_NATIVE_SPECS)).toBe('TASK-0596');
  });

  it('returns null for prefixes the active registry does not declare', () => {
    expect(canonicalizeIdQuery('REQ 1', DOCS_NATIVE_SPECS)).toBeNull();
    expect(canonicalizeIdQuery('epic 1', DOCS_NATIVE_SPECS)).toBeNull();
  });

  it('routes id_lookup intent for registry prefixes via parseQueryIntent', () => {
    expect(parseQueryIntent('ADR 0116', DOCS_NATIVE_SPECS))
      .toMatchObject({ type: 'id_lookup', id: 'ADR 0116' });
    expect(parseQueryIntent('ADR-0092.1', DOCS_NATIVE_SPECS))
      .toMatchObject({ type: 'id_lookup', id: 'ADR 0092.1' });
  });
});

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

// ── End-to-end: docs-native registry-prefix ID navigation ──────────
// Failure shape from the structural truth suite (457-failure run): of 162
// entities, ~45 were absent from the top-20 for BOTH forms of their own ID
// because the exact-ID fast path only knew built-in prefixes.

describe('OramaSearchService: registry-prefix ID navigation', () => {
  async function docsNativeService(): Promise<OramaSearchService> {
    const svc = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    svc.configureIdIntent(DOCS_NATIVE_IDENTITIES);
    await svc.index([
      docsNativeDocument(docsNativeEntity({
        id: 'ADR 0092', type: 'adr', title: 'Memory Substrate — Docs-Native Recall',
      })),
      docsNativeDocument(docsNativeEntity({
        id: 'ADR 0092.1', type: 'adr', title: 'Temporal Decay for Episodic Memories',
      })),
      // Decoys: thread children and citations that swamp BM25 for "ADR 0092".
      docsNativeDocument(docsNativeEntity({
        id: 'ADR 0100', type: 'adr', title: 'Citations of ADR 0092 everywhere',
        content: 'ADR 0092 ADR 0092 ADR 0092 supersedes ADR 0092 per ADR 0092',
      })),
      docsNativeDocument(docsNativeEntity({
        id: 'REF-0004', type: 'reference', title: 'Prior Art: Hindsight',
      })),
    ]);
    return svc;
  }

  it('routes the space form of a docs-native id to that entity at rank 1', async () => {
    const svc = await docsNativeService();
    const results = await svc.searchAll('ADR 0092', { limit: 20 });
    expect(results.map(r => r.id)).toEqual(['ADR 0092']);
    expect(results[0]?.score).toBe(1.0);
  });

  it('routes the hyphen form of a docs-native id to that entity at rank 1', async () => {
    const svc = await docsNativeService();
    const results = await svc.searchAll('ADR-0092', { limit: 20 });
    expect(results.map(r => r.id)).toEqual(['ADR 0092']);
  });

  it('routes thread-child ids in both forms', async () => {
    const svc = await docsNativeService();
    expect((await svc.searchAll('ADR 0092.1', { limit: 20 })).map(r => r.id))
      .toEqual(['ADR 0092.1']);
    expect((await svc.searchAll('ADR-0092.1', { limit: 20 })).map(r => r.id))
      .toEqual(['ADR 0092.1']);
  });

  it('routes hyphen-form registry ids in both forms', async () => {
    const svc = await docsNativeService();
    expect((await svc.searchAll('REF-0004', { limit: 20 })).map(r => r.id))
      .toEqual(['REF-0004']);
    expect((await svc.searchAll('REF 0004', { limit: 20 })).map(r => r.id))
      .toEqual(['REF-0004']);
  });

  it('falls through to fulltext when the canonical id is not in the corpus', async () => {
    const svc = await docsNativeService();
    const results = await svc.searchAll('ADR 0999', { limit: 20 });
    expect(results.map(r => r.id)).not.toContain('ADR 0999');
  });
});

// ── End-to-end: zero-universe type-word fail-open ──────────────────
// Failure shape from the structural truth suite: ADR 0096's own exact title
// ("Cron Entity Type — Scheduled Task Intake") returned zero results because
// the leading word became a type:cron filter over a corpus with no crons.

describe('OramaSearchService: zero-universe type-word fail-open', () => {
  it('treats a type word as content when that type has zero entities', async () => {
    const svc = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await svc.index([
      docsNativeDocument(docsNativeEntity({
        id: 'ADR 0096', type: 'adr', title: 'Cron Entity Type — Scheduled Task Intake',
      })),
      docsNativeDocument(docsNativeEntity({
        id: 'ADR 0095', type: 'adr', title: 'Unrelated Decision',
      })),
    ]);

    const results = await svc.searchAll('Cron Entity Type — Scheduled Task Intake', { limit: 20 });
    expect(results[0]?.id).toBe('ADR 0096');
  });

  it('keeps type-filter semantics when the type universe is non-empty', async () => {
    const svc = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    const cron = {
      id: 'CRON-0001',
      type: 'cron',
      title: 'nightly backup',
      content: '',
      status: 'open',
      schedule: '0 3 * * *',
      command: 'backup.sh',
      enabled: true,
      created_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
    } as Entity;
    await svc.index(searchDocuments([
      cron,
      makeEntity({ id: 'TASK-0001', title: 'nightly backup task' }),
    ]));

    const results = await svc.searchAll('cron nightly backup', { limit: 20 });
    const ids = results.map(r => r.id);
    expect(ids).toContain('CRON-0001');
    expect(ids).not.toContain('TASK-0001');
  });

  it('does not fail open when caller docTypes already govern the universe', async () => {
    // Ranking-freeze guard: judged eval queries pass explicit types (e.g.
    // filter-02 "memory uplift …" with types:["prompt"]). The parsed type
    // word is already overridden by docTypes, so the residual-text BM25
    // behavior must stay byte-identical.
    const svc = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await svc.index([
      docsNativeDocument(docsNativeEntity({
        id: 'PROMPT 0002', type: 'prompt', title: 'uplift substrates docs native',
      })),
      docsNativeDocument(docsNativeEntity({
        id: 'ADR 0001', type: 'adr', title: 'memory uplift substrates docs native',
      })),
    ]);

    const withTypeWord = await svc.searchAll('memory uplift substrates docs native', {
      limit: 20, docTypes: ['prompt'],
    });
    const residualOnly = await svc.searchAll('uplift substrates docs native', {
      limit: 20, docTypes: ['prompt'],
    });
    expect(withTypeWord.map(r => r.id)).toEqual(residualOnly.map(r => r.id));
  });
});
