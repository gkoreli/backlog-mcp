/** Stateless MCP request assembly, explicit home selection and transport handling (ADR 0136). */
import type { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { homedir } from 'node:os';
import { registerTools, type ToolDeps } from '../tools/index.js';
import type { AppRequestRuntime, AppRequestRuntimeResolver, CorpusCheckerResolver } from '../composition/app-request-runtime.types.js';
import { registerBacklogCheckTool } from '../tools/backlog-check.js';
import { managedWriteDependencies } from '../composition/managed-write-context.js';
import { createWriteProvenance } from '../composition/write-provenance.js';
import { createSelectedHomeReadCoordinator } from '../composition/home-read-runtime.js';
import type { HomeReadCoordinator } from '../core/home-read-coordinator.types.js';
import { withRequestTelemetrySession } from '../memory/retrieval-telemetry.js';
import type { SubstrateIntentQuarantineDiagnostic } from '../tools/register-substrate-intents.types.js';
import { isCorpusCheckRequest, selectMcpRequestRuntime } from './mcp-request-runtime.js';
import { selectAppRequestRuntime } from './request-selection.js';

type StaticToolDefaults = Pick<ToolDeps, 'actor' | 'agentIdentity'>;

/** Only app-wide transport identity/defaults and the selected runtime resolver. */
export interface McpRouteOptions {
  staticRuntime: AppRequestRuntime;
  resolveRuntime?: AppRequestRuntimeResolver;
  resolveCorpusChecker?: CorpusCheckerResolver;
  defaults?: StaticToolDefaults;
  name?: string;
  version?: string;
  logError?: (message: string, data?: Record<string, unknown>) => void;
}

function createRequestToolDeps(
  runtime: AppRequestRuntime,
  deps: StaticToolDefaults | undefined,
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
    corpusChecker: runtime.corpusChecker,
    ...managedWriteDependencies({ ...runtime, actor: runtime.home === undefined ? deps?.actor : runtime.actor }),
    agentIdentity: runtime.home === undefined
      ? deps?.agentIdentity
      : runtime.agentIdentity,
    operationLogger: runtime.operationLogger,
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
    writeProvenance: createWriteProvenance(runtime, homedir()),
  };
}

/** Mount one request-owned MCP server; cross-home tools resolve independently. */
export function registerMcpRoute(app: Hono, options: McpRouteOptions): void {
  const staticRuntime = options.staticRuntime;
  const reported = new Set<string>();
  function reportIntentQuarantine(diagnostic: SubstrateIntentQuarantineDiagnostic): void {
    const key = JSON.stringify(diagnostic);
    if (reported.has(key)) return;
    reported.add(key);
    if (options.logError !== undefined) options.logError('Substrate intent quarantined', { ...diagnostic });
    else console.error('Substrate intent quarantined', { ...diagnostic });
  }
  const resolveSelectedRuntime: AppRequestRuntimeResolver = options.resolveRuntime ?? (async function resolveStaticRuntime() { return staticRuntime; });
  // MCP endpoint — WebStandardStreamableHTTPServerTransport works on Node.js + Workers
  app.all('/mcp', async function serveMcp(c) {
    const selection = await selectMcpRequestRuntime(
      c.req.raw,
      selectAppRequestRuntime(c.req),
    );
    // Cross-home tools resolve both homes inside the allSettled coordinator.
    // The static shell is sufficient for tool registration and prevents an
    // unhealthy project or global runtime from aborting the request early.
    const checkOnly = await isCorpusCheckRequest(c.req.raw);
    const runtime = checkOnly || selection.home === 'all'
      ? staticRuntime
      : await resolveSelectedRuntime(selection);
    const server = new McpServer({ name: options.name ?? 'backlog-mcp', version: options.version ?? '0.0.0' });
    // ToolDeps carries write-boundary wiring; core builds WriteContext
    // per-write using these pieces. See ADR 0094.
    const homeReadCoordinator = options.resolveRuntime === undefined
      ? undefined
      : createSelectedHomeReadCoordinator(
          resolveSelectedRuntime,
          selection.projectRoot,
        );
    if (checkOnly) {
      const checker = options.resolveCorpusChecker === undefined
        ? (options.resolveRuntime === undefined && selection.home === undefined && selection.projectRoot === undefined
          ? runtime.corpusChecker : undefined)
        : await options.resolveCorpusChecker(selection);
      if (checker === undefined) return c.json({ error: 'Corpus checking capability is unavailable in this runtime.' }, 503);
      registerBacklogCheckTool(server, checker);
    } else {
      const toolDeps = createRequestToolDeps(
        runtime,
        options.defaults,
        homeReadCoordinator,
        reportIntentQuarantine,
      );
      registerTools(server, runtime.service, toolDeps);
      if (runtime.resourceManager) {
        runtime.resourceManager.registerResource(server);
      }
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
      options.logError?.('MCP request failed', {
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

}
