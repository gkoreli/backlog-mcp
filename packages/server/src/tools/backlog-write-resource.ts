import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { applyOperation } from '../resources/operations.js';

export function registerWriteResourceTool(server: McpServer, service: IBacklogService): void {
  server.registerTool(
    'write_resource',
    {
      description: `Edit the markdown body of an existing task or epic. All entity creation goes through backlog_create.
 * The \`append\` command will add content to the end of the body, automatically adding a newline if needed.
 Notes for using the \`str_replace\` command:
 * The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original body. Be mindful of whitespaces!
 * If the \`old_str\` parameter is not unique in the body, the replacement will not be performed. Include enough context to make it unique.
 * The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\``,
      inputSchema: z.object({
        id: z.string().describe('Task or epic ID, e.g. TASK-0001 or EPIC-0002'),
        operation: z.preprocess(
          // Workaround: MCP clients stringify object params with $ref/oneOf schemas
          // https://github.com/anthropics/claude-code/issues/18260
          (val) => typeof val === 'string' ? JSON.parse(val) : val,
          z.discriminatedUnion('type', [
            z.object({
              type: z.literal('str_replace'),
              old_str: z.string().describe('String in the body to replace (must match exactly)'),
              new_str: z.string().describe('New string to replace old_str with'),
            }),
            z.object({
              type: z.literal('insert'),
              insert_line: z.number().describe('Line number after which new_str will be inserted'),
              new_str: z.string().describe('String to insert'),
            }),
            z.object({
              type: z.literal('append'),
              new_str: z.string().describe('Content to append to the body'),
            }),
          ])
        ).describe('Operation to apply to the body'),
      }),
    },
    async ({ id, operation }) => {
      const task = await service.get(id);
      if (!task) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: `Task not found: ${id}` }) }] };
      }

      try {
        const newBody = applyOperation(task.description ?? '', operation);
        await service.save({ ...task, description: newBody, updated_at: new Date().toISOString() });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, message: `Successfully applied ${operation.type} to ${id}` }) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }) }] };
      }
    }
  );
}
