import type { MemoryComposer } from '@backlog-mcp/memory';
import type {
  BacklogHome,
  BacklogHomeSelector,
} from '../core/backlog-home.types.js';
import type { WriteContext } from '../core/types.js';
import type { MemoryUsageTracker } from '../memory/usage-tracker.js';
import type { OperationLogger } from '../operations/logger.js';
import type { Actor } from '../operations/types.js';
import type { AppRequestRuntime } from '../server/app-request-runtime.types.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { LocalRuntime } from '../storage/local/local-runtime.js';

/** Services owned by one direct CLI command invocation. */
export interface CliRuntime {
  service: IBacklogService;
  writeContext: WriteContext;
  memoryComposer: MemoryComposer;
  usageTracker?: MemoryUsageTracker;
  operationLogger: OperationLogger;
  readUsageLines?: () => string[];
  readIdentity: () => string | undefined;
  resolveSourcePath: (sourcePath: string) => string;
  close: () => Promise<void>;
}

/** Injectable process and construction boundaries for direct CLI tests. */
export interface CliRunnerDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  cwd?: string;
  home?: BacklogHomeSelector;
  projectRoot?: string;
  actor?: () => Actor;
  createLegacyRuntime?: () => CliRuntime;
  createLocalRuntime?: (home: BacklogHome) => LocalRuntime;
  adaptLocalRuntime?: (runtime: LocalRuntime) => AppRequestRuntime;
}
