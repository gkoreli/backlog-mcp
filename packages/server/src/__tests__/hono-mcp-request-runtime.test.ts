import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKLOG_HOME_HEADER,
  BACKLOG_PROJECT_ROOT_HEADER,
} from '../core/backlog-home.js';
import type { AppRequestRuntimeSelection } from '../server/app-request-runtime.types.js';
import { createApp } from '../server/hono-app.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { BacklogHome } from '../core/backlog-home.types.js';

const EMPTY_SERVICE = {} as IBacklogService;
const transportRequests = vi.hoisted(function createTransportRequestSpy() {
  return vi.fn();
});
const registeredTools = vi.hoisted(function createToolRegistry() {
  return new Map<string, (
    params: Record<string, unknown>,
  ) => Promise<unknown>>();
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', function mockMcpServer() {
  return {
    McpServer: class McpServer {
      registerTool(
        name: string,
        _metadata: unknown,
        handler: (
          params: Record<string, unknown>,
        ) => Promise<unknown>,
      ) {
        registeredTools.set(name, handler);
      }

      async connect() {}
    },
  };
});

vi.mock(
  '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js',
  function mockStreamableTransport() {
    return {
      WebStandardStreamableHTTPServerTransport: class StreamableTransport {
        async handleRequest(request: Request): Promise<Response> {
          transportRequests(request);
          const body = await request.clone().json() as {
            method?: string;
            params?: {
              name?: string;
              arguments?: Record<string, unknown>;
            };
          };
          if (
            body.method === 'tools/call'
            && body.params?.name === 'backlog_search'
          ) {
            const handler = registeredTools.get(body.params.name);
            if (handler === undefined) {
              throw new Error('backlog_search handler was not registered');
            }
            return Response.json(await handler(
              body.params.arguments ?? {},
            ));
          }
          return new Response(await request.text(), {
            headers: { 'content-type': 'application/json' },
          });
        }
      },
    };
  },
);

describe('/mcp explicit tool home selection', function describeMcpRouting() {
  beforeEach(function resetTransportSpy() {
    transportRequests.mockClear();
    registeredTools.clear();
  });

  it('resolves the runtime from call arguments before forwarding the intact body', async function routesExplicitCall() {
    const resolver = vi.fn(async function resolveRuntime(
      _selection: AppRequestRuntimeSelection,
    ) {
      return {
        service: EMPTY_SERVICE,
        intentRegistrationMode: 'unavailable' as const,
      };
    });
    const app = createApp(EMPTY_SERVICE, {
      resolveRuntime: resolver,
      logError: vi.fn(),
    });
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'backlog_list',
        arguments: {
          home: 'global',
        },
      },
    });

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [BACKLOG_HOME_HEADER]: 'project',
        [BACKLOG_PROJECT_ROOT_HEADER]: '/bridge/project',
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(resolver).toHaveBeenCalledWith({ home: 'global' });
    expect(transportRequests).toHaveBeenCalledOnce();
    expect(await response.text()).toBe(body);
  });

  it('fails before transport when a writable runtime has incomplete intent ports', async function rejectsIncompleteIntentRuntime() {
    const resolver = vi.fn(async function resolveRuntime() {
      return {
        service: EMPTY_SERVICE,
        intentRegistrationMode: 'required' as const,
      };
    });
    const app = createApp(EMPTY_SERVICE, {
      resolveRuntime: resolver,
      logError: vi.fn(),
    });
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    });

    expect(response.status).toBe(500);
    expect(transportRequests).not.toHaveBeenCalled();
  });

  it('executes home:all search through global plus the bridged project runtime', async function coordinatesAllSearch() {
    function home(kind: 'global' | 'project', id: string): BacklogHome {
      return {
        kind,
        id,
        root: id === 'global' ? '/global' : id,
        documentsDir: id === 'global' ? '/global/docs' : `${id}/docs`,
        controlDir: id === 'global'
          ? '/global'
          : `${id}/.backlog`,
      };
    }
    function searchService(id: string): IBacklogService {
      return {
        searchUnified: vi.fn(async function searchUnified() {
          return [{
            item: {
              id,
              title: id,
              type: 'task',
              status: 'open',
              created_at: '2026-07-16T00:00:00.000Z',
              updated_at: '2026-07-16T00:00:00.000Z',
            },
            score: 1,
            type: 'task',
          }];
        }),
        isHybridSearchActive: function isHybridSearchActive() {
          return false;
        },
      } as IBacklogService;
    }

    const resolver = vi.fn(async function resolveRuntime(
      selection: AppRequestRuntimeSelection,
    ) {
      if (selection.home === 'project') {
        return {
          home: home('project', '/workspace/project'),
          service: searchService('TASK-PROJECT'),
          getSourcePath: function getSourcePath() {
            return 'tasks/TASK-PROJECT.md';
          },
        };
      }
      return {
        home: home('global', 'global'),
        service: searchService('TASK-GLOBAL'),
        getSourcePath: function getSourcePath() {
          return 'tasks/TASK-GLOBAL.md';
        },
      };
    });
    const app = createApp(EMPTY_SERVICE, { resolveRuntime: resolver });
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [BACKLOG_HOME_HEADER]: 'project',
        [BACKLOG_PROJECT_ROOT_HEADER]: '/workspace/project',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'backlog_search',
          arguments: {
            home: 'all',
            query: 'task',
            limit: 2,
          },
        },
      }),
    });

    const toolResult = await response.json() as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    const result = JSON.parse(toolResult.content[0]?.text ?? '{}') as {
      results?: Array<{
        id: string;
        home_id: string;
        source_path: string;
      }>;
      search_mode?: string;
    };

    expect(toolResult.isError).not.toBe(true);
    expect(result.search_mode).toBe('cross-home');
    expect(result.results).toEqual([
      expect.objectContaining({
        id: 'TASK-PROJECT',
        home_id: '/workspace/project',
        source_path: 'tasks/TASK-PROJECT.md',
      }),
      expect.objectContaining({
        id: 'TASK-GLOBAL',
        home_id: 'global',
        source_path: 'tasks/TASK-GLOBAL.md',
      }),
    ]);
    expect(resolver.mock.calls.map(function selection(call) {
      return call[0];
    })).toEqual([
      { home: 'global' },
      { home: 'project', projectRoot: '/workspace/project' },
    ]);
  });

  it('keeps global results when the project runtime is unavailable', async function degradesProject() {
    const globalService = {
      searchUnified: vi.fn(async function searchUnified() {
        return [{
          item: {
            id: 'TASK-GLOBAL',
            title: 'Global result',
            type: 'task',
            status: 'open',
            created_at: '2026-07-16T00:00:00.000Z',
            updated_at: '2026-07-16T00:00:00.000Z',
          },
          score: 1,
          type: 'task',
        }];
      }),
      isHybridSearchActive: function isHybridSearchActive() {
        return false;
      },
    } as IBacklogService;
    const resolver = vi.fn(async function resolveRuntime(
      selection: AppRequestRuntimeSelection,
    ) {
      if (selection.home === 'project') {
        throw new Error('project runtime unavailable');
      }
      return {
        home: {
          kind: 'global' as const,
          id: 'global',
          root: '/global',
          documentsDir: '/global/docs',
          controlDir: '/global',
        },
        service: globalService,
      };
    });
    const app = createApp(EMPTY_SERVICE, { resolveRuntime: resolver });
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [BACKLOG_HOME_HEADER]: 'project',
        [BACKLOG_PROJECT_ROOT_HEADER]: '/workspace/project',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'backlog_search',
          arguments: {
            home: 'all',
            query: 'global',
          },
        },
      }),
    });

    const toolResult = await response.json() as {
      content: Array<{ text: string }>;
    };
    const result = JSON.parse(toolResult.content[0]?.text ?? '{}') as {
      results: Array<{ id: string; home_id: string }>;
      homes: Array<{
        home_id: string;
        available: boolean;
        reason?: string;
      }>;
    };
    expect(result.results).toEqual([
      expect.objectContaining({
        id: 'TASK-GLOBAL',
        home_id: 'global',
      }),
    ]);
    expect(result.homes).toContainEqual({
      home: 'project',
      home_id: '/workspace/project',
      available: false,
      reason: 'project runtime unavailable',
    });
  });
});
