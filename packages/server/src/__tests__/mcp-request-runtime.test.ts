import { describe, expect, it } from 'vitest';
import { selectMcpRequestRuntime } from '../server/mcp-request-runtime.js';

function toolsCall(argumentsValue: Record<string, unknown>): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'backlog_list',
        arguments: argumentsValue,
      },
    }),
  });
}

describe('selectMcpRequestRuntime', function describeMcpSelection() {
  it('lets explicit call arguments override inherited header/query selection', async function overridesInherited() {
    const request = toolsCall({
      home: 'project',
      project_root: '/call/project',
    });

    await expect(selectMcpRequestRuntime(request, {
      home: 'global',
      projectRoot: '/bridge/project',
    })).resolves.toEqual({
      home: 'project',
      projectRoot: '/call/project',
    });
  });

  it('clears an inherited project root for an explicit global home', async function clearsProjectRoot() {
    const request = toolsCall({ home: 'global' });

    await expect(selectMcpRequestRuntime(request, {
      home: 'project',
      projectRoot: '/bridge/project',
    })).resolves.toEqual({ home: 'global' });
  });

  it('lets an explicit project home inherit the bridge project root', async function inheritsProjectRoot() {
    const request = toolsCall({ home: 'project' });

    await expect(selectMcpRequestRuntime(request, {
      home: 'global',
      projectRoot: '/bridge/project',
    })).resolves.toEqual({
      home: 'project',
      projectRoot: '/bridge/project',
    });
  });

  it('infers project home from an explicit project_root', async function infersProjectHome() {
    const request = toolsCall({ project_root: '/call/project' });

    await expect(selectMcpRequestRuntime(request, {
      home: 'global',
    })).resolves.toEqual({
      home: 'project',
      projectRoot: '/call/project',
    });
  });

  it('preserves home:all with the explicit or inherited project root', async function preservesAll() {
    await expect(selectMcpRequestRuntime(
      toolsCall({ home: 'all', project_root: '/call/project' }),
      { home: 'global', projectRoot: '/bridge/project' },
    )).resolves.toEqual({
      home: 'all',
      projectRoot: '/call/project',
    });

    await expect(selectMcpRequestRuntime(
      toolsCall({ home: 'all' }),
      { home: 'project', projectRoot: '/bridge/project' },
    )).resolves.toEqual({
      home: 'all',
      projectRoot: '/bridge/project',
    });

    await expect(selectMcpRequestRuntime(
      toolsCall({ home: 'all' }),
      { home: 'global' },
    )).resolves.toEqual({ home: 'all' });
  });

  it('falls back for non-tool JSON, GET requests, and malformed JSON', async function fallsBack() {
    const inherited = {
      home: 'project',
      projectRoot: '/bridge/project',
    };
    const nonTool = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    });
    const get = new Request('http://localhost/mcp');
    const malformed = new Request('http://localhost/mcp', {
      method: 'POST',
      body: '{',
    });

    await expect(selectMcpRequestRuntime(nonTool, inherited)).resolves.toEqual(inherited);
    await expect(selectMcpRequestRuntime(get, inherited)).resolves.toEqual(inherited);
    await expect(selectMcpRequestRuntime(malformed, inherited)).resolves.toEqual(inherited);
  });

  it('leaves the original request body readable', async function preservesBody() {
    const request = toolsCall({ home: 'global' });

    await selectMcpRequestRuntime(request, {
      home: 'project',
      projectRoot: '/bridge/project',
    });

    await expect(request.json()).resolves.toMatchObject({
      method: 'tools/call',
      params: {
        arguments: { home: 'global' },
      },
    });
  });
});
