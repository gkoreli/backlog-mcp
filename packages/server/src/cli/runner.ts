import { BacklogService } from '../storage/backlog-service.js';
import { NotFoundError, ValidationError } from '../core/types.js';
import { operationLogger, envActor } from '../operations/logger.js';
import type { WriteContext } from '../core/types.js';

/**
 * Build a WriteContext for CLI-originated writes.
 *
 * Per-invocation so each command reads env freshly — a long-lived REPL or
 * sequence of commands with different BACKLOG_ACTOR_NAME values each get
 * their own actor. No event bus — CLI is one-shot, nothing subscribes.
 * See ADR 0094.
 */
export function cliWriteContext(): WriteContext {
  return {
    actor: envActor(),
    operationLog: operationLogger,
  };
}

export async function run<R>(
  handler: (service: BacklogService) => Promise<R>,
  format: (result: R) => string,
  json: boolean,
): Promise<void> {
  try {
    const service = BacklogService.getInstance();
    const result = await handler(service);
    console.log(json ? JSON.stringify(result, null, 2) : format(result));
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
