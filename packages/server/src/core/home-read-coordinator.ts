import {
  mergeCrossHomeRrf,
  type CrossHomeRankedList,
  type CrossHomeRrfResult,
} from '@backlog-mcp/memory/search';
import { recall } from './recall.js';
import { searchItems } from './search.js';
import { ValidationError } from './types.js';
import type {
  RecallParams,
  RecallResult,
  SearchParams,
  SearchResult,
  SearchResultItem,
  WakeupResult,
} from './types.js';
import { wakeup } from './wakeup.js';
import type {
  AvailableHomeReadStatus,
  CrossHomeRecallItem,
  CrossHomeRecallResult,
  CrossHomeSearchResult,
  CrossHomeSearchResultItem,
  CrossHomeWakeupGroup,
  CrossHomeWakeupParams,
  CrossHomeWakeupResult,
  HomeReadCoordinator,
  HomeReadCoordinatorDependencies,
  HomeReadRuntime,
  HomeReadRuntimeSelection,
  HomeReadSelection,
  HomeReadStatus,
  UnavailableHomeReadStatus,
} from './home-read-coordinator.types.js';

const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_RECALL_LIMIT = 10;

interface SelectedHome {
  home: HomeReadRuntimeSelection['home'];
  homeId: string;
  selection: HomeReadRuntimeSelection;
}

interface AvailableHomeExecution<T> {
  available: true;
  runtime: HomeReadRuntime;
  value: T;
}

interface UnavailableHomeExecution {
  available: false;
  home: SelectedHome['home'];
  homeId: string;
  reason: string;
}

type HomeExecution<T> =
  | AvailableHomeExecution<T>
  | UnavailableHomeExecution;

interface RankedSearchCandidate {
  item: SearchResultItem;
  runtime: HomeReadRuntime;
}

interface RankedRecallCandidate {
  item: RecallResult['items'][number];
  runtime: HomeReadRuntime;
}

function compareBytewise(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function selectedHomes(selection: HomeReadSelection = {}): SelectedHome[] {
  const homes: SelectedHome[] = [{
    home: 'global',
    homeId: 'global',
    selection: { home: 'global' },
  }];
  const projectRoot = selection.projectRoot?.trim();
  if (projectRoot !== undefined && projectRoot.length > 0) {
    homes.push({
      home: 'project',
      homeId: projectRoot,
      selection: { home: 'project', projectRoot },
    });
  }
  return homes;
}

function validateSearchQuery(query: string): void {
  if (!query.trim()) throw new ValidationError('Query must not be empty');
}

function validateRecallQuery(query: string): void {
  if (!query.trim()) throw new ValidationError('query is required');
}

function errorReason(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : error.name;
  }
  const reason = String(error).trim();
  return reason.length > 0 ? reason : 'Unknown error';
}

function executionHomeId<T>(execution: HomeExecution<T>): string {
  return execution.available ? execution.runtime.home.id : execution.homeId;
}

function compareExecutions<T>(
  left: HomeExecution<T>,
  right: HomeExecution<T>,
): number {
  return compareBytewise(executionHomeId(left), executionHomeId(right));
}

async function settleHomes<T>(
  selection: HomeReadSelection | undefined,
  deps: HomeReadCoordinatorDependencies,
  run: (runtime: HomeReadRuntime) => Promise<T>,
): Promise<HomeExecution<T>[]> {
  const homes = selectedHomes(selection);

  async function execute(selected: SelectedHome): Promise<HomeExecution<T>> {
    const runtime = await deps.resolveRuntime(selected.selection);
    if (runtime.home.kind !== selected.home) {
      throw new Error(
        `Resolved ${runtime.home.kind} runtime for ${selected.home} home selection`,
      );
    }
    try {
      return {
        available: true,
        runtime,
        value: await run(runtime),
      };
    } catch (error) {
      return {
        available: false,
        home: runtime.home.kind,
        homeId: runtime.home.id,
        reason: errorReason(error),
      };
    }
  }

  const settled = await Promise.allSettled(homes.map(execute));
  const executions: HomeExecution<T>[] = [];
  for (const [index, result] of settled.entries()) {
    const selected = homes[index];
    if (selected === undefined) continue;
    if (result.status === 'fulfilled') {
      executions.push(result.value);
      continue;
    }
    executions.push({
      available: false,
      home: selected.home,
      homeId: selected.homeId,
      reason: errorReason(result.reason),
    });
  }
  return executions.sort(compareExecutions);
}

function unavailableStatus(
  execution: UnavailableHomeExecution,
): UnavailableHomeReadStatus {
  return {
    home: execution.home,
    home_id: execution.homeId,
    available: false,
    reason: execution.reason,
  };
}

function availableStatus<T>(
  execution: AvailableHomeExecution<T>,
  searchMode?: string,
): AvailableHomeReadStatus {
  return {
    home: execution.runtime.home.kind,
    home_id: execution.runtime.home.id,
    available: true,
    ...(searchMode === undefined ? {} : { search_mode: searchMode }),
  };
}

function readStatuses<T>(
  executions: readonly HomeExecution<T>[],
): HomeReadStatus[] {
  const statuses: HomeReadStatus[] = [];
  for (const execution of executions) {
    statuses.push(
      execution.available
        ? availableStatus(execution)
        : unavailableStatus(execution),
    );
  }
  return statuses;
}

function searchStatuses(
  executions: readonly HomeExecution<SearchResult>[],
): HomeReadStatus[] {
  const statuses: HomeReadStatus[] = [];
  for (const execution of executions) {
    statuses.push(
      execution.available
        ? availableStatus(execution, execution.value.search_mode)
        : unavailableStatus(execution),
    );
  }
  return statuses;
}

function safeSourcePath(
  runtime: HomeReadRuntime,
  id: string,
): string | undefined {
  try {
    return runtime.getSourcePath?.(id);
  } catch {
    return undefined;
  }
}

function searchSourcePath(candidate: RankedSearchCandidate): string | undefined {
  if (
    candidate.item.type === 'resource'
    && candidate.item.path !== undefined
  ) {
    return candidate.item.path;
  }
  return safeSourcePath(candidate.runtime, candidate.item.id);
}

function searchCandidateId(candidate: RankedSearchCandidate): string {
  return candidate.item.id;
}

function recallCandidateId(candidate: RankedRecallCandidate): string {
  return candidate.item.id;
}

function toCrossHomeSearchItem(
  result: CrossHomeRrfResult<RankedSearchCandidate>,
): CrossHomeSearchResultItem {
  const sourcePath = searchSourcePath(result.item);
  return {
    ...result.item.item,
    score: result.rrfScore,
    home: result.item.runtime.home.kind,
    home_id: result.homeId,
    ...(sourcePath === undefined ? {} : { source_path: sourcePath }),
    within_home_rank: result.withinHomeRank,
  };
}

function toCrossHomeRecallItem(
  result: CrossHomeRrfResult<RankedRecallCandidate>,
): CrossHomeRecallItem {
  const sourcePath = safeSourcePath(
    result.item.runtime,
    result.item.item.id,
  );
  return {
    ...result.item.item,
    score: result.rrfScore,
    home: result.item.runtime.home.kind,
    home_id: result.homeId,
    ...(sourcePath === undefined ? {} : { source_path: sourcePath }),
    within_home_rank: result.withinHomeRank,
  };
}

function searchLists(
  executions: readonly HomeExecution<SearchResult>[],
): CrossHomeRankedList<RankedSearchCandidate>[] {
  const lists: CrossHomeRankedList<RankedSearchCandidate>[] = [];
  for (const execution of executions) {
    if (!execution.available) continue;
    const runtime = execution.runtime;
    const items = execution.value.results.map(
      function addSearchRuntime(item): RankedSearchCandidate {
        return { item, runtime };
      },
    );
    lists.push({
      homeId: runtime.home.id,
      items,
    });
  }
  return lists;
}

function recallLists(
  executions: readonly HomeExecution<RecallResult>[],
): CrossHomeRankedList<RankedRecallCandidate>[] {
  const lists: CrossHomeRankedList<RankedRecallCandidate>[] = [];
  for (const execution of executions) {
    if (!execution.available) continue;
    const runtime = execution.runtime;
    const items = execution.value.items.map(
      function addRecallRuntime(item): RankedRecallCandidate {
        return { item, runtime };
      },
    );
    lists.push({
      homeId: runtime.home.id,
      items,
    });
  }
  return lists;
}

function withoutRecallTokenBudget(params: RecallParams): RecallParams {
  const perHomeParams = { ...params };
  delete perHomeParams.token_budget;
  return perHomeParams;
}

function packRecallItems(
  items: readonly CrossHomeRecallItem[],
  tokenBudget: number | undefined,
): {
  items: CrossHomeRecallItem[];
  truncated: boolean;
} {
  if (tokenBudget === undefined || tokenBudget <= 0) {
    return { items: [...items], truncated: false };
  }

  const packed: CrossHomeRecallItem[] = [];
  let used = 0;
  for (const item of items) {
    const cost = Math.ceil(JSON.stringify(item).length / 4);
    if (packed.length > 0 && used + cost > tokenBudget) break;
    packed.push(item);
    used += cost;
    if (used >= tokenBudget) break;
  }
  return {
    items: packed,
    truncated: packed.length < items.length,
  };
}

function recordRecallDemand(
  executions: readonly HomeExecution<RecallResult>[],
  query: string,
  items: readonly CrossHomeRecallItem[],
): void {
  for (const execution of executions) {
    if (!execution.available) continue;
    const ids = items
      .filter(function ownedByRuntime(item) {
        return item.home_id === execution.runtime.home.id;
      })
      .map(function localId(item) {
        return item.id;
      });
    if (ids.length === 0) continue;
    try {
      execution.runtime.usageTracker?.recordRecall(query, ids);
    } catch {
      // Usage demand is derived telemetry and must not break recall.
    }
  }
}

function wakeupGroups(
  executions: readonly HomeExecution<WakeupResult>[],
): CrossHomeWakeupGroup[] {
  const groups: CrossHomeWakeupGroup[] = [];
  for (const execution of executions) {
    if (!execution.available) continue;
    groups.push({
      home: execution.runtime.home.kind,
      home_id: execution.runtime.home.id,
      briefing: execution.value,
    });
  }
  return groups;
}

/**
 * Create a stateless coordinator for global plus at most one explicit project.
 *
 * The resolver is the only construction seam: no registry, history, current
 * directory, or filesystem discovery is consulted by this module.
 */
export function createHomeReadCoordinator(
  deps: HomeReadCoordinatorDependencies,
): HomeReadCoordinator {
  async function search(
    params: SearchParams,
    selection?: HomeReadSelection,
  ): Promise<CrossHomeSearchResult> {
    validateSearchQuery(params.query);

    async function runSearch(runtime: HomeReadRuntime): Promise<SearchResult> {
      return searchItems(runtime.service, params);
    }

    const executions = await settleHomes(selection, deps, runSearch);
    const merged = mergeCrossHomeRrf(
      searchLists(executions),
      params.limit ?? DEFAULT_SEARCH_LIMIT,
      searchCandidateId,
    ).map(toCrossHomeSearchItem);

    return {
      results: merged,
      total: merged.length,
      query: params.query,
      search_mode: 'cross-home',
      homes: searchStatuses(executions),
    };
  }

  async function recallAcrossHomes(
    params: RecallParams,
    selection?: HomeReadSelection,
  ): Promise<CrossHomeRecallResult> {
    validateRecallQuery(params.query);
    const perHomeParams = withoutRecallTokenBudget(params);

    async function runRecall(runtime: HomeReadRuntime): Promise<RecallResult> {
      return recall(perHomeParams, {
        ...(runtime.memoryComposer === undefined
          ? {}
          : { memoryComposer: runtime.memoryComposer }),
      });
    }

    const executions = await settleHomes(selection, deps, runRecall);
    const merged = mergeCrossHomeRrf(
      recallLists(executions),
      params.limit ?? DEFAULT_RECALL_LIMIT,
      recallCandidateId,
    ).map(toCrossHomeRecallItem);
    const packed = packRecallItems(merged, params.token_budget);
    const query = params.query.trim();
    recordRecallDemand(executions, query, packed.items);

    return {
      items: packed.items,
      total: packed.items.length,
      query,
      ...(packed.truncated ? { truncated: true } : {}),
      homes: readStatuses(executions),
    };
  }

  async function wakeupAcrossHomes(
    params: CrossHomeWakeupParams = {},
    selection?: HomeReadSelection,
  ): Promise<CrossHomeWakeupResult> {
    async function runWakeup(runtime: HomeReadRuntime): Promise<WakeupResult> {
      return wakeup(runtime.service, {
        ...params,
        ...(runtime.readIdentity === undefined
          ? {}
          : { readIdentity: runtime.readIdentity }),
        ...(runtime.acceptsParent === undefined
          ? {}
          : { acceptsParent: runtime.acceptsParent }),
        ...(runtime.readOperations === undefined
          ? {}
          : { readOperations: runtime.readOperations }),
        ...(runtime.mintMemoryEntry === undefined
          ? {}
          : { mintMemoryEntry: runtime.mintMemoryEntry }),
      });
    }

    const executions = await settleHomes(selection, deps, runWakeup);
    return {
      groups: wakeupGroups(executions),
      homes: readStatuses(executions),
    };
  }

  return {
    search,
    recall: recallAcrossHomes,
    wakeup: wakeupAcrossHomes,
  };
}
