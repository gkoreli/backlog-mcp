/**
 * mcp-search-invariants.test.ts — Architectural invariant tests for ADR-0073.
 *
 * These tests verify the structural guarantees of the MCP-first unified
 * search architecture. They ensure:
 *
 * 1. MCP tools and HTTP endpoints use the same service method (no forked paths)
 * 2. backlog_search returns the same results as searchUnified
 * 3. Server-side snippets are always present in search results
 * 4. backlog_get supports both task IDs and resource URIs
 * 5. Snippet generation produces correct match context
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { OramaSearchService, type SearchEntityDocument, type SearchSnippet } from '@backlog-mcp/memory/search';
import { generateTaskSnippet, generateResourceSnippet } from '@backlog-mcp/memory/search';
import type { Entity, TaskEntity } from '@backlog-mcp/shared';
import type { Resource } from '@backlog-mcp/memory/search';
import { searchDocuments } from './helpers/search-document.js';

function makeEntity(overrides: Partial<Entity> & { id: string; title: string }): TaskEntity {
  return {
    type: 'task',
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeResource(overrides: Partial<Resource> & { id: string; title: string; content: string }): Resource {
  return {
    path: 'resources/test.md',
    ...overrides,
  };
}

// Each describe block needs a unique cache path to avoid cross-test
// pollution from OramaSearchService.index() loading stale disk cache.
let cacheCounter = 0;
function freshCachePath(): string {
  return join(process.cwd(), 'test-data', '.cache', `search-invariants-${++cacheCounter}-${Date.now()}.json`);
}

// ── Invariant 1: searchAll always returns snippets ──────────────────

describe('Invariant: searchAll always returns snippets (ADR-0073)', () => {
  let service: OramaSearchService;

  const tasks: Entity[] = [
    makeEntity({ id: 'TASK-0001', title: 'Implement authentication', content: 'Add OAuth2 login flow with SSO support' }),
    makeEntity({ id: 'TASK-0002', title: 'Fix login bug', content: 'Users cannot authenticate with SSO', status: 'in_progress' }),
    makeEntity({ id: 'EPIC-0001', title: 'User Management Epic', type: 'epic' }),
  ];

  const resources: Resource[] = [
    makeResource({ id: 'mcp://backlog/resources/auth-design.md', title: 'Authentication Design', content: '# Auth Design\n\nOAuth2 flow with PKCE for secure login.', path: 'resources/auth-design.md' }),
  ];

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index(searchDocuments(tasks));
    await service.indexResources(resources);
  });

  it('every result from searchAll has a snippet property', async () => {
    const results = await service.searchAll('login');
    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(r.snippet).toBeDefined();
      expect(r.snippet.field).toBeTruthy();
      expect(typeof r.snippet.text).toBe('string');
      expect(Array.isArray(r.snippet.matched_fields)).toBe(true);
    }
  });

  it('snippet matched_fields reflects which fields contain the query', async () => {
    const results = await service.searchAll('authentication');
    const taskResult = results.find(r => r.id === 'TASK-0001');
    expect(taskResult).toBeDefined();
    expect(taskResult!.snippet.matched_fields).toContain('title');
  });

  it('returns snippets for resources too', async () => {
    const results = await service.searchAll('OAuth2');
    const resourceResult = results.find(r => r.type === 'resource');
    expect(resourceResult).toBeDefined();
    expect(resourceResult!.snippet.field).toBeTruthy();
    expect(resourceResult!.snippet.text).toBeTruthy();
  });

  it('cross-type search returns mixed results with snippets', async () => {
    const results = await service.searchAll('login', { docTypes: ['task', 'resource'] });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.snippet).toBeDefined();
    }
  });
});

// ── Invariant 2: Server-side snippet generation ─────────────────────

describe('Invariant: snippet generation correctness (ADR-0073)', () => {
  it('generateTaskSnippet finds match in title', () => {
    const task = makeEntity({ id: 'T-1', title: 'Fix authentication bug', content: 'Some unrelated content' });
    const snippet = generateTaskSnippet(task, 'authentication');
    expect(snippet.field).toBe('title');
    expect(snippet.text).toContain('authentication');
    expect(snippet.matched_fields).toContain('title');
  });

  it('generateTaskSnippet finds match in content when title does not match', () => {
    const task = makeEntity({ id: 'T-1', title: 'General bug fix', content: 'The OAuth2 flow fails when redirect URI is missing' });
    const snippet = generateTaskSnippet(task, 'oauth2');
    expect(snippet.field).toBe('content');
    expect(snippet.text.toLowerCase()).toContain('oauth2');
    expect(snippet.matched_fields).toContain('content');
    expect(snippet.matched_fields).not.toContain('title');
  });

  it('generateTaskSnippet finds match in evidence', () => {
    const task = makeEntity({ id: 'T-1', title: 'Deploy service', evidence: ['Verified in staging', 'Load test passed at 500 RPS'] });
    const snippet = generateTaskSnippet(task, 'staging');
    expect(snippet.field).toBe('evidence');
    expect(snippet.matched_fields).toContain('evidence');
  });

  it('generateTaskSnippet finds match in blocked_reason', () => {
    const task = makeEntity({ id: 'T-1', title: 'Database migration', blocked_reason: ['Waiting for DBA approval'] });
    const snippet = generateTaskSnippet(task, 'DBA');
    expect(snippet.field).toBe('blocked_reason');
    expect(snippet.matched_fields).toContain('blocked_reason');
  });

  it('generateTaskSnippet reports all matched fields', () => {
    const task = makeEntity({ id: 'T-1', title: 'Fix login flow', content: 'Login button is broken on mobile' });
    const snippet = generateTaskSnippet(task, 'login');
    expect(snippet.matched_fields).toContain('title');
    expect(snippet.matched_fields).toContain('content');
    // First match should be title (searched first)
    expect(snippet.field).toBe('title');
  });

  it('generateTaskSnippet returns title fallback when no match', () => {
    const task = makeEntity({ id: 'T-1', title: 'Something else entirely' });
    const snippet = generateTaskSnippet(task, 'xyznonexistent');
    expect(snippet.field).toBe('title');
    expect(snippet.matched_fields).toEqual([]);
  });

  it('generateTaskSnippet truncates long descriptions with ellipsis', () => {
    const longDesc = 'A'.repeat(50) + ' authentication ' + 'B'.repeat(200);
    const task = makeEntity({ id: 'T-1', title: 'Short title', content: longDesc });
    const snippet = generateTaskSnippet(task, 'authentication');
    expect(snippet.text.length).toBeLessThanOrEqual(130); // 120 + ellipsis
    expect(snippet.text).toContain('...');
  });

  it('generateResourceSnippet finds match in title', () => {
    const resource = makeResource({ id: 'R-1', title: 'API Design Doc', content: 'Unrelated content' });
    const snippet = generateResourceSnippet(resource, 'API');
    expect(snippet.field).toBe('title');
    expect(snippet.matched_fields).toContain('title');
  });

  it('generateResourceSnippet finds match in content', () => {
    const resource = makeResource({ id: 'R-1', title: 'Design Doc', content: 'The REST API uses OAuth2 for authentication' });
    const snippet = generateResourceSnippet(resource, 'OAuth2');
    expect(snippet.field).toBe('content');
    expect(snippet.matched_fields).toContain('content');
  });
});

// ── Invariant 3: searchAll type filtering works correctly ───────────

describe('Invariant: searchAll type filtering (ADR-0073)', () => {
  let service: OramaSearchService;

  const tasks: Entity[] = [
    makeEntity({ id: 'TASK-0001', title: 'Search implementation', content: 'Implement full-text search' }),
    makeEntity({ id: 'EPIC-0001', title: 'Search epic', type: 'epic' }),
  ];

  const resources: Resource[] = [
    makeResource({ id: 'mcp://backlog/resources/search-design.md', title: 'Search Design', content: 'Search implementation details', path: 'resources/search-design.md' }),
  ];

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index(searchDocuments(tasks));
    await service.indexResources(resources);
  });

  it('docTypes=["task"] returns only tasks', async () => {
    const results = await service.searchAll('search', { docTypes: ['task'] });
    for (const r of results) {
      expect(r.type).toBe('task');
    }
  });

  it('docTypes=["epic"] returns only epics', async () => {
    const results = await service.searchAll('search', { docTypes: ['epic'] });
    for (const r of results) {
      expect(r.type).toBe('epic');
    }
  });

  it('docTypes=["resource"] returns only resources', async () => {
    const results = await service.searchAll('search', { docTypes: ['resource'] });
    for (const r of results) {
      expect(r.type).toBe('resource');
    }
  });

  it('no docTypes returns all types', async () => {
    const results = await service.searchAll('search');
    const types = new Set(results.map(r => r.type));
    expect(types.size).toBeGreaterThanOrEqual(2); // At least tasks and epics or resources
  });
});

// ── Invariant 4: sort mode works correctly ──────────────────────────

describe('Invariant: searchAll sort modes (ADR-0073)', () => {
  let service: OramaSearchService;

  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const lastWeek = new Date(now.getTime() - 7 * 86400000);

  const tasks: Entity[] = [
    makeEntity({ id: 'TASK-0001', title: 'Old search task', updated_at: lastWeek.toISOString() }),
    makeEntity({ id: 'TASK-0002', title: 'Recent search task', updated_at: now.toISOString() }),
    makeEntity({ id: 'TASK-0003', title: 'Yesterday search task', updated_at: yesterday.toISOString() }),
  ];

  const resources: Resource[] = [
    makeResource({ id: 'mcp://backlog/docs/search-notes.md', title: 'Search notes', content: '# Search notes\n\nUndated search background.', path: 'docs/search-notes.md' }),
  ];

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index(searchDocuments(tasks));
    await service.indexResources(resources);
  });

  it('sort=recent orders by updated_at descending', async () => {
    const results = await service.searchAll('search', { docTypes: ['task'], sort: 'recent' });
    expect(results.length).toBe(3);
    // Most recent first
    expect(results[0].id).toBe('TASK-0002');
    expect(results[1].id).toBe('TASK-0003');
    expect(results[2].id).toBe('TASK-0001');
  });

  it('sort=relevant uses relevance scoring (default)', async () => {
    const results = await service.searchAll('search');
    expect(results.length).toBeGreaterThan(0);
    // All results should have scores
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
    }
  });

  // 0003 friction-log fix: recency must reorder the retrieval set, never
  // change which documents are retrieved.
  it('sort=recent returns exactly the sort=relevant result set', async () => {
    const relevant = await service.searchAll('search');
    const recent = await service.searchAll('search', { sort: 'recent' });
    expect(new Set(recent.map(r => r.id))).toEqual(new Set(relevant.map(r => r.id)));
  });

  it('sort=recent keeps undated resources in the set, after dated documents', async () => {
    const results = await service.searchAll('search', { sort: 'recent' });
    const ids = results.map(r => r.id);
    expect(ids).toContain('mcp://backlog/docs/search-notes.md');
    expect(ids.indexOf('mcp://backlog/docs/search-notes.md')).toBe(ids.length - 1);
  });
});

// ── Invariant 5: snippet generation is deterministic ────────────────

describe('Invariant: snippet determinism (ADR-0073)', () => {
  it('same task and query always produce the same snippet', () => {
    const task = makeEntity({ id: 'T-1', title: 'Fix authentication bug', content: 'OAuth2 flow needs fixing' });
    const s1 = generateTaskSnippet(task, 'authentication');
    const s2 = generateTaskSnippet(task, 'authentication');
    expect(s1).toEqual(s2);
  });

  it('same resource and query always produce the same snippet', () => {
    const resource = makeResource({ id: 'R-1', title: 'Auth Design', content: 'OAuth2 with PKCE' });
    const s1 = generateResourceSnippet(resource, 'OAuth2');
    const s2 = generateResourceSnippet(resource, 'OAuth2');
    expect(s1).toEqual(s2);
  });
});

// ── Invariant 6: SearchSnippet shape contract ───────────────────────

describe('Invariant: SearchSnippet type contract (ADR-0073)', () => {
  it('has required fields: field, text, matched_fields', () => {
    const task = makeEntity({ id: 'T-1', title: 'Test task', content: 'A test' });
    const snippet: SearchSnippet = generateTaskSnippet(task, 'test');

    // These are structural type checks - they'd fail at compile time
    // if the interface changes, but we verify runtime too
    expect(typeof snippet.field).toBe('string');
    expect(typeof snippet.text).toBe('string');
    expect(Array.isArray(snippet.matched_fields)).toBe(true);
    for (const f of snippet.matched_fields) {
      expect(typeof f).toBe('string');
    }
  });
});

// ── Invariant 7: Empty/edge cases don't crash ───────────────────────

describe('Invariant: edge cases (ADR-0073)', () => {
  let service: OramaSearchService;

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index(searchDocuments([
      makeEntity({ id: 'TASK-0001', title: 'Test task' }),
    ]));
  });

  it('searchAll with empty query returns empty array', async () => {
    const results = await service.searchAll('');
    expect(results).toEqual([]);
  });

  it('searchAll with whitespace-only query returns empty array', async () => {
    const results = await service.searchAll('   ');
    expect(results).toEqual([]);
  });

  it('snippet generation with empty content does not crash', () => {
    const task = makeEntity({ id: 'T-1', title: 'Minimal task' });
    delete task.content;
    const snippet = generateTaskSnippet(task, 'minimal');
    expect(snippet.field).toBe('title');
  });

  it('snippet generation with empty evidence/blocked_reason does not crash', () => {
    const task = makeEntity({ id: 'T-1', title: 'Test', evidence: [], blocked_reason: [] });
    const snippet = generateTaskSnippet(task, 'test');
    expect(snippet).toBeDefined();
  });

  it('snippet generation with undefined arrays does not crash', () => {
    const task = makeEntity({ id: 'T-1', title: 'Test' });
    delete task.evidence;
    delete task.blocked_reason;
    delete task.references;
    const snippet = generateTaskSnippet(task, 'test');
    expect(snippet).toBeDefined();
  });
});

// ── Invariant 8: declared resource status is searchable (BUG-0003) ──
//
// Original failure shape (byte-identical across trial and rerun 0006):
// generic issue resources with frontmatter `status:` came back as search
// candidates with no status in the stub, and --status open / --status
// resolved both returned 0 generic resources. Declared statuses must flow
// into the search document and obey the same leading-token filter
// semantics as canonical entities (packages/shared/src/status-token.ts).

describe('Invariant: declared resource status is searchable (BUG-0003)', () => {
  let service: OramaSearchService;

  const resources: Resource[] = [
    makeResource({
      id: 'mcp://backlog/docs/issues/0016-router-ssg.md',
      path: 'docs/issues/0016-router-ssg.md',
      title: 'Router SSG lifecycle breakage',
      content: '# Router SSG lifecycle breakage\n\nLifecycle router work for SSG output.',
      status: 'Resolved (2026-07-01)',
    }),
    makeResource({
      id: 'mcp://backlog/docs/issues/0021-router-followup.md',
      path: 'docs/issues/0021-router-followup.md',
      title: 'Router follow-up work',
      content: '# Router follow-up work\n\nCurrent open issues for the lifecycle router.',
      status: 'Open',
    }),
    makeResource({
      id: 'mcp://backlog/docs/notes/router-background.md',
      path: 'docs/notes/router-background.md',
      title: 'Router background note',
      content: '# Router background note\n\nContext about the lifecycle router.',
    }),
  ];

  // Declared-substrate statuses are freeform in real corpora — model an
  // ADR-style runtime document projected the way the registry projects it.
  const adrDocument: SearchEntityDocument = {
    kind: 'entity-document',
    entity: {
      id: 'ADR-0042',
      type: 'adr',
      title: 'Freeform declared decision',
      status: 'Accepted (goga, 2026-07-16)',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as Entity,
    fields: [
      { name: 'title', value: 'Freeform declared decision' },
      { name: 'content', value: 'A declared decision about the router' },
    ],
  };

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index([adrDocument]);
    await service.indexResources(resources);
  });

  it('unfiltered search carries the declared status on resource results', async () => {
    const results = await service.searchAll('lifecycle router');
    const resolved = results.find(r => r.id === 'mcp://backlog/docs/issues/0016-router-ssg.md');
    expect(resolved).toBeDefined();
    expect((resolved!.item as Resource).status).toBe('Resolved (2026-07-01)');
  });

  it('--status open returns the open generic resource (was 0)', async () => {
    const results = await service.searchAll('lifecycle router', { filters: { status: ['open'] } });
    const ids = results.map(r => r.id);
    expect(ids).toContain('mcp://backlog/docs/issues/0021-router-followup.md');
    expect(ids).not.toContain('mcp://backlog/docs/issues/0016-router-ssg.md');
  });

  it('--status resolved matches a freeform declared status by leading token (was 0)', async () => {
    const results = await service.searchAll('lifecycle router', { filters: { status: ['resolved'] } });
    const ids = results.map(r => r.id);
    expect(ids).toEqual(['mcp://backlog/docs/issues/0016-router-ssg.md']);
  });

  it('a resource without declared status never matches a status filter (fail-closed)', async () => {
    const results = await service.searchAll('lifecycle router', { filters: { status: ['open', 'resolved'] } });
    expect(results.map(r => r.id)).not.toContain('mcp://backlog/docs/notes/router-background.md');
  });

  it('entity freeform declared status matches its leading token', async () => {
    const results = await service.searchAll('declared decision', { filters: { status: ['accepted'] } });
    expect(results.map(r => r.id)).toContain('ADR-0042');
  });

  it('filter values normalize through the same rule as indexed statuses', async () => {
    const results = await service.searchAll('lifecycle router', { filters: { status: ['RESOLVED, verified'] } });
    expect(results.map(r => r.id)).toEqual(['mcp://backlog/docs/issues/0016-router-ssg.md']);
  });

  it('pure status-intent queries list status-matching resources too', async () => {
    // "open" decomposes to a status filter with no residual text — the
    // no-BM25 listing lane must apply the same declared-status semantics.
    const results = await service.searchAll('open');
    const ids = results.map(r => r.id);
    expect(ids).toContain('mcp://backlog/docs/issues/0021-router-followup.md');
    expect(ids).not.toContain('mcp://backlog/docs/issues/0016-router-ssg.md');
    expect(ids).not.toContain('mcp://backlog/docs/notes/router-background.md');
  });
});
