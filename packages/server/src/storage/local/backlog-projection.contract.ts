/** Capabilities consumed by the local repository's derived read-model boundary. */
import type { IndexableEntity, Resource, SearchOptions, SearchService, UnifiedSearchResult } from '@backlog-mcp/memory/search';
import type { ResourceContent } from '../../core/resource-content.contract.js';
import type { SearchReconciliationStats } from './backlog-service.types.js';

/** Query plus ordered projection maintenance, independent of the index implementation. */
export interface BacklogSearchPort extends SearchService {
  reconcile(entities: IndexableEntity[]): Promise<SearchReconciliationStats>;
  reconcileResources(resources: Resource[]): Promise<SearchReconciliationStats>;
  searchAll(query: string, options?: SearchOptions): Promise<UnifiedSearchResult[]>;
  isHybridSearchActive(): boolean;
  flush(): void;
}

/** The resource operations this repository consumes; MCP registration is an adapter concern. */
export interface BacklogResourceCatalogPort {
  readonly scanPrefix: string;
  list(): Resource[];
  invalidate(): void;
  read(uri: string): ResourceContent;
  toUri(filePath: string): string | null;
}
