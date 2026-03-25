import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { ENTITY_TYPES } from '@backlog-mcp/shared';
import { createItem } from '../core/create.js';

// Re-export for backward compat (source-path.test.ts imports this)
export { resolveSourcePath } from '../core/create.js';

export function registerBacklogCreateTool(server: McpServer, service: IBacklogService) {
  server.registerTool(
    'backlog_create',
    {
      description: 'Create a new item in the backlog.',
      inputSchema: z.object({
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description in markdown'),
        source_path: z.string().optional().describe('Local file path to read as description. Mutually exclusive with description — provide one or the other. Server reads the file directly.'),
        type: z.enum(ENTITY_TYPES).optional().describe('Type: task (default) or epic'),
        epic_id: z.string().optional().describe('Parent epic ID to link this task to'),
        parent_id: z.string().optional().describe('Parent ID (any entity). Supports subtasks (task→task), epic membership, folder organization, milestone grouping.'),
        references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links. Formats: external URLs (https://...), task refs (mcp://backlog/tasks/TASK-XXXX.md), resources (mcp://backlog/resources/{path}). Local files must include extension (file:///path/to/file.md)'),
      }).refine(
        (data) => !(data.description && data.source_path),
        { message: 'Cannot provide both description and source_path — use one or the other' },
      ),
    },
    async (params) => {
      try {
        const result = await createItem(service, params);
        return { content: [{ type: 'text', text: `Created ${result.id}` }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );
}
