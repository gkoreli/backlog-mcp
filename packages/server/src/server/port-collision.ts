/**
 * Port-collision policy for a fresh backlog-mcp instance that finds the viewer
 * port already bound (EADDRINUSE).
 *
 * This is a **server-runtime** concern (it governs how the HTTP server claims
 * its port), so it lives under `server/` — not `cli/`, which holds only thin
 * command adapters. The decision is a pure function; the resolver is a
 * dependency-injected orchestrator so both are unit-testable with no real
 * process, socket, or filesystem (see `__tests__/port-collision.test.ts`).
 */

import { execSync } from 'node:child_process';
import { isOlderVersion } from '../utils/version.js';

/**
 * Action a fresh instance takes when it finds the port already bound.
 * - `takeover`   — incumbent is a strictly older backlog-mcp; shut it down and rebind (upgrade path).
 * - `defer`      — incumbent is an equal-or-newer backlog-mcp, or an unidentified holder in production; yield and exit cleanly.
 * - `kill-holder`— development only: an unidentified holder; kill the stale process and rebind.
 */
export type PortCollisionAction = 'takeover' | 'defer' | 'kill-holder';

/**
 * Pure decision for a port collision under the **monotonic newer-wins**
 * invariant. Side-effect free so it can be exhaustively unit-tested.
 *
 * Invariant (anti-symmetry ⇒ no ping-pong): for two *different* backlog-mcp
 * versions a, b exactly one orientation yields `takeover` and the reverse
 * yields `defer`. The loser never fights back, so the multi-bridge flap that
 * 5211cb1 fixed cannot recur. Equal versions always `defer`.
 *
 * @param incumbent      Version reported by the process on the port, or `null`
 *                       when nothing answered `/version` (not our server, or
 *                       already dying).
 * @param ours           Our own version.
 * @param isDevelopment  Whether we're running in the development environment.
 */
export function decidePortCollision(
  incumbent: string | null,
  ours: string,
  isDevelopment: boolean,
): PortCollisionAction {
  if (incumbent !== null) {
    return isOlderVersion(incumbent, ours) ? 'takeover' : 'defer';
  }
  // Unidentified holder: reclaim aggressively in dev, defer safely in prod.
  return isDevelopment ? 'kill-holder' : 'defer';
}

/** Side effects the resolver needs — injected so the orchestration is unit-testable. */
export interface PortCollisionEffects {
  /** Probe the incumbent's `/version`; `null` if nothing answers. */
  getIncumbentVersion(port: number): Promise<string | null>;
  /** Ask the incumbent backlog-mcp to shut down gracefully. */
  shutdownIncumbent(port: number): Promise<void>;
  /** Kill whatever process holds the port (dev escape hatch). Returns true if killed. */
  killPortHolder(port: number): Promise<boolean>;
  /** Re-attempt binding the server to the port. */
  rebind(): void;
  /** Terminate the process with an exit code. */
  exit(code: number): void;
  /** Human-facing stdout line (a collision is never silent). */
  log(message: string): void;
  /** Human-facing stderr line. */
  errorLog(message: string): void;
  /** Synchronous structured log written before a pre-exit path. */
  fatalSync(message: string, data?: Record<string, unknown>): void;
  /** Await a delay (injected so tests run instantly). */
  sleep(ms: number): Promise<void>;
}

export interface PortCollisionConfig {
  port: number;
  ourVersion: string;
  isDevelopment: boolean;
  /** Bound the takeover retries so a slow incumbent shutdown converges instead of looping. Default 5. */
  maxTakeoverAttempts?: number;
}

/**
 * Build a stateful resolver for the `server.on('error')` EADDRINUSE path. The
 * returned function maps {@link decidePortCollision} to concrete effects and
 * carries the bounded retry budget across re-fires (a slow incumbent shutdown
 * can briefly re-occupy the port).
 */
export function createPortCollisionResolver(
  config: PortCollisionConfig,
  effects: PortCollisionEffects,
): () => Promise<void> {
  const { port, ourVersion, isDevelopment } = config;
  const maxAttempts = config.maxTakeoverAttempts ?? 5;
  let takeoverAttempts = 0;

  return async function resolvePortCollision(): Promise<void> {
    const incumbent = await effects.getIncumbentVersion(port);
    const action = decidePortCollision(incumbent, ourVersion, isDevelopment);

    if (action === 'takeover') {
      // incumbent is non-null here (decision only returns 'takeover' for an older incumbent).
      if (takeoverAttempts++ >= maxAttempts) {
        effects.errorLog(`Port ${port}: could not take over older v${incumbent} after ${maxAttempts} attempts.`);
        effects.fatalSync('Takeover exhausted', { port, incumbent, ours: ourVersion });
        effects.exit(1);
        return;
      }
      effects.log(`Port ${port} held by older v${incumbent} — shutting it down and taking over as v${ourVersion}...`);
      await effects.shutdownIncumbent(port);
      await effects.sleep(1000);
      effects.rebind();
      return;
    }

    if (action === 'kill-holder') {
      const killed = await effects.killPortHolder(port);
      if (killed) {
        effects.log(`⚠️  Killed stale process on port ${port} — retrying...`);
        await effects.sleep(300);
        effects.rebind();
        return;
      }
      effects.errorLog(`Port ${port} in use and could not kill the holder. Change BACKLOG_VIEWER_PORT or kill it manually.`);
      effects.exit(1);
      return;
    }

    // action === 'defer'
    if (incumbent) {
      effects.log(`Port ${port} already served by v${incumbent} (>= v${ourVersion}) — deferring to the running server.`);
      effects.fatalSync('Port owned by equal-or-newer instance — deferring', { port, incumbent, ours: ourVersion });
    } else {
      effects.errorLog(`Port ${port} is in use by an unidentified process. Change BACKLOG_VIEWER_PORT or stop it manually.`);
      effects.fatalSync('Port held by unidentified process — deferring', { port, ours: ourVersion });
    }
    effects.exit(0);
  };
}

/** Default {@link PortCollisionEffects.sleep}. */
export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Default {@link PortCollisionEffects.killPortHolder}: find the PID listening
 * on the port via `lsof` and SIGTERM it. Returns true if a holder was killed.
 */
export async function killPortHolder(targetPort: number): Promise<boolean> {
  try {
    const out = execSync(`lsof -ti TCP:${targetPort} -sTCP:LISTEN`, { encoding: 'utf-8' }).trim();
    const pids = out.split('\n').map(Number).filter(Boolean);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    if (pids.length > 0) {
      await sleep(200); // let the port free up
      return true;
    }
  } catch { /* lsof found nothing / not available */ }
  return false;
}
