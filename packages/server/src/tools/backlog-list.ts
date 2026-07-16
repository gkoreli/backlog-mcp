import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { listItems } from '../core/list.js';
import { BACKLOG_HOME_INPUT_FIELDS } from './home-input.js';

export function registerBacklogListTool(server: McpServer, service: IBacklogService): void {
  server.registerTool(
    'backlog_list',
    {
      description: 'List backlog entities from the active project substrate registry. Returns most recently observed items first, limited to 20 by default.',
      inputSchema: z.object({
        ...BACKLOG_HOME_INPUT_FIELDS,
        status: z.array(z.string()).optional().describe('Filter by substrate-defined status.'),
        type: z.string().optional().describe('Filter by substrate type. Default: returns all.'),
        parent_id: z.string().optional().describe('Filter items by parent. Example: parent_id="FLDR-0001"'),
        query: z.string().optional().describe('Search across all task fields (title, content, evidence, references, etc.). Case-insensitive substring matching.'),
        counts: z.boolean().optional().describe('Include global counts { total_tasks, total_epics, by_status, by_type } alongside results. Use this to detect if more items exist beyond the limit. Default: false'),
        limit: z.number().optional().describe('Max items to return. Default: 20. Increase if you need to see more items (e.g., limit=100 to list all epics).'),
      }).strict(),
    },
    async ({ home: _home, project_root: _projectRoot, ...params }) => {
      const result = await listItems(service, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}
