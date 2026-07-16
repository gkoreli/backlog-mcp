import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { createApp } from './hono-app.js';
import { BacklogService } from '../storage/local/backlog-service.js';
import { resourceManager } from '../resources/manager.js';
import { operationLogger, envActor } from '../operations/logger.js';
import { eventBus } from '../events/index.js';
import { defaultMemoryComposer, defaultUsageTracker, readUsageLines } from '../memory/bootstrap.js';
import { paths } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { resolveSourcePath } from '../utils/resolve-source-path.js';
import { setViewerCacheHeaders } from '../utils/viewer-cache.js';
import type { CreateNodeAppOptions } from './node-app.types.js';

function readLocalFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

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
export function createNodeApp(options: CreateNodeAppOptions = {}): Hono {
  const service = BacklogService.getInstance();
  return createApp(service, {
    name: paths.packageJson.name,
    version: paths.getVersion(),
    dataDir: paths.backlogDataDir,
    actor: envActor(),
    operationLog: operationLogger,
    eventBus,
    memoryComposer: defaultMemoryComposer,
    usageTracker: defaultUsageTracker,
    resourceManager,
    staticMiddleware: options?.skipStatic
      ? undefined
      : serveStatic({ root: paths.viewerDist, onFound: setViewerCacheHeaders }),
    readLocalFile,
    readUsageLines,
    resolveSourcePath,
    identityPath: join(paths.backlogDataDir, 'identity.md'),
    resolveRuntime: options.resolveRuntime,
    logError: (message, data) => logger.error(message, data),
  });
}
