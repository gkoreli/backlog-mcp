import type { Entity } from '@backlog-mcp/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { OperationEntry, IOperationLog } from '../operations/types.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { registerBacklogCreateTool } from '../tools/backlog-create.js';
import { registerBacklogListTool } from '../tools/backlog-list.js';
import { registerBacklogRecallTool } from '../tools/backlog-recall.js';
import { registerBacklogSearchTool } from '../tools/backlog-search.js';
import { registerBacklogUpdateTool } from '../tools/backlog-update.js';
import { registerBacklogWakeupTool } from '../tools/backlog-wakeup.js';
import {
  BACKLOG_HOME_INPUT_FIELDS,
  BACKLOG_READ_HOME_INPUT_FIELDS,
} from '../tools/home-input.js';
import { registerTools, type ToolDeps } from '../tools/index.js';
import type { HomeReadCoordinator } from '../core/home-read-coordinator.types.js';

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function captureHandler(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | undefined;
  const server = {
    registerTool(
      _name: string,
      _meta: unknown,
      registeredHandler: ToolHandler,
    ) {
      handler = registeredHandler;
    },
  } as unknown as McpServer;
  register(server);
  if (handler === undefined) throw new Error('tool did not register a handler');
  return handler;
}

function createOperationDeps(): {
  deps: ToolDeps;
  append: ReturnType<typeof vi.fn>;
} {
  const append = vi.fn(function appendOperation(_entry: OperationEntry) {});
  const operationLog: IOperationLog = {
    append,
    query: vi.fn(async function queryOperations() {
      return [];
    }),
    countForTask: vi.fn(async function countForTask() {
      return 0;
    }),
  };
  return {
    deps: {
      actor: { type: 'agent', name: 'home-input-test' },
      operationLog,
    },
    append,
  };
}

function task(title = 'Existing task'): Entity {
  return {
    id: 'TASK-0001',
    title,
    status: 'open',
    type: 'task',
    created_at: '2026-07-16T00:00:00.000Z',
    updated_at: '2026-07-16T00:00:00.000Z',
  };
}

function inputShape(meta: unknown): Record<string, z.ZodType> {
  if (typeof meta !== 'object' || meta === null || !('inputSchema' in meta)) {
    throw new Error('tool metadata has no input schema');
  }
  const inputSchema = meta.inputSchema;
  if (
    typeof inputSchema !== 'object'
    || inputSchema === null
    || !('shape' in inputSchema)
    || typeof inputSchema.shape !== 'object'
    || inputSchema.shape === null
  ) {
    throw new Error('tool input schema has no object shape');
  }
  return inputSchema.shape as Record<string, z.ZodType>;
}

describe('backlog MCP home inputs', function describeHomeInputs() {
  const schema = z.object(BACKLOG_HOME_INPUT_FIELDS);
  const readSchema = z.object(BACKLOG_READ_HOME_INPUT_FIELDS);

  it('reserves home:all for the three bounded read verbs', function validatesHomeInputs() {
    expect(schema.safeParse({ home: 'global' }).success).toBe(true);
    expect(schema.safeParse({ home: 'project', project_root: '/workspace/project' }).success).toBe(true);
    expect(schema.safeParse({ home: 'all' }).success).toBe(false);
    expect(readSchema.safeParse({ home: 'all' }).success).toBe(true);
    expect(schema.safeParse({ project_root: '' }).success).toBe(false);
    expect(readSchema.safeParse({ project_root: '' }).success).toBe(false);
  });

  it('adds the shared transport fields to every backlog tool schema', function coversEveryTool() {
    const metadata = new Map<string, unknown>();
    const server = {
      registerTool(name: string, meta: unknown) {
        metadata.set(name, meta);
      },
    } as unknown as McpServer;

    registerTools(server, {} as IBacklogService);

    expect([...metadata.keys()].sort()).toEqual([
      'backlog_consolidation_candidates',
      'backlog_contradictions',
      'backlog_create',
      'backlog_delete',
      'backlog_forget',
      'backlog_get',
      'backlog_list',
      'backlog_recall',
      'backlog_remember',
      'backlog_search',
      'backlog_update',
      'backlog_wakeup',
      'write_resource',
    ]);
    const crossHomeTools = new Set([
      'backlog_recall',
      'backlog_search',
      'backlog_wakeup',
    ]);
    for (const [name, meta] of metadata) {
      const shape = inputShape(meta);
      expect(shape.home?.safeParse('project').success).toBe(true);
      expect(shape.home?.safeParse('all').success).toBe(
        crossHomeTools.has(name),
      );
      expect(shape.project_root?.safeParse('/workspace/project').success).toBe(true);
    }
  });

  it('routes home:all search through the coordinator', async function coordinatesSearch() {
    const localSearch = vi.fn();
    const service = {
      searchUnified: localSearch,
    } as unknown as IBacklogService;
    const search = vi.fn(async function searchAcrossHomes() {
      return {
        results: [],
        total: 0,
        query: 'needle',
        search_mode: 'cross-home' as const,
        homes: [],
      };
    });
    const coordinator = {
      search,
      recall: vi.fn(),
      wakeup: vi.fn(),
    } as unknown as HomeReadCoordinator;
    const handler = captureHandler(function register(server) {
      registerBacklogSearchTool(server, service, {
        homeReadCoordinator: coordinator,
      });
    });

    const response = await handler({
      home: 'all',
      project_root: '/workspace/project',
      query: 'needle',
      limit: 3,
    });

    expect(response.isError).not.toBe(true);
    expect(search).toHaveBeenCalledWith(
      { query: 'needle', limit: 3 },
      { projectRoot: '/workspace/project' },
    );
    expect(localSearch).not.toHaveBeenCalled();
  });

  it('routes home:all recall without double-recording demand', async function coordinatesRecall() {
    const recordRecall = vi.fn();
    const recall = vi.fn(async function recallAcrossHomes() {
      return {
        items: [],
        total: 0,
        query: 'memory',
        homes: [],
      };
    });
    const coordinator = {
      search: vi.fn(),
      recall,
      wakeup: vi.fn(),
    } as unknown as HomeReadCoordinator;
    const handler = captureHandler(function register(server) {
      registerBacklogRecallTool(server, {
        homeReadCoordinator: coordinator,
        usageTracker: { recordRecall } as never,
      });
    });

    const response = await handler({
      home: 'all',
      project_root: '/workspace/project',
      query: 'memory',
      token_budget: 200,
    });

    expect(response.isError).not.toBe(true);
    expect(recall).toHaveBeenCalledWith(
      { query: 'memory', token_budget: 200 },
      { projectRoot: '/workspace/project' },
    );
    expect(recordRecall).not.toHaveBeenCalled();
  });

  it('routes home:all wakeup as grouped briefings', async function coordinatesWakeup() {
    const localList = vi.fn();
    const service = {
      list: localList,
    } as unknown as IBacklogService;
    const wakeup = vi.fn(async function wakeupAcrossHomes() {
      return {
        groups: [],
        homes: [],
      };
    });
    const coordinator = {
      search: vi.fn(),
      recall: vi.fn(),
      wakeup,
    } as unknown as HomeReadCoordinator;
    const handler = captureHandler(function register(server) {
      registerBacklogWakeupTool(server, service, {
        homeReadCoordinator: coordinator,
      });
    });

    const response = await handler({
      home: 'all',
      project_root: '/workspace/project',
      max_activity: 2,
    });

    expect(response.isError).not.toBe(true);
    expect(wakeup).toHaveBeenCalledWith(
      { maxActivity: 2 },
      { projectRoot: '/workspace/project' },
    );
    expect(localList).not.toHaveBeenCalled();
  });

  it('strips home fields before backlog_list reaches service filters', async function stripsListFields() {
    const list = vi.fn(async function listEntities() {
      return [];
    });
    const service = { list } as unknown as IBacklogService;
    const handler = captureHandler(function register(server) {
      registerBacklogListTool(server, service);
    });

    await handler({
      home: 'project',
      project_root: '/workspace/project',
      status: ['open'],
      limit: 5,
    });

    expect(list).toHaveBeenCalledWith({
      status: ['open'],
      limit: 5,
      parent_id: undefined,
    });
  });

  it('strips home fields from backlog_create core and mutation params', async function stripsCreateFields() {
    const add = vi.fn(async function addEntity(entity: Entity) {
      return entity;
    });
    const service = {
      allocateId: vi.fn(async function allocateId() {
        return 'TASK-0001';
      }),
      add,
    } as unknown as IBacklogService;
    const { deps, append } = createOperationDeps();
    const handler = captureHandler(function register(server) {
      registerBacklogCreateTool(server, service, deps);
    });

    const response = await handler({
      home: 'project',
      project_root: '/workspace/project',
      title: 'Transport-safe create',
    });

    expect(response.isError).not.toBe(true);
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0]?.[0]).not.toHaveProperty('home');
    expect(add.mock.calls[0]?.[0]).not.toHaveProperty('project_root');
    const entry = append.mock.calls[0]?.[0] as OperationEntry | undefined;
    expect(entry?.params).not.toHaveProperty('home');
    expect(entry?.params).not.toHaveProperty('project_root');
  });

  it('strips home fields from backlog_update core and mutation params', async function stripsUpdateFields() {
    const save = vi.fn(async function saveEntity(entity: Entity) {
      return entity;
    });
    const service = {
      get: vi.fn(async function getEntity() {
        return task();
      }),
      save,
    } as unknown as IBacklogService;
    const { deps, append } = createOperationDeps();
    const handler = captureHandler(function register(server) {
      registerBacklogUpdateTool(server, service, deps);
    });

    const response = await handler({
      home: 'project',
      project_root: '/workspace/project',
      id: 'TASK-0001',
      title: 'Updated task',
    });

    expect(response.isError).not.toBe(true);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'TASK-0001',
      title: 'Updated task',
    }));
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('home');
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('project_root');
    const entry = append.mock.calls[0]?.[0] as OperationEntry | undefined;
    expect(entry?.params).toEqual({
      id: 'TASK-0001',
      title: 'Updated task',
    });
  });
});
