import type {
  AnyEntity,
  Entity,
  EntityType,
  Status,
  SubstrateType,
} from '@backlog-mcp/shared';
import type { DocumentIdentity } from '../core/document-identity.types.js';

export interface ListFilter {
  status?: string[];
  type?: SubstrateType;
  parent_id?: string;
  limit?: number;
}

/** Closed satellite filter retained by the descoped D1 adapter. */
export interface AsyncListFilter {
  status?: Status[];
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  limit?: number;
}

/**
 * Synchronous storage adapter interface.
 * Implemented by FilesystemStorage for local/filesystem mode. The "Adapter"
 * pattern term lives here on the interface; concrete classes name the thing
 * (FilesystemStorage), not the pattern (ADR 0106.3 §A).
 */
export interface StorageAdapter {
  get(id: string): AnyEntity | undefined;
  getMarkdown(id: string): string | null;
  list(filter?: ListFilter): AnyEntity[];
  add(entity: AnyEntity): AnyEntity;
  save(entity: AnyEntity): AnyEntity;
  delete(id: string): boolean;
  counts(): {
    total_tasks: number;
    total_epics: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
  };
  getMaxId(type: SubstrateType): number;
  iterateEntities(): Iterable<AnyEntity>;
  /** Absolute path to the entity's markdown file, or null if absent (local-only). */
  getFilePath(id: string): string | null;
}

/** A validated entity together with its authoritative Markdown provenance. */
export interface StoredEntityDocument {
  entity: AnyEntity;
  sourcePath: string;
  identity: DocumentIdentity;
  markdown: string;
}

/** Local storage contract for path-addressed, docs-native entity documents. */
export interface DocumentStorageAdapter extends StorageAdapter {
  getDocumentById(id: string): StoredEntityDocument | undefined;
  getDocumentBySourcePath(sourcePath: string): StoredEntityDocument | undefined;
  iterateDocuments(): Iterable<StoredEntityDocument>;
  createDocument(entity: AnyEntity, sourcePath: string): AnyEntity;
}

/**
 * Async storage adapter interface.
 * Implemented by D1Storage for Cloudflare Workers / cloud mode.
 * All methods return Promises to allow async I/O.
 */
export interface AsyncStorageAdapter {
  get(id: string): Promise<Entity | undefined>;
  getMarkdown(id: string): Promise<string | null>;
  list(filter?: AsyncListFilter): Promise<Entity[]>;
  add(entity: Entity): Promise<void>;
  save(entity: Entity): Promise<void>;
  delete(id: string): Promise<boolean>;
  counts(): Promise<{
    total_tasks: number;
    total_epics: number;
    by_status: Record<Status, number>;
    by_type: Record<string, number>;
  }>;
  getMaxId(type?: EntityType): Promise<number>;
  search(query: string, limit?: number): Promise<Entity[]>;
}
