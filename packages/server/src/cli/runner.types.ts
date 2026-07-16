import type {
  MemoryComposer,
  MemoryEntry,
} from '@backlog-mcp/memory';
import type { Memory } from '@backlog-mcp/shared';
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

/** CLI-only selector; `all` is accepted by the three bounded read commands. */
export type CliHomeSelector = BacklogHomeSelector | 'all';

/** Services owned by one direct CLI command invocation. */
export interface CliRuntime {
  home?: BacklogHome;
  service: IBacklogService;
  writeContext: WriteContext;
  memoryComposer: MemoryComposer;
  mintMemoryEntry?: (memory: Memory) => MemoryEntry;
  usageTracker?: MemoryUsageTracker;
  operationLogger: OperationLogger;
  readUsageLines?: () => string[];
  readIdentity: () => string | undefined;
  /** Vision-doc loader (NORTH-STAR.md) — undefined off docs-native homes. */
  readVision?: () => string | undefined;
  getSourcePath?: (id: string) => string | undefined;
  resolveSourcePath: (sourcePath: string) => string;
  close: () => Promise<void>;
}

/** Injectable process and construction boundaries for direct CLI tests. */
export interface CliRunnerDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  cwd?: string;
  home?: CliHomeSelector;
  projectRoot?: string;
  actor?: () => Actor;
  createLocalRuntime?: (home: BacklogHome) => LocalRuntime;
  adaptLocalRuntime?: (runtime: LocalRuntime) => AppRequestRuntime;
}
