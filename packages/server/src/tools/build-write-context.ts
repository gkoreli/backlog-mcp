/**
 * Helper: build a per-request WriteContext from ToolDeps.
 *
 * The Hono layer wires the pieces (actor, operationLog, eventBus) into
 * deps at app construction. Each MCP tool handler calls this to get a
 * ctx for the specific write it's about to perform.
 *
 * Fails loud if the required pieces are missing — this is a server-side
 * wiring bug, not a user-facing error.
 */

import type { WriteContext } from '../core/types.js';
import type { ToolDeps } from './index.js';

export function buildWriteContext(deps: ToolDeps | undefined): WriteContext {
  if (!deps?.actor || !deps?.operationLog) {
    throw new Error(
      'buildWriteContext: tool deps missing actor or operationLog — ' +
      'check hono-app / node-server / worker-entry bootstrap wiring'
    );
  }
  return {
    actor: deps.actor,
    operationLog: deps.operationLog,
    eventBus: deps.eventBus,
  };
}
