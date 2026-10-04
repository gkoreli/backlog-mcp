/** Complete entity reads for invariants and analysis (ADR 0135 R1). */
import type { AnyEntity, SubstrateType } from '@backlog-mcp/shared';

export interface EntityCorpusFilter {
  status?: string[];
  type?: SubstrateType;
  parent_id?: string;
  excludeTypes?: readonly SubstrateType[];
}

/** A complete filtered snapshot; no pagination or search ranking. */
export interface EntityCorpusReadPort {
  scan(filter?: EntityCorpusFilter): Promise<AnyEntity[]>;
}

/** Local context traversal consumes the same complete snapshot synchronously. */
export interface SyncEntityCorpusReadPort {
  scanSync(filter?: EntityCorpusFilter): AnyEntity[];
}
