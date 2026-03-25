import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { STATUSES } from '@backlog-mcp/shared';
import { searchItems } from '../core/search.js';

export function registerBacklogSearchTool(server: McpServer, service: IBacklogService) {
  server.registerTool(
    'backlog_search',
    {
      description: 'Search across all backlog content — tasks, epics, and resources. Returns relevance-ranked results with match context. Use this for discovery; use backlog_list for filtering by status/type.',
      inputSchema: z.object({
        query: z.string().describe('Search query. Supports keywords, phrases, and natural language. Fuzzy matching and semantic similarity are applied automatically.'),
        types: z.array(z.enum(['task', 'epic', 'resource'])).optional().describe('Filter results by type. Default: all types. Example: ["task", "epic"] to exclude resources.'),
        status: z.array(z.enum(STATUSES)).optional().describe('Filter tasks/epics by status. Default: all statuses. Example: ["open", "in_progress"] for active work only.'),
        parent_id: z.string().optional().describe('Scope search to items under a specific parent. Example: "EPIC-0001"'),
        sort: z.enum(['relevant', 'recent']).optional().describe('Sort mode. "relevant" (default) ranks by search relevance. "recent" ranks by last updated.'),
        limit: z.number().min(1).max(100).optional().describe('Max results to return. Default: 20, max: 100.'),
        include_content: z.boolean().optional().describe('Include full description/content in results. Default: false (returns snippets only). Set true when you need the full text.'),
        include_scores: z.boolean().optional().describe('Include relevance scores in results. Default: false.'),
      }),
    },
    async (params) => {
      try {
        const result = await searchItems(service, params);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }], isError: true };
      }
    }
  );
}
