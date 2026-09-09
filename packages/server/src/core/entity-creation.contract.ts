import type { AnyEntity, SubstrateType } from '@backlog-mcp/shared';

/** New entity data; the repository owns identity allocation. */
export interface EntityDraft {
  type: SubstrateType;
  title: string;
  [field: string]: unknown;
}

/** Allocate and insert one entity without an observable check-then-write gap. */
export interface EntityCreationPort {
  create(draft: EntityDraft): Promise<AnyEntity>;
}
