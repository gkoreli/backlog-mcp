/**
 * REST API routes for the Cloudflare Worker viewer backend.
 *
 * Handles /tasks, /tasks/:id, /operations, /operations/count/:taskId,
 * /events, /api/status, and /search endpoints.
 *
 * ADR-0089 Phase 3.
 */

import type { WorkerEnv } from './worker-entry.js';
import { D1BacklogService } from './storage/d1-backlog-service.js';
import type { Status } from '@backlog-mcp/shared';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

export async function handleApiRequest(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only handle GET from here on
  if (request.method !== 'GET') return null;

  // GET /tasks
  if (pathname === '/tasks') {
    const service = new D1BacklogService(env.DB);
    const filterParam = url.searchParams.get('filter') ?? 'active';
    const q = url.searchParams.get('q') ?? '';
    const limit = parseInt(url.searchParams.get('limit') ?? '10000', 10);

    let status: Status[] | undefined;
    if (filterParam === 'active') {
      status = ['open', 'in_progress', 'blocked'] as Status[];
    } else if (filterParam === 'completed') {
      status = ['done', 'cancelled'] as Status[];
    }
    // 'all' → status remains undefined

    let results;
    if (q) {
      results = await service.list({ query: q, limit });
    } else {
      results = await service.list({ status, limit });
    }

    return json(results);
  }

  // GET /tasks/:id
  const taskMatch = pathname.match(/^\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const id = taskMatch[1];
    const service = new D1BacklogService(env.DB);

    const task = await service.get(id);
    if (!task) {
      return json({ error: 'Not found' }, 404);
    }

    const raw = await service.getMarkdown(id);
    const children = await service.list({ parent_id: id, limit: 1000 });

    let parentTitle: string | undefined;
    const parentId = task.parent_id || task.epic_id;
    if (parentId) {
      const parent = await service.get(parentId);
      parentTitle = parent?.title;
    }

    return json({ ...task, raw, parentTitle, children });
  }

  // GET /operations/count/:taskId  (must be checked before /operations)
  const opCountMatch = pathname.match(/^\/operations\/count\/([^/]+)$/);
  if (opCountMatch) {
    const taskId = opCountMatch[1];
    const row = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM operations WHERE task_id = ?',
    )
      .bind(taskId)
      .first<{ count: number }>();
    return json({ count: row?.count ?? 0 });
  }

  // GET /operations
  if (pathname === '/operations') {
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const taskFilter = url.searchParams.get('task') ?? null;

    type OpRow = {
      id: number;
      ts: string;
      tool: string;
      actor: string;
      resource_id: string | null;
      task_id: string | null;
      params: string | null;
      result: string | null;
    };

    const { results: ops } = await env.DB.prepare(
      'SELECT * FROM operations WHERE (task_id = ? OR ? IS NULL) ORDER BY id DESC LIMIT ?',
    )
      .bind(taskFilter, taskFilter, limit)
      .all<OpRow>();

    const service = new D1BacklogService(env.DB);
    const titleCache = new Map<string, string | undefined>();

    const enriched = await Promise.all(
      ops.map(async (op: OpRow) => {
        let resourceTitle: string | undefined;
        let epicId: string | undefined;
        let epicTitle: string | undefined;

        if (op.task_id) {
          if (!titleCache.has(op.task_id)) {
            const entity = await service.get(op.task_id);
            titleCache.set(op.task_id, entity?.title);
            if (entity?.epic_id) {
              if (!titleCache.has(entity.epic_id)) {
                const epic = await service.get(entity.epic_id);
                titleCache.set(entity.epic_id, epic?.title);
              }
              epicId = entity.epic_id;
              epicTitle = titleCache.get(entity.epic_id);
            }
          } else {
            resourceTitle = titleCache.get(op.task_id);
          }
          if (!resourceTitle) {
            resourceTitle = titleCache.get(op.task_id);
          }
        }

        return {
          ...op,
          params: op.params ? tryParseJson(op.params) : op.params,
          result: op.result ? tryParseJson(op.result) : op.result,
          resourceTitle,
          epicId,
          epicTitle,
        };
      }),
    );

    return json(enriched);
  }

  // GET /events — SSE heartbeat stream
  if (pathname === '/events') {
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(': connected\n\n'));
        const id = setInterval(() => {
          try {
            controller.enqueue(enc.encode(': heartbeat\n\n'));
          } catch {
            clearInterval(id);
          }
        }, 30000);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...corsHeaders,
      },
    });
  }

  // GET /api/status
  if (pathname === '/api/status') {
    const service = new D1BacklogService(env.DB);
    const { total_tasks, total_epics } = await service.counts();
    return json({
      version: '0.46.0',
      mode: 'cloudflare-worker',
      taskCount: total_tasks + total_epics,
    });
  }

  // GET /search
  if (pathname === '/search') {
    const q = url.searchParams.get('q');
    if (!q) {
      return json({ error: 'Missing required query param: q' }, 400);
    }
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const service = new D1BacklogService(env.DB);
    const results = await service.searchUnified(q, { limit });
    return json(results);
  }

  return null;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
