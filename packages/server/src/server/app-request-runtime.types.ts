import type { MemoryComposer } from '@backlog-mcp/memory';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type { EventBus } from '../events/event-bus.js';
import type { MemoryUsageTracker } from '../memory/usage-tracker.js';
import type { OperationLogger } from '../operations/logger.js';
import type { IOperationLog } from '../operations/types.js';
import type { ResourceManager } from '../resources/manager.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';

/** Runtime-owned services selected for one transport request. */
export interface AppRequestRuntime {
  home?: BacklogHome;
  service: IBacklogService;
  operationLog?: IOperationLog;
  operationLogger?: OperationLogger;
  eventBus?: EventBus;
  memoryComposer?: MemoryComposer;
  usageTracker?: MemoryUsageTracker;
  resourceManager?: ResourceManager;
  readLocalFile?: (filePath: string) => string | null;
  resolveSourcePath?: (path: string) => string;
  getSourcePath?: (id: string) => string | undefined;
  readUsageLines?: () => string[];
  identityPath?: string;
}

/** Explicit caller context extracted from one HTTP request. */
export interface AppRequestRuntimeSelection {
  home?: string;
  projectRoot?: string;
}

/** Resolve the isolated runtime graph for one request. */
export type AppRequestRuntimeResolver = (
  selection: AppRequestRuntimeSelection,
) => Promise<AppRequestRuntime>;
