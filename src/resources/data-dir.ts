import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readMcpResource } from './resource-reader.js';

/**
 * Catch-all handler for any path in the backlog data directory.
 * 
 * URI Template (RFC 6570): mcp://backlog/{+path}
 * - {+path}: Greedy match - captures everything including slashes
 * 
 * Examples:
 *   ✅ mcp://backlog/backlog-mcp-engineer/system-config-visibility-2026-01-26/artifact.md
 *   ✅ mcp://backlog/artifacts/some-file.md
 *   ✅ mcp://backlog/any/nested/path/file.md
 * 
 * Storage location: {BACKLOG_DATA_DIR}/{path}
 * 
 * Note: This is the lowest priority handler (registered last).
 * More specific handlers (tasks, task-attached resources) take precedence.
 */
export function registerDataDirResource(server: McpServer) {
  const template = new ResourceTemplate(
    'mcp://backlog/{+path}',
    { list: undefined }
  );
  
  server.registerResource(
    'Data Directory Resource',
    template,
    { description: 'Any file in the backlog data directory' },
    async (uri, variables) => {
      const path = String(variables.path);
      
      const resource = await readMcpResource(uri.toString());
      return { contents: [{ uri: uri.toString(), mimeType: resource.mimeType, text: resource.content }] };
    }
  );
}
