import {
  MemoryComposer,
  type ForgetFilter,
  type MemoryEntry,
  type MemoryResult,
  type MemoryStore,
  type RecallQuery,
} from '@backlog-mcp/memory';
import {
  RRF_K,
  type UnifiedSearchResult,
} from '@backlog-mcp/memory/search';
import {
  EntityType,
  type Entity,
  type Memory,
} from '@backlog-mcp/shared';
import {
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { createHomeReadCoordinator } from '../core/home-read-coordinator.js';
import type {
  HomeReadRuntime,
  HomeReadRuntimeResolver,
  HomeReadRuntimeSelection,
  HomeRecallDemandRecorder,
} from '../core/home-read-coordinator.types.js';
import { ValidationError } from '../core/types.js';
import type {
  IBacklogService,
  ListFilter,
} from '../storage/backlog-service.contract.js';

const NOW = '2026-07-16T12:00:00.000Z';

interface ServiceOptions {
  searchResults?: UnifiedSearchResult[];
  searchError?: Error;
  hybrid?: boolean;
  list?: (filter?: ListFilter) => Promise<Entity[]>;
}

interface RuntimeOptions extends ServiceOptions {
  composer?: MemoryComposer;
  usageTracker?: HomeRecallDemandRecorder;
  sourcePaths?: Readonly<Record<string, string>>;
  readIdentity?: () => string | undefined;
  readOperations?: HomeReadRuntime['readOperations'];
  mintMemoryEntry?: HomeReadRuntime['mintMemoryEntry'];
}

class RankedMemoryStore implements MemoryStore {
  readonly name: string;

  constructor(
    name: string,
    private readonly results: readonly MemoryResult[],
  ) {
    this.name = name;
  }

  async store(entry: MemoryEntry): Promise<MemoryEntry> {
    return entry;
  }

  async recall(query: RecallQuery): Promise<MemoryResult[]> {
    const limit = query.limit ?? this.results.length;
    return this.results.slice(0, limit);
  }

  async forget(_filter: ForgetFilter): Promise<number> {
    return 0;
  }

  async size(): Promise<number> {
    return this.results.length;
  }
}

function task(id: string, title = id): Entity {
  return {
    id,
    title,
    type: 'task',
    status: 'open',
    created_at: NOW,
    updated_at: NOW,
  };
}

function memoryEntity(id: string, title = id): Memory {
  return {
    id,
    title,
    content: `${title} body`,
    type: 'memory',
    layer: 'semantic',
    source: 'test',
    created_at: NOW,
    updated_at: NOW,
  };
}

function memoryEntry(id: string, title = id): MemoryEntry {
  return {
    id,
    title,
    content: `${title} body`,
    layer: 'episodic',
    source: 'test',
    createdAt: Date.parse(NOW),
  };
}

function rankedMemory(id: string, score: number): MemoryResult {
  return {
    entry: memoryEntry(id),
    score,
  };
}

function composer(
  name: string,
  results: readonly MemoryResult[],
): MemoryComposer {
  const value = new MemoryComposer();
  value.register('episodic', new RankedMemoryStore(name, results));
  return value;
}

function searchResult(id: string, score: number): UnifiedSearchResult {
  return {
    item: task(id),
    score,
    type: 'task',
  };
}

function createService(options: ServiceOptions = {}): IBacklogService {
  const list = options.list
    ?? async function listEmpty(): Promise<Entity[]> {
      return [];
    };

  return {
    get: vi.fn(async function get(): Promise<Entity | undefined> {
      return undefined;
    }),
    getMarkdown: vi.fn(async function getMarkdown(): Promise<string | null> {
      return null;
    }),
    list: vi.fn(list),
    add: vi.fn(async function add(): Promise<void> {}),
    save: vi.fn(async function save(): Promise<void> {}),
    delete: vi.fn(async function deleteEntity(): Promise<boolean> {
      return false;
    }),
    counts: vi.fn(async function counts() {
      return {
        total_tasks: 0,
        total_epics: 0,
        by_status: {},
        by_type: {},
      };
    }),
    getMaxId: vi.fn(async function getMaxId(): Promise<number> {
      return 0;
    }),
    searchUnified: vi.fn(async function searchUnified() {
      if (options.searchError !== undefined) throw options.searchError;
      return options.searchResults ?? [];
    }),
    isHybridSearchActive: function isHybridSearchActive(): boolean {
      return options.hybrid === true;
    },
  };
}

function createRuntime(
  kind: 'global' | 'project',
  id: string,
  options: RuntimeOptions = {},
): HomeReadRuntime {
  const sourcePaths = options.sourcePaths ?? {};
  return {
    home: {
      kind,
      id,
      root: id === 'global' ? '/global' : id,
      documentsDir: id === 'global' ? '/global/docs' : `${id}/docs`,
      controlDir: id === 'global'
        ? '/global'
        : `${id}/.backlog`,
    },
    service: createService(options),
    ...(options.composer === undefined
      ? {}
      : { memoryComposer: options.composer }),
    ...(options.usageTracker === undefined
      ? {}
      : { usageTracker: options.usageTracker }),
    getSourcePath: function getSourcePath(entityId) {
      return sourcePaths[entityId];
    },
    ...(options.readIdentity === undefined
      ? {}
      : { readIdentity: options.readIdentity }),
    ...(options.readOperations === undefined
      ? {}
      : { readOperations: options.readOperations }),
    ...(options.mintMemoryEntry === undefined
      ? {}
      : { mintMemoryEntry: options.mintMemoryEntry }),
  };
}

function resolverFor(
  globalRuntime: HomeReadRuntime,
  projectRuntime?: HomeReadRuntime,
): Mock<HomeReadRuntimeResolver> {
  return vi.fn(async function resolveRuntime(
    selection: HomeReadRuntimeSelection,
  ): Promise<HomeReadRuntime> {
    if (selection.home === 'global') return globalRuntime;
    if (projectRuntime !== undefined) return projectRuntime;
    throw new Error(`No project runtime for ${selection.projectRoot}`);
  });
}

function resultIdentities(
  items: readonly { home_id: string; id: string }[],
): string[] {
  return items.map(function identity(item) {
    return `${item.home_id}:${item.id}`;
  });
}

function recallCost(item: object): number {
  return Math.ceil(JSON.stringify(item).length / 4);
}

function demandRecorder(): {
  tracker: HomeRecallDemandRecorder;
  recordRecall: Mock<HomeRecallDemandRecorder['recordRecall']>;
  recordSearch: Mock<NonNullable<HomeRecallDemandRecorder['recordSearch']>>;
} {
  const recordRecall = vi.fn<HomeRecallDemandRecorder['recordRecall']>();
  const recordSearch = vi.fn<NonNullable<HomeRecallDemandRecorder['recordSearch']>>();
  return {
    tracker: { recordRecall, recordSearch },
    recordRecall,
    recordSearch,
  };
}

describe('home read coordinator', function describeHomeReadCoordinator() {
  it('selects only global plus one explicit project and fairly merges size-skewed search ranks', async function mergesSizeSkew() {
    const globalRuntime = createRuntime('global', 'global', {
      hybrid: true,
      searchResults: [
        searchResult('G-1', 999),
        searchResult('G-2', 998),
        searchResult('G-3', 997),
        searchResult('G-4', 996),
      ],
      sourcePaths: {
        'G-1': 'tasks/G-1.md',
        'G-2': 'tasks/G-2.md',
        'G-3': 'tasks/G-3.md',
        'G-4': 'tasks/G-4.md',
      },
    });
    const projectRuntime = createRuntime('project', 'project', {
      searchResults: [searchResult('P-1', 0.001)],
      sourcePaths: { 'P-1': 'tasks/P-1.md' },
    });
    const resolveRuntime = resolverFor(globalRuntime, projectRuntime);
    const coordinator = createHomeReadCoordinator({ resolveRuntime });

    const result = await coordinator.search({
      query: 'ranked',
      limit: 4,
      include_scores: true,
    }, {
      projectRoot: 'project',
    });

    expect(resolveRuntime).toHaveBeenCalledTimes(2);
    expect(resolveRuntime.mock.calls.map(function selection(call) {
      return call[0];
    })).toEqual([
      { home: 'global' },
      { home: 'project', projectRoot: 'project' },
    ]);
    expect(resultIdentities(result.results)).toEqual([
      'global:G-1',
      'project:P-1',
      'global:G-2',
      'global:G-3',
    ]);
    expect(result.results.map(function score(item) {
      return item.score;
    })).toEqual([
      1 / (RRF_K + 1),
      1 / (RRF_K + 1),
      1 / (RRF_K + 2),
      1 / (RRF_K + 3),
    ]);
    expect(result.results.map(function rank(item) {
      return item.within_home_rank;
    })).toEqual([1, 1, 2, 3]);
    expect(result.results[0]).toMatchObject({
      home: 'global',
      home_id: 'global',
      source_path: 'tasks/G-1.md',
      score: 1 / (RRF_K + 1),
    });
    expect(result.search_mode).toBe('cross-home');
    expect(result.homes).toEqual([
      {
        home: 'global',
        home_id: 'global',
        available: true,
        search_mode: 'hybrid',
      },
      {
        home: 'project',
        home_id: 'project',
        available: true,
        search_mode: 'bm25',
      },
    ]);
  });

  it('keeps duplicate local IDs distinct and exposes fused search score without include_scores', async function preservesDuplicateIds() {
    const globalRuntime = createRuntime('global', 'global', {
      searchResults: [searchResult('TASK-0001', 0.9)],
    });
    const projectRuntime = createRuntime('project', 'project', {
      searchResults: [searchResult('TASK-0001', 100)],
    });
    const coordinator = createHomeReadCoordinator({
      resolveRuntime: resolverFor(globalRuntime, projectRuntime),
    });

    const result = await coordinator.search(
      { query: 'duplicate', limit: 2 },
      { projectRoot: 'project' },
    );

    expect(resultIdentities(result.results)).toEqual([
      'global:TASK-0001',
      'project:TASK-0001',
    ]);
    expect(result.results).toHaveLength(2);
    expect(result.results.every(function hasRrfScore(item) {
      return item.score === 1 / (RRF_K + 1);
    })).toBe(true);
  });

  it('returns the complete equal-score cutoff tier', async function completesCutoffTier() {
    const globalRuntime = createRuntime('global', 'global', {
      searchResults: [
        searchResult('G-1', 1),
        searchResult('G-2', 0.9),
        searchResult('G-3', 0.8),
      ],
    });
    const projectRuntime = createRuntime('project', 'project', {
      searchResults: [
        searchResult('P-1', 1),
        searchResult('P-2', 0.9),
        searchResult('P-3', 0.8),
      ],
    });
    const coordinator = createHomeReadCoordinator({
      resolveRuntime: resolverFor(globalRuntime, projectRuntime),
    });

    const result = await coordinator.search(
      { query: 'tier', limit: 3 },
      { projectRoot: 'project' },
    );

    expect(resultIdentities(result.results)).toEqual([
      'global:G-1',
      'project:P-1',
      'global:G-2',
      'project:P-2',
    ]);
    expect(result.total).toBe(4);
  });

  it('reports a zero-result home as available with its own search mode', async function reportsEmptyAvailable() {
    const globalRuntime = createRuntime('global', 'global', {
      searchResults: [searchResult('G-1', 1)],
    });
    const projectRuntime = createRuntime('project', 'project', {
      hybrid: true,
      searchResults: [],
    });
    const coordinator = createHomeReadCoordinator({
      resolveRuntime: resolverFor(globalRuntime, projectRuntime),
    });

    const result = await coordinator.search(
      { query: 'empty' },
      { projectRoot: 'project' },
    );

    expect(resultIdentities(result.results)).toEqual(['global:G-1']);
    expect(result.homes).toContainEqual({
      home: 'project',
      home_id: 'project',
      available: true,
      search_mode: 'hybrid',
    });
  });

  it('keeps a ready home when another degrades and reports the error-derived reason', async function reportsDegradedHome() {
    const globalRuntime = createRuntime('global', 'global', {
      searchResults: [searchResult('G-1', 1)],
    });
    const projectRuntime = createRuntime('project', 'project', {
      searchError: new Error('project index unavailable'),
    });
    const coordinator = createHomeReadCoordinator({
      resolveRuntime: resolverFor(globalRuntime, projectRuntime),
    });

    const result = await coordinator.search(
      { query: 'degraded' },
      { projectRoot: 'project' },
    );

    expect(resultIdentities(result.results)).toEqual(['global:G-1']);
    expect(result.homes).toEqual([
      {
        home: 'global',
        home_id: 'global',
        available: true,
        search_mode: 'bm25',
      },
      {
        home: 'project',
        home_id: 'project',
        available: false,
        reason: 'project index unavailable',
      },
    ]);
  });

  it('reports canonical home identity after a resolved pipeline degrades', async function canonicalizesDegradedHome() {
    const globalRuntime = createRuntime('global', 'global', {
      searchResults: [searchResult('G-1', 1)],
    });
    const projectRuntime = createRuntime(
      'project',
      '/canonical/project',
      {
        searchError: new Error('project search failed'),
      },
    );
    const coordinator = createHomeReadCoordinator({
      resolveRuntime: resolverFor(globalRuntime, projectRuntime),
    });

    const result = await coordinator.search(
      { query: 'canonical' },
      { projectRoot: '/alias/../project' },
    );

    expect(result.homes).toContainEqual({
      home: 'project',
      home_id: '/canonical/project',
      available: false,
      reason: 'project search failed',
    });
  });

  it('orders provenance and statuses bytewise regardless of resolver completion order', async function stabilizesOrder() {
    const globalRuntime = createRuntime('global', 'global', {
      searchResults: [searchResult('G-1', 1)],
    });
    const projectRuntime = createRuntime('project', 'A-project', {
      searchResults: [searchResult('P-1', 1)],
    });
    const resolveRuntime = vi.fn(async function resolveOutOfOrder(
      selection: HomeReadRuntimeSelection,
    ): Promise<HomeReadRuntime> {
      if (selection.home === 'global') {
        await Promise.resolve();
        return globalRuntime;
      }
      return projectRuntime;
    });
    const coordinator = createHomeReadCoordinator({ resolveRuntime });

    const result = await coordinator.search(
      { query: 'stable', limit: 2 },
      { projectRoot: 'A-project' },
    );

    expect(resultIdentities(result.results)).toEqual([
      'A-project:P-1',
      'global:G-1',
    ]);
    expect(result.homes.map(function homeId(status) {
      return status.home_id;
    })).toEqual(['A-project', 'global']);
  });

  it('packs recall after fusion and records demand only for final visible items on owning runtimes', async function packsAndPartitionsRecall() {
    const globalDemand = demandRecorder();
    const projectDemand = demandRecorder();
    const globalRuntime = createRuntime('global', 'global', {
      composer: composer('global', [
        rankedMemory('MEMO-G1', 1),
        rankedMemory('MEMO-G2', 0.9),
      ]),
      usageTracker: globalDemand.tracker,
      sourcePaths: {
        'MEMO-G1': 'memories/MEMO-G1.md',
        'MEMO-G2': 'memories/MEMO-G2.md',
      },
    });
    const projectRuntime = createRuntime('project', 'project', {
      composer: composer('project', [
        rankedMemory('MEMO-P1', 500),
        rankedMemory('MEMO-P2', 400),
      ]),
      usageTracker: projectDemand.tracker,
      sourcePaths: {
        'MEMO-P1': 'memories/MEMO-P1.md',
        'MEMO-P2': 'memories/MEMO-P2.md',
      },
    });
    const coordinator = createHomeReadCoordinator({
      resolveRuntime: resolverFor(globalRuntime, projectRuntime),
    });

    const unbounded = await coordinator.recall(
      { query: 'memory', limit: 4 },
      { projectRoot: 'project' },
    );
    const first = unbounded.items[0];
    const second = unbounded.items[1];
    if (first === undefined || second === undefined) {
      throw new Error('Expected at least two fused recall items');
    }
    const budget = recallCost(first) + recallCost(second);
    globalDemand.recordRecall.mockClear();
    projectDemand.recordRecall.mockClear();

    const result = await coordinator.recall(
      { query: ' memory ', limit: 4, token_budget: budget },
      { projectRoot: 'project' },
    );

    expect(resultIdentities(result.items)).toEqual([
      'global:MEMO-G1',
      'project:MEMO-P1',
    ]);
    expect(result.items.map(function score(item) {
      return item.score;
    })).toEqual([
      1 / (RRF_K + 1),
      1 / (RRF_K + 1),
    ]);
    expect(result.items.map(function rank(item) {
      return item.within_home_rank;
    })).toEqual([1, 1]);
    expect(result.items[0]).toMatchObject({
      home: 'global',
      home_id: 'global',
      source_path: 'memories/MEMO-G1.md',
    });
    expect(result.query).toBe('memory');
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(true);
    expect(globalDemand.recordRecall).toHaveBeenCalledOnce();
    expect(globalDemand.recordRecall).toHaveBeenCalledWith(
      'memory',
      ['MEMO-G1'],
    );
    expect(projectDemand.recordRecall).toHaveBeenCalledOnce();
    expect(projectDemand.recordRecall).toHaveBeenCalledWith(
      'memory',
      ['MEMO-P1'],
    );
  });

  it('records a per-home recall miss when a consulted home returns nothing (ADR 0121 R7)', async function recordsRecallMiss() {
    const globalDemand = demandRecorder();
    const projectDemand = demandRecorder();
    const globalRuntime = createRuntime('global', 'global', {
      composer: composer('global', [rankedMemory('MEMO-G1', 0.9)]),
      usageTracker: globalDemand.tracker,
    });
    const projectRuntime = createRuntime('project', 'project', {
      composer: composer('project', []),
      usageTracker: projectDemand.tracker,
    });
    const coordinator = createHomeReadCoordinator({
      resolveRuntime: resolverFor(globalRuntime, projectRuntime),
    });

    await coordinator.recall(
      { query: 'memory', limit: 4 },
      { projectRoot: 'project' },
    );

    expect(globalDemand.recordRecall).toHaveBeenCalledWith(
      'memory',
      ['MEMO-G1'],
    );
    // The empty home still records: ids [] is the first-class miss event
    // and the promotion lane's cross-home demand signal.
    expect(projectDemand.recordRecall).toHaveBeenCalledOnce();
    expect(projectDemand.recordRecall).toHaveBeenCalledWith('memory', []);
  });

  it('records per-home search demand — ids only, zero-contribution homes included', async function recordsSearchDemand() {
    const globalDemand = demandRecorder();
    const projectDemand = demandRecorder();
    const globalRuntime = createRuntime('global', 'global', {
      searchResults: [searchResult('G-1', 2), searchResult('G-2', 1)],
      usageTracker: globalDemand.tracker,
    });
    const projectRuntime = createRuntime('project', 'project', {
      searchResults: [],
      usageTracker: projectDemand.tracker,
    });
    const coordinator = createHomeReadCoordinator({
      resolveRuntime: resolverFor(globalRuntime, projectRuntime),
    });

    await coordinator.search(
      { query: 'ranked', limit: 4 },
      { projectRoot: 'project' },
    );

    expect(globalDemand.recordSearch).toHaveBeenCalledOnce();
    expect(globalDemand.recordSearch).toHaveBeenCalledWith(['G-1', 'G-2']);
    expect(projectDemand.recordSearch).toHaveBeenCalledOnce();
    expect(projectDemand.recordSearch).toHaveBeenCalledWith([]);
    // Search demand is Tier-1 telemetry only: never the recall overlay.
    expect(globalDemand.recordRecall).not.toHaveBeenCalled();
  });

  it('keeps wakeup briefings grouped per home without cross-home fusion', async function groupsWakeup() {
    function wakeupRuntime(
      kind: 'global' | 'project',
      id: string,
      label: string,
    ): HomeReadRuntime {
      const active = {
        ...task(`TASK-${label}`, `${label} active`),
        status: 'in_progress' as const,
      };
      const knowledge = memoryEntity(`MEMO-${label}`, `${label} knowledge`);
      async function list(filter?: ListFilter): Promise<Entity[]> {
        if (
          filter?.status?.includes('in_progress')
          && filter.type === undefined
        ) {
          return [active];
        }
        if (filter?.type === EntityType.Memory) return [knowledge];
        return [];
      }
      return createRuntime(kind, id, {
        list,
        readIdentity: function readIdentity() {
          return `${label} identity`;
        },
        readOperations: function readOperations() {
          return [{
            ts: NOW,
            tool: 'backlog_update',
            params: { id: active.id },
            resourceId: active.id,
            actor: { type: 'agent', name: label },
          }];
        },
        mintMemoryEntry: function mintMemoryEntry(): MemoryEntry {
          return {
            ...memoryEntry(knowledge.id, knowledge.title),
            layer: 'semantic',
          };
        },
      });
    }

    const globalRuntime = wakeupRuntime('global', 'global', 'GLOBAL');
    const projectRuntime = wakeupRuntime('project', 'project', 'PROJECT');
    const coordinator = createHomeReadCoordinator({
      resolveRuntime: resolverFor(globalRuntime, projectRuntime),
    });

    const result = await coordinator.wakeup(
      { maxCompletions: 0, maxActivity: 1, maxKnowledge: 5 },
      { projectRoot: 'project' },
    );

    expect(result.groups.map(function summarize(group) {
      return {
        home_id: group.home_id,
        identity: group.briefing.identity,
        active: group.briefing.now.active_tasks.map(function id(item) {
          return item.id;
        }),
        knowledge: group.briefing.knowledge.map(function id(item) {
          return item.id;
        }),
        actors: group.briefing.recent.activity.map(function actor(item) {
          return item.actor;
        }),
      };
    })).toEqual([
      {
        home_id: 'global',
        identity: 'GLOBAL identity',
        active: ['TASK-GLOBAL'],
        knowledge: ['MEMO-GLOBAL'],
        actors: ['GLOBAL'],
      },
      {
        home_id: 'project',
        identity: 'PROJECT identity',
        active: ['TASK-PROJECT'],
        knowledge: ['MEMO-PROJECT'],
        actors: ['PROJECT'],
      },
    ]);
    expect(result.homes).toEqual([
      {
        home: 'global',
        home_id: 'global',
        available: true,
      },
      {
        home: 'project',
        home_id: 'project',
        available: true,
      },
    ]);
  });

  it('rejects invalid search and recall queries before resolving any home', async function validatesBeforeFanout() {
    const resolveRuntime = resolverFor(
      createRuntime('global', 'global'),
    );
    const coordinator = createHomeReadCoordinator({ resolveRuntime });

    await expect(coordinator.search({ query: '   ' }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(coordinator.recall({ query: '' }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(resolveRuntime).not.toHaveBeenCalled();
  });
});
