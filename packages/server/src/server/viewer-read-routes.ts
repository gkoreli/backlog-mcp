/** Viewer entity discovery, detail and analysis HTTP routes over selected read capabilities. */
import type { Hono } from 'hono';
import type { AppRequestRuntime, AppRequestRuntimeSelection } from '../composition/app-request-runtime.types.js';
import type { HomeReadCoordinator } from '../core/home-read-coordinator.types.js';
import { selectAppRequestRuntime, type RequestSelectionSource } from './request-selection.js';
import { detectContradictions } from '../core/contradictions.js';
import { desk, type DeskReader } from '../core/desk.js';
import { findCollisionCandidatePairs } from '../core/collision-candidates.js';
import { readEntityDetail, projectEntityUsage, type EntityDetailReader } from '../core/entity-detail.js';
import { getHomeProvenance, withEntityHomeProvenance, withSearchHomeProvenance } from './home-provenance.js';

/** No write authority or process controls are needed for viewer reads. */
export type ViewerReadRuntime = Pick<AppRequestRuntime,
  'home' | 'getSourcePath' | 'clock' | 'mintMemoryEntry' | 'readUsageLines'
  | 'readDeskDocuments' | 'readEvaluationCandidates' | 'readGrounding'>
  & { service: EntityDetailReader & DeskReader };

export interface ViewerReadRoutesDeps {
  resolveRequestRuntime: (request: RequestSelectionSource) => Promise<ViewerReadRuntime>;
  resolveSelectedRuntime: (selection: AppRequestRuntimeSelection) => Promise<ViewerReadRuntime>;
  crossHomeCoordinator?: (projectRoot?: string) => HomeReadCoordinator;
}

export function registerViewerReadRoutes(app: Hono, deps: ViewerReadRoutesDeps): void {
  // GET /tasks
  app.get('/tasks', async (c) => {
    const runtime = await deps.resolveRequestRuntime(c.req);
    const filterParam = c.req.query('filter') ?? 'active';
    const q = c.req.query('q');
    const limit = parseInt(c.req.query('limit') ?? '10000', 10);

    const statusMap = new Map<string, string[]>([
      ['active', ['open', 'in_progress', 'blocked']],
      ['completed', ['done', 'cancelled']],
    ]);
    const status = statusMap.get(filterParam);

    const now = (runtime.clock?.() ?? Date.now());
    const results = await runtime.service.list({ status, query: q || undefined, limit });
    return c.json(results.map(function addProvenance(result) {
      return withEntityHomeProvenance(
        runtime,
        projectEntityUsage(result, runtime.mintMemoryEntry?.bind(runtime), now),
      );
    }));
  });

  // GET /tasks/:id
  app.get('/tasks/:id', async function readTaskDetail(c) {
    const runtime = await deps.resolveRequestRuntime(c.req);
    const now = (runtime.clock?.() ?? Date.now());
    const detail = await readEntityDetail(runtime.service, c.req.param('id'), {
      now, childLimit: 1000,
      readUsageLines: runtime.readUsageLines?.bind(runtime),
      mintMemoryEntry: runtime.mintMemoryEntry?.bind(runtime),
    });
    if (detail === undefined) return c.json({ error: 'Not found' }, 404);
    const { entity, children, ...analysis } = detail;
    return c.json({
      ...withEntityHomeProvenance(runtime, entity), ...analysis,
      children: children.map(function childProvenance(child) { return withEntityHomeProvenance(runtime, child); }),
    });
  });

  // GET /search
  app.get('/search', async (c) => {
    const selection = selectAppRequestRuntime(c.req);
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Missing required query param: q' }, 400);
    const limit = parseInt(c.req.query('limit') ?? '20', 10);
    const types = c.req.query('types')?.split(',');
    const sort = c.req.query('sort');
    // home=all — cross-home discovery (ADR 0112.4 §3): read-only, fused via
    // the shipped coordinator (rrf merge, provenance-stamped per row). Same
    // machinery the MCP search tool uses; the coordinator resolves exactly
    // global + the supplied project root — never a workspace scan (R-2/R-9).
    if (selection.home === 'all' && deps.crossHomeCoordinator !== undefined) {
      const coordinator = deps.crossHomeCoordinator(selection.projectRoot);
      const crossHome = await coordinator.search(
        {
          query: q,
          limit,
          ...(types === undefined ? {} : { types }),
          ...(sort === undefined ? {} : { sort: sort as 'relevant' | 'recent' }),
        },
        selection.projectRoot === undefined ? undefined : { projectRoot: selection.projectRoot },
      );
      // Adapt to the route's UnifiedSearchResult shape ({item, type, score,
      // provenance}) so the viewer renders one result grammar for both modes.
      return c.json(crossHome.results.map(function toUnifiedShape(item) {
        const { score, home, home_id, source_path, within_home_rank, ...entity } = item;
        return {
          item: entity,
          type: entity.type,
          score,
          home,
          home_id,
          ...(source_path === undefined ? {} : { source_path }),
        };
      }));
    }

    const runtime = await deps.resolveSelectedRuntime(selection);
    const results = await runtime.service.searchUnified(q, {
      types,
      sort,
      limit,
    });
    return c.json(results.map(function addProvenance(result) {
      return withSearchHomeProvenance(runtime, result);
    }));
  });

  // GET /memory/contradictions — all contradiction sets (ADR 0092.13 R-9)
  app.get('/memory/contradictions', async (c) => {
    const runtime = await deps.resolveRequestRuntime(c.req);
    const now = (runtime.clock?.() ?? Date.now());
    const result = c.req.query('candidates') === 'true'
      ? await findCollisionCandidatePairs(runtime.service, { now })
      : await detectContradictions(runtime.service, now);
    return c.json(result);
  });

  // GET /api/desk — the Desk briefing (attention-viewer V1): ONE new
  // composition endpoint by design law. The server composes the fold from
  // store state; the viewer renders it verbatim, read-only.
  app.get('/api/desk', async (c) => {
    const runtime = await deps.resolveRequestRuntime(c.req);
    const briefing = await desk(runtime.service, {
      now: runtime.clock?.() ?? Date.now(),
      readDocuments: runtime.readDeskDocuments?.bind(runtime),
      readEvaluationCandidates: runtime.readEvaluationCandidates?.bind(runtime),
      readGrounding: runtime.readGrounding?.bind(runtime),
    });
    return c.json({
      ...briefing,
      ...getHomeProvenance(runtime),
    });
  });

}
