/** HTTP parsing and provenance for read-only operation history (ADR 0136 R4). */
import type { Hono, HonoRequest } from 'hono';
import type { AppRequestRuntime } from '../composition/app-request-runtime.types.js';
import { enrichOperationHistory } from '../core/operation-history.js';
import { getHomeProvenance } from './home-provenance.js';

/** Mount history routes against the request's selected home. */
export function registerOperationRoutes(app: Hono, resolveRuntime: (request: HonoRequest) => Promise<AppRequestRuntime>): void {
  app.get('/operations/count/:taskId', async function countOperations(c) {
    const runtime = await resolveRuntime(c.req);
    const id = c.req.param('taskId');
    const count = await runtime.operationLog?.countForTask(id) ?? 0;
    return c.json({ count, ...getHomeProvenance(runtime, runtime.operationLog === undefined ? undefined : runtime.getSourcePath?.(id)) });
  });
  app.get('/operations', async function readHistory(c) {
    const runtime = await resolveRuntime(c.req);
    const log = runtime.operationLog;
    if (log === undefined) return c.json([]);
    const date = c.req.query('date');
    const tz = c.req.query('tz');
    const operations = await log.query({
      limit: date ? 1000 : parseInt(c.req.query('limit') ?? '50', 10),
      taskId: c.req.query('task') || undefined,
      date: date || undefined,
      tzOffset: tz === undefined ? undefined : parseInt(tz),
    });
    const history = await enrichOperationHistory(runtime.service, operations);
    return c.json(history.map(function addProvenance(entry) {
      return { ...entry, ...getHomeProvenance(runtime, entry.resourceId ? runtime.getSourcePath?.(entry.resourceId) : undefined) };
    }));
  });
}
