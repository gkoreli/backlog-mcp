/** Atomic infrastructure capability for engine-owned thread creation (ADR 0129.2 R2). */
import type { AnyEntity } from '@backlog-mcp/shared';
import type { EntityDraft } from './entity-creation.contract.js';
import type { Committed } from './entity-mutation.contract.js';

export interface ThreadCreationPort {
  /** Validate and allocate with fresh claims inside the insertion lock. */
  createThreadChildCommitted(draft: EntityDraft, thread: string): Promise<Committed<AnyEntity>>;
}
