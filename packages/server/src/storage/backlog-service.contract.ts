/**
 * backlog-service.contract.ts — the IBacklogService contract.
 *
 * A shared contract implemented by both BacklogService (local/filesystem
 * singleton) and D1BacklogService (cloud/per-request), consumed widely across
 * core, tools, memory, and server layers. Named `*.contract.ts` per the file
 * naming convention (ADR 0106.3 §D): shared contracts implemented by many and
 * consumed widely.
 */
import type {
  AnyEntity,
  CompiledDisclosureRelation,
  CompiledSubstrateWakeupDisclosure,
  SubstrateType,
  SubstrateWorkflowDefinition,
} from '@backlog-mcp/shared';
import type { UnifiedSearchResult, SearchableType } from '@backlog-mcp/memory/search';
import type { ResourceContent } from '../resources/manager.js';
import type { ClaimQuarantine, StorageSaveOptions } from './storage-adapter.js';

export interface ListFilter {
  status?: string[];
  type?: SubstrateType;
  parent_id?: string;
  query?: string;
  limit?: number;
}

export interface IBacklogService {
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
  listSync?(filter?: ListFilter): AnyEntity[];
}
