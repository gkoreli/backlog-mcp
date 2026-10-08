/** MCP checker routing uses in-memory HTTP, injected effects and memfs (ADR 0113.4). */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AppRequestRuntime, AppRequestRuntimeSelection } from '../composition/app-request-runtime.types.js';
import type { CorpusCheckReport } from '../core/corpus-check.contract.js';
import type { IBacklogService } from '../core/backlog-service.contract.js';
import { registerMcpRoute } from '../server/mcp-route.js';
import { BACKLOG_HOME_HEADER, BACKLOG_PROJECT_ROOT_HEADER } from '../core/backlog-home.js';
import { vol } from './helpers/virtual-fs.js';

// This read-only unit never acquires embeddings; importing peer tools must not load model effects.
vi.mock('@huggingface/transformers', function mockModels() {
  return { pipeline: vi.fn(async function forbiddenModel() { throw new Error('Checker must not load a model'); }) };
});

const report: CorpusCheckReport = {
  version: 1, complete: true, valid: false,
  summary: { documents: 1, entities: 1, resources: 0, errors: 1, warnings: 0 },
  diagnostics: [{ code: 'missing-frontmatter', severity: 'error', source_path: 'adr/0001-first.md', message: 'Supply authored metadata.' }],
};

function harness() {
  const app = new Hono();
  const check = vi.fn(function inspect() { return report; });
  const resolveRuntime = vi.fn(async function forbiddenManagedRuntime(): Promise<AppRequestRuntime> {
    throw new Error('Checker must not start a managed runtime');
  });
  const resolveCorpusChecker = vi.fn(async function readonlyChecker(_selection: AppRequestRuntimeSelection) { return { check }; });
  registerMcpRoute(app, {
    staticRuntime: { service: {} as IBacklogService, intentRegistrationMode: 'unavailable' },
    resolveRuntime, resolveCorpusChecker,
  });
  return { app, check, resolveRuntime, resolveCorpusChecker };
}

function request(argumentsValue: Record<string, unknown>): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      [BACKLOG_HOME_HEADER]: 'global', [BACKLOG_PROJECT_ROOT_HEADER]: '/inherited/project' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'backlog_check', arguments: argumentsValue } }),
  });
}

describe('read-only MCP corpus routing', function checkerRouting() {
  it('routes explicit selected-home checking without managed acquisition and returns the core report', async function coldHome() {
    const fixture = harness();
    const before = vol.toJSON();
    const response = await fixture.app.fetch(request({ home: 'project', project_root: '/selected/project' }));
    expect(response.status).toBe(200);
    const payload = await response.json() as { result?: { isError?: boolean; content?: Array<{ type: string; text: string }> } };
    expect(fixture.resolveRuntime).not.toHaveBeenCalled();
    expect(fixture.resolveCorpusChecker).toHaveBeenCalledWith({ home: 'project', projectRoot: '/selected/project' });
    expect(fixture.check).toHaveBeenCalledTimes(1);
    expect(payload.result?.isError).not.toBe(true);
    expect(JSON.parse(payload.result?.content?.[0]?.text ?? '{}')).toEqual(report);
    expect(vol.toJSON()).toEqual(before);
  });

  it('rejects malformed caller home fields without invoking checks or acquiring managed runtimes', async function malformedSelection() {
    const fixture = harness();
    const before = vol.toJSON();
    for (const input of [{ home: 'garbage' }, { home: 'all' }, { project_root: '' }, { project_root: 42 }]) {
      const response = await fixture.app.fetch(request(input));
      const payload = await response.json() as { error?: unknown; result?: { isError?: boolean } };
      expect(payload.error !== undefined || payload.result?.isError === true).toBe(true);
    }
    expect(fixture.check).not.toHaveBeenCalled();
    expect(fixture.resolveRuntime).not.toHaveBeenCalled();
    expect(vol.toJSON()).toEqual(before);
  });

  it('does not substitute a boot-home checker when an explicitly selected home has no resolver', async function unavailableSelectedHome() {
    const app = new Hono();
    const check = vi.fn(function bootHome() { return report; });
    registerMcpRoute(app, { staticRuntime: { service: {} as IBacklogService, intentRegistrationMode: 'unavailable', corpusChecker: { check } } });
    const before = vol.toJSON();
    const response = await app.fetch(request({ home: 'project', project_root: '/other/project' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Corpus checking capability is unavailable in this runtime.' });
    expect(check).not.toHaveBeenCalled();
    expect(vol.toJSON()).toEqual(before);
  });
});
