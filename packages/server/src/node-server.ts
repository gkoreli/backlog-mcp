#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
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

/** Find and kill the process holding a TCP port. Returns true if killed. */
async function killPortHolder(targetPort: number): Promise<boolean> {
  try {
    const out = execSync(`lsof -ti TCP:${targetPort} -sTCP:LISTEN`, { encoding: 'utf-8' }).trim();
    const pids = out.split('\n').map(Number).filter(Boolean);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
    if (pids.length > 0) {
      // Wait for the port to free up
      await new Promise(resolve => setTimeout(resolve, 200));
      return true;
    }
  } catch {}
  return false;
}

// Resilience: a port collision means another instance already owns this port.
// In development, kill the incumbent and retry — stale zombies from previous
// sessions silently block `pnpm dev` otherwise.
// In production, defer to the incumbent and exit *cleanly* (code 0) — the
// supervisor treats code 0 as "stop", so no respawn loop.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    if (paths.environment === 'development') {
      killPortHolder(port).then((killed) => {
        if (killed) {
          console.log(`⚠️  Killed stale process on port ${port} — retrying...`);
          setTimeout(() => {
            server.listen({ port, hostname: '0.0.0.0' });
          }, 300);
        } else {
          console.error(`❌ Port ${port} in use and could not kill the holder. Change BACKLOG_VIEWER_PORT or kill it manually.`);
          process.exit(1);
        }
      });
    } else {
      logger.fatalSync('Port already owned by another instance — deferring', { port });
      process.exit(0);
    }
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
