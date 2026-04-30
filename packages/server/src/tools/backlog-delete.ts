import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import type { ToolDeps } from './index.js';
import { deleteItem } from '../core/delete.js';
import { buildWriteContext } from './build-write-context.js';

export function registerBacklogDeleteTool(server: McpServer, service: IBacklogService, deps?: ToolDeps): void {
  server.registerTool(
    'backlog_delete',
    {
      description: 'Delete an item permanently.',
      inputSchema: z.object({
        id: z.string().describe('Task ID to delete'),
      }),
    },
    async ({ id }) => {
      const result = await deleteItem(service, { id }, buildWriteContext(deps));
      return { content: [{ type: 'text', text: `Deleted ${result.id}` }] };
    }
  );
}
