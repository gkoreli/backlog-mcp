import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IBacklogService } from '../storage/service-types.js';
import type { Actor, IOperationLog } from '../operations/types.js';
import { registerBacklogListTool } from './backlog-list.js';
import { registerBacklogGetTool } from './backlog-get.js';
import { registerBacklogCreateTool } from './backlog-create.js';
import { registerBacklogUpdateTool } from './backlog-update.js';
import { registerBacklogDeleteTool } from './backlog-delete.js';
import { registerBacklogSearchTool } from './backlog-search.js';
import { registerBacklogContextTool } from './backlog-context.js';
import { registerWriteResourceTool } from './backlog-write-resource.js';

/**
 * Per-request tool dependencies.
 *
 * Write-path pieces (actor, operationLog, eventBus) flow through to each
 * MCP write tool handler, which packs them into a WriteContext via
 * buildWriteContext() before calling core. Core functions require the
 * context — that's how attribution and journaling are enforced at the
 * type level rather than by convention. See ADR 0094.
 */
export interface ToolDeps {
  resourceManager?: any;
  operationLogger?: any;
  resolveSourcePath?: (path: string) => string;
  /** Who is making this call. Node reads env; Worker binds to session/auth. */
  actor?: Actor;
  /** Append-only mutation journal. Local=JSONL, Cloud=D1. */
  operationLog?: IOperationLog;
  /** Live-event bus for SSE push. Node only; Worker is stateless. */
  eventBus?: { emit: (event: any) => void };
}

export function registerTools(server: McpServer, service: IBacklogService, deps?: ToolDeps): void {
  registerBacklogListTool(server, service);
  registerBacklogGetTool(server, service);
  registerBacklogCreateTool(server, service, deps);
  registerBacklogUpdateTool(server, service, deps);
  registerBacklogDeleteTool(server, service, deps);
  registerBacklogSearchTool(server, service);
  registerWriteResourceTool(server, service, deps);
  if (deps?.resourceManager && deps?.operationLogger) {
    registerBacklogContextTool(server, service, { resourceManager: deps.resourceManager, operationLogger: deps.operationLogger });
  }
}
