import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryComposer, MemoryEntry } from '@backlog-mcp/memory';
import type { Memory } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { Actor, IOperationLog } from '../operations/types.js';
import type { MemoryUsageTracker } from '../memory/usage-tracker.js';
import type { HomeReadCoordinator } from '../core/home-read-coordinator.types.js';
import type {
  IntentRegistryPort,
  IntentWriteValidatorPort,
} from '../core/substrates/index.js';
import type { ProjectSubstrateRegistry } from '../core/substrates/project-substrate-registry.js';
import { registerBacklogListTool } from './backlog-list.js';
import { registerBacklogGetTool } from './backlog-get.js';
import { registerBacklogDeleteTool } from './backlog-delete.js';
import { registerBacklogSearchTool } from './backlog-search.js';
import { registerBacklogWakeupTool } from './backlog-wakeup.js';
import { registerBacklogRecallTool } from './backlog-recall.js';
import { registerBacklogRememberTool } from './backlog-remember.js';
import { registerBacklogForgetTool } from './backlog-forget.js';
import { registerBacklogConsolidationTool } from './backlog-consolidation.js';
import { registerBacklogContradictionsTool } from './backlog-contradictions.js';
import { registerWriteResourceTool } from './backlog-write-resource.js';
import { registerSubstrateIntents } from './register-substrate-intents.js';
import type { SubstrateIntentQuarantineDiagnostic } from './register-substrate-intents.types.js';

export type IntentToolRegistration =
  | {
    mode: 'required';
    intentRegistry: IntentRegistryPort;
    intentWriteValidator: IntentWriteValidatorPort;
    reportIntentQuarantine: (
      diagnostic: SubstrateIntentQuarantineDiagnostic,
    ) => void;
  }
  | {
    mode: 'unavailable';
    reason: 'constrained-runtime';
  };

/** Per-request dependencies for the static and registry-declared MCP tools. */
export interface ToolDeps {
  resourceManager?: any;
  operationLogger?: any;
  actor?: Actor;
  operationLog?: IOperationLog;
  substrateRegistry?: Pick<
    ProjectSubstrateRegistry,
    'acceptsParent' | 'getIntake'
  >;
  scopeRoot?: string;
  eventBus?: { emit: (event: any) => void };
  memoryComposer?: MemoryComposer;
  mintMemoryEntry?: (memory: Memory) => MemoryEntry;
  readLocalFile?: (filePath: string) => string | null;
  usageTracker?: MemoryUsageTracker;
  identityPath?: string;
  /** Absolute path to NORTH-STAR.md. Docs-native only (ADR 0113 C.2). */
  visionPath?: string;
  readUsageLines?: () => string[];
  homeReadCoordinator?: HomeReadCoordinator;
  intentRegistration?: IntentToolRegistration;
}

function requireIntentRegistration(
  deps: ToolDeps | undefined,
): IntentToolRegistration {
  const registration = deps?.intentRegistration;
  if (
    registration?.mode === 'required'
    && registration.intentRegistry !== undefined
    && registration.intentWriteValidator !== undefined
    && registration.reportIntentQuarantine !== undefined
  ) {
    return registration;
  }
  if (
    registration?.mode === 'unavailable'
    && registration.reason === 'constrained-runtime'
  ) {
    return registration;
  }
  throw new Error(
    'MCP tool registration requires an explicit complete intent registration mode',
  );
}

/** Register the request-selected static reads and semantic write intents. */
export function registerTools(
  server: McpServer,
  service: IBacklogService,
  deps?: ToolDeps,
): void {
  const intentRegistration = requireIntentRegistration(deps);
  registerBacklogListTool(server, service);
  registerBacklogGetTool(server, service, deps?.usageTracker
    ? { usageTracker: deps.usageTracker }
    : undefined);
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
  registerBacklogForgetTool(
    server,
    deps?.memoryComposer ? { memoryComposer: deps.memoryComposer } : undefined,
  );
  registerBacklogConsolidationTool(
    server,
    service,
    deps?.readUsageLines ? { readUsageLines: deps.readUsageLines } : undefined,
  );
  registerBacklogContradictionsTool(server, service);
  if (intentRegistration.mode === 'required') {
    registerSubstrateIntents(server, service, {
      intentRegistry: intentRegistration.intentRegistry,
      validator: intentRegistration.intentWriteValidator,
      toolDeps: deps ?? { intentRegistration },
      reportQuarantine: intentRegistration.reportIntentQuarantine,
    });
  }
}
