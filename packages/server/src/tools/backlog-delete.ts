import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { ToolDeps } from './index.js';
import { deleteItem } from '../core/delete.js';
import { describeDocumentLocation } from '../core/home-provenance.js';
import { buildWriteContext } from './build-write-context.js';
import { BACKLOG_HOME_INPUT_FIELDS } from './home-input.js';
import { AGENT_IDENTITY_INPUT_FIELDS } from './agent-identity-input.js';

const DELETE_ATTRIBUTION = {
  tool: 'backlog_delete',
  mutation: 'delete',
} as const;

export function registerBacklogDeleteTool(server: McpServer, service: IBacklogService, deps?: ToolDeps): void {
  server.registerTool(
    'backlog_delete',
    {
      description: 'Delete an item permanently.',
      inputSchema: z.object({
        ...BACKLOG_HOME_INPUT_FIELDS,
        ...AGENT_IDENTITY_INPUT_FIELDS,
        id: z.string().describe('Task ID to delete'),
      }),
    },
    async ({ id, as: agentIdentity }) => {
      // The path is looked up first: after deletion it no longer resolves.
      const location = describeDocumentLocation(deps?.writeProvenance?.document(id) ?? {});
      const result = await deleteItem(
        service,
        { id },
        buildWriteContext(deps, agentIdentity),
        DELETE_ATTRIBUTION,
      );
      const text = location === undefined
        ? `Deleted ${result.id}`
        : `Deleted ${result.id}\n  ${location}`;
      return { content: [{ type: 'text', text }] };
    }
  );
}
