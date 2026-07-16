import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryComposer, MemoryEntry } from '@backlog-mcp/memory';
import type { Memory } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { Actor, IOperationLog } from '../operations/types.js';
import { registerBacklogListTool } from './backlog-list.js';
import { registerBacklogGetTool } from './backlog-get.js';
import { registerBacklogCreateTool } from './backlog-create.js';
import { registerBacklogUpdateTool } from './backlog-update.js';
import { registerBacklogDeleteTool } from './backlog-delete.js';
import { registerBacklogSearchTool } from './backlog-search.js';
import { registerBacklogWakeupTool } from './backlog-wakeup.js';
import { registerBacklogRecallTool } from './backlog-recall.js';
import { registerBacklogRememberTool } from './backlog-remember.js';
import { registerBacklogForgetTool } from './backlog-forget.js';
import { registerBacklogConsolidationTool } from './backlog-consolidation.js';
import { registerBacklogContradictionsTool } from './backlog-contradictions.js';
import type { MemoryUsageTracker } from '../memory/usage-tracker.js';
import { registerWriteResourceTool } from './backlog-write-resource.js';
import type { HomeReadCoordinator } from '../core/home-read-coordinator.types.js';
import type { ProjectSubstrateRegistry } from '../core/substrates/project-substrate-registry.js';

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
  substrateRegistry?: Pick<
    ProjectSubstrateRegistry,
    'acceptsParent' | 'getIntake'
  >;
  scopeRoot?: string;
  /** Live-event bus for SSE push. Node only; Worker is stateless. */
  eventBus?: { emit: (event: any) => void };
  /**
   * Episodic memory composer — optional. Node wires the default composer;
   * Worker omits memory for now (see ADR 0092.2 §D4).
   */
  memoryComposer?: MemoryComposer;
  /** Mint memory metadata through the selected home's store boundary. */
  mintMemoryEntry?: (memory: Memory) => MemoryEntry;
  /** Read a local file by path. Node-only; Worker omits. */
  readLocalFile?: (filePath: string) => string | null;
  /** Memory usage tracker (ADR 0092.9). Node wires the default; Worker omits. */
  usageTracker?: MemoryUsageTracker;
  /** Absolute path to identity.md. Node-only. */
  identityPath?: string;
  /** Absolute path to NORTH-STAR.md. Docs-native only (ADR 0113 C.2). */
  visionPath?: string;
  /**
   * memory-usage.jsonl reader (ADR 0092.9 R-16) — powers the consolidation
   * demand gate. Node wires bootstrap's reader; Worker omits (demand 0,
   * ripeness degrades to age-only).
   */
  readUsageLines?: () => string[];
  /** Request-scoped coordinator for global plus one explicit project read. */
  homeReadCoordinator?: HomeReadCoordinator;
}

export function registerTools(server: McpServer, service: IBacklogService, deps?: ToolDeps): void {
  registerBacklogListTool(server, service);
  registerBacklogGetTool(server, service, deps?.usageTracker ? { usageTracker: deps.usageTracker } : undefined);
  registerBacklogCreateTool(server, service, deps);
  registerBacklogUpdateTool(server, service, deps);
  registerBacklogDeleteTool(server, service, deps);
  registerBacklogSearchTool(server, service, deps?.homeReadCoordinator
    ? { homeReadCoordinator: deps.homeReadCoordinator }
    : undefined);
  registerWriteResourceTool(server, service, deps);
  registerBacklogWakeupTool(server, service, {
    ...(deps?.operationLogger ? { operationLogger: deps.operationLogger } : {}),
    ...(deps?.readLocalFile ? { readLocalFile: deps.readLocalFile } : {}),
    ...(deps?.identityPath ? { identityPath: deps.identityPath } : {}),
    ...(deps?.visionPath ? { visionPath: deps.visionPath } : {}),
    ...(deps?.mintMemoryEntry
      ? { mintMemoryEntry: deps.mintMemoryEntry }
      : {}),
    ...(deps?.substrateRegistry
      ? { substrateRegistry: deps.substrateRegistry }
      : {}),
    ...(deps?.homeReadCoordinator
      ? { homeReadCoordinator: deps.homeReadCoordinator }
      : {}),
  });
  registerBacklogRecallTool(server, {
    ...(deps?.memoryComposer ? { memoryComposer: deps.memoryComposer } : {}),
    ...(deps?.usageTracker ? { usageTracker: deps.usageTracker } : {}),
    ...(deps?.homeReadCoordinator
      ? { homeReadCoordinator: deps.homeReadCoordinator }
      : {}),
  });
  registerBacklogRememberTool(server, {
    ...(deps?.memoryComposer ? { memoryComposer: deps.memoryComposer } : {}),
    ...(deps?.actor ? { actor: deps.actor } : {}),
    ...(deps?.usageTracker ? { usageTracker: deps.usageTracker } : {}),
  });
  registerBacklogForgetTool(server, deps?.memoryComposer ? { memoryComposer: deps.memoryComposer } : undefined);
  registerBacklogConsolidationTool(server, service,
    deps?.readUsageLines ? { readUsageLines: deps.readUsageLines } : undefined);
  registerBacklogContradictionsTool(server, service);
}
