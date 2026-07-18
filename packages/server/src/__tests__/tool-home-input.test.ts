import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { registerBacklogListTool } from '../tools/backlog-list.js';
import { registerBacklogRecallTool } from '../tools/backlog-recall.js';
import { registerBacklogSearchTool } from '../tools/backlog-search.js';
import { registerBacklogWakeupTool } from '../tools/backlog-wakeup.js';
import { registerBacklogContradictionsTool } from '../tools/backlog-contradictions.js';
import {
  BACKLOG_HOME_INPUT_FIELDS,
  BACKLOG_READ_HOME_INPUT_FIELDS,
} from '../tools/home-input.js';
import { registerTools } from '../tools/index.js';
import type { HomeReadCoordinator } from '../core/home-read-coordinator.types.js';
import {
  RESERVED_TOOL_NAMES,
  STATIC_TOOL_NAMES,
} from '../server/tool-name-reservations.js';

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

    registerTools(server, {} as IBacklogService, {
      intentRegistration: {
        mode: 'unavailable',
        reason: 'constrained-runtime',
      },
    });

    expect([...metadata.keys()].sort()).toEqual(STATIC_TOOL_NAMES);
    expect(metadata.get('write_resource')).toMatchObject({
      _meta: {
        'anthropic/alwaysLoad': false,
      },
    });
    expect(metadata.get('backlog_wakeup')).toMatchObject({
      _meta: {
        'anthropic/alwaysLoad': true,
      },
    });
    for (const [name, meta] of metadata) {
      if (name === 'backlog_wakeup') continue;
      // Tenet 8 permits exactly one always-visible MCP door. Removing that
      // door breaks the Cold-Open Test; adding another spends baseline context.
      expect(meta).not.toMatchObject({
        _meta: {
          'anthropic/alwaysLoad': true,
        },
      });
    }
    const crossHomeTools = new Set([
      'backlog_recall',
      'backlog_search',
      'backlog_wakeup',
    ]);
    const attributedWriteTools = new Set([
      'backlog_delete',
      'backlog_remember',
      'write_resource',
    ]);
    for (const [name, meta] of metadata) {
      const shape = inputShape(meta);
      expect(shape.home?.safeParse('project').success).toBe(true);
      expect(shape.home?.safeParse('all').success).toBe(
        crossHomeTools.has(name),
      );
      expect(shape.project_root?.safeParse('/workspace/project').success).toBe(true);
      expect(shape.as !== undefined).toBe(attributedWriteTools.has(name));
      if (shape.as !== undefined) {
        expect(shape.as.safeParse('aime:granite').success).toBe(true);
      }
    }
  });

  it('retires generic write names without allowing declarations to reclaim them', function preservesTombstones() {
    expect(STATIC_TOOL_NAMES).not.toEqual(
      expect.arrayContaining(['backlog_create', 'backlog_update']),
    );
    expect(RESERVED_TOOL_NAMES).toEqual(
      expect.arrayContaining(['backlog_create', 'backlog_update']),
    );
  });

  it('switches to collision candidates only when explicitly requested', async function switchesContradictionMode() {
    const service = {
      list: vi.fn(async function list() { return []; }),
      searchUnified: vi.fn(async function search() { return []; }),
    } as unknown as IBacklogService;
    const handler = captureHandler(function register(server) {
      registerBacklogContradictionsTool(server, service);
    });

    const defaultResponse = await handler({});
    const candidateResponse = await handler({ candidates: true });

    expect(JSON.parse(defaultResponse.content[0]?.text ?? '{}')).toEqual({
      groups: [], total_live_keyed: 0, contradiction_count: 0,
    });
    expect(JSON.parse(candidateResponse.content[0]?.text ?? '{}')).toEqual({
      pairs: [], total_live_memories: 0, focal_count: 0, candidate_count: 0,
    });
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
});
