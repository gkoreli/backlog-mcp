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
  type RuntimeEntity,
  type SubstrateType,
} from '@backlog-mcp/shared';
import { isPathWithin } from '../../core/backlog-home.js';
import type { BacklogHome } from '../../core/backlog-home.types.js';
import { discoverDocuments } from '../../core/document-discovery.js';
import {
  normalizeDocumentSourcePath,
  parseDocumentIdentity,
} from '../../core/document-identity.js';
import {
  claimSubstrateDocuments,
  SubstrateWriteError,
  type ClaimedSubstrateDocument,
  type ProjectSubstrateRegistry,
} from '../../core/substrates/index.js';
import type {
  DocumentStorageAdapter,
  ListFilter,
  StorageSaveOptions,
  StoredEntityDocument,
} from '../storage-adapter.js';
import {
  formatStorageDisplayId,
  matchesStorageDocumentIdentity,
  storageDocumentSourcePath,
} from '../storage-identity.js';
import type { SubstrateStorageClaim } from '../substrate-storage-catalog.contract.js';

const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/iu;

function isSourcePathUnderFolder(sourcePath: string, folder: string): boolean {
  const relativePath = posix.relative(folder, sourcePath);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith('../')
    && !posix.isAbsolute(relativePath);
}

function firstHeading(content: string): string | undefined {
  const heading = /^\s*#\s+(.+?)\s*$/mu.exec(content)?.[1]?.trim();
  return heading || undefined;
}

function stringField(
  data: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = data[field];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseStoredDocument(
  claimed: ClaimedSubstrateDocument,
  registry: ProjectSubstrateRegistry,
): StoredEntityDocument | undefined {
  const document = claimed.document;
  if (document.format !== 'markdown' || document.content === undefined) {
    return undefined;
  }

  try {
    const parsedMarkdown = matter(document.content, {});
    const data = parsedMarkdown.data as Record<string, unknown>;
    const claim = registry.getStorageClaim(claimed.type);
    if (claim === undefined) return undefined;

    const id = formatStorageDisplayId(claim, claimed.storageKey);
    const title = stringField(data, 'title')
      ?? firstHeading(parsedMarkdown.content)
      ?? document.identity.slug
      ?? id;
    const content = parsedMarkdown.content.trim();
    const projection: RuntimeEntity = {
      ...data,
      id,
      type: claimed.type,
      title,
      ...(content ? { content } : {}),
    };

    return {
      entity: projection,
      sourcePath: document.sourcePath,
      identity: document.identity,
      markdown: document.content,
    };
  } catch {
    return undefined;
  }
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

function numericRoot(identity: string): number | undefined {
  const localIdentity = identity.includes('-')
    ? identity.slice(identity.lastIndexOf('-') + 1)
    : identity;
  const rootSegment = localIdentity.split('.')[0];
  if (rootSegment === undefined || !/^\d+$/u.test(rootSegment)) {
    return undefined;
  }
  return Number.parseInt(rootSegment, 10);
}

function documentSequence(document: StoredEntityDocument): number | undefined {
  const pathSequence = document.identity.pathKey === undefined
    ? undefined
    : numericRoot(document.identity.pathKey);
  return pathSequence ?? numericRoot(document.entity.id);
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

/**
 * Docs-native entity storage scoped to one resolved backlog home.
 *
 * Substrate claims select typed documents before frontmatter is interpreted.
 * Declarative documents stay lenient on read; every managed write passes once
 * through the strict project registry and serializes its canonical result.
 */
export class DocsNativeFilesystemStorage implements DocumentStorageAdapter {
  constructor(
    private readonly home: BacklogHome,
    private readonly registry: ProjectSubstrateRegistry,
  ) {}

  private discoverClaims() {
    const discovery = discoverDocuments({
      documentsDir: this.home.documentsDir,
    });
    return claimSubstrateDocuments({
      homeKey: this.home.root,
      documents: discovery.documents,
      substrates: this.registry.listSubstrates(),
    });
  }

  private assertNoClaimCollisions(type: SubstrateType): void {
    const collisions = this.discoverClaims().diagnostics.filter(
      function matchesType(diagnostic) {
        return diagnostic.type === type;
      },
    );
    if (collisions.length === 0) return;

    const sourcePaths = collisions.flatMap(function getSources(diagnostic) {
      return diagnostic.sourcePaths;
    }).sort();
    throw new SubstrateWriteError(type, [{
      code: 'shape',
      path: '/id',
      message: `duplicate document identities: ${sourcePaths.join(', ')}`,
    }]);
  }

  private documents(): StoredEntityDocument[] {
    const claims = this.discoverClaims();
    const documents: StoredEntityDocument[] = [];

    for (const claimed of claims.claimed) {
      const storedDocument = parseStoredDocument(claimed, this.registry);
      if (storedDocument !== undefined) documents.push(storedDocument);
    }

    return documents;
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
    const target = this.resolveClaimedPath(sourcePath, claim);
    validateWriteIdentity(entity, target.sourcePath, claim);
    mkdirSync(dirname(target.absolutePath), { recursive: true });
    writeFileSync(
      target.absolutePath,
      serializeEntity(entity),
      exclusive ? { flag: 'wx' } : undefined,
    );
    return entity;
  }

  getDocumentById(id: string): StoredEntityDocument | undefined {
    for (const document of this.documents()) {
      if (document.entity.id === id) return document;
    }
    return undefined;
  }

  getDocumentBySourcePath(
    sourcePath: string,
  ): StoredEntityDocument | undefined {
    const normalizedSourcePath = normalizeDocumentSourcePath(sourcePath);
    for (const document of this.documents()) {
      if (document.sourcePath === normalizedSourcePath) return document;
    }
    return undefined;
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
        const entityStatus = document.entity.status;
        return typeof entityStatus === 'string' && status.includes(entityStatus);
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
    return this.write(entity, sourcePath, true);
  }

  add(entity: AnyEntity): AnyEntity {
    const claim = this.claimFor(entity);
    return this.createDocument(
      entity,
      storageDocumentSourcePath(claim, entity.id),
    );
  }

  save(entity: AnyEntity, options?: StorageSaveOptions): AnyEntity {
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
    const claim = this.claimFor(entity);
    const sourcePath = existing?.sourcePath
      ?? storageDocumentSourcePath(claim, entity.id);
    return this.write(entity, sourcePath, false);
  }

  delete(id: string): boolean {
    const document = this.getDocumentById(id);
    if (document === undefined) return false;

    unlinkSync(resolve(
      this.home.documentsDir,
      ...document.sourcePath.split('/'),
    ));
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
    let maxId = 0;

    for (const document of this.iterateDocuments()) {
      if (document.entity.type !== type) continue;
      const sequence = documentSequence(document);
      if (sequence !== undefined && sequence > maxId) maxId = sequence;
    }

    return maxId;
  }
}
