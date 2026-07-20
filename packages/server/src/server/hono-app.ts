import { Hono } from 'hono';
import { cors } from 'hono/cors';
import matter from 'gray-matter';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { IOperationLog, Actor } from '../operations/types.js';
import { extractTargetFilename } from '../operations/resource-id.js';
import { normalizeOperationEntry } from '../operations/mutation.js';
import { registerTools, type ToolDeps } from '../tools/index.js';
import { detectContradictions, contradictsFor } from '../core/contradictions.js';
import { desk } from '../core/desk.js';
import { findCollisionCandidatePairs, findCollisionCandidatesForMemory } from '../core/collision-candidates.js';
import { usageSeries, hasUsage } from '../core/usage-series.js';
import type { AnyEntity, Entity, Memory } from '@backlog-mcp/shared';
import {
  BACKLOG_HOME_HEADER,
  BACKLOG_PROJECT_ROOT_HEADER,
} from '../core/backlog-home.js';
import type { BacklogEventCallback } from '../events/event-bus.js';
import {
  createAuthRuntime,
  registerMcpAuthMiddleware,
  registerOAuthRoutes,
  type AuthEvent,
  type OAuthStore,
} from '../auth/index.js';
import type {
  AppRequestRuntime,
  AppRequestRuntimeResolver,
  AppRequestRuntimeSelection,
} from './app-request-runtime.types.js';
import {
  getHomeProvenance,
  withEntityHomeProvenance,
  withSearchHomeProvenance,
} from './home-provenance.js';
import { homedir } from 'node:os';
import { selectMcpRequestRuntime } from './mcp-request-runtime.js';
import type { RecentHomesStore } from '../storage/local/recent-homes-store.js';
import {
  presentGlobalHome,
  presentProjectHome,
} from '../core/home-presentation.js';
import { asBuiltinEntity } from '../core/substrates/index.js';
import { createHomeReadCoordinator } from '../core/home-read-coordinator.js';
import type {
  HomeReadCoordinator,
  HomeReadRuntime,
  HomeReadRuntimeSelection,
} from '../core/home-read-coordinator.types.js';
import { memoryUsageFieldsFromEntry } from '../memory/memory-entry-usage.js';
import { withRequestTelemetrySession } from '../memory/retrieval-telemetry.js';
import type { SubstrateIntentQuarantineDiagnostic } from '../tools/register-substrate-intents.types.js';
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
  // Error sink — injected by entry points (Node: structured file logger;
  // Worker: console). Lets transport-free shared code report failures
  // without importing the Node-only logger (which pulls in paths/fs and
  // breaks the Workers bundle).
  logError?: (message: string, data?: Record<string, unknown>) => void;
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
  readUsageLines?: () => string[];  // memory-usage.jsonl reader (ADR 0092.14); Node-only, absent in Worker
  db?: any;                // cloud: D1 database — used for mode detection only
  resolveRuntime?: AppRequestRuntimeResolver;
  requestShutdown?: () => void | Promise<void>;
  // Recent-homes registry (ADR 0128); Node-only, absent in Worker.
  recentHomes?: RecentHomesStore;
}

interface RequestSelectionSource {
  header(name: string): string | undefined;
  query(name: string): string | undefined;
}

/**
 * Read explicit caller context from one HTTP request.
 *
 * Headers are the bridge/server contract and therefore win over viewer query
 * parameters. Missing values remain missing; server cwd and process env are
 * deliberately not request-selection inputs.
 */
export function selectAppRequestRuntime(
  request: RequestSelectionSource,
): AppRequestRuntimeSelection {
  const home = request.header(BACKLOG_HOME_HEADER) ?? request.query('home');
  const projectRoot = request.header(BACKLOG_PROJECT_ROOT_HEADER)
    ?? request.query('project_root');

  return {
    ...(home === undefined ? {} : { home }),
    ...(projectRoot === undefined ? {} : { projectRoot }),
  };
}

function createStaticRequestRuntime(
  service: IBacklogService,
  deps: AppDeps | undefined,
): AppRequestRuntime {
  return {
    service,
    operationLog: deps?.operationLog,
    operationLogger: deps?.operationLogger,
    eventBus: deps?.eventBus,
    memoryComposer: deps?.memoryComposer,
    mintMemoryEntry: deps?.mintMemoryEntry,
    usageTracker: deps?.usageTracker,
    resourceManager: deps?.resourceManager,
    readLocalFile: deps?.readLocalFile,
    readUsageLines: deps?.readUsageLines,
    identityPath: deps?.identityPath,
    visionPath: deps?.visionPath,
    intentRegistrationMode: 'unavailable',
  };
}

function createRequestToolDeps(
  runtime: AppRequestRuntime,
  deps: AppDeps | undefined,
  homeReadCoordinator?: HomeReadCoordinator,
  reportIntentQuarantine?: (
    diagnostic: SubstrateIntentQuarantineDiagnostic,
  ) => void,
): ToolDeps {
  function createIntentRegistration(): NonNullable<ToolDeps['intentRegistration']> {
    if (runtime.intentRegistrationMode === 'unavailable') {
      return {
        mode: 'unavailable' as const,
        reason: 'constrained-runtime' as const,
      };
    }
    if (runtime.intentRegistrationMode !== 'required') {
      throw new Error('Runtime has no explicit intent registration mode');
    }
    const intentRegistry = runtime.intentRegistry;
    const intentWriteValidator = runtime.intentWriteValidator;
    if (
      intentRegistry === undefined
      || intentWriteValidator === undefined
      || reportIntentQuarantine === undefined
    ) {
      throw new Error(
        'Writable local runtime has incomplete intent registration dependencies',
      );
    }
    return {
      mode: 'required',
      intentRegistry,
      intentWriteValidator,
      reportIntentQuarantine,
    };
  }
  return {
    actor: runtime.home === undefined ? deps?.actor : runtime.actor,
    agentIdentity: runtime.home === undefined
      ? deps?.agentIdentity
      : runtime.agentIdentity,
    operationLog: runtime.operationLog,
    operationLogger: runtime.operationLogger,
    substrateRegistry: runtime.substrateRegistry,
    scopeRoot: runtime.scopeRoot,
    eventBus: runtime.eventBus,
    memoryComposer: runtime.memoryComposer,
    mintMemoryEntry: runtime.mintMemoryEntry,
    usageTracker: runtime.usageTracker,
    resourceManager: runtime.resourceManager,
    readLocalFile: runtime.readLocalFile,
    readUsageLines: runtime.readUsageLines,
    identityPath: runtime.identityPath,
    visionPath: runtime.visionPath,
    readGrounding: runtime.readGrounding,
    homeReadCoordinator,
    intentRegistration: createIntentRegistration(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toHomeReadRuntime(runtime: AppRequestRuntime): HomeReadRuntime {
  const home = runtime.home;
  if (home === undefined) {
    throw new Error('Cross-home reads require a docs-native local runtime');
  }

  const readLocalFile = runtime.readLocalFile;
  const identityPath = runtime.identityPath;
  const readIdentity = readLocalFile === undefined
    || identityPath === undefined
    ? undefined
    : function readRuntimeIdentity(): string | undefined {
      const raw = readLocalFile(identityPath);
      return raw?.trim() || undefined;
    };
  const visionPath = runtime.visionPath;
  const readVision = readLocalFile === undefined
    || visionPath === undefined
    ? undefined
    : function readRuntimeVision(): string | undefined {
      const raw = readLocalFile(visionPath);
      return raw?.trim() || undefined;
    };
  const operationLogger = runtime.operationLogger;
  const readOperations = operationLogger === undefined
    ? undefined
    : function readRuntimeOperations(options: { limit?: number }) {
      return operationLogger.read(options);
    };

  return {
    home,
    service: runtime.service,
    memoryComposer: runtime.memoryComposer,
    usageTracker: runtime.usageTracker,
    getSourcePath: runtime.getSourcePath,
    readIdentity,
    ...(runtime.substrateRegistry === undefined
      ? {}
      : {
          acceptsParent: function acceptsParent(type: string): boolean {
            return runtime.substrateRegistry?.acceptsParent(type) === true;
          },
        }),
    readVision,
    ...(runtime.readGrounding === undefined
      ? {}
      : { readGrounding: runtime.readGrounding }),
    readOperations,
    mintMemoryEntry: runtime.mintMemoryEntry,
  };
}

function createRequestHomeReadCoordinator(
  resolveRuntime: (
    selection: AppRequestRuntimeSelection,
  ) => Promise<AppRequestRuntime>,
  projectRoot?: string,
): HomeReadCoordinator {
  async function resolveHomeReadRuntime(
    selection: HomeReadRuntimeSelection,
  ): Promise<HomeReadRuntime> {
    return toHomeReadRuntime(await resolveRuntime(selection));
  }

  const coordinator = createHomeReadCoordinator({
    resolveRuntime: resolveHomeReadRuntime,
  });
  const inheritedSelection = projectRoot === undefined
    ? undefined
    : { projectRoot };

  return {
    search: function searchAcrossRequestHomes(params, selection) {
      return coordinator.search(params, selection ?? inheritedSelection);
    },
    recall: function recallAcrossRequestHomes(params, selection) {
      return coordinator.recall(params, selection ?? inheritedSelection);
    },
    wakeup: function wakeupAcrossRequestHomes(params, selection) {
      return coordinator.wakeup(params, selection ?? inheritedSelection);
    },
  };
}

function withMintedMemoryUsage(
  runtime: AppRequestRuntime,
  entity: AnyEntity,
): AnyEntity {
  const builtin = asBuiltinEntity(entity);
  if (
    builtin?.type !== 'memory'
    || runtime.mintMemoryEntry === undefined
  ) {
    return entity;
  }

  const memory = { ...builtin };
  delete memory.usage_count;
  delete memory.last_used_at;
  const entry = runtime.mintMemoryEntry(builtin);
  Object.assign(memory, memoryUsageFieldsFromEntry(entry));
  return memory;
}

export function createApp(service: IBacklogService, deps?: AppDeps): Hono {
  const app = new Hono();
  const staticRuntime = createStaticRequestRuntime(service, deps);
  const reportedIntentQuarantines = new Set<string>();
  function reportIntentQuarantine(
    diagnostic: SubstrateIntentQuarantineDiagnostic,
  ): void {
    const key = JSON.stringify(diagnostic);
    if (reportedIntentQuarantines.has(key)) return;
    reportedIntentQuarantines.add(key);
    const data = { ...diagnostic };
    if (deps?.logError !== undefined) {
      deps.logError('Substrate intent quarantined', data);
      return;
    }
    console.error('Substrate intent quarantined', data);
  }
  async function resolveSelectedRuntime(
    selection: AppRequestRuntimeSelection,
  ): Promise<AppRequestRuntime> {
    if (deps?.resolveRuntime === undefined) return staticRuntime;
    return deps.resolveRuntime(selection);
  }
  async function resolveRequestRuntime(
    request: RequestSelectionSource,
  ): Promise<AppRequestRuntime> {
    return resolveSelectedRuntime(selectAppRequestRuntime(request));
  }
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
    const selection = await selectMcpRequestRuntime(
      c.req.raw,
      selectAppRequestRuntime(c.req),
    );
    // Cross-home tools resolve both homes inside the allSettled coordinator.
    // The static shell is sufficient for tool registration and prevents an
    // unhealthy project or global runtime from aborting the request early.
    const runtime = selection.home === 'all'
      ? staticRuntime
      : await resolveSelectedRuntime(selection);
    const server = new McpServer({ name: deps?.name ?? 'backlog-mcp', version: deps?.version ?? '0.0.0' });
    // ToolDeps carries write-boundary wiring; core builds WriteContext
    // per-write using these pieces. See ADR 0094.
    const homeReadCoordinator = deps?.resolveRuntime === undefined
      ? undefined
      : createRequestHomeReadCoordinator(
          resolveSelectedRuntime,
          selection.projectRoot,
        );
    const toolDeps = createRequestToolDeps(
      runtime,
      deps,
      homeReadCoordinator,
      reportIntentQuarantine,
    );
    registerTools(server, runtime.service, toolDeps);
    if (runtime.resourceManager) {
      runtime.resourceManager.registerResource(server);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      // Stateless transport = stateless telemetry session (review 0001):
      // this endpoint builds a fresh server per request, so each request
      // also handles inside its own minted telemetry session — two
      // independent HTTP requests must never share one. BACKLOG_SESSION
      // still overrides inside the scope; CLI processes are untouched.
      return await withRequestTelemetrySession(async function handleInSession() {
        await server.connect(transport);
        return transport.handleRequest(c.req.raw);
      });
    } catch (err) {
      // Without this, a throwing tool handler propagates out unlogged and
      // the bridge only sees a dropped socket ("mcp-remote lost connection").
      const error = err instanceof Error ? err : new Error(String(err));
      deps?.logError?.('MCP request failed', {
        method: c.req.method,
        message: error.message,
        stack: error.stack,
      });
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32603, message: `Internal error: ${error.message}` },
          id: null,
        },
        500,
      );
    }
  });

  // ── Viewer REST API ─────────────────────────────────────────────────────────

  // GET /tasks
  app.get('/tasks', async (c) => {
    const runtime = await resolveRequestRuntime(c.req);
    const filterParam = c.req.query('filter') ?? 'active';
    const q = c.req.query('q');
    const limit = parseInt(c.req.query('limit') ?? '10000', 10);

    const statusMap: Record<string, string[] | undefined> = {
      active: ['open', 'in_progress', 'blocked'],
      completed: ['done', 'cancelled'],
      all: undefined,
    };
    const status = statusMap[filterParam] as any;

    const results = await runtime.service.list({ status, query: q || undefined, limit });
    return c.json(results.map(function addProvenance(result) {
      return withEntityHomeProvenance(
        runtime,
        withMintedMemoryUsage(runtime, result),
      );
    }));
  });

  // GET /tasks/:id
  app.get('/tasks/:id', async (c) => {
    const runtime = await resolveRequestRuntime(c.req);
    const requestService = runtime.service;
    const id = c.req.param('id');
    const task = await requestService.get(id);
    if (!task) return c.json({ error: 'Not found' }, 404);

    const raw = await requestService.getMarkdown(id);
    const children = (
      await requestService.list({ parent_id: id, limit: 1000 })
    ).map(function addProvenance(child) {
      return withEntityHomeProvenance(runtime, child);
    });
    let parentTitle: string | undefined;
    const parentId = typeof task.parent_id === 'string'
      ? task.parent_id
      : undefined;
    if (parentId) {
      const parent = await requestService.get(parentId);
      parentTitle = parent?.title;
    }

    // R-9 visibility (ADR 0092.13): if this is a memory whose state_key has
    // other live holders, surface them so MetadataCard renders navigable
    // links + a contradiction chip. Empty/absent for the no-conflict case.
    let contradicts: string[] | undefined;
    let collisionCandidates: Awaited<ReturnType<typeof findCollisionCandidatesForMemory>> | undefined;
    // usage_series (ADR 0092.14): per-day touch counts from the JSONL, for the
    // viewer sparkline. Node-only (reader injected); omitted if no activity.
    let usage_series: number[] | undefined;
    if ((task.type ?? 'task') === 'memory') {
      const conflicts = await contradictsFor(requestService, task as Entity as Memory);
      if (conflicts.length > 0) contradicts = conflicts;
      try {
        collisionCandidates = await findCollisionCandidatesForMemory(requestService, id);
      } catch {
        // Collision review is advisory. Search unavailability must not make
        // the authoritative memory detail unreadable or claim a clean scan.
      }
      if (runtime.readUsageLines) {
        const series = usageSeries(runtime.readUsageLines(), id);
        if (hasUsage(series)) usage_series = series;
      }
    }

    return c.json({
      ...withEntityHomeProvenance(
        runtime,
        withMintedMemoryUsage(runtime, task),
      ),
      raw,
      parentTitle,
      children,
      ...(contradicts ? { contradicts } : {}),
      ...(collisionCandidates === undefined ? {} : { collision_candidates: collisionCandidates }),
      ...(usage_series ? { usage_series } : {}),
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
    if (selection.home === 'all' && deps?.resolveRuntime !== undefined) {
      const coordinator = createRequestHomeReadCoordinator(
        resolveSelectedRuntime,
        selection.projectRoot,
      );
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

    const runtime = await resolveSelectedRuntime(selection);
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
    const runtime = await resolveRequestRuntime(c.req);
    const result = c.req.query('candidates') === 'true'
      ? await findCollisionCandidatePairs(runtime.service)
      : await detectContradictions(runtime.service);
    return c.json(result);
  });

  // GET /api/desk — the Desk briefing (attention-viewer V1): ONE new
  // composition endpoint by design law. The server composes the fold from
  // store state; the viewer renders it verbatim, read-only.
  app.get('/api/desk', async (c) => {
    const runtime = await resolveRequestRuntime(c.req);
    const briefing = await desk(runtime.service, {
      readDocuments: runtime.readDeskDocuments,
      readEvaluationCandidates: runtime.readEvaluationCandidates,
      readGrounding: runtime.readGrounding,
    });
    return c.json({
      ...briefing,
      ...getHomeProvenance(runtime),
    });
  });

  // GET /api/status
  const startTime = Date.now();
  app.get('/api/status', async (c) => {
    const runtime = await resolveRequestRuntime(c.req);
    const counts = await runtime.service.counts();
    return c.json({
      version: deps?.version ?? '0.0.0',
      mode: deps?.db ? 'cloudflare-worker' : 'local',
      taskCount: counts.total_tasks + counts.total_epics,
      dataDir: runtime.home?.documentsDir ?? deps?.dataDir,
      port: parseInt(c.req.header('host')?.split(':')[1] ?? '0'),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      ...getHomeProvenance(runtime),
    });
  });

  // ── Recent homes (ADR 0128) ──────────────────────────────────────────────────
  // The switcher's source of truth: `global` (always) + every project home an
  // agent has worked against. Populated by use at the runtime-resolution seam,
  // never by scanning the filesystem (ADR 0112 R-9). Node-only; a Worker/legacy
  // server without a store simply returns just the global entry.
  const recentHomes = deps?.recentHomes;
  app.get('/api/homes', async (c) => {
    const userHomeDir = homedir();
    // The global entry carries its real, env-resolved root/documentsDir from
    // the domain model plus server-computed presentation (never a client-side
    // `~/.backlog` guess). Resolve the global runtime and project its home.
    const globalRuntime = await resolveSelectedRuntime({ home: 'global' });
    const globalHome = globalRuntime.home;
    const globalPresentation = presentGlobalHome(
      globalHome?.root ?? '',
      userHomeDir,
    );
    const projects = (recentHomes?.read() ?? []).map(function toItem(entry) {
      // Label/display_path are computed server-side from the same presenter,
      // so the UI renders identical strings for every home (ADR 0128).
      const presentation = presentProjectHome(entry.root, userHomeDir);
      return {
        home: 'project' as const,
        root: entry.root,
        label: presentation.label,
        display_path: presentation.display_path,
        first_seen: entry.first_seen,
        last_seen: entry.last_seen,
      };
    });
    return c.json({
      homes: [
        {
          home: 'global' as const,
          label: globalPresentation.label,
          ...(globalHome === undefined
            ? {}
            : {
                root: globalHome.root,
                documents_dir: globalHome.documentsDir,
                display_path: globalPresentation.display_path,
              }),
        },
        ...projects,
      ],
    });
  });

  // DELETE /api/homes/:root — forget one recent project (ADR 0128 R6). The
  // root is URL-encoded; forgetting is idempotent and never touches the home.
  app.delete('/api/homes/:root', (c) => {
    if (recentHomes === undefined) return c.json({ removed: false }, 200);
    let root: string;
    try {
      root = decodeURIComponent(c.req.param('root'));
    } catch {
      return c.json({ error: 'Invalid root encoding' }, 400);
    }
    return c.json({ removed: recentHomes.forget(root) });
  });

  // ── Operations ──────────────────────────────────────────────────────────────

  // GET /operations/count/:taskId  (must be before /operations)
  app.get('/operations/count/:taskId', async (c) => {
    const runtime = await resolveRequestRuntime(c.req);
    if (!runtime.operationLog) {
      return c.json({
        count: 0,
        ...getHomeProvenance(runtime),
      });
    }
    const count = await runtime.operationLog.countForTask(c.req.param('taskId'));
    return c.json({
      count,
      ...getHomeProvenance(
        runtime,
        runtime.getSourcePath?.(c.req.param('taskId')),
      ),
    });
  });

  // GET /operations — works identically for local and cloud via IOperationLog
  app.get('/operations', async (c) => {
    const runtime = await resolveRequestRuntime(c.req);
    const operationLog = runtime.operationLog;
    const requestService = runtime.service;
    if (!operationLog) return c.json([]);

    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const taskFilter = c.req.query('task');
    const date = c.req.query('date');
    const tz = c.req.query('tz');

    const operations = await operationLog.query({
      limit: date ? 1000 : limit,
      taskId: taskFilter || undefined,
      date: date || undefined,
      tzOffset: tz != null ? parseInt(tz) : undefined,
    });

    // Enrich with task/epic titles via the service (same for local and cloud)
    const taskCache = new Map<string, { title?: string; epicId?: string }>();
    const epicCache = new Map<string, string | undefined>();

    const enriched = await Promise.all(operations.map(async (rawOperation) => {
      const op = normalizeOperationEntry(rawOperation);
      const id = op.resourceId;
      if (!id) {
        const targetFilename = extractTargetFilename(op.mutation, op.params);
        return {
          ...op,
          ...(targetFilename ? { targetFilename } : {}),
          ...getHomeProvenance(runtime),
        };
      }

      if (!taskCache.has(id)) {
        const entity = await requestService.get(id);
        taskCache.set(id, {
          title: entity?.title,
          epicId: typeof entity?.parent_id === 'string'
            ? entity.parent_id
            : undefined,
        });
      }
      const cached = taskCache.get(id);
      if (cached === undefined) {
        return {
          ...op,
          ...getHomeProvenance(runtime, runtime.getSourcePath?.(id)),
        };
      }

      let epicTitle: string | undefined;
      if (cached.epicId) {
        if (!epicCache.has(cached.epicId)) {
          const epic = await requestService.get(cached.epicId);
          epicCache.set(cached.epicId, epic?.title);
        }
        epicTitle = epicCache.get(cached.epicId);
      }

      return {
        ...op,
        resourceTitle: cached.title,
        epicId: cached.epicId,
        epicTitle,
        targetFilename: extractTargetFilename(op.mutation, op.params),
        ...getHomeProvenance(runtime, runtime.getSourcePath?.(id)),
      };
    }));

    return c.json(enriched);
  });

  // ── SSE events ──────────────────────────────────────────────────────────────
  app.get('/events', async (c) => {
    const runtime = await resolveRequestRuntime(c.req);
    const eventBus = runtime.eventBus;
    if (eventBus) {
      // Node.js: live push via eventBus
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc = new TextEncoder();

      writer.write(enc.encode(': connected\n\n'));

      const onEvent: BacklogEventCallback = function onEvent(event) {
        const payload = {
          ...event,
          ...getHomeProvenance(runtime, runtime.getSourcePath?.(event.id)),
        };
        writer.write(
          enc.encode(`id: ${event.seq}\ndata: ${JSON.stringify(payload)}\n\n`),
        ).catch(() => {});
      };
      eventBus.subscribe(onEvent);

      const heartbeat = setInterval(() => {
        writer.write(enc.encode(': heartbeat\n\n')).catch(() => clearInterval(heartbeat));
      }, 30000);

      // Cleanup when client disconnects
      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        eventBus.unsubscribe(onEvent);
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
  const hasRequestResources = deps?.resourceManager !== undefined
    || deps?.resolveRuntime !== undefined;
  if (hasRequestResources) {
    // Resource proxy — serves local filesystem resources
    app.get('/resource', async (c) => {
      const filePath = c.req.query('path');

      if (!filePath) {
        return c.json({ error: 'Missing path parameter' }, 400);
      }

      const runtime = await resolveRequestRuntime(c.req);
      const resourceManager = runtime.resourceManager;
      const readLocalFile = runtime.readLocalFile;
      if (resourceManager === undefined || readLocalFile === undefined) {
        return c.json({ error: 'Resource access unavailable' }, 404);
      }

      const content = readLocalFile(filePath);
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
          mcpUri: resourceManager.toUri(filePath),
          ext,
          ...getHomeProvenance(
            runtime,
            filePath.startsWith('/') ? undefined : filePath,
          ),
        });
      } catch (error: unknown) {
        return c.json({
          error: 'Failed to read file',
          message: errorMessage(error),
        }, 500);
      }
    });

    // MCP resource proxy — resolves mcp://backlog/ URIs to filesystem content
    app.get('/mcp/resource', async (c) => {
      const uri = c.req.query('uri');

      if (!uri || !uri.startsWith('mcp://backlog/')) {
        return c.json({ error: 'Invalid MCP URI' }, 400);
      }

      const runtime = await resolveRequestRuntime(c.req);
      const resourceManager = runtime.resourceManager;
      if (resourceManager === undefined) {
        return c.json({ error: 'Resource access unavailable' }, 404);
      }

      try {
        const resource = resourceManager.read(uri);
        const filePath = resourceManager.resolve(uri);
        const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';

        return c.json({
          content: resource.content,
          frontmatter: resource.frontmatter || {},
          type: resource.mimeType,
          path: filePath,
          fileUri: `file://${filePath}`,
          mcpUri: uri,
          ext,
          ...getHomeProvenance(
            runtime,
            decodeURIComponent(new URL(uri).pathname).replace(/^\/+/u, ''),
          ),
        });
      } catch (error: unknown) {
        return c.json({
          error: 'Resource not found',
          uri,
          message: errorMessage(error),
        }, 404);
      }
    });

    app.get('/open', (c) => {
      const uri = c.req.query('uri');
      if (!uri) return c.json({ error: 'Missing uri' }, 400);
      return c.redirect(`/?resource=${encodeURIComponent(uri)}`);
    });

    // Typed-URL chrome alias (same class as /open — a redirect into the
    // SPA, zero composition): the human starts the day at /desk. Existing
    // query params (home/project_root) ride along — home-scoped like
    // every page.
    app.get('/desk', (c) => {
      const params = new URLSearchParams(new URL(c.req.url).search);
      params.set('view', 'desk');
      return c.redirect(`/?${params.toString()}`);
    });
  }

  // Shutdown remains app-scoped and retains its existing Node registration.
  if (deps?.requestShutdown !== undefined) {
    app.post('/shutdown', (c) => {
      void Promise.resolve(deps.requestShutdown?.()).catch(function logFailure(
        error,
      ) {
        deps.logError?.('Shutdown failed', {
          message: errorMessage(error),
        });
      });
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
