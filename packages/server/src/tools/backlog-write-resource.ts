import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { applyOperation } from '../resources/operations.js';
import type { ToolDeps } from './index.js';

const TASK_URI_RE = /^mcp:\/\/backlog\/tasks\/([A-Z]+-\d+)\.md$/;

export function registerWriteResourceTool(server: McpServer, service: IBacklogService, deps?: ToolDeps): void {
  server.registerTool(
    'write_resource',
    {
      description: `Edit existing files on the MCP server. All file creation goes through backlog_create.
 * The \`append\` command will add content to the end of an existing file, automatically adding a newline if the file doesn't end with one.
 Notes for using the \`str_replace\` command:
 * The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
 * If the \`old_str\` parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context in \`old_str\` to make it unique
 * The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\``,
      inputSchema: z.object({
        uri: z.string().describe('MCP resource URI, e.g. mcp://backlog/path/to/file.md'),
        operation: z.preprocess(
          // Workaround: MCP clients stringify object params with $ref/oneOf schemas
          // https://github.com/anthropics/claude-code/issues/18260
          (val) => typeof val === 'string' ? JSON.parse(val) : val,
          z.discriminatedUnion('type', [
            z.object({
              type: z.literal('str_replace'),
              old_str: z.string().describe('String in file to replace (must match exactly)'),
              new_str: z.string().describe('New string to replace old_str with'),
            }),
            z.object({
              type: z.literal('insert'),
              insert_line: z.number().describe('Line number after which new_str will be inserted'),
              new_str: z.string().describe('String to insert'),
            }),
            z.object({
              type: z.literal('append'),
              new_str: z.string().describe('Content to append to the file'),
            }),
          ])
        ).describe('Operation to apply'),
      }),
    },
    async ({ uri, operation }) => {
      const taskMatch = uri.match(TASK_URI_RE);

      if (taskMatch) {
        // Task URI — backed by IBacklogService (works in both local and cloud mode)
        const id = taskMatch[1]!;
        const [task, body] = await Promise.all([service.get(id), service.getMarkdown(id)]);

        if (!task) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, message: 'Task not found', error: `No task with id ${id}` }) }] };
        }
        if (body === null) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, message: 'Task body not found' }) }] };
        }

        try {
          const newBody = applyOperation(body, operation);
          await service.save({ ...task, description: newBody, updated_at: new Date().toISOString() });
          return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, message: `Successfully applied ${operation.type} to ${uri}` }) }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, message: 'Operation failed', error: err instanceof Error ? err.message : String(err) }) }] };
        }
      }

      // Non-task URI — delegate to resourceManager (local mode only)
      if (deps?.resourceManager) {
        const result = deps.resourceManager.write(uri, operation);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, message: 'Not supported', error: 'write_resource for non-task URIs requires local mode (filesystem access not available in cloud mode)' }) }] };
    }
  );
}
