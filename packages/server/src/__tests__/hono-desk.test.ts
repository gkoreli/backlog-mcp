/**
 * GET /api/desk endpoint tests — the ONE new composition endpoint the
 * attention-viewer design allows. The server composes; the response is a
 * finished briefing with home provenance, honest omission, and copy-ready
 * instructions. /desk itself is a zero-composition chrome redirect into
 * the SPA (the /open precedent).
 */
import { describe, expect, it, vi } from 'vitest';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type { AppRequestRuntime } from '../server/app-request-runtime.types.js';
import { createApp } from '../server/hono-app.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';

const PROJECT_ROOT = '/workspace/desk';

const home: BacklogHome = {
  kind: 'project',
  id: PROJECT_ROOT,
  root: PROJECT_ROOT,
  documentsDir: `${PROJECT_ROOT}/docs`,
  controlDir: `${PROJECT_ROOT}/.backlog`,
};

function createService(): IBacklogService {
  return {
    get: vi.fn(async function get() { return undefined; }),
    getMarkdown: vi.fn(async function getMarkdown() { return null; }),
    list: vi.fn(async function list() { return []; }),
    add: vi.fn(async function add(entity) { return entity; }),
    save: vi.fn(async function save(entity) { return entity; }),
    delete: vi.fn(async function deleteEntity() { return false; }),
    counts: vi.fn(async function counts() {
      return { total_tasks: 0, total_epics: 0, by_status: {}, by_type: {} };
    }),
    getMaxId: vi.fn(async function getMaxId() { return 0; }),
    searchUnified: vi.fn(async function searchUnified() { return []; }),
    listClaimQuarantines: vi.fn(function listClaimQuarantines() { return []; }),
  };
}

function createRuntime(service: IBacklogService): AppRequestRuntime {
  return {
    home,
    service,
    readDeskDocuments: () => [
      {
        path: 'docs/adr/0107-history-truth.md',
        title: 'ADR 0107 — history vs truth',
        status: 'Proposed',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    readEvaluationCandidates: () => [],
    intentRegistrationMode: 'unavailable',
  };
}

describe('GET /api/desk', () => {
  it('returns the composed briefing with home provenance and honest omission', async () => {
    const service = createService();
    const resolveRuntime = vi.fn(async function resolveRuntime() {
      return createRuntime(service);
    });
    const app = createApp(service, { resolveRuntime });

    const response = await app.request(
      `/api/desk?home=project&project_root=${encodeURIComponent(PROJECT_ROOT)}`,
    );

    expect(response.status).toBe(200);
    expect(resolveRuntime).toHaveBeenCalledWith({
      home: 'project',
      projectRoot: PROJECT_ROOT,
    });
    const body = await response.json();
    expect(body.home).toBe('project');
    expect(body.home_id).toBe(PROJECT_ROOT);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: 'docs/adr/0107-history-truth.md',
      class: 'judge',
      path: 'docs/adr/0107-history-truth.md',
    });
    expect(body.items[0].why_surfaced).toMatch(/^Status "Proposed" has awaited a ruling for \d+ days\.$/u);
    expect(body.items[0].instruction).toContain('Adjudicate docs/adr/0107-history-truth.md');
    expect(body.omitted).toEqual({ judge: 0, review: 0, read: 0, health: 0 });
    expect(body.metadata.budget).toBe(7);
  });

  it('composes an empty briefing on runtimes without desk readers (degrade, never fail)', async () => {
    const service = createService();
    const app = createApp(service);

    const response = await app.request('/api/desk');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
    expect(body.omitted).toEqual({ judge: 0, review: 0, read: 0, health: 0 });
  });
});

describe('GET /desk', () => {
  it('redirects into the SPA desk view (chrome alias, zero composition)', async () => {
    const service = createService();
    const app = createApp(service, {
      resolveRuntime: vi.fn(async function resolveRuntime() {
        return createRuntime(service);
      }),
    });

    const response = await app.request('/desk');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/?view=desk');
  });
});
