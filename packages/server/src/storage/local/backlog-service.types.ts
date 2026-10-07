import type { BacklogSearchPort, BacklogResourceCatalogPort } from './backlog-projection.contract.js';
import type { CompiledDisclosureRelation, CompiledSubstrateWakeupDisclosure, SubstrateType, SubstrateWorkflowDefinition } from '@backlog-mcp/shared';
import type { StorageAdapter } from '../storage-adapter.js';

/** Runtime-owned dependencies composed by one local backlog service. */
export interface BacklogServiceDependencies {
  storage: StorageAdapter;
  search: BacklogSearchPort;
  resourceManager: BacklogResourceCatalogPort;
  getSearchFields?: (type: SubstrateType) => readonly string[] | undefined;
  getDiscoveryProjection?: (type: SubstrateType) => readonly string[] | undefined;
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
