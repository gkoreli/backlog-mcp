/** Narrow capability for ADD-only memory corrections (ADR 0135 R4). */
import type { Memory } from '@backlog-mcp/shared';
import type { Committed } from './entity-mutation.contract.js';

export interface MemoryCorrectionPort {
  correctMemory(draft: Omit<Memory, 'id'>, now: number): Promise<Committed<Memory>>;
}

/** Failure is explicit about recovery, including native edits that prevented restoration. */
export class MemoryCorrectionError extends Error {
  constructor(
    readonly outcome: 'rolled_back' | 'partial_failure',
    readonly affectedIds: readonly string[],
    readonly unrecoveredIds: readonly string[],
    cause: unknown,
  ) {
    super(outcome === 'rolled_back'
      ? 'Memory correction failed; original documents were restored.'
      : `Memory correction partially failed. Inspect these documents before retrying: ${unrecoveredIds.join(', ')}`, { cause });
    this.name = 'MemoryCorrectionError';
  }
}
