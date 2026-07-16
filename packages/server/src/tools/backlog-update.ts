import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { ToolDeps } from './index.js';
import { updateItem, NotFoundError } from '../core/index.js';
import { buildWriteContext } from './build-write-context.js';
import { BACKLOG_HOME_INPUT_FIELDS } from './home-input.js';

export function registerBacklogUpdateTool(server: McpServer, service: IBacklogService, deps?: ToolDeps): void {
  server.registerTool(
    'backlog_update',
    {
      description: 'Update one entity through its active substrate definition. For editing the markdown body, use write_resource with str_replace.',
      inputSchema: z.object({
        ...BACKLOG_HOME_INPUT_FIELDS,
        id: z.string().describe('Entity ID to update'),
        title: z.string().optional().describe('New title'),
        status: z.string().optional().describe('New substrate-defined status'),
        parent_id: z.union([z.string(), z.null()]).optional().describe('Parent ID (null to unlink).'),
        fields: z.record(z.string(), z.unknown()).optional().describe('Substrate-specific field changes. Null removes a field; id/type remain server-owned.'),
        blocked_reason: z.array(z.string()).optional().describe('Reason if status is blocked'),
        evidence: z.array(z.string()).optional().describe('Proof of completion when marking done - links to PRs, docs, or notes'),
        references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links. Formats: external URLs (https://...), task refs (mcp://backlog/tasks/TASK-XXXX.md), resources (mcp://backlog/resources/{path}). Local files must include extension (file:///path/to/file.md)'),
        due_date: z.union([z.string(), z.null()]).optional().describe('Due date for milestones (ISO 8601). Null to clear.'),
        content_type: z.union([z.string(), z.null()]).optional().describe('Content type for artifacts (e.g. text/markdown). Null to clear.'),
        // Cron-only fields — validated server-side in core/update.ts.
        schedule: z.string().optional().describe('Cron expression (5 fields). Validated on write. Only permitted on cron entities.'),
        command: z.string().optional().describe('Command string for external scheduler. Only permitted on cron entities.'),
        enabled: z.boolean().optional().describe('Whether the external scheduler should tick this cron. Separate from status. Only permitted on cron entities.'),
        last_run: z.union([z.string(), z.null()]).optional().describe('ISO-8601 timestamp of most recent scheduler tick. Typically written by the scheduler. Null to clear (e.g. scheduler reset).'),
        next_run: z.union([z.string(), z.null()]).optional().describe('ISO-8601 timestamp of next scheduled tick. Typically written by the scheduler. Null to clear.'),
      }).strict(),
    },
    async ({ home: _home, project_root: _projectRoot, ...params }) => {
      try {
        const result = await updateItem(service, params, buildWriteContext(deps));
        return { content: [{ type: 'text', text: `Updated ${result.id}` }] };
      } catch (error) {
        if (error instanceof NotFoundError) {
          return { content: [{ type: 'text', text: `Task ${params.id} not found` }], isError: true };
        }
        throw error;
      }
    }
  );
}
