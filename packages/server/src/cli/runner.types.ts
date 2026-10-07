import type {
  MemoryComposer,
  MemoryEntry,
} from '@backlog-mcp/memory';
import type { Memory } from '@backlog-mcp/shared';
import type {
  BacklogHome,
  BacklogHomeSelector,
} from '../core/backlog-home.types.js';
import type { LocalHomeResolutionParams } from '../storage/local/backlog-home.types.js';
import type { WakeupGrounding, WriteContext } from '../core/types.js';
import type { MemoryUsageTracker } from '../memory/usage-tracker.js';
import type { OperationLogger } from '../operations/logger.js';
import type { Actor } from '../core/operation-log.contract.js';
import type { AppRequestRuntime } from '../composition/app-request-runtime.types.js';
import type { WriteProvenance } from '../composition/write-provenance.js';
import type { IBacklogService } from '../core/backlog-service.contract.js';
import type { LocalRuntime } from '../storage/local/local-runtime.js';
import type { IntentRegistryPort, IntentWriteValidatorPort } from '../core/substrates/index.js';

/** CLI-only selector; `all` is accepted by the three bounded read commands. */
export type CliHomeSelector = BacklogHomeSelector | 'all';

/** Services owned by one direct CLI command invocation. */
export interface CliRuntime {
  home?: BacklogHome;
  service: IBacklogService;
  intentRegistry?: IntentRegistryPort;
  intentValidator?: IntentWriteValidatorPort;
  writeContext: WriteContext;
  memoryComposer: MemoryComposer;
  mintMemoryEntry?: (memory: Memory, now?: number) => MemoryEntry;
  usageTracker?: MemoryUsageTracker;
  operationLogger: OperationLogger;
  readUsageLines?: () => string[];
  readIdentity: () => string | undefined;
  /** Vision-doc loader (NORTH-STAR.md) — undefined off docs-native homes. */
  readVision?: () => string | undefined;
  /** First-impression grounding reader (charter Slices A/B). */
  readGrounding?: () => WakeupGrounding | undefined;
  getSourcePath?: (id: string) => string | undefined;
  /** Where writes landed (ADR 0134.1 R4.2). Absent without a docs-native home. */
  writeProvenance?: WriteProvenance;
  close: () => Promise<void>;
}

/** Injectable process and construction boundaries for direct CLI tests. */
export interface CliRunnerDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  cwd?: string;
  home?: CliHomeSelector;
  projectRoot?: string;
  /** Invocation-specific selection; runtime construction consumes one resolved home. */
  resolveHome?: (params: LocalHomeResolutionParams) => BacklogHome;
  actor?: () => Actor;
  createLocalRuntime?: (home: BacklogHome) => LocalRuntime;
  adaptLocalRuntime?: (runtime: LocalRuntime) => AppRequestRuntime;
}
