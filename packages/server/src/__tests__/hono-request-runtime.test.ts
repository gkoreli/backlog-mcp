import type { Entity } from '@backlog-mcp/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  BACKLOG_HOME_HEADER,
  BACKLOG_PROJECT_ROOT_HEADER,
} from '../core/backlog-home.js';
import type { OperationEntry, IOperationLog } from '../operations/types.js';
import {
  createApp,
  selectAppRequestRuntime,
} from '../server/hono-app.js';
import type {
  AppRequestRuntime,
  AppRequestRuntimeResolver,
  AppRequestRuntimeSelection,
} from '../server/app-request-runtime.types.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';

const SHARED_ID = 'TASK-0001';

function createTask(title: string): Entity {
  return {
    id: SHARED_ID,
    title,
    status: 'open',
    type: 'task',
    created_at: '2026-07-16T00:00:00.000Z',
    updated_at: '2026-07-16T00:00:00.000Z',
  };
}

function createService(
  entity: Entity | undefined,
  totalTasks = entity === undefined ? 0 : 1,
): IBacklogService {
  return {
    get: vi.fn(async function get(id) {
      return id === entity?.id ? entity : undefined;
    }),
    getMarkdown: vi.fn(async function getMarkdown(id) {
      return id === entity?.id ? `# ${entity.title}` : null;
    }),
    list: vi.fn(async function list(filter) {
      if (filter?.parent_id !== undefined || entity === undefined) return [];
      return [entity];
    }),
    add: vi.fn(async function add() {}),
    save: vi.fn(async function save() {}),
    delete: vi.fn(async function deleteEntity() {
      return false;
    }),
    counts: vi.fn(async function counts() {
      return {
        total_tasks: totalTasks,
        total_epics: 0,
        by_status: {},
        by_type: {},
      };
    }),
    getMaxId: vi.fn(async function getMaxId() {
      return 0;
    }),
    searchUnified: vi.fn(async function searchUnified() {
      return [];
    }),
  };
}

function createOperationLog(entries: OperationEntry[]): {
  log: IOperationLog;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async function queryOperations() {
    return entries;
  });
  return {
    log: {
      append: vi.fn(function appendOperation() {}),
      query,
      countForTask: vi.fn(async function countForTask() {
        return entries.length;
      }),
    },
    query,
  };
}

function createOperation(resourceId: string): OperationEntry {
  return {
    ts: '2026-07-16T00:00:00.000Z',
    tool: 'backlog_update',
    params: { id: resourceId },
    result: { ok: true },
    resourceId,
    actor: { type: 'agent', name: 'phase-c-test' },
  };
}

describe('selectAppRequestRuntime', function describeRequestSelection() {
  it('prefers bridge headers over viewer query parameters', function prefersHeaders() {
    const selection = selectAppRequestRuntime({
      header: function header(name) {
        if (name === BACKLOG_HOME_HEADER) return 'project';
        if (name === BACKLOG_PROJECT_ROOT_HEADER) return '/header/project';
        return undefined;
      },
      query: function query(name) {
        return name === 'home' ? 'global' : '/query/project';
      },
    });

    expect(selection).toEqual({
      home: 'project',
      projectRoot: '/header/project',
    });
  });
});

describe('createApp request runtimes', function describeRequestRuntimes() {
  it('isolates simultaneous project requests containing the same entity id', async function isolatesProjects() {
    const projectA = '/workspace/project-a';
    const projectB = '/workspace/project-b';
    const runtimes = new Map<string, AppRequestRuntime>([
      [projectA, { service: createService(createTask('Project A task')) }],
      [projectB, { service: createService(createTask('Project B task')) }],
    ]);
    let arrivals = 0;
    let releaseRequests: () => void = function releaseRequests() {};
    const bothRequestsArrived = new Promise<void>(function waitForRequests(resolve) {
      releaseRequests = resolve;
    });
    const resolveRuntime: AppRequestRuntimeResolver = async function resolveRuntime(
      selection,
    ) {
      arrivals += 1;
      if (arrivals === 2) releaseRequests();
      await bothRequestsArrived;
      const runtime = runtimes.get(selection.projectRoot ?? '');
      if (runtime === undefined) {
        throw new Error(`Unexpected project root: ${selection.projectRoot}`);
      }
      return runtime;
    };
    const app = createApp(createService(undefined), { resolveRuntime });

    const [responseA, responseB] = await Promise.all([
      app.request(`/tasks/${SHARED_ID}`, {
        headers: {
          [BACKLOG_HOME_HEADER]: 'project',
          [BACKLOG_PROJECT_ROOT_HEADER]: projectA,
        },
      }),
      app.request(`/tasks/${SHARED_ID}`, {
        headers: {
          [BACKLOG_HOME_HEADER]: 'project',
          [BACKLOG_PROJECT_ROOT_HEADER]: projectB,
        },
      }),
    ]);

    expect(await responseA.json()).toMatchObject({
      id: SHARED_ID,
      title: 'Project A task',
    });
    expect(await responseB.json()).toMatchObject({
      id: SHARED_ID,
      title: 'Project B task',
    });
  });

  it('passes header-selected context to the resolver ahead of query context', async function resolvesHeaderContext() {
    const service = createService(createTask('Header-selected task'));
    const resolver = vi.fn(async function resolveRuntime(
      _selection: AppRequestRuntimeSelection,
    ): Promise<AppRequestRuntime> {
      return { service };
    });
    const app = createApp(createService(undefined), {
      resolveRuntime: resolver,
    });

    const response = await app.request(
      `/tasks?home=global&project_root=${encodeURIComponent('/query/project')}`,
      {
        headers: {
          [BACKLOG_HOME_HEADER]: 'project',
          [BACKLOG_PROJECT_ROOT_HEADER]: '/header/project',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(resolver).toHaveBeenCalledWith({
      home: 'project',
      projectRoot: '/header/project',
    });
  });

  it('passes an empty selection for an unscoped request', async function resolvesUnscoped() {
    const service = createService(undefined);
    const resolver = vi.fn(async function resolveRuntime(
      _selection: AppRequestRuntimeSelection,
    ): Promise<AppRequestRuntime> {
      return { service };
    });
    const app = createApp(createService(undefined), {
      resolveRuntime: resolver,
    });

    const response = await app.request('/tasks');

    expect(response.status).toBe(200);
    expect(resolver).toHaveBeenCalledWith({});
  });

  it('preserves the static createApp service path when no resolver is present', async function preservesStaticApp() {
    const app = createApp(createService(createTask('Static task')));

    const response = await app.request(`/tasks/${SHARED_ID}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: SHARED_ID,
      title: 'Static task',
    });
  });

  it('projects memory usage through the selected store mint without changing raw Markdown', async function projectsMemoryUsage() {
    const memory: Entity = {
      id: 'MEMO-0001',
      title: 'Project memory',
      content: 'Memory body',
      type: 'memory',
      layer: 'semantic',
      usage_count: 89,
      last_used_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const selectedService = createService(memory);
    const app = createApp(createService(undefined), {
      resolveRuntime: async function resolveRuntime() {
        return {
          service: selectedService,
          mintMemoryEntry: function mintMemoryEntry(selectedMemory) {
            return {
              id: selectedMemory.id,
              title: selectedMemory.title,
              content: selectedMemory.content,
              layer: selectedMemory.layer,
              source: selectedMemory.source ?? 'unknown',
              createdAt: Date.parse(selectedMemory.created_at),
              metadata: {
                usageCount: 3,
                last_used_at: '2026-07-16T12:00:00.000Z',
              },
            };
          },
        };
      },
    });

    const response = await app.request('/tasks/MEMO-0001', {
      headers: {
        [BACKLOG_HOME_HEADER]: 'project',
        [BACKLOG_PROJECT_ROOT_HEADER]: '/workspace/project',
      },
    });

    expect(await response.json()).toMatchObject({
      id: memory.id,
      usage_count: 3,
      last_used_at: '2026-07-16T12:00:00.000Z',
      raw: '# Project memory',
    });
    expect(memory).toMatchObject({
      usage_count: 89,
      last_used_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('uses the selected runtime operation log and service for enrichment', async function selectsOperations() {
    const selectedService = createService(createTask('Selected task'));
    const selectedOperations = createOperationLog([createOperation(SHARED_ID)]);
    const legacyOperations = createOperationLog([createOperation(SHARED_ID)]);
    const app = createApp(createService(createTask('Legacy task')), {
      operationLog: legacyOperations.log,
      resolveRuntime: async function resolveRuntime() {
        return {
          service: selectedService,
          operationLog: selectedOperations.log,
        };
      },
    });

    const response = await app.request('/operations', {
      headers: {
        [BACKLOG_HOME_HEADER]: 'project',
        [BACKLOG_PROJECT_ROOT_HEADER]: '/workspace/selected',
      },
    });

    expect(await response.json()).toEqual([
      expect.objectContaining({
        resourceId: SHARED_ID,
        resourceTitle: 'Selected task',
      }),
    ]);
    expect(selectedOperations.query).toHaveBeenCalledOnce();
    expect(legacyOperations.query).not.toHaveBeenCalled();
  });

  it('does not inherit missing runtime-owned dependencies from app deps', async function disablesMissingRuntimeDeps() {
    const legacyOperations = createOperationLog([createOperation(SHARED_ID)]);
    const app = createApp(createService(undefined), {
      operationLog: legacyOperations.log,
      resolveRuntime: async function resolveRuntime() {
        return { service: createService(undefined) };
      },
    });

    const response = await app.request('/operations');

    expect(await response.json()).toEqual([]);
    expect(legacyOperations.query).not.toHaveBeenCalled();
  });
});
