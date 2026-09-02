#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { paths } from './utils/paths.js';
import { getServerVersion, shutdownServer } from './cli/server-manager.js';
import {
  createPortCollisionResolver,
  isPortInUse,
  killPortHolder,
  resolvePortBeforeBind,
  sleep,
  type PortCollisionConfig,
} from './server/port-collision.js';
import {
  LOCAL_SERVER_HOSTNAME,
  resolveViewerPort,
} from './utils/ports.js';
import { logger } from './utils/logger.js';
import { requestExit } from './utils/process-exit.js';
import { createLocalNodeApp } from './server/local-node-app.js';

const port = resolveViewerPort(paths.environment);
const collisionConfig: PortCollisionConfig = {
  port,
  ourVersion: paths.getVersion(),
  isDevelopment: paths.environment === 'development',
};
const announce = {
  log: (message: string) => console.log(message),
  errorLog: (message: string) => console.error(message),
  fatalSync: (message: string, data?: Record<string, unknown>) => logger.fatalSync(message, data),
};

/**
 * How long a draining shutdown may take before we give up and hard-exit
 * (ADR 0130 R4). The fallback is the only normal-path `process.exit` left in
 * the daemon; it logs first so a leaked handle is diagnosable.
 */
const DRAIN_FALLBACK_MS = 5000;

async function startServer(): Promise<void> {
  const composition = await createLocalNodeApp({
    requestShutdown: () => shutdown(0),
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

  let shuttingDown = false;
  /**
   * Drain, never hard-exit (ADR 0130 R4): close the listener and its
   * connections, stop every runtime (watchers unsubscribe), set the exit
   * code, and let the event loop empty. The ONNX runtime then releases its
   * thread pool in order instead of aborting under C `exit()`.
   */
  async function shutdown(code: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Server shutting down', { code });
    console.log('Shutting down gracefully...');
    const forced = setTimeout(function forceExit() {
      logger.fatalSync('Forced exit: event loop did not drain', { code, after_ms: DRAIN_FALLBACK_MS });
      process.exit(code);
    }, DRAIN_FALLBACK_MS);
    forced.unref();

    server.close();
    if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    try {
      await composition.registry.closeAll();
    } catch (error) {
      logger.error('Runtime shutdown failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    requestExit(code);
  }

  // Port-collision handling lives in ./server/port-collision (pure decision +
  // dependency-injected resolver, unit-tested). The pre-bind probe below has
  // normally already settled the port; this is the fallback for the bind race.
  const resolvePortCollision = createPortCollisionResolver(
    collisionConfig,
    {
      getIncumbentVersion: getServerVersion,
      shutdownIncumbent: shutdownServer,
      killPortHolder,
      rebind: () => server.listen({ port, hostname: LOCAL_SERVER_HOSTNAME }),
      exit: (code) => { void shutdown(code); },
      sleep,
      ...announce,
    },
  );

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      void resolvePortCollision();
      return;
    }
    logger.fatalSync('Server error', { code: err.code, message: err.message, stack: err.stack });
    void shutdown(1);
  });

  process.on('SIGTERM', function onSigterm() {
    void shutdown(0);
  });
  process.on('SIGINT', function onSigint() {
    void shutdown(0);
  });

  // Last-resort crash visibility. Without these, an unhandled throw in a tool
  // or transport handler kills the detached server silently — the bridge only
  // reports a lost connection, with no trace anywhere. Log the stack first.
  process.on('uncaughtException', (err: Error) => {
    // Sync log before exit — an async write would be dropped by process.exit.
    logger.fatalSync('Uncaught exception', { message: err.message, stack: err.stack });
    console.error('Uncaught exception:', err);
    // Process state is undefined after an uncaught exception — flush and exit.
    // This hard exit is sanctioned by ADR 0130 R6.
    try { composition.runtime.service.flush(); } catch { /* best effort */ }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Unhandled rejection', { message: err.message, stack: err.stack });
    console.error('Unhandled rejection:', err);
  });
}

// Decide the port BEFORE composing the app (ADR 0130 R3): a deferring
// instance must exit having loaded nothing — no runtime, no search index, no
// embedding model — so the exit is instant and cannot trip the ONNX abort.
const preBind = await resolvePortBeforeBind(collisionConfig, {
  isPortInUse,
  getIncumbentVersion: getServerVersion,
  shutdownIncumbent: shutdownServer,
  killPortHolder,
  sleep,
  ...announce,
});
if (preBind.action === 'exit') {
  requestExit(preBind.code);
} else {
  await startServer();
}
