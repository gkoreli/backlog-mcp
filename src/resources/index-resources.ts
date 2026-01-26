import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDataDirResource } from './data-dir.js';

/**
 * Register MCP resources.
 * 
 * Single handler: mcp://backlog/{+path} → {BACKLOG_DATA_DIR}/{path}
 * 
 * Examples:
 *   mcp://backlog/tasks/TASK-0092.md
 *   mcp://backlog/resources/TASK-0092/strategic-improvements.md
 *   mcp://backlog/backlog-mcp-engineer/system-config-visibility-2026-01-26/artifact.md
 * 
 * For git repo files (ADRs, source code), use file:// URIs.
 */
export function registerResources(server: McpServer) {
  registerDataDirResource(server);
}
