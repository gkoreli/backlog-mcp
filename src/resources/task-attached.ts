import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readMcpResource } from './resource-reader.js';

/**
 * Task-attached resources (ADRs, design docs, artifacts specific to a task).
 * 
 * URI Template (RFC 6570): mcp://backlog/resources/{taskId}/{filename}
 * - {taskId}: TASK-NNNN or EPIC-NNNN
 * - {filename}: Any filename (no slashes)
 * 
 * Examples:
 *   ✅ mcp://backlog/resources/TASK-0092/strategic-improvements.md
 *   ✅ mcp://backlog/resources/EPIC-0002/roadmap.md
 *   ❌ mcp://backlog/resources/docs/adr/0001.md (handled by resource-file.ts)
 * 
 * Storage location: {BACKLOG_DATA_DIR}/resources/{taskId}/{filename}
 */
export function registerTaskAttachedResource(server: McpServer) {
  const template = new ResourceTemplate(
    'mcp://backlog/resources/{taskId}/{filename}',
    { list: undefined } // No listing callback needed
  );
  
  server.registerResource(
    'Task-Attached Resource',
    template,
    { description: 'Task-attached resources (ADRs, design docs, etc.)' },
    async (uri, variables) => {
      const taskId = String(variables.taskId);
      const filename = String(variables.filename);
      
      // Validate task ID format
      if (!/^(TASK-\d+|EPIC-\d+)$/.test(taskId)) {
        throw new Error(`Invalid task ID format. Expected TASK-NNNN or EPIC-NNNN, got: ${taskId}`);
      }
      
      const { content, mimeType } = await readMcpResource(uri.toString());
      return { contents: [{ uri: uri.toString(), mimeType, text: content }] };
    }
  );
}
