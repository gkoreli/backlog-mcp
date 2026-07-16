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
  SubstrateType,
} from '@backlog-mcp/shared';
import type { UnifiedSearchResult, SearchableType } from '@backlog-mcp/memory/search';
import type { ResourceContent } from '../resources/manager.js';

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
  save(entity: AnyEntity): Promise<AnyEntity>;
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
  getResource?(uri: string): ResourceContent | undefined;
  isHybridSearchActive?(): boolean;
  getFilePath?(id: string): string | null;
  listSync?(filter?: ListFilter): AnyEntity[];
}
