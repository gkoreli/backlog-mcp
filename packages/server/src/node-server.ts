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
import { resolveViewerPort } from './utils/ports.js';
import { logger } from './utils/logger.js';
import { resolveSourcePath } from './utils/resolve-source-path.js';

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
  staticMiddleware: serveStatic({ root: paths.viewerDist }),
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

// Resilience: a port collision means another instance already owns this port.
// Defer to the incumbent and exit *cleanly* (code 0) rather than crashing —
// the supervisor treats code 0 as "stop", so no respawn loop. Without this,
// concurrent/duplicate bridges crash-loop and corrupt the stdio stream.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // Sync log: process.exit() below would drop an async write before flush.
    logger.fatalSync('Port already owned by another instance — deferring', { port });
    process.exit(0);
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
