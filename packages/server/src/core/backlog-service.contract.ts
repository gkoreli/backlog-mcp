/** Consumer-owned entity repository and search port (ADR 0134 R1.2). */
import type {
  AnyEntity,
  CompiledDisclosureRelation,
  CompiledSubstrateWakeupDisclosure,
  SubstrateType,
  SubstrateWorkflowDefinition,
} from '@backlog-mcp/shared';
import type { UnifiedSearchResult, SearchableType } from '@backlog-mcp/memory/search';
import type { ResourceContent } from './resource-content.contract.js';
import type { EntityCreationPort } from './entity-creation.contract.js';
import type { EntityCorpusReadPort, SyncEntityCorpusReadPort } from './entity-corpus.contract.js';
import type { EntityMutationPort, StorageSaveOptions } from './entity-mutation.contract.js';
export type { StorageSaveOptions } from './entity-mutation.contract.js';

/** Explicit authority to canonicalize an external document during a managed write. */
/** A claimed document that failed compilation; retained as a lossless resource. */
export interface ClaimQuarantine {
  type: string;
  sourcePath: string;
  reason: string;
}

export interface ListFilter {
  status?: string[];
  type?: SubstrateType;
  parent_id?: string;
  query?: string;
  limit?: number;
  excludeTypes?: readonly SubstrateType[];
}

export interface IBacklogService extends Partial<EntityCorpusReadPort>, Partial<SyncEntityCorpusReadPort>, Partial<EntityMutationPort> {
  /** Atomic creation in local mode; constrained adapters may retain explicit-ID add. */
  create?: EntityCreationPort['create'];
  get(id: string): Promise<AnyEntity | undefined>;
  getMarkdown(id: string): Promise<string | null>;
  list(filter?: ListFilter): Promise<AnyEntity[]>;
  add(entity: AnyEntity): Promise<AnyEntity>;
  save(entity: AnyEntity, options?: StorageSaveOptions): Promise<AnyEntity>;
  delete(id: string): Promise<boolean>;
  counts(): Promise<{ total_tasks: number; total_epics: number; by_status: Record<string, number>; by_type: Record<string, number> }>;
  getMaxId(type?: SubstrateType): Promise<number>;
  allocateId?(type: SubstrateType): Promise<string>;
  searchUnified(query: string, options?: {
    types?: SearchableType[];
    status?: string[];
    parent_id?: string;
    sort?: string;
    limit?: number;
  }): Promise<UnifiedSearchResult[]>;
  // Optional local-only methods
  getSync?(id: string): AnyEntity | undefined;
  /** Registry-declared relation edges (0113 R6/R7) — docs-native only. */
  listDisclosureRelations?(): readonly CompiledDisclosureRelation[];
  /**
   * Registry-declared wakeup sections (0113 C.2) — docs-native only.
   * `workflow` is the substrate's own declared workflow, when it has one
   * (compiled-process 2026-07 slice): it powers the focal legal-next-actions
   * line and is never a new declaration kind.
   */
  listWakeupDisclosures?(): ReadonlyArray<{
    type: string;
    wakeup: CompiledSubstrateWakeupDisclosure;
    workflow?: SubstrateWorkflowDefinition;
  }>;
  /** Claimed-but-uncompilable documents (EXP-1 B-3) — docs-native only. */
  listClaimQuarantines?(): ClaimQuarantine[];
  getResource?(uri: string): ResourceContent | undefined;
  isHybridSearchActive?(): boolean;
  getFilePath?(id: string): string | null;
  /**
   * The resource URI of an entity's document, following it to whatever
   * folder or filename it has (ADR 0129.1). `null` when the entity has no
   * document in this home. Callers never synthesize `tasks/<id>.md`.
   */
  getResourceUri?(id: string): string | null;
  listSync?(filter?: ListFilter): AnyEntity[];
}
