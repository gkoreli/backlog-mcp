#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { paths } from './utils/paths.js';
import { getServerVersion, shutdownServer } from './cli/server-manager.js';
import { createPortCollisionResolver, killPortHolder, sleep } from './server/port-collision.js';
import {
  LOCAL_SERVER_HOSTNAME,
  resolveViewerPort,
} from './utils/ports.js';
import { logger } from './utils/logger.js';
import { createLocalNodeApp } from './server/local-node-app.js';

const port = resolveViewerPort(paths.environment);
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Server shutting down');
  console.log('Shutting down gracefully...');
  server.close();
  setTimeout(() => process.exit(0), 500);
  try {
    await composition.registry.closeAll();
  } catch (error) {
    logger.error('Runtime shutdown failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const composition = await createLocalNodeApp({
  requestShutdown: shutdown,
});
const app = composition.app;

const server = serve({
  fetch: app.fetch,
  port,
  hostname: LOCAL_SERVER_HOSTNAME,
}, (info) => {
  logger.info('Server started', {
    port: info.port,
    dataDir: composition.home.documentsDir,
    version: paths.getVersion(),
  });
  console.log(`Backlog MCP server running on http://localhost:${info.port}`);
  console.log(`- Viewer: http://localhost:${info.port}/`);
  console.log(`- MCP endpoint: http://localhost:${info.port}/mcp`);
  console.log(`- Data directory: ${composition.home.documentsDir}`);
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
    rebind: () => server.listen({ port, hostname: LOCAL_SERVER_HOSTNAME }),
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

process.on('SIGTERM', function onSigterm() {
  void shutdown();
});
process.on('SIGINT', function onSigint() {
  void shutdown();
});

// Last-resort crash visibility. Without these, an unhandled throw in a tool
// or transport handler kills the detached server silently — the bridge only
// reports a lost connection, with no trace anywhere. Log the stack first.
process.on('uncaughtException', (err: Error) => {
  // Sync log before exit — an async write would be dropped by process.exit.
  logger.fatalSync('Uncaught exception', { message: err.message, stack: err.stack });
  console.error('Uncaught exception:', err);
  // Process state is undefined after an uncaught exception — flush and exit.
  try { composition.runtime.service.flush(); } catch { /* best effort */ }
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('Unhandled rejection', { message: err.message, stack: err.stack });
  console.error('Unhandled rejection:', err);
});
