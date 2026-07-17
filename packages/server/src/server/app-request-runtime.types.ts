import type {
  MemoryComposer,
  MemoryEntry,
} from '@backlog-mcp/memory';
import type { Memory } from '@backlog-mcp/shared';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type { EventBus } from '../events/event-bus.js';
import type { MemoryUsageTracker } from '../memory/usage-tracker.js';
import type { OperationLogger } from '../operations/logger.js';
import type { IOperationLog } from '../operations/types.js';
import type { ResourceManager } from '../resources/manager.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { ProjectSubstrateRegistry } from '../core/substrates/project-substrate-registry.js';
import type {
  IntentRegistryPort,
  IntentWriteValidatorPort,
} from '../core/substrates/index.js';
import type { WakeupGrounding } from '../core/types.js';
import type {
  DeskDocument,
  DeskEvaluationCandidateFile,
} from '../core/desk.types.js';

/** Runtime-owned services selected for one transport request. */
export interface AppRequestRuntime {
  home?: BacklogHome;
  service: IBacklogService;
  operationLog?: IOperationLog;
  operationLogger?: OperationLogger;
  substrateRegistry?: ProjectSubstrateRegistry;
  scopeRoot?: string;
  eventBus?: EventBus;
  memoryComposer?: MemoryComposer;
  mintMemoryEntry?: (memory: Memory) => MemoryEntry;
  usageTracker?: MemoryUsageTracker;
  resourceManager?: ResourceManager;
  readLocalFile?: (filePath: string) => string | null;
  resolveSourcePath?: (path: string) => string;
  getSourcePath?: (id: string) => string | undefined;
  readUsageLines?: () => string[];
  identityPath?: string;
  /** Absolute path to the vision doc (NORTH-STAR.md) — docs-native only. */
  visionPath?: string;
  /** First-impression grounding reader (charter Slices A/B) — docs-native only. */
  readGrounding?: () => WakeupGrounding | undefined;
  /** Desk documents reader (attention-viewer V1) — docs-native only. */
  readDeskDocuments?: () => DeskDocument[];
  /** Mined evaluation-candidate files reader — docs-native only. */
  readEvaluationCandidates?: () => DeskEvaluationCandidateFile[];
  intentRegistrationMode: 'required' | 'unavailable';
  intentRegistry?: IntentRegistryPort;
  intentWriteValidator?: IntentWriteValidatorPort;
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
