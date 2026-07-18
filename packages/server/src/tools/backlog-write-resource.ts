import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { ToolDeps } from './index.js';
import { editItem, NotFoundError } from '../core/index.js';
import { buildWriteContext } from './build-write-context.js';
import { BACKLOG_HOME_INPUT_FIELDS } from './home-input.js';
import { AGENT_IDENTITY_INPUT_FIELDS } from './agent-identity-input.js';

const EDIT_ATTRIBUTION = {
  tool: 'write_resource',
  mutation: 'resource-edit',
} as const;

export function registerWriteResourceTool(server: McpServer, service: IBacklogService, deps?: ToolDeps): void {
  server.registerTool(
    'write_resource',
    {
      description: `Use when you want backlog-mcp to validate and canonically persist an existing entity edit before reporting success. For ordinary repository prose edits, use your native Edit tool; reconciliation updates indexes and diagnostics afterward. Create and transition entities through the substrate-declared intent tools.
 * The \`append\` command will add content to the end of the body, automatically adding a newline if needed.
 Notes for using the \`str_replace\` command:
 * The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original body. Be mindful of whitespaces!
 * If the \`old_str\` parameter is not unique in the body, the replacement will not be performed. Include enough context to make it unique.
 * The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\``,
      // Claude Code owns MCP deferral; this strict lane is not exempted into
      // the always-loaded baseline.
      _meta: {
        'anthropic/alwaysLoad': false,
      },
      inputSchema: z.object({
        ...BACKLOG_HOME_INPUT_FIELDS,
        ...AGENT_IDENTITY_INPUT_FIELDS,
        id: z.string().describe('Task or epic ID, e.g. TASK-0001 or EPIC-0002'),
        operation: z.object({
          type: z.enum(['str_replace', 'insert', 'append']).describe('Operation type'),
          old_str: z.string().optional().describe('str_replace: exact string to replace'),
          new_str: z.string().optional().describe('str_replace/insert/append: replacement or new content'),
          insert_line: z.number().optional().describe('insert: line number to insert after'),
        }).describe('Operation to apply to the body'),
      }),
    },
    async ({ id, operation, as: agentIdentity }) => {
      try {
        const result = await editItem(
          service,
          { id, operation },
          buildWriteContext(deps, agentIdentity),
          EDIT_ATTRIBUTION,
        );
        if (!result.success) {
          return {
            content: [{ type: 'text' as const, text: result.error ?? 'Resource edit failed' }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text' as const, text: result.message ?? 'Resource updated' }],
        };
      } catch (error) {
        if (error instanceof NotFoundError) {
          return { content: [{ type: 'text' as const, text: `Task not found: ${id}` }], isError: true };
        }
        throw error;
      }
    }
  );
}
