import type {
  MemoryComposer,
  MemoryEntry,
} from '@backlog-mcp/memory';
import type { Memory } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { BacklogHome } from './backlog-home.types.js';
import type {
  RecallItem,
  RecallParams,
  SearchParams,
  SearchResultItem,
  WakeupParams,
  WakeupResult,
} from './types.js';

/** The bounded caller context used to select global plus one project home. */
export interface HomeReadSelection {
  projectRoot?: string;
}

/** One explicit runtime selection passed to the injected resolver. */
export type HomeReadRuntimeSelection =
  | { home: 'global' }
  | { home: 'project'; projectRoot: string };

/** Weak recall-demand recorder owned by one selected home runtime. */
export interface HomeRecallDemandRecorder {
  recordRecall: (query: string, returnedIds: string[]) => void;
}

/**
 * The runtime surface required by cross-home read composition.
 *
 * Every dependency remains home-owned. The coordinator does not discover,
 * enumerate, construct, cache, or inspect runtimes outside this interface.
 */
export interface HomeReadRuntime {
  home: BacklogHome;
  service: IBacklogService;
  memoryComposer?: MemoryComposer;
  usageTracker?: HomeRecallDemandRecorder;
  getSourcePath?: (id: string) => string | undefined;
  readIdentity?: () => string | undefined;
  readOperations?: WakeupParams['readOperations'];
  mintMemoryEntry?: (memory: Memory) => MemoryEntry;
}

/** Resolve one explicitly selected home runtime for the current request. */
export type HomeReadRuntimeResolver = (
  selection: HomeReadRuntimeSelection,
) => Promise<HomeReadRuntime>;

/** Construction dependencies for the stateless coordinator. */
export interface HomeReadCoordinatorDependencies {
  resolveRuntime: HomeReadRuntimeResolver;
}

/** Stable provenance attached to every cross-home merged item. */
export interface CrossHomeItemProvenance {
  home: BacklogHome['kind'];
  home_id: string;
  source_path?: string;
  within_home_rank: number;
}

/** One home that successfully served the requested production pipeline. */
export interface AvailableHomeReadStatus {
  home: BacklogHome['kind'];
  home_id: string;
  available: true;
  search_mode?: string;
}

/** One selected home that could not serve, with an error-derived reason. */
export interface UnavailableHomeReadStatus {
  home: BacklogHome['kind'];
  home_id: string;
  available: false;
  reason: string;
}

/** Per-home availability reported in deterministic home-id order. */
export type HomeReadStatus =
  | AvailableHomeReadStatus
  | UnavailableHomeReadStatus;

/** One fused search result. `score` is always the cross-home RRF score. */
export interface CrossHomeSearchResultItem
  extends SearchResultItem, CrossHomeItemProvenance {
  score: number;
}

/** Search response composed from the selected home runtimes. */
export interface CrossHomeSearchResult {
  results: CrossHomeSearchResultItem[];
  total: number;
  query: string;
  search_mode: 'cross-home';
  homes: HomeReadStatus[];
}

/** One fused recall result. The required score is the cross-home RRF score. */
export interface CrossHomeRecallItem
  extends Omit<RecallItem, 'score'>, CrossHomeItemProvenance {
  score: number;
}

/** Recall response composed and optionally token-packed after cross-home merge. */
export interface CrossHomeRecallResult {
  items: CrossHomeRecallItem[];
  total: number;
  query: string;
  truncated?: boolean;
  homes: HomeReadStatus[];
}

/** Cross-home wakeup parameters; runtime-owned readers are not caller inputs. */
export type CrossHomeWakeupParams = Omit<
  WakeupParams,
  'readIdentity' | 'readOperations' | 'mintMemoryEntry'
>;

/** One unmerged wakeup briefing grouped under its owning home. */
export interface CrossHomeWakeupGroup {
  home: BacklogHome['kind'];
  home_id: string;
  briefing: WakeupResult;
}

/** Wakeup response with independent per-home groups and availability. */
export interface CrossHomeWakeupResult {
  groups: CrossHomeWakeupGroup[];
  homes: HomeReadStatus[];
}

/** Request-scoped, transport-free cross-home read operations. */
export interface HomeReadCoordinator {
  search: (
    params: SearchParams,
    selection?: HomeReadSelection,
  ) => Promise<CrossHomeSearchResult>;
  recall: (
    params: RecallParams,
    selection?: HomeReadSelection,
  ) => Promise<CrossHomeRecallResult>;
  wakeup: (
    params?: CrossHomeWakeupParams,
    selection?: HomeReadSelection,
  ) => Promise<CrossHomeWakeupResult>;
}
