/** Managed commit and preimage contracts (ADR 0135 R2/R3). */
import type { AnyEntity } from '@backlog-mcp/shared';
import type { EntityDraft } from './entity-creation.contract.js';

export interface EntityPreimage {
  entity: AnyEntity;
  /** Opaque authoritative-document revision; local mode hashes exact Markdown. */
  revision?: string;
}

export interface StorageSaveOptions {
  canonicalAdoption?: true;
  expected?: EntityPreimage;
}

export interface WriteWarning {
  code: 'index_repair_pending' | 'journal_append_failed' | 'notification_failed';
  message: string;
}

export interface MutationReceipt {
  warnings?: WriteWarning[];
}

/** Returned only after authoritative persistence succeeds. */
export interface Committed<T> extends MutationReceipt {
  value: T;
  preimage?: EntityPreimage;
}

export interface EntityMutationPort {
  getForWrite(id: string): Promise<EntityPreimage | undefined>;
  saveCommitted(entity: AnyEntity, options?: StorageSaveOptions): Promise<Committed<AnyEntity>>;
  createCommitted(draft: EntityDraft): Promise<Committed<AnyEntity>>;
  deleteCommitted(id: string): Promise<Committed<boolean>>;
}

export class EntityWriteConflictError extends Error {
  constructor(readonly id: string) {
    super(`Document ${id} changed since it was read. Read it again before applying this write.`);
    this.name = 'EntityWriteConflictError';
  }
}
