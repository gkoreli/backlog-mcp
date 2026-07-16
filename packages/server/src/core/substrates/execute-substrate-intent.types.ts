import type { CompiledSubstrateIntent } from '@backlog-mcp/shared';
import type { IBacklogService } from '../../storage/backlog-service.contract.js';
import type { WriteContext } from '../types.js';
import type { IntentWriteValidatorPort } from './intent-registry.contract.js';

export interface ExecuteSubstrateIntentParams {
  intent: CompiledSubstrateIntent;
  input: Readonly<Record<string, unknown>>;
  service: IBacklogService;
  validator: IntentWriteValidatorPort;
  context: WriteContext;
}

export interface ExecuteSubstrateIntentResult {
  ids: readonly string[];
  changed: boolean;
}

export type SubstrateIntentFailureCode =
  | 'mutation-failed'
  | 'compensated-failure'
  | 'partial_failure';

/** Failure metadata for a compiled intent whose write plan did not complete. */
export class SubstrateIntentExecutionError extends Error {
  constructor(
    message: string,
    readonly code: SubstrateIntentFailureCode,
    readonly ids: readonly string[],
    readonly cause: unknown,
    readonly compensationSucceeded?: boolean,
  ) {
    super(message);
    this.name = 'SubstrateIntentExecutionError';
  }
}
