import { MemoryCorrectionError } from '../core/memory-correction.contract.js';
import { EntityWriteConflictError } from '../core/entity-mutation.contract.js';
import { SubstrateWriteError } from '../core/substrates/substrate-write-error.js';
import { WorkspaceHomeResolutionError } from '../core/backlog-home.errors.js';
import { NotFoundError, ValidationError } from '../core/types.js';
import { requestExit } from '../utils/process-exit.js';

/** Where the failure is reported; injectable for tests. */
export interface CliFailureIo {
  error(message: string): void;
}

/**
 * Errors the CLI treats as expected user-facing outcomes: the message is the
 * whole story and a stack trace would only bury it.
 */
function isDomainError(error: unknown): error is Error {
  return error instanceof NotFoundError
    || error instanceof MemoryCorrectionError
    || error instanceof EntityWriteConflictError
    || error instanceof ValidationError
    || error instanceof SubstrateWriteError;
}

function workspaceHomeFailureMessage(error: WorkspaceHomeResolutionError): string {
  if (error.reason === 'missing-boundary') {
    return 'No project boundary found for wakeup; run inside a project, pass '
      + '--project-root <path>, or explicitly select --home global';
  }
  return `${error.message}; pass --project-root <path>`;
}

/**
 * The one CLI error boundary (ADR 0130 R5). Prints the failure and requests
 * exit code 1 without hard-exiting, so a command that already ran embedding
 * inference drains cleanly instead of aborting in the ONNX runtime.
 */
export function reportCliFailure(error: unknown, io: CliFailureIo = console): void {
  if (error instanceof WorkspaceHomeResolutionError) {
    io.error(workspaceHomeFailureMessage(error));
  } else if (isDomainError(error)) {
    io.error(error.message);
  } else if (error instanceof Error) {
    io.error(error.stack ?? error.message);
  } else {
    io.error(String(error));
  }
  requestExit(1);
}
