import { Hono } from 'hono';
import { cors } from 'hono/cors';
import matter from 'gray-matter';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { IBacklogService } from '../storage/service-types.js';
import type { IOperationLog, Actor } from '../operations/types.js';
import { extractTargetFilename } from '../operations/resource-id.js';
import { registerTools, type ToolDeps } from '../tools/index.js';
import {
  createAuthRuntime,
  registerMcpAuthMiddleware,
  registerOAuthRoutes,
  type AuthEvent,
  type OAuthStore,
} from '../auth/index.js';
// Note: paths.ts and operations/index.ts are NOT imported here — they pull in
// Node.js modules (import.meta.url, fs, path) that break the Workers bundle.
// name/version and the MCP server wrapper are injected via AppDeps.

export interface AppDeps extends ToolDeps {
  // Server identity — passed explicitly to avoid importing paths.ts in Workers
  name?: string;
  version?: string;
  dataDir?: string;
  // Auth secrets — injected from entry points (process.env in Node.js, env bindings in Workers)
  apiKey?: string;                   // direct Bearer token (Claude Desktop / programmatic)
  clientSecret?: string;             // OAuth client_secret (Claude.ai web connector)
  jwtSecret?: string;                // internal JWT signing key (never exposed to clients)
  oauthStore?: OAuthStore;           // optional persistent OAuth grant store for refresh tokens
  refreshTokenInactivitySeconds?: number; // default 30 days
  refreshTokenMaxAgeSeconds?: number;     // default 90 days
  now?: () => Date;                  // test seam
  generateId?: () => string;         // test seam
  generateToken?: (prefix?: string) => string; // test seam
  logAuthEvent?: (event: AuthEvent) => void | Promise<void>;
  // GitHub OAuth — replaces API key form with "Sign in with GitHub"
  githubClientId?: string;           // GitHub OAuth App client ID
  githubClientSecret?: string;       // GitHub OAuth App client secret
  allowedGithubUsernames?: string;   // comma-separated allowlist e.g. "gkoreli,gogakoreli"
  // Operation log — same interface for local (JSONL) and cloud (D1)
  operationLog?: IOperationLog;
  // Write-boundary wiring — passed through to tool handlers so each
  // MCP write builds a WriteContext (see ADR 0094).
  actor?: Actor;
  // Node.js-only
  staticMiddleware?: any;  // result of serveStatic({ root: '...' }) from @hono/node-server/serve-static
  eventBus?: any;          // for SSE push
  readLocalFile?: (filePath: string) => string | null;  // injected by node-server.ts; absent in Worker
  db?: any;                // cloud: D1 database — used for mode detection only
}

export function createApp(service: IBacklogService, deps?: AppDeps): Hono {
  const app = new Hono();
  const authRuntime = createAuthRuntime({
    store: deps?.oauthStore,
    inactivitySeconds: deps?.refreshTokenInactivitySeconds,
    maxAgeSeconds: deps?.refreshTokenMaxAgeSeconds,
    now: deps?.now,
    generateId: deps?.generateId,
    generateToken: deps?.generateToken,
  });
  app.use('*', cors());

  registerMcpAuthMiddleware(app, {
    apiKey: deps?.apiKey ?? process.env.API_KEY,
    jwtSecret: deps?.jwtSecret ?? process.env.JWT_SECRET,
  });
  registerOAuthRoutes(app, {
    apiKey: deps?.apiKey ?? process.env.API_KEY,
    clientSecret: deps?.clientSecret ?? process.env.CLIENT_SECRET,
    jwtSecret: deps?.jwtSecret ?? process.env.JWT_SECRET,
    githubClientId: deps?.githubClientId ?? process.env.GITHUB_CLIENT_ID,
    githubClientSecret: deps?.githubClientSecret ?? process.env.GITHUB_CLIENT_SECRET,
    allowedGithubUsernames: deps?.allowedGithubUsernames ?? process.env.ALLOWED_GITHUB_USERNAMES,
    logAuthEvent: deps?.logAuthEvent,
  }, authRuntime);

  // Health
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Version
  app.get('/version', (c) => c.json(deps?.version ?? '0.0.0'));

  // MCP endpoint — WebStandardStreamableHTTPServerTransport works on Node.js + Workers
  app.all('/mcp', async (c) => {
    const server = new McpServer({ name: deps?.name ?? 'backlog-mcp', version: deps?.version ?? '0.0.0' });
    // ToolDeps carries write-boundary wiring; core builds WriteContext
    // per-write using these pieces. See ADR 0094.
    const toolDeps: ToolDeps = {
      ...deps,
      actor: deps?.actor,
      operationLog: deps?.operationLog,
      eventBus: deps?.eventBus,
      memoryComposer: deps?.memoryComposer,
    };
    registerTools(server, service, toolDeps);
    if (deps?.resourceManager) {
      deps.resourceManager.registerResource(server);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // ── Viewer REST API ─────────────────────────────────────────────────────────

  // GET /tasks
  app.get('/tasks', async (c) => {
    const filterParam = c.req.query('filter') ?? 'active';
    const q = c.req.query('q');
    const limit = parseInt(c.req.query('limit') ?? '10000', 10);

    const statusMap: Record<string, string[] | undefined> = {
      active: ['open', 'in_progress', 'blocked'],
      completed: ['done', 'cancelled'],
      all: undefined,
    };
    const status = statusMap[filterParam] as any;

    const results = await service.list({ status, query: q || undefined, limit });
    return c.json(results);
  });

  // GET /tasks/:id
  app.get('/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const task = await service.get(id);
    if (!task) return c.json({ error: 'Not found' }, 404);

    const raw = await service.getMarkdown(id);
    const children = await service.list({ parent_id: id, limit: 1000 });
    let parentTitle: string | undefined;
    const parentId = task.parent_id || task.epic_id;
    if (parentId) {
      const parent = await service.get(parentId);
      parentTitle = parent?.title;
    }

    return c.json({ ...task, raw, parentTitle, children });
  });

  // GET /search
  app.get('/search', async (c) => {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Missing required query param: q' }, 400);
    const limit = parseInt(c.req.query('limit') ?? '20', 10);
    const types = c.req.query('types')?.split(',');
    const sort = c.req.query('sort');
    const results = await service.searchUnified(q, { types: types as Array<'task' | 'epic' | 'resource'> | undefined, sort, limit });
    return c.json(results);
  });

  // GET /api/status
  const startTime = Date.now();
  app.get('/api/status', async (c) => {
    const counts = await service.counts();
    return c.json({
      version: deps?.version ?? '0.0.0',
      mode: deps?.db ? 'cloudflare-worker' : 'local',
      taskCount: counts.total_tasks + counts.total_epics,
      dataDir: deps?.dataDir,
      port: parseInt(c.req.header('host')?.split(':')[1] ?? '0'),
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  // ── Operations ──────────────────────────────────────────────────────────────

  // GET /operations/count/:taskId  (must be before /operations)
  app.get('/operations/count/:taskId', async (c) => {
    if (!deps?.operationLog) return c.json({ count: 0 });
    const count = await deps.operationLog.countForTask(c.req.param('taskId'));
    return c.json({ count });
  });

  // GET /operations — works identically for local and cloud via IOperationLog
  app.get('/operations', async (c) => {
    if (!deps?.operationLog) return c.json([]);

    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const taskFilter = c.req.query('task');
    const date = c.req.query('date');
    const tz = c.req.query('tz');

    const operations = await deps.operationLog.query({
      limit: date ? 1000 : limit,
      taskId: taskFilter || undefined,
      date: date || undefined,
      tzOffset: tz != null ? parseInt(tz) : undefined,
    });

    // Enrich with task/epic titles via the service (same for local and cloud)
    const taskCache = new Map<string, { title?: string; epicId?: string }>();
    const epicCache = new Map<string, string | undefined>();

    const enriched = await Promise.all(operations.map(async (op) => {
      const id = op.resourceId;
      if (!id) {
        const targetFilename = extractTargetFilename(op.tool, op.params);
        return targetFilename ? { ...op, targetFilename } : op;
      }

      if (!taskCache.has(id)) {
        const entity = await service.get(id);
        taskCache.set(id, { title: entity?.title, epicId: entity?.parent_id ?? entity?.epic_id });
      }
      const cached = taskCache.get(id)!;

      let epicTitle: string | undefined;
      if (cached.epicId) {
        if (!epicCache.has(cached.epicId)) {
          const epic = await service.get(cached.epicId);
          epicCache.set(cached.epicId, epic?.title);
        }
        epicTitle = epicCache.get(cached.epicId);
      }

      return {
        ...op,
        resourceTitle: cached.title,
        epicId: cached.epicId,
        epicTitle,
        targetFilename: extractTargetFilename(op.tool, op.params),
      };
    }));

    return c.json(enriched);

    return c.json([]);
  });

  // ── SSE events ──────────────────────────────────────────────────────────────
  app.get('/events', (c) => {
    if (deps?.eventBus) {
      // Node.js: live push via eventBus
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc = new TextEncoder();

      writer.write(enc.encode(': connected\n\n'));

      const onEvent = (event: any) => {
        writer.write(enc.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)).catch(() => {});
      };
      deps.eventBus.subscribe(onEvent);

      const heartbeat = setInterval(() => {
        writer.write(enc.encode(': heartbeat\n\n')).catch(() => clearInterval(heartbeat));
      }, 30000);

      // Cleanup when client disconnects
      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        deps.eventBus!.unsubscribe(onEvent);
        writer.close().catch(() => {});
      });

      return new Response(readable, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }

    // Cloud/stateless: heartbeat only
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(': connected\n\n'));
        const id = setInterval(() => {
          try { controller.enqueue(enc.encode(': heartbeat\n\n')); } catch { clearInterval(id); }
        }, 30000);
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  });

  // ── Node.js-only routes (filesystem) ────────────────────────────────────────
  if (deps?.staticMiddleware || deps?.resourceManager) {
    // Resource proxy — serves local filesystem resources
    if (deps?.resourceManager) {
      app.get('/resource', async (c) => {
        const filePath = c.req.query('path');

        if (!filePath) {
          return c.json({ error: 'Missing path parameter' }, 400);
        }

        const content = deps.readLocalFile!(filePath);
        if (content === null) {
          return c.json({ error: 'File not found', path: filePath }, 404);
        }

        try {
          const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';
          const mimeMap: Record<string, string> = {
            md: 'text/markdown',
            ts: 'text/typescript',
            js: 'text/javascript',
            json: 'application/json',
            txt: 'text/plain',
          };

          let frontmatter = {};
          let bodyContent = content;

          // Parse frontmatter for markdown files
          if (ext === 'md') {
            const parsed = matter(content);
            frontmatter = parsed.data;
            bodyContent = parsed.content;
          }

          return c.json({
            content: bodyContent,
            frontmatter,
            type: mimeMap[ext] || 'text/plain',
            path: filePath,
            fileUri: `file://${filePath}`,
            mcpUri: deps.resourceManager.toUri(filePath),
            ext,
          });
        } catch (error: any) {
          return c.json({ error: 'Failed to read file', message: error.message }, 500);
        }
      });

      // MCP resource proxy — resolves mcp://backlog/ URIs to filesystem content
      app.get('/mcp/resource', async (c) => {
        const uri = c.req.query('uri');

        if (!uri || !uri.startsWith('mcp://backlog/')) {
          return c.json({ error: 'Invalid MCP URI' }, 400);
        }

        try {
          const resource = deps.resourceManager.read(uri);
          const filePath = deps.resourceManager.resolve(uri);
          const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';

          return c.json({
            content: resource.content,
            frontmatter: resource.frontmatter || {},
            type: resource.mimeType,
            path: filePath,
            fileUri: `file://${filePath}`,
            mcpUri: uri,
            ext,
          });
        } catch (error: any) {
          return c.json({ error: 'Resource not found', uri, message: error.message }, 404);
        }
      });

      app.get('/open', (c) => {
        const uri = c.req.query('uri');
        if (!uri) return c.json({ error: 'Missing uri' }, 400);
        return c.redirect(`/?resource=${encodeURIComponent(uri)}`);
      });
    }

    // Shutdown (local only)
    app.post('/shutdown', (c) => {
      setTimeout(() => process.exit(0), 500);
      return c.text('Shutting down...');
    });
  }

  // Static files — must be LAST (fallthrough for SPA)
  // Only registered in Node.js mode. In cloud mode Pages serves static files.
  if (deps?.staticMiddleware) {
    app.use('/*', deps.staticMiddleware);
  }

  return app;
}
