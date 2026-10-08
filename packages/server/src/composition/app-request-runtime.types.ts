import type {
  MemoryComposer,
  MemoryEntry,
} from '@backlog-mcp/memory';
import type { Memory } from '@backlog-mcp/shared';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type { CorpusCheckerPort } from '../core/corpus-check.contract.js';
import type { EventBus } from '../events/event-bus.js';
import type { MemoryUsageTracker } from '../memory/usage-tracker.js';
import type { OperationLogger } from '../operations/logger.js';
import type { Actor, IOperationLog } from '../core/operation-log.contract.js';
import type { ResolvedAgentIdentity } from '../core/identity-resolution.js';
import type { ResourceManager } from '../resources/manager.js';
import type { IBacklogService } from '../core/backlog-service.contract.js';
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
  corpusChecker?: CorpusCheckerPort;
  clock?: () => number;
  home?: BacklogHome;
  service: IBacklogService;
  /** Runtime-home-resolved write actor for a request-selected local home. */
  actor?: Actor;
  /** Runtime-home-resolved identity and disclosure rung (ADR 0119.1 R2). */
  agentIdentity?: ResolvedAgentIdentity;
  operationLog?: IOperationLog;
  operationLogger?: OperationLogger;
  substrateRegistry?: ProjectSubstrateRegistry;
  scopeRoot?: string;
  eventBus?: EventBus;
  memoryComposer?: MemoryComposer;
  mintMemoryEntry?: (memory: Memory, now?: number) => MemoryEntry;
  usageTracker?: MemoryUsageTracker;
  resourceManager?: ResourceManager;
  readLocalFile?: (filePath: string) => string | null;
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

/** Resolve diagnostic capability without acquiring a managed runtime (ADR 0113.4). */
export type CorpusCheckerResolver = (
  selection: AppRequestRuntimeSelection,
) => CorpusCheckerPort | Promise<CorpusCheckerPort>;
