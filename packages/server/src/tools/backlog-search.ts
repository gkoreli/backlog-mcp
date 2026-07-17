import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { searchItems } from '../core/search.js';
import type { HomeReadCoordinator } from '../core/home-read-coordinator.types.js';
import type { MemoryUsageTracker } from '../memory/usage-tracker.js';
import {
  BACKLOG_READ_HOME_INPUT_FIELDS,
  requireHomeReadCoordinator,
} from './home-input.js';

export interface BacklogSearchDeps {
  homeReadCoordinator?: HomeReadCoordinator;
  /** Tier-1 search telemetry (ADR 0121 R7): returned ids, never query text. */
  usageTracker?: MemoryUsageTracker;
}

export function registerBacklogSearchTool(
  server: McpServer,
  service: IBacklogService,
  deps?: BacklogSearchDeps,
): void {
  server.registerTool(
    'backlog_search',
    {
      description: 'Search across all indexed backlog substrates and generic resources. Returns relevance-ranked results with match context. Use this for discovery; use backlog_list for filtering by status/type.',
      inputSchema: z.object({
        ...BACKLOG_READ_HOME_INPUT_FIELDS,
        query: z.string().describe('Search query. Supports keywords, phrases, and natural language. Fuzzy matching and semantic similarity are applied automatically.'),
        types: z.array(z.string().min(1)).optional().describe('Filter by substrate type or "resource". Default: all searchable types.'),
        status: z.array(z.string().min(1)).optional().describe('Filter entities by canonical substrate status. Default: all statuses.'),
        parent_id: z.string().optional().describe('Scope search to items under a specific parent. Example: "EPIC-0001"'),
        sort: z.enum(['relevant', 'recent']).optional().describe('Sort mode. "relevant" (default) ranks by search relevance. "recent" ranks by last updated.'),
        limit: z.number().min(1).max(100).optional().describe('Max results to return. Default: 20, max: 100.'),
        include_content: z.boolean().optional().describe('Include full content in results. Default: false (returns snippets only). Set true when you need the full text.'),
        include_scores: z.boolean().optional().describe('Include relevance scores in results. Default: false.'),
      }),
    },
    async ({ home, project_root, ...params }) => {
      try {
        const result = home === 'all'
          ? await requireHomeReadCoordinator(
              deps?.homeReadCoordinator,
            ).search(
              params,
              project_root === undefined
                ? undefined
                : { projectRoot: project_root },
            )
          : await searchItems(service, params);
        if (home !== 'all') {
          // Tier-1 telemetry (ADR 0121 R7) — session-stamped returned ids,
          // fail-open; the cross-home path records per home inside the
          // coordinator. Search behavior stays byte-identical.
          deps?.usageTracker?.recordSearch(
            result.results.map(function resultId(item) {
              return item.id;
            }),
          );
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }], isError: true };
      }
    }
  );
}
