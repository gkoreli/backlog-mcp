import type { OramaSearchService } from '@backlog-mcp/memory/search';
import type { CompiledDisclosureRelation, CompiledSubstrateWakeupDisclosure, SubstrateType, SubstrateWorkflowDefinition } from '@backlog-mcp/shared';
import type { ResourceManager } from '../../resources/manager.js';
import type { StorageAdapter } from '../storage-adapter.js';

/** Runtime-owned dependencies composed by one local backlog service. */
export interface BacklogServiceDependencies {
  storage: StorageAdapter;
  search: OramaSearchService;
  resourceManager: ResourceManager;
  getSearchFields?: (type: SubstrateType) => readonly string[] | undefined;
  allocateId?: (type: SubstrateType, currentMaxId: number) => string;
  /** Registry-derived reads (0113 C.2) — injected like getSearchFields. */
  listDisclosureRelations?: () => readonly CompiledDisclosureRelation[];
  listWakeupDisclosures?: () => ReadonlyArray<{
    type: string;
    wakeup: CompiledSubstrateWakeupDisclosure;
    workflow?: SubstrateWorkflowDefinition;
  }>;
}

/** Drift repaired for one search-index document family. */
export interface SearchReconciliationStats {
  added: number;
  removed: number;
  updated: number;
}

/** Results from reconciling a home's entities and generic resources. */
export interface BacklogReconciliationResult {
  entities: SearchReconciliationStats;
  resources: SearchReconciliationStats;
}
