#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { createNodeApp } from './server/node-app.js';
import { BacklogService } from './storage/local/backlog-service.js';
import { paths } from './utils/paths.js';
import { getServerVersion, shutdownServer } from './cli/server-manager.js';
import { createPortCollisionResolver, killPortHolder, sleep } from './server/port-collision.js';
import { resolveViewerPort } from './utils/ports.js';
import { logger } from './utils/logger.js';

const service = BacklogService.getInstance();
const port = resolveViewerPort(paths.environment);
// Single source of truth for the wired app graph — shared with the Vite dev
// entry (ADR 0110). This server adds the listener + port collision + lifecycle.
const app = createNodeApp();

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
