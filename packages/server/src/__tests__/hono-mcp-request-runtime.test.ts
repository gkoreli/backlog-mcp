import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKLOG_HOME_HEADER,
  BACKLOG_PROJECT_ROOT_HEADER,
} from '../core/backlog-home.js';
import type { AppRequestRuntimeSelection } from '../server/app-request-runtime.types.js';
import { createApp } from '../server/hono-app.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';

const EMPTY_SERVICE = {} as IBacklogService;
const transportRequests = vi.hoisted(function createTransportRequestSpy() {
  return vi.fn();
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', function mockMcpServer() {
  return {
    McpServer: class McpServer {
      registerTool() {}

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
  });

  it('resolves the runtime from call arguments before forwarding the intact body', async function routesExplicitCall() {
    const resolver = vi.fn(async function resolveRuntime(
      _selection: AppRequestRuntimeSelection,
    ) {
      return { service: EMPTY_SERVICE };
    });
    const app = createApp(EMPTY_SERVICE, { resolveRuntime: resolver });
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
});
