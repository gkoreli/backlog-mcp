import type { UnifiedSearchResult } from '@backlog-mcp/memory/search';
import type { Entity } from '@backlog-mcp/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  BACKLOG_HOME_HEADER,
  BACKLOG_PROJECT_ROOT_HEADER,
} from '../core/backlog-home.js';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type { IOperationLog, OperationEntry } from '../operations/types.js';
import type { AppRequestRuntime } from '../server/app-request-runtime.types.js';
import { createApp } from '../server/hono-app.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';

const PROJECT_ROOT = '/workspace/provenance';
const PROJECT_HEADERS = {
  [BACKLOG_HOME_HEADER]: 'project',
  [BACKLOG_PROJECT_ROOT_HEADER]: PROJECT_ROOT,
};

const task: Entity = {
  id: 'TASK-0001',
  title: 'Provenance task',
  status: 'open',
  type: 'task',
  created_at: '2026-07-16T00:00:00.000Z',
  updated_at: '2026-07-16T00:00:00.000Z',
};

const child: Entity = {
  id: 'TASK-0002',
  title: 'Provenance child',
  status: 'open',
  type: 'task',
  parent_id: task.id,
  created_at: '2026-07-16T00:00:00.000Z',
  updated_at: '2026-07-16T00:00:00.000Z',
};

const sourcePaths = new Map([
  [task.id, 'tasks/TASK-0001-provenance-task.md'],
  [child.id, 'tasks/TASK-0002-provenance-child.md'],
]);

function createService(): IBacklogService {
  const searchResults: UnifiedSearchResult[] = [
    {
      item: task,
      score: 1,
      type: 'task',
    },
    {
      item: {
        id: 'mcp://backlog/guides/project.md',
        path: 'guides/project.md',
        title: 'Project guide',
        content: 'Guide',
      },
      score: 0.5,
      type: 'resource',
    },
  ];

  return {
    get: vi.fn(async function get(id) {
      if (id === task.id) return task;
      if (id === child.id) return child;
      return undefined;
    }),
    getMarkdown: vi.fn(async function getMarkdown(id) {
      return id === task.id ? '# Provenance task' : null;
    }),
    list: vi.fn(async function list(filter) {
      return filter?.parent_id === task.id ? [child] : [task];
    }),
    add: vi.fn(async function add() {}),
    save: vi.fn(async function save() {}),
    delete: vi.fn(async function deleteEntity() {
      return false;
    }),
    counts: vi.fn(async function counts() {
      return {
        total_tasks: 2,
        total_epics: 0,
        by_status: {},
        by_type: {},
      };
    }),
    getMaxId: vi.fn(async function getMaxId() {
      return 2;
    }),
    searchUnified: vi.fn(async function searchUnified() {
      return searchResults;
    }),
  };
}

function createOperationLog(): IOperationLog {
  const entry: OperationEntry = {
    ts: '2026-07-16T00:00:00.000Z',
    tool: 'backlog_update',
    params: { id: task.id },
    result: { ok: true },
    resourceId: task.id,
    actor: { type: 'agent', name: 'provenance-test' },
  };

  return {
    append: vi.fn(function append() {}),
    query: vi.fn(async function query() {
      return [entry];
    }),
    countForTask: vi.fn(async function countForTask() {
      return 1;
    }),
  };
}

function createRuntime(): AppRequestRuntime {
  const home: BacklogHome = {
    kind: 'project',
    id: PROJECT_ROOT,
    root: PROJECT_ROOT,
    documentsDir: `${PROJECT_ROOT}/docs`,
    controlDir: `${PROJECT_ROOT}/.backlog`,
  };

  return {
    home,
    service: createService(),
    operationLog: createOperationLog(),
    getSourcePath: function getSourcePath(id) {
      return sourcePaths.get(id);
    },
  };
}

describe('docs-native viewer provenance', function describeViewerProvenance() {
  it('annotates entity lists, detail children, and search results', async function annotatesResults() {
    const runtime = createRuntime();
    const app = createApp(createService(), {
      resolveRuntime: async function resolveRuntime() {
        return runtime;
      },
    });

    const tasksResponse = await app.request('/tasks', {
      headers: PROJECT_HEADERS,
    });
    const detailResponse = await app.request(`/tasks/${task.id}`, {
      headers: PROJECT_HEADERS,
    });
    const searchResponse = await app.request('/search?q=project', {
      headers: PROJECT_HEADERS,
    });

    expect(await tasksResponse.json()).toEqual([
      expect.objectContaining({
        id: task.id,
        home: 'project',
        home_id: PROJECT_ROOT,
        source_path: sourcePaths.get(task.id),
      }),
    ]);
    expect(await detailResponse.json()).toMatchObject({
      id: task.id,
      home: 'project',
      home_id: PROJECT_ROOT,
      source_path: sourcePaths.get(task.id),
      children: [
        {
          id: child.id,
          home: 'project',
          home_id: PROJECT_ROOT,
          source_path: sourcePaths.get(child.id),
        },
      ],
    });
    expect(await searchResponse.json()).toEqual([
      expect.objectContaining({
        home: 'project',
        home_id: PROJECT_ROOT,
        source_path: sourcePaths.get(task.id),
      }),
      expect.objectContaining({
        home: 'project',
        home_id: PROJECT_ROOT,
        source_path: 'guides/project.md',
      }),
    ]);
  });

  it('annotates status and operation responses from the selected runtime', async function annotatesRuntimeResponses() {
    const runtime = createRuntime();
    const app = createApp(createService(), {
      resolveRuntime: async function resolveRuntime() {
        return runtime;
      },
    });

    const statusResponse = await app.request('/api/status', {
      headers: PROJECT_HEADERS,
    });
    const countResponse = await app.request(
      `/operations/count/${task.id}`,
      { headers: PROJECT_HEADERS },
    );
    const operationsResponse = await app.request('/operations', {
      headers: PROJECT_HEADERS,
    });

    expect(await statusResponse.json()).toMatchObject({
      home: 'project',
      home_id: PROJECT_ROOT,
      dataDir: `${PROJECT_ROOT}/docs`,
    });
    expect(await countResponse.json()).toMatchObject({
      count: 1,
      home: 'project',
      home_id: PROJECT_ROOT,
      source_path: sourcePaths.get(task.id),
    });
    expect(await operationsResponse.json()).toEqual([
      expect.objectContaining({
        resourceId: task.id,
        home: 'project',
        home_id: PROJECT_ROOT,
        source_path: sourcePaths.get(task.id),
      }),
    ]);
  });

  it('leaves legacy static response shapes unannotated', async function preservesLegacyShape() {
    const app = createApp(createService());

    const response = await app.request('/tasks');
    const results = await response.json();

    expect(results[0]).not.toHaveProperty('home');
    expect(results[0]).not.toHaveProperty('home_id');
    expect(results[0]).not.toHaveProperty('source_path');
  });
});
