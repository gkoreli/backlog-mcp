import { describe, expect, it, vi } from 'vitest';
import {
  BACKLOG_HOME_HEADER,
  BACKLOG_PROJECT_ROOT_HEADER,
} from '../core/backlog-home.js';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type { AppRequestRuntime } from '../server/app-request-runtime.types.js';
import { createApp } from '../server/hono-app.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';

const PROJECT_ROOT = '/workspace/address';
const PROJECT_HEADERS = {
  [BACKLOG_HOME_HEADER]: 'project',
  [BACKLOG_PROJECT_ROOT_HEADER]: PROJECT_ROOT,
};
const TASK_URI = 'mcp://backlog/docs/tasks/archive/TASK-0092-human-name.md';
const TASK_PATH = `${PROJECT_ROOT}/docs/tasks/archive/TASK-0092-human-name.md`;

function createService(): IBacklogService {
  const unsupported = vi.fn(async function unsupported() {
    throw new Error('not exercised');
  });
  return {
    get: unsupported,
    getMarkdown: unsupported,
    list: unsupported,
    add: unsupported,
    save: unsupported,
    delete: unsupported,
    counts: unsupported,
    getMaxId: unsupported,
    searchUnified: unsupported,
    // The one entity → document hop (ADR 0129.1 R2): storage knows the file.
    getResourceUri: vi.fn(function getResourceUri(id: string) {
      return id === 'TASK-0092' ? TASK_URI : null;
    }),
  };
}

function createRuntime(service: IBacklogService): AppRequestRuntime {
  const home: BacklogHome = {
    kind: 'project',
    id: PROJECT_ROOT,
    root: PROJECT_ROOT,
    documentsDir: `${PROJECT_ROOT}/docs`,
    controlDir: `${PROJECT_ROOT}/.backlog`,
  };
  const resourceManager = {
    read: vi.fn(function read(uri: string) {
      if (uri !== TASK_URI) throw new Error(`Resource not found: ${uri}`);
      return { content: '# Human-named task', frontmatter: { id: 'TASK-0092' }, mimeType: 'text/markdown' };
    }),
    resolve: vi.fn(function resolve(uri: string) {
      if (uri !== TASK_URI) throw new Error(`Resource not found: ${uri}`);
      return TASK_PATH;
    }),
  };
  return {
    home,
    service,
    resourceManager: resourceManager as unknown as AppRequestRuntime['resourceManager'],
  } as AppRequestRuntime;
}

function createAddressApp() {
  const service = createService();
  const runtime = createRuntime(service);
  const app = createApp(service, {
    resolveRuntime: async function resolveRuntime() {
      return runtime;
    },
  });
  return { app, service, runtime };
}

describe('GET /mcp/resource — one document address (ADR 0129.1)', function describeDocumentAddress() {
  it('resolves an entity id through the service to its real file, wherever it lives', async function resolvesEntityId() {
    const { app, service, runtime } = createAddressApp();

    const response = await app.request('/mcp/resource?address=TASK-0092', { headers: PROJECT_HEADERS });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      content: '# Human-named task',
      frontmatter: { id: 'TASK-0092' },
      path: TASK_PATH,
      mcpUri: TASK_URI,
      home: 'project',
    });
    expect(service.getResourceUri).toHaveBeenCalledWith('TASK-0092');
    expect(runtime.resourceManager?.read).toHaveBeenCalledWith(TASK_URI);
  });

  it('still serves a resource URI, through the uri alias too', async function servesResourceUri() {
    const { app, service } = createAddressApp();

    const byAddress = await app.request(`/mcp/resource?address=${encodeURIComponent(TASK_URI)}`, { headers: PROJECT_HEADERS });
    const byUri = await app.request(`/mcp/resource?uri=${encodeURIComponent(TASK_URI)}`, { headers: PROJECT_HEADERS });

    expect(byAddress.status).toBe(200);
    expect(byUri.status).toBe(200);
    expect(service.getResourceUri).not.toHaveBeenCalled();
  });

  it('fails closed on an unknown id with a named reason, never a synthesized path', async function failsClosed() {
    const { app, runtime } = createAddressApp();

    const response = await app.request('/mcp/resource?address=TASK-9999', { headers: PROJECT_HEADERS });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Resource not found',
      address: 'TASK-9999',
      message: 'No document for TASK-9999 in this home',
    });
    expect(runtime.resourceManager?.read).not.toHaveBeenCalled();
  });

  it('rejects a missing address', async function rejectsMissing() {
    const { app } = createAddressApp();
    const response = await app.request('/mcp/resource', { headers: PROJECT_HEADERS });
    expect(response.status).toBe(400);
  });
});
