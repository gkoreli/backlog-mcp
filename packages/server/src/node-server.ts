#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './server/hono-app.js';
import { BacklogService } from './storage/local/backlog-service.js';
import { resourceManager } from './resources/manager.js';
import { operationLogger, envActor } from './operations/logger.js';
import { eventBus } from './events/index.js';
import { defaultMemoryComposer, defaultUsageTracker, readUsageLines } from './memory/bootstrap.js';
import { paths } from './utils/paths.js';
import { getServerVersion, shutdownServer } from './cli/server-manager.js';
import { createPortCollisionResolver, killPortHolder, sleep } from './server/port-collision.js';
import { resolveViewerPort } from './utils/ports.js';
import { logger } from './utils/logger.js';
import { resolveSourcePath } from './utils/resolve-source-path.js';
import { setViewerCacheHeaders } from './utils/viewer-cache.js';

function readLocalFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try { return readFileSync(filePath, 'utf-8'); } catch { return null; }
}

const service = BacklogService.getInstance();
const port = resolveViewerPort(paths.environment);

// Node mode wires actor from env, JSONL operation log, and the real
// event bus for SSE push. Core write functions build a WriteContext
// from these pieces per-request (see ADR 0094).
const app = createApp(service, {
  name: paths.packageJson.name,
  version: paths.getVersion(),
  dataDir: paths.backlogDataDir,
  actor: envActor(),
  operationLog: operationLogger,
  eventBus,
  memoryComposer: defaultMemoryComposer,
  usageTracker: defaultUsageTracker,
  resourceManager,
  staticMiddleware: serveStatic({ root: paths.viewerDist, onFound: setViewerCacheHeaders }),
  readLocalFile,
  readUsageLines,
  resolveSourcePath,
  identityPath: join(paths.backlogDataDir, 'identity.md'),
  logError: (message, data) => logger.error(message, data),
});

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  logger.info('Server started', { port: info.port, dataDir: paths.backlogDataDir, version: paths.getVersion() });
  console.log(`Backlog MCP server running on http://localhost:${info.port}`);
  console.log(`- Viewer: http://localhost:${info.port}/`);
  console.log(`- MCP endpoint: http://localhost:${info.port}/mcp`);
  console.log(`- Data directory: ${paths.backlogDataDir}`);
});

// Port-collision handling lives in ./server/port-collision (pure decision +
// dependency-injected resolver, unit-tested). Here we only wire the real
// effects: probe/shutdown the incumbent over HTTP, rebind the Hono server,
// and surface every branch to the console + structured log (never silent).
const resolvePortCollision = createPortCollisionResolver(
  { port, ourVersion: paths.getVersion(), isDevelopment: paths.environment === 'development' },
  {
    getIncumbentVersion: getServerVersion,
    shutdownIncumbent: shutdownServer,
    killPortHolder,
    rebind: () => server.listen({ port, hostname: '0.0.0.0' }),
    exit: (code) => process.exit(code),
    log: (message) => console.log(message),
    errorLog: (message) => console.error(message),
    fatalSync: (message, data) => logger.fatalSync(message, data),
    sleep,
  },
);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    void resolvePortCollision();
    return;
  }
  logger.fatalSync('Server error', { code: err.code, message: err.message, stack: err.stack });
  process.exit(1);
});

const shutdown = async () => {
  logger.info('Server shutting down');
  console.log('Shutting down gracefully...');
  service.flush();
  server.close();
  setTimeout(() => process.exit(0), 500);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Last-resort crash visibility. Without these, an unhandled throw in a tool
// or transport handler kills the detached server silently — the bridge only
// reports a lost connection, with no trace anywhere. Log the stack first.
process.on('uncaughtException', (err: Error) => {
  // Sync log before exit — an async write would be dropped by process.exit.
  logger.fatalSync('Uncaught exception', { message: err.message, stack: err.stack });
  console.error('Uncaught exception:', err);
  // Process state is undefined after an uncaught exception — flush and exit.
  try { service.flush(); } catch { /* best effort */ }
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('Unhandled rejection', { message: err.message, stack: err.stack });
  console.error('Unhandled rejection:', err);
});
