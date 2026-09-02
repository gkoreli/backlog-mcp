import { describe, expect, it, vi } from 'vitest';
import type { AppRequestRuntime } from '../server/app-request-runtime.types.js';
import { createApp } from '../server/hono-app.js';
import { isLoopbackOrigin } from '../server/loopback-origin.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';

function createService(): IBacklogService {
  const unsupported = vi.fn(async function unsupported() { throw new Error('not exercised'); });
  return {
    get: unsupported, getMarkdown: unsupported, list: unsupported, add: unsupported,
    save: unsupported, delete: unsupported, counts: unsupported, getMaxId: unsupported,
    searchUnified: unsupported,
  };
}

function createReleaseApp(overrides: {
  installed?: string | null;
  requestRestart?: () => void;
  requestShutdown?: () => void;
} = {}) {
  const service = createService();
  const runtime = { service } as AppRequestRuntime;
  const installed = overrides.installed === undefined ? '0.74.0' : overrides.installed;
  return createApp(service, {
    version: '0.73.0',
    resolveRuntime: async function resolveRuntime() { return runtime; },
    readReleaseStatus: overrides.installed === undefined && overrides.requestRestart === undefined && overrides.requestShutdown === undefined
      ? undefined
      : () => ({ running: '0.73.0', installed, updateAvailable: installed === '0.74.0' }),
    requestRestart: overrides.requestRestart,
    requestShutdown: overrides.requestShutdown,
  });
}

describe('isLoopbackOrigin (ADR 0131 R3)', () => {
  it('accepts absent and loopback origins, rejects everything else', () => {
    expect(isLoopbackOrigin(undefined)).toBe(true);
    expect(isLoopbackOrigin('http://localhost:3030')).toBe(true);
    expect(isLoopbackOrigin('http://127.0.0.1:3030')).toBe(true);
    expect(isLoopbackOrigin('https://evil.example')).toBe(false);
    expect(isLoopbackOrigin('http://localhost.evil.example')).toBe(false);
    expect(isLoopbackOrigin('null')).toBe(false);
  });
});

describe('GET /api/release (ADR 0131 R1/R4)', () => {
  it('reports the running process against the install on disk', async () => {
    const app = createReleaseApp({ installed: '0.74.0', requestRestart: () => {} });
    expect(await (await app.request('/api/release')).json()).toEqual({
      running: '0.73.0', installed: '0.74.0', updateAvailable: true, canRestart: true,
    });
  });

  it('degrades to "nothing known" without the Node seams', async () => {
    const app = createReleaseApp();
    expect(await (await app.request('/api/release')).json()).toEqual({
      running: '0.73.0', installed: null, updateAvailable: false, canRestart: false,
    });
  });
});

describe('POST /api/restart and /shutdown (ADR 0131 R2/R3)', () => {
  it('accepts a loopback restart and invokes the handover seam once', async () => {
    const requestRestart = vi.fn();
    const app = createReleaseApp({ requestRestart });
    const response = await app.request('/api/restart', { method: 'POST', headers: { origin: 'http://localhost:3030' } });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'restarting' });
    expect(requestRestart).toHaveBeenCalledTimes(1);
  });

  it('rejects foreign origins on restart and shutdown, never invoking the seams', async () => {
    const requestRestart = vi.fn();
    const requestShutdown = vi.fn();
    const app = createReleaseApp({ requestRestart, requestShutdown });
    expect((await app.request('/api/restart', { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await app.request('/shutdown', { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect(requestRestart).not.toHaveBeenCalled();
    expect(requestShutdown).not.toHaveBeenCalled();
  });

  it('is absent when the composition provides no restart seam', async () => {
    const app = createReleaseApp();
    expect((await app.request('/api/restart', { method: 'POST' })).status).toBe(404);
  });
});
