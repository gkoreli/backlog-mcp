/**
 * GET /search?home=all — cross-home discovery for the viewer (ADR 0112.4 §3).
 *
 * The capability (coordinator fan-out, rrf merge, provenance stamping) was
 * MCP-only; this exposes it to the viewer's HTTP read route. Read-only:
 * exactly global + the supplied project root, never a workspace scan.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BacklogHome } from '../core/backlog-home.types.js';
import { createApp } from '../server/hono-app.js';
import type { AppRequestRuntimeSelection } from '../server/app-request-runtime.types.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';

function home(kind: 'global' | 'project', id: string): BacklogHome {
  return {
    kind,
    id,
    root: id === 'global' ? '/global' : id,
    documentsDir: id === 'global' ? '/global/docs' : `${id}/docs`,
    controlDir: id === 'global' ? '/global/.backlog-mcp' : `${id}/.backlog-mcp`,
  } as BacklogHome;
}

function searchService(id: string): IBacklogService {
  return {
    searchUnified: vi.fn(async () => [{
      item: {
        id, title: id, type: 'task', status: 'open',
        created_at: '2026-07-16T00:00:00.000Z', updated_at: '2026-07-16T00:00:00.000Z',
      },
      score: 1,
      type: 'task',
    }]),
    isHybridSearchActive: () => false,
  } as unknown as IBacklogService;
}

const EMPTY_SERVICE = searchService('unused');

describe('GET /search with home=all', () => {
  it('fans out to global + project and returns viewer-shaped provenance-stamped rows', async () => {
    const resolver = vi.fn(async (selection: AppRequestRuntimeSelection) => {
      if (selection.home === 'project') {
        return {
          home: home('project', '/workspace/project'),
          service: searchService('TASK-PROJECT'),
          getSourcePath: () => 'tasks/TASK-PROJECT.md',
        };
      }
      return {
        home: home('global', 'global'),
        service: searchService('TASK-GLOBAL'),
        getSourcePath: () => 'tasks/TASK-GLOBAL.md',
      };
    });
    const app = createApp(EMPTY_SERVICE, { resolveRuntime: resolver });

    const response = await app.request('/search?q=task&home=all&project_root=%2Fworkspace%2Fproject');
    expect(response.status).toBe(200);
    const rows = await response.json() as Array<Record<string, any>>;

    // Viewer result grammar: {item, type, score, home, home_id, source_path}
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map(r => [r.item.id, r]));
    expect(byId['TASK-PROJECT']).toMatchObject({
      type: 'task',
      home: 'project',
      home_id: '/workspace/project',
      source_path: 'tasks/TASK-PROJECT.md',
    });
    expect(byId['TASK-GLOBAL']).toMatchObject({
      home: 'global',
      home_id: 'global',
    });
    // Provenance never leaks into the nested item (one grammar, no dupes)
    expect(byId['TASK-PROJECT']?.item.home_id).toBeUndefined();

    // Exactly global + the supplied project root — never a scan (R-2/R-9)
    expect(resolver.mock.calls.map(call => call[0])).toEqual([
      { home: 'global' },
      { home: 'project', projectRoot: '/workspace/project' },
    ]);
  });

  it('falls back to the static single-home path when no resolver is wired (legacy server)', async () => {
    const app = createApp(searchService('TASK-LEGACY'));
    const response = await app.request('/search?q=task&home=all');
    expect(response.status).toBe(200);
    const rows = await response.json() as Array<Record<string, any>>;
    expect(rows[0]?.item?.id ?? rows[0]?.id).toBe('TASK-LEGACY');
  });
});
