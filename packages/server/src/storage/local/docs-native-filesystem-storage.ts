import {
  existsSync,
  mkdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, posix, resolve } from 'node:path';
import matter from 'gray-matter';
import {
  EntityType,
  type AnyEntity,
  type SubstrateType,
} from '@backlog-mcp/shared';
import { isPathWithin } from '../../core/backlog-home.js';
import type { BacklogHome } from '../../core/backlog-home.types.js';
import type { EntityDraft } from '../../core/entity-creation.contract.js';
import { matchesDeclaredStatus } from '../../core/status-token.js';
import { slugifyDocumentTitle } from '../../core/document-slug.js';
import {
  normalizeDocumentSourcePath,
  normalizeDocumentKey,
  parseDocumentIdentity,
} from '../../core/document-identity.js';
import {
  SubstrateWriteError,
  type ProjectSubstrateRegistry,
} from '../../core/substrates/index.js';
import type {
  ClaimQuarantine,
  DocumentStorageAdapter,
  ListFilter,
  StorageSaveOptions,
  StoredEntityDocument,
} from '../storage-adapter.js';
import {
  matchesStorageDocumentIdentity,
  nextStorageDocumentId,
  parseStorageDisplayId,
  storageDocumentSourcePath,
} from '../storage-identity.js';
import type { SubstrateStorageClaim } from '../substrate-storage-catalog.contract.js';
import { readDocumentSnapshot, type DocumentSnapshot } from './docs-native-read-model.js';
import { withDocumentWriteLock } from './document-write-lock.js';

const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/iu;

function isSourcePathUnderFolder(sourcePath: string, folder: string): boolean {
  const relativePath = posix.relative(folder, sourcePath);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith('../')
    && !posix.isAbsolute(relativePath);
}

function serializeEntity(entity: AnyEntity): string {
  const { content, ...frontmatter } = entity;
  return matter.stringify(typeof content === 'string' ? content : '', frontmatter);
}

function hasCanonicalFrontmatter(
  document: StoredEntityDocument,
  registry: ProjectSubstrateRegistry,
): boolean {
  const validation = registry.validateWrite(document.entity);
  if (!validation.ok) return false;

  const canonical = serializeEntity(validation.entity);
  return matter(document.markdown, {}).matter === matter(canonical, {}).matter;
}

function normalizeWritableSourcePath(sourcePath: string): string {
  const normalized = normalizeDocumentSourcePath(sourcePath);
  if (
    normalized === ''
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || posix.isAbsolute(normalized)
    || !MARKDOWN_EXTENSION.test(normalized)
  ) {
    throw new Error(`Invalid document source path: ${sourcePath}`);
  }
  return normalized;
}

function canonicalizeThroughExistingAncestor(path: string): string {
  const missingSegments: string[] = [];
  let existingPath = path;

  while (!existsSync(existingPath)) {
    const parentPath = dirname(existingPath);
    if (parentPath === existingPath) return resolve(path);
    missingSegments.unshift(basename(existingPath));
    existingPath = parentPath;
  }

  return resolve(realpathSync(existingPath), ...missingSegments);
}

function validateWriteIdentity(
  entity: AnyEntity,
  sourcePath: string,
  claim: Readonly<SubstrateStorageClaim>,
): void {
  const identity = parseDocumentIdentity({ sourcePath });
  if (!matchesStorageDocumentIdentity(claim, entity.id, identity)) {
    throw new Error(
      `Document filename identity must match entity id ${entity.id}: ${sourcePath}`,
    );
  }
}

function sortableTime(document: StoredEntityDocument): number {
  const updatedAt = document.entity.updated_at;
  const value = typeof updatedAt === 'string'
    ? Date.parse(updatedAt)
    : Number.NaN;
  if (Number.isFinite(value)) return value;

  const observed = document.identity.observedDate;
  const observedValue = observed === undefined ? Number.NaN : Date.parse(observed);
  return Number.isFinite(observedValue) ? observedValue : 0;
}

/** Repository adapter: cached document reads and exclusive managed writes. */
export class DocsNativeFilesystemStorage implements DocumentStorageAdapter {
  /**
   * Memoized read model. `undefined` means "cold" — the next read rebuilds it
   * from disk. Every mutation and every `invalidate()` resets it to
   * `undefined` (ADR 0127 R1–R3).
   */
  private snapshotCache: DocumentSnapshot | undefined;

  constructor(
    private readonly home: BacklogHome,
    private readonly registry: ProjectSubstrateRegistry,
  ) {}

  /**
   * Drop the derived read model (ADR 0127 R3). Idempotent and cheap; the next
   * read rebuilds from the authoritative markdown tree.
   */
  invalidate(): void {
    this.snapshotCache = undefined;
  }

  private mutate<T>(operation: () => T): T {
    const storage = this;
    return withDocumentWriteLock(this.home, function freshWrite() {
      storage.invalidate();
      const incomplete = storage.snapshot().incompletePaths;
      if (incomplete.length > 0) {
        throw new Error(`Cannot establish document identities: unreadable paths ${incomplete.join(', ')}`);
      }
      return operation();
    });
  }

  private snapshot(): DocumentSnapshot {
    this.snapshotCache ??= readDocumentSnapshot(this.home, this.registry);
    return this.snapshotCache;
  }

  private assertNoClaimCollisions(type: SubstrateType): void {
    const collisions = this.snapshot().claimDiagnostics.filter(
      function matchesType(diagnostic) {
        return diagnostic.type === type;
      },
    );
    if (collisions.length === 0) return;

    const sourcePaths = collisions.flatMap(function getSources(diagnostic) {
      return [...diagnostic.sourcePaths];
    }).sort();
    throw new SubstrateWriteError(type, [{
      code: 'shape',
      path: '/id',
      message: `duplicate document identities: ${sourcePaths.join(', ')}`,
    }]);
  }

  private documents(): StoredEntityDocument[] {
    return this.snapshot().documents;
  }

  listClaimQuarantines(): ClaimQuarantine[] {
    return this.snapshot().quarantines;
  }

  private claimFor(entity: AnyEntity): Readonly<SubstrateStorageClaim> {
    const claim = this.registry.getStorageClaim(entity.type);
    if (claim === undefined) {
      throw new Error(`No storage claim for entity type: ${entity.type}`);
    }
    return claim;
  }

  private resolveClaimedPath(
    sourcePath: string,
    claim: Readonly<SubstrateStorageClaim>,
  ): { absolutePath: string; sourcePath: string } {
    const normalizedSourcePath = normalizeWritableSourcePath(sourcePath);
    if (!isSourcePathUnderFolder(normalizedSourcePath, claim.folder)) {
      throw new Error(
        `Document source path must remain under ${claim.folder}: ${sourcePath}`,
      );
    }

    const claimPath = resolve(
      this.home.documentsDir,
      ...claim.folder.split('/'),
    );
    const absolutePath = resolve(
      this.home.documentsDir,
      ...normalizedSourcePath.split('/'),
    );
    if (!isPathWithin(claimPath, absolutePath)) {
      throw new Error(
        `Document source path must remain under ${claim.folder}: ${sourcePath}`,
      );
    }
    const canonicalDocumentsDir = canonicalizeThroughExistingAncestor(
      this.home.documentsDir,
    );
    const canonicalHomeRoot = canonicalizeThroughExistingAncestor(
      this.home.root,
    );
    const canonicalTarget = canonicalizeThroughExistingAncestor(absolutePath);
    if (
      !isPathWithin(canonicalHomeRoot, canonicalDocumentsDir)
      || !isPathWithin(canonicalDocumentsDir, canonicalTarget)
    ) {
      throw new Error(
        `Document source path escapes the documents directory: ${sourcePath}`,
      );
    }

    return { absolutePath, sourcePath: normalizedSourcePath };
  }

  private write(
    candidate: AnyEntity,
    sourcePath: string,
    exclusive: boolean,
  ): AnyEntity {
    const validation = this.registry.validateWrite(candidate);
    if (!validation.ok) {
      throw new SubstrateWriteError(candidate.type, validation.issues);
    }
    const entity = validation.entity;
    const claim = this.claimFor(entity);
    this.assertNoClaimCollisions(entity.type);
    const key = parseStorageDisplayId(claim, entity.id);
    const snapshot = this.snapshot();
    const occupied = key !== undefined
      && snapshot.identitiesByType.get(entity.type)?.has(normalizeDocumentKey(key));
    // Fresh claim identity guards different slugs, digit widths, and
    // quarantined bodies. Existing canonical saves keep their original path.
    if (occupied && (exclusive || !snapshot.byId.has(entity.id))) {
      throw new Error(`Document id already exists: ${entity.id}`);
    }
    const target = this.resolveClaimedPath(sourcePath, claim);
    validateWriteIdentity(entity, target.sourcePath, claim);
    mkdirSync(dirname(target.absolutePath), { recursive: true });
    writeFileSync(
      target.absolutePath,
      serializeEntity(entity),
      exclusive ? { flag: 'wx' } : undefined,
    );
    // The disk changed; the derived read model is now stale (ADR 0127 R2).
    this.invalidate();
    return entity;
  }

  getDocumentById(id: string): StoredEntityDocument | undefined {
    return this.snapshot().byId.get(id);
  }

  getDocumentBySourcePath(
    sourcePath: string,
  ): StoredEntityDocument | undefined {
    const normalizedSourcePath = normalizeDocumentSourcePath(sourcePath);
    return this.snapshot().bySourcePath.get(normalizedSourcePath);
  }

  *iterateDocuments(): Generator<StoredEntityDocument> {
    yield* this.documents();
  }

  *iterateEntities(): Generator<AnyEntity> {
    for (const document of this.iterateDocuments()) {
      yield document.entity;
    }
  }

  get(id: string): AnyEntity | undefined {
    return this.getDocumentById(id)?.entity;
  }

  getMarkdown(id: string): string | null {
    return this.getDocumentById(id)?.markdown ?? null;
  }

  getFilePath(id: string): string | null {
    const document = this.getDocumentById(id);
    return document === undefined
      ? null
      : resolve(this.home.documentsDir, ...document.sourcePath.split('/'));
  }

  list(filter?: ListFilter): AnyEntity[] {
    const { status, type, parent_id, limit = 20 } = filter ?? {};
    let documents = Array.from(this.iterateDocuments());

    if (status !== undefined) {
      documents = documents.filter(function hasSelectedStatus(document) {
        // Token-normalized (status-token.ts): lenient external reads write
        // freeform statuses; `--status accepted` must match "Accepted,
        // amended 2026-04-14" without a synonym map.
        const entityStatus = document.entity.status;
        return status.some(function matchesFilter(filterStatus) {
          return matchesDeclaredStatus(entityStatus, filterStatus);
        });
      });
    }
    if (type !== undefined) {
      documents = documents.filter(function hasSelectedType(document) {
        return document.entity.type === type;
      });
    }
    if (parent_id !== undefined) {
      documents = documents.filter(function hasSelectedParent(document) {
        return document.entity.parent_id === parent_id;
      });
    }

    documents.sort(function compareDocuments(left, right) {
      const timeOrder = sortableTime(right) - sortableTime(left);
      return timeOrder !== 0
        ? timeOrder
        : left.sourcePath.localeCompare(right.sourcePath);
    });
    return documents.slice(0, limit).map(function getEntity(document) {
      return document.entity;
    });
  }

  createDocument(entity: AnyEntity, sourcePath: string): AnyEntity {
    const storage = this;
    return this.mutate(function insert() {
      return storage.write(entity, sourcePath, true);
    });
  }

  /** Allocate and insert under one lock against freshly scanned identity claims. */
  create(draft: EntityDraft): AnyEntity {
    const storage = this;
    return this.mutate(function createEntity() {
      const id = nextStorageDocumentId(storage.registry, draft.type, storage.getMaxId(draft.type));
      const entity = { ...draft, id };
      return storage.write(entity, storage.newDocumentSourcePath(entity), true);
    });
  }

  /**
   * The docs-relative path a brand-new document is written to: the claim's
   * folder, the id's path key, and a title-derived slug (ADR 0129 R2). The
   * slug is fixed here and never revisited on later saves (R4).
   */
  private newDocumentSourcePath(entity: AnyEntity): string {
    const claim = this.claimFor(entity);
    return storageDocumentSourcePath(
      claim,
      entity.id,
      slugifyDocumentTitle(entity.title),
    );
  }

  add(entity: AnyEntity): AnyEntity {
    return this.createDocument(entity, this.newDocumentSourcePath(entity));
  }

  save(entity: AnyEntity, options?: StorageSaveOptions): AnyEntity {
    const storage = this;
    return this.mutate(function saveDocument() { return storage.saveCurrent(entity, options); });
  }

  private saveCurrent(entity: AnyEntity, options?: StorageSaveOptions): AnyEntity {
    const existing = this.getDocumentById(entity.id);
    if (
      existing !== undefined
      && options?.canonicalAdoption !== true
      && !hasCanonicalFrontmatter(existing, this.registry)
    ) {
      throw new Error(
        `Canonical adoption requires separate explicit consent: ${entity.id}`,
      );
    }
    const sourcePath = existing?.sourcePath
      ?? this.newDocumentSourcePath(entity);
    return this.write(entity, sourcePath, false);
  }

  delete(id: string): boolean {
    const storage = this;
    return this.mutate(function deleteDocument() { return storage.deleteCurrent(id); });
  }

  private deleteCurrent(id: string): boolean {
    const document = this.getDocumentById(id);
    if (document === undefined) return false;

    unlinkSync(resolve(
      this.home.documentsDir,
      ...document.sourcePath.split('/'),
    ));
    // The disk changed; the derived read model is now stale (ADR 0127 R2).
    this.invalidate();
    return true;
  }

  counts(): {
    total_tasks: number;
    total_epics: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
  } {
    const by_status: Record<string, number> = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
      cancelled: 0,
    };
    const by_type: Record<string, number> = {};
    let total_tasks = 0;
    let total_epics = 0;

    for (const entity of this.iterateEntities()) {
      const status = entity.status;
      if (typeof status === 'string') {
        by_status[status] = (by_status[status] ?? 0) + 1;
      }
      by_type[entity.type] = (by_type[entity.type] ?? 0) + 1;
      if (entity.type === EntityType.Epic) {
        total_epics++;
      } else {
        total_tasks++;
      }
    }

    return { total_tasks, total_epics, by_status, by_type };
  }

  getMaxId(type: SubstrateType): number {
    this.assertNoClaimCollisions(type);
    return this.snapshot().maxIds.get(type) ?? 0;
  }
}
