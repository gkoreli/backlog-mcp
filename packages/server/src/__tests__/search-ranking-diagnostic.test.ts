/**
 * Diagnostic test: reproduces real-world ranking failures.
 *
 * The golden test dataset (11 docs) is too clean — few documents mention
 * the same terms. In a real backlog, many tasks reference "backlog-mcp"
 * in descriptions, evidence, and references. This test simulates that.
 */
import { describe, it, beforeAll } from 'vitest';
import { join } from 'node:path';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { Entity, TaskEntity } from '@backlog-mcp/shared';
import { searchDocuments } from './helpers/search-document.js';

const TEST_CACHE_PATH = join(process.cwd(), 'test-data', '.cache', 'search-diag.json');

function makeEntity(overrides: Partial<Entity> & { id: string; title: string }): TaskEntity {
  return {
    type: 'task',
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Realistic dataset: the target epic + many tasks that naturally mention
 * "backlog" and "mcp" in their body text (as happens in a real backlog-mcp project).
 */
const TASKS: Entity[] = [
  // THE target: the epic about backlog-mcp
  makeEntity({
    id: 'EPIC-0001',
    title: 'backlog-mcp 10x',
    content: 'Transform backlog-mcp from task tracker to agentic work system with keyboard-first UX',
    type: 'epic',
  }),

  // Tasks that naturally reference "backlog-mcp" in body text
  makeEntity({
    id: 'TASK-0010',
    title: 'Implement Spotlight-style search UI',
    content: 'Global search modal for backlog-mcp triggered by Cmd+J. The backlog search needs to support mcp tool integration.',
    references: [{ url: 'https://github.com/user/backlog-mcp', title: 'backlog-mcp repo' }],
  }),
  makeEntity({
    id: 'TASK-0011',
    title: 'Fix search ranking quality',
    content: 'Search in backlog-mcp returns wrong results. The backlog items are not ranked properly when using mcp tools. Need to improve the backlog search for mcp agents.',
    evidence: ['Searched backlog for mcp-related tasks, got wrong results', 'backlog-mcp search needs improvement'],
  }),
  makeEntity({
    id: 'TASK-0012',
    title: 'Add MCP tool documentation',
    content: 'Document all backlog-mcp tools. The MCP protocol requires specific schemas. The backlog tools should follow mcp best practices for backlog management.',
    references: [
      { url: 'https://github.com/user/backlog-mcp/docs', title: 'backlog-mcp docs' },
      { url: 'https://modelcontextprotocol.io', title: 'MCP specification' },
    ],
  }),
  makeEntity({
    id: 'TASK-0013',
    title: 'Performance optimization for large backlogs',
    content: 'The backlog-mcp server is slow with >500 items. Need to optimize backlog queries. The mcp server should handle large backlog collections efficiently. Current backlog-mcp indexing takes too long.',
  }),
  makeEntity({
    id: 'TASK-0014',
    title: 'Implement backlog import/export',
    content: 'Add import/export functionality to backlog-mcp. Users need to migrate their backlog from other tools into mcp format. The backlog export should preserve all mcp metadata.',
  }),
  makeEntity({
    id: 'TASK-0015',
    title: 'API rate limiting for MCP server',
    content: 'Add rate limiting to the backlog-mcp MCP server endpoints. The backlog API needs throttling when mcp clients send too many requests to the backlog service.',
  }),
  makeEntity({
    id: 'TASK-0016',
    title: 'Hybrid search architecture',
    content: 'Implement BM25 + vector hybrid search for backlog-mcp. The search should combine text and semantic matching for the backlog. MCP tool responses should include relevance scores.',
  }),
  makeEntity({
    id: 'TASK-0017',
    title: 'Test infrastructure improvements',
    content: 'Improve test coverage for backlog-mcp. Add golden tests for backlog search. The mcp tool tests need better assertions. Current backlog test suite is incomplete.',
  }),
  makeEntity({
    id: 'TASK-0018',
    title: 'Backlog notifications via MCP',
    content: 'Send notifications through MCP when backlog items change. The backlog-mcp server should emit events. MCP clients consuming the backlog need real-time updates.',
  }),

  // FeatureStore scenario: target + noisy "feature" mentions
  makeEntity({
    id: 'TASK-0009',
    title: 'Create YavapaiMFE ownership transfer documentation',
    content: 'Create comprehensive starter doc for new team taking ownership of FeatureStore (YavapaiMFE).\n\nMFE ID: `featurestore`\nFeature flag: `featureStore`\nMain package: RhinestoneMonarchYavapaiMFE',
    status: 'done',
  }),
  makeEntity({
    id: 'TASK-0020',
    title: 'Feature flag cleanup',
    content: 'Remove old feature flags from the codebase. The feature toggle system has accumulated stale feature flags. Clean up the feature management store.',
  }),
  makeEntity({
    id: 'TASK-0021',
    title: 'Feature prioritization framework',
    content: 'Create a feature prioritization framework. Each feature should have a score. The product feature backlog needs a feature ranking system to store priorities.',
  }),
  makeEntity({
    id: 'TASK-0022',
    title: 'Implement feature toggle service',
    content: 'Build a centralized feature toggle service. Features can be enabled per user. The feature store should persist feature state. Add feature flag support for A/B testing.',
  }),
  makeEntity({
    id: 'TASK-0023',
    title: 'Add feature request template',
    content: 'Create a feature request template for the backlog. Feature requests should include feature content, feature impact, and feature store integration requirements.',
  }),
];

describe('Ranking Diagnostic', () => {
  let service: OramaSearchService;

  beforeAll(async () => {
    service = new OramaSearchService({ cachePath: TEST_CACHE_PATH });
    await service.index(searchDocuments(TASKS));
  });

  /**
   * Diagnostic: print full ranking details for a query.
   * This is not a pass/fail test — it's an evidence-gathering tool.
   */
  async function diagnose(query: string, expectedFirst: string) {
    const results = await service.search(query);
    console.log(`\n${'='.repeat(70)}`);
    console.log(`QUERY: "${query}"  |  EXPECTED #1: ${expectedFirst}`);
    console.log(`${'='.repeat(70)}`);

    const targetIdx = results.findIndex(r => r.task.id === expectedFirst);
    console.log(`Target position: ${targetIdx === -1 ? 'NOT FOUND' : `#${targetIdx + 1}`} of ${results.length}`);
    console.log(`\nFull ranking:`);
    results.forEach((r, i) => {
      const marker = r.task.id === expectedFirst ? ' <<<< TARGET' : '';
      console.log(`  #${i + 1}  ${r.task.id.padEnd(12)} score=${r.score.toFixed(4)}  "${r.task.title.substring(0, 50)}"${marker}`);
    });
    console.log('');
  }

  it('diagnose "backlog mcp" ranking', async () => {
    await diagnose('backlog mcp', 'EPIC-0001');
  });

  it('diagnose "feature store" ranking', async () => {
    await diagnose('feature store', 'TASK-0009');
  });

  it('diagnose "backlog" ranking (single term)', async () => {
    await diagnose('backlog', 'EPIC-0001');
  });

  it('diagnose "feature" ranking (single term)', async () => {
    await diagnose('feature', 'TASK-0009');
  });

  it('diagnose "mcp" ranking (single term)', async () => {
    await diagnose('mcp', 'EPIC-0001');
  });

  it('diagnose "backlog-mcp" (hyphenated)', async () => {
    await diagnose('backlog-mcp', 'EPIC-0001');
  });
});
