import { SubstrateWriteError } from '../core/substrates/substrate-write-error.js';
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
    || error instanceof ValidationError
    || error instanceof SubstrateWriteError;
}

/**
 * The one CLI error boundary (ADR 0130 R5). Prints the failure and requests
 * exit code 1 without hard-exiting, so a command that already ran embedding
 * inference drains cleanly instead of aborting in the ONNX runtime.
 */
export function reportCliFailure(error: unknown, io: CliFailureIo = console): void {
  if (isDomainError(error)) {
    io.error(error.message);
  } else if (error instanceof Error) {
    io.error(error.stack ?? error.message);
  } else {
    io.error(String(error));
  }
  requestExit(1);
}
