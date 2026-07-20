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

/** Explicit authority for a managed write to canonicalize an external document. */
export interface StorageSaveOptions {
  canonicalAdoption?: true;
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
 * Synchronous local storage adapter composed by one docs-native home runtime.
 */
export interface StorageAdapter {
  get(id: string): AnyEntity | undefined;
  getMarkdown(id: string): string | null;
  list(filter?: ListFilter): AnyEntity[];
  add(entity: AnyEntity): AnyEntity;
  save(entity: AnyEntity, options?: StorageSaveOptions): AnyEntity;
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

/**
 * A document a substrate claimed but could not compile (EXP-1 B-3). It stays
 * readable as a generic lossless resource; this record makes the downgrade
 * visible so read surfaces never imply the typed disclosure is complete.
 */
export interface ClaimQuarantine {
  type: string;
  sourcePath: string;
  reason: string;
}

/** Local storage contract for path-addressed, docs-native entity documents. */
export interface DocumentStorageAdapter extends StorageAdapter {
  getDocumentById(id: string): StoredEntityDocument | undefined;
  getDocumentBySourcePath(sourcePath: string): StoredEntityDocument | undefined;
  iterateDocuments(): Iterable<StoredEntityDocument>;
  createDocument(entity: AnyEntity, sourcePath: string): AnyEntity;
  /** Claimed-but-uncompilable documents, sourcePath-ordered. */
  listClaimQuarantines?(): ClaimQuarantine[];
  /**
   * Drop any derived in-memory read model so the next read rebuilds from the
   * authoritative markdown on disk (ADR 0127 R3). Local writes invalidate
   * themselves; this is the seam the watcher-driven reconcile uses to refresh
   * the read model after an external edit. A no-op is a valid implementation
   * for adapters that hold no cache.
   */
  invalidate?(): void;
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
