import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { Entity, TaskEntity } from '@backlog-mcp/shared';
import { searchDocuments } from './helpers/search-document.js';

/**
 * Semantic/Hybrid search tests.
 * These tests verify that hybrid search finds semantically related content.
 * 
 * Note: First run downloads the embedding model (~23MB), which takes ~5s.
 * Subsequent runs use cached model.
 */

function makeEntity(overrides: Partial<Entity> & { id: string; title: string }): TaskEntity {
  return {
    type: 'task',
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const TEST_CACHE_PATH = join(process.cwd(), 'test-data', '.cache', 'hybrid-search-index.json');

/** Distinct updated_at per task so sort=recent has a deterministic order. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

describe('Hybrid Search (Semantic)', () => {
  let service: OramaSearchService;

  // Tasks designed to test semantic similarity
  const tasks: Entity[] = [
    makeEntity({
      id: 'TASK-0001',
      title: 'Implement user authentication',
      content: 'Add OAuth2 and SSO support for secure user access',
      updated_at: daysAgo(4),
    }),
    makeEntity({
      id: 'TASK-0002',
      title: 'Fix CI/CD pipeline',
      content: 'Deployment automation is failing on staging environment',
      updated_at: daysAgo(0),
    }),
    makeEntity({
      id: 'TASK-0003',
      title: 'Database performance optimization',
      content: 'Query response times are too slow, need indexing improvements',
      updated_at: daysAgo(2),
    }),
    makeEntity({
      id: 'TASK-0004',
      title: 'Add user profile page',
      content: 'Users should be able to view and edit their account settings',
      updated_at: daysAgo(1),
    }),
    makeEntity({
      id: 'TASK-0005',
      title: 'Implement rate limiting',
      content: 'Protect API endpoints from abuse and DDoS attacks',
      updated_at: daysAgo(3),
    }),
  ];

  beforeAll(async () => {
    // Use fresh index to ensure embeddings are generated
    service = new OramaSearchService({ cachePath: TEST_CACHE_PATH, hybridSearch: true });
    await service.index(searchDocuments(tasks));
  }, 60000); // 60s timeout for model download on first run

  describe('semantic similarity', () => {
    it('finds "authentication" task when searching "login"', async () => {
      const results = await service.search('login');
      // "login" is semantically related to "authentication"
      const authTask = results.find(r => r.task.id === 'TASK-0001');
      expect(authTask).toBeDefined();
    });

    it('finds "CI/CD" task when searching "deployment"', async () => {
      const results = await service.search('deployment issues');
      const cicdTask = results.find(r => r.task.id === 'TASK-0002');
      expect(cicdTask).toBeDefined();
    });

    it('finds "database" task when searching "slow queries"', async () => {
      const results = await service.search('slow queries');
      const dbTask = results.find(r => r.task.id === 'TASK-0003');
      expect(dbTask).toBeDefined();
    });

    it('finds "rate limiting" task when searching "API security"', async () => {
      const results = await service.search('API security');
      const rateLimitTask = results.find(r => r.task.id === 'TASK-0005');
      expect(rateLimitTask).toBeDefined();
    });

    it('finds "profile" task when searching "account settings"', async () => {
      const results = await service.search('account settings');
      const profileTask = results.find(r => r.task.id === 'TASK-0004');
      expect(profileTask).toBeDefined();
    });
  });

  describe('exact matches still rank high', () => {
    it('exact title match ranks first', async () => {
      const results = await service.search('authentication');
      expect(results[0].task.id).toBe('TASK-0001');
    });

    it('exact content match is found', async () => {
      const results = await service.search('OAuth2');
      expect(results.some(r => r.task.id === 'TASK-0001')).toBe(true);
    });
  });

  describe('graceful degradation', () => {
    it('works with hybrid search disabled', async () => {
      const bm25Service = new OramaSearchService({
        cachePath: join(process.cwd(), 'test-data', '.cache', 'bm25-only-index.json'),
        hybridSearch: false,
      });
      await bm25Service.index(searchDocuments(tasks));

      // Should still find exact matches
      const results = await bm25Service.search('authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].task.id).toBe('TASK-0001');
    });
  });

  describe('sort=recent keeps the hybrid retrieval set (0003 friction log)', () => {
    // Original failure shape: --sort recent silently swapped the hybrid
    // engine for a native BM25 sortBy query, shrinking 10 results to 2
    // in the internal ADR mine's dogfood. "login" appears nowhere as a
    // literal token in this corpus, so any result is vector-lane only —
    // under the old code, recent mode returned nothing for it.

    it('returns the same result set as sort=relevant, reordered', async () => {
      const relevant = await service.searchAll('login');
      const recent = await service.searchAll('login', { sort: 'recent' });

      expect(relevant.length).toBeGreaterThan(0);
      expect(new Set(recent.map(r => r.id))).toEqual(new Set(relevant.map(r => r.id)));
    });

    it('keeps the semantic-only hit and orders by updated_at descending', async () => {
      const recent = await service.searchAll('login', { sort: 'recent' });

      expect(recent.map(r => r.id)).toContain('TASK-0001');
      const updatedAts = recent.map(r => (r.item as TaskEntity).updated_at);
      expect(updatedAts).toEqual([...updatedAts].sort().reverse());
    });
  });

  describe('isHybridSearchActive', () => {
    it('returns true when embeddings are loaded', () => {
      expect(service.isHybridSearchActive()).toBe(true);
    });

    it('returns false when hybrid search is disabled', async () => {
      const bm25Service = new OramaSearchService({
        cachePath: join(process.cwd(), 'test-data', '.cache', 'bm25-check-index.json'),
        hybridSearch: false,
      });
      await bm25Service.index(searchDocuments(tasks));
      expect(bm25Service.isHybridSearchActive()).toBe(false);
    });
  });
});
