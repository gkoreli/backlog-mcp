import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readMcpResource } from './resource-reader.js';

/**
 * Repository resources (docs, ADRs, etc.) - NOT task-attached resources.
 * 
 * URI Template (RFC 6570): mcp://backlog/resources/{+path}
 * - {+path}: Greedy match - captures everything including slashes
 * - Excludes TASK-/EPIC- prefixed paths (handled by task-attached.ts)
 * 
 * Examples:
 *   ✅ mcp://backlog/resources/docs/adr/0001-decision.md
 *   ✅ mcp://backlog/resources/README.md
 *   ❌ mcp://backlog/resources/TASK-0092/file.md (handled by task-attached.ts)
 * 
 * Storage location: {REPO_ROOT}/{path}
 */
export function registerResourceFileResource(server: McpServer) {
  const template = new ResourceTemplate(
    'mcp://backlog/resources/{+path}',
    { list: undefined } // No listing callback needed
  );
  
  server.registerResource(
    'Resource File',
    template,
    { description: 'Repository resource files (docs, ADRs, etc.) - excludes task-attached resources', mimeType: 'text/plain' },
    async (uri, variables) => {
      const path = String(variables.path);
      
      // Reject task-attached resources - they have their own handler
      if (/^(TASK-\d+|EPIC-\d+)\//.test(path)) {
        throw new Error(`Task-attached resources must use the Task-Attached Resource handler. Path: ${path}`);
      }
      
      const resource = await readMcpResource(uri.toString());
      return { contents: [{ uri: uri.toString(), mimeType: resource.mimeType, text: resource.content }] };
    }
  );
}
