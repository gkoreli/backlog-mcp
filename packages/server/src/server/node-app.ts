import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { createApp } from './hono-app.js';
import { envActor } from '../operations/logger.js';
import { ambientAgentIdentity } from '../storage/local/agent-identity.js';
import { paths } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { setViewerCacheHeaders } from '../utils/viewer-cache.js';
import type { CreateNodeAppOptions } from './node-app.types.js';

/**
 * Build the fully-wired Node Hono app (storage, SSE event bus, JSONL operation
 * log, memory, MCP, static viewer) — the single source of truth for the app
 * graph shared by:
 *   - `node-server.ts` (the published/detached server: adds serve() + port
 *     collision + process lifecycle)
 *   - the Vite dev entry consumed by `@hono/vite-dev-server` (ADR 0110), which
 *     runs THIS app on Vite's single origin with HMR — no proxy, no second
 *     process.
 *
 * Transport-free: no listener, no process handlers. The caller owns the server.
 */
export function createNodeApp(options: CreateNodeAppOptions): Hono {
  const runtime = options.runtime;
  return createApp(runtime.service, {
    name: paths.packageJson.name,
    version: paths.getVersion(),
    dataDir: runtime.home?.documentsDir,
    actor: envActor(),
    // ADR 0119.1: the attribution ladder resolves once per server boot;
    // the wakeup briefing discloses the value and its winning rung.
    agentIdentity: ambientAgentIdentity(),
    operationLog: runtime.operationLog,
    operationLogger: runtime.operationLogger,
    eventBus: runtime.eventBus,
    memoryComposer: runtime.memoryComposer,
    mintMemoryEntry: runtime.mintMemoryEntry,
    usageTracker: runtime.usageTracker,
    resourceManager: runtime.resourceManager,
    staticMiddleware: options.skipStatic
      ? undefined
      : serveStatic({ root: paths.viewerDist, onFound: setViewerCacheHeaders }),
    readLocalFile: runtime.readLocalFile,
    readUsageLines: runtime.readUsageLines,
    identityPath: runtime.identityPath,
    visionPath: runtime.visionPath,
    resolveRuntime: options.resolveRuntime,
    requestShutdown: options.requestShutdown,
    logError: (message, data) => logger.error(message, data),
  });
}
