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
  EntitySchema,
  EntityType,
  type Entity,
  type Status,
} from '@backlog-mcp/shared';
import { isPathWithin } from '../../core/backlog-home.js';
import type { BacklogHome } from '../../core/backlog-home.types.js';
import { discoverDocuments } from '../../core/document-discovery.js';
import type { DiscoveredDocument } from '../../core/document-discovery.types.js';
import {
  normalizeDocumentSourcePath,
  parseDocumentIdentity,
} from '../../core/document-identity.js';
import type {
  DocumentStorageAdapter,
  ListFilter,
  StoredEntityDocument,
} from '../storage-adapter.js';
import type {
  SubstrateStorageCatalog,
  SubstrateStorageClaim,
} from '../substrate-storage-catalog.contract.js';

const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/iu;

function isSourcePathUnderFolder(sourcePath: string, folder: string): boolean {
  const relativePath = posix.relative(folder, sourcePath);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith('../')
    && !posix.isAbsolute(relativePath);
}

function parseStoredDocument(
  document: DiscoveredDocument,
  catalog: SubstrateStorageCatalog,
): StoredEntityDocument | undefined {
  if (document.format !== 'markdown' || document.content === undefined) {
    return undefined;
  }

  try {
    const parsedMarkdown = matter(document.content, {});
    const type = parsedMarkdown.data.type;
    if (typeof type !== 'string') return undefined;

    const claim = catalog.getStorageClaim(type);
    if (
      claim === undefined
      || !isSourcePathUnderFolder(document.sourcePath, claim.folder)
    ) {
      return undefined;
    }

    const result = EntitySchema.safeParse({
      ...parsedMarkdown.data,
      content: parsedMarkdown.content.trim(),
    });
    if (!result.success) return undefined;

    return {
      entity: result.data,
      sourcePath: document.sourcePath,
      identity: document.identity,
      markdown: document.content,
    };
  } catch {
    return undefined;
  }
}

function serializeEntity(entity: Entity): string {
  const { content, ...frontmatter } = entity;
  return matter.stringify(content ?? '', frontmatter);
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
  entity: Entity,
  sourcePath: string,
  claim: Readonly<SubstrateStorageClaim>,
): void {
  if (claim.identity.strategy !== 'prefixed-number') return;

  const pathKey = parseDocumentIdentity({ sourcePath }).pathKey;
  if (pathKey !== entity.id) {
    throw new Error(
      `Document filename identity must match entity id ${entity.id}: ${sourcePath}`,
    );
  }

  const prefix = claim.identity.prefix;
  const minimumDigits = claim.identity.minimumDigits;
  if (
    prefix === undefined
    || minimumDigits === undefined
    || !Number.isInteger(minimumDigits)
    || minimumDigits < 1
  ) {
    throw new Error(
      `Prefixed-number storage claim requires a prefix and minimum digit width: ${claim.type}`,
    );
  }

  const prefixWithSeparator = `${prefix}-`;
  const number = entity.id.startsWith(prefixWithSeparator)
    ? entity.id.slice(prefixWithSeparator.length)
    : undefined;
  if (
    number === undefined
    || !/^\d+$/u.test(number)
    || number.length < minimumDigits
  ) {
    throw new Error(
      `Document identity must use prefix ${prefix} with at least ${minimumDigits} digits: ${entity.id}`,
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

/**
 * Docs-native entity storage scoped to one resolved backlog home.
 *
 * Markdown remains authoritative: every read recursively rediscovers the
 * home's documents tree instead of relying on an ambient path or cached view.
 */
export class DocsNativeFilesystemStorage implements DocumentStorageAdapter {
  constructor(
    private readonly home: BacklogHome,
    private readonly catalog: SubstrateStorageCatalog,
  ) {}

  private documents(): StoredEntityDocument[] {
    const discovery = discoverDocuments({
      documentsDir: this.home.documentsDir,
    });
    const documents: StoredEntityDocument[] = [];

    for (const document of discovery.documents) {
      const storedDocument = parseStoredDocument(document, this.catalog);
      if (storedDocument !== undefined) documents.push(storedDocument);
    }

    return documents;
  }

  private claimFor(entity: Entity): Readonly<SubstrateStorageClaim> {
    const claim = this.catalog.getStorageClaim(entity.type);
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
    entity: Entity,
    sourcePath: string,
    exclusive: boolean,
  ): void {
    const validatedEntity = EntitySchema.parse(entity);
    const claim = this.claimFor(validatedEntity);
    const target = this.resolveClaimedPath(sourcePath, claim);
    validateWriteIdentity(validatedEntity, target.sourcePath, claim);
    mkdirSync(dirname(target.absolutePath), { recursive: true });
    writeFileSync(
      target.absolutePath,
      serializeEntity(validatedEntity),
      exclusive ? { flag: 'wx' } : undefined,
    );
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

  *iterateEntities(): Generator<Entity> {
    for (const document of this.iterateDocuments()) {
      yield document.entity;
    }
  }

  get(id: string): Entity | undefined {
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

  list(filter?: ListFilter): Entity[] {
    const { status, type, epic_id, parent_id, limit = 20 } = filter ?? {};
    let entities = Array.from(this.iterateEntities());

    if (status !== undefined) {
      entities = entities.filter(function hasSelectedStatus(entity) {
        return entity.status !== undefined && status.includes(entity.status);
      });
    }
    if (type !== undefined) {
      entities = entities.filter(function hasSelectedType(entity) {
        return entity.type === type;
      });
    }
    if (parent_id !== undefined) {
      entities = entities.filter(function hasSelectedParent(entity) {
        return (entity.parent_id ?? entity.epic_id) === parent_id;
      });
    } else if (epic_id !== undefined) {
      entities = entities.filter(function hasSelectedEpic(entity) {
        return (entity.parent_id ?? entity.epic_id) === epic_id;
      });
    }

    entities.sort(function compareUpdatedAt(left, right) {
      return new Date(right.updated_at).getTime()
        - new Date(left.updated_at).getTime();
    });
    return entities.slice(0, limit);
  }

  createDocument(entity: Entity, sourcePath: string): void {
    this.write(entity, sourcePath, true);
  }

  add(entity: Entity): void {
    const claim = this.claimFor(entity);
    this.createDocument(
      entity,
      posix.join(claim.folder, `${entity.id}.md`),
    );
  }

  save(entity: Entity): void {
    const existing = this.getDocumentById(entity.id);
    const sourcePath = existing?.sourcePath
      ?? posix.join(this.claimFor(entity).folder, `${entity.id}.md`);
    this.write(entity, sourcePath, false);
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
    by_status: Record<Status, number>;
    by_type: Record<string, number>;
  } {
    const by_status: Record<Status, number> = {
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
      if (entity.status !== undefined) by_status[entity.status]++;
      by_type[entity.type] = (by_type[entity.type] ?? 0) + 1;
      if (entity.type === EntityType.Epic) {
        total_epics++;
      } else {
        total_tasks++;
      }
    }

    return { total_tasks, total_epics, by_status, by_type };
  }

  getMaxId(type: EntityType = EntityType.Task): number {
    let maxId = 0;

    for (const document of this.iterateDocuments()) {
      if (document.entity.type !== type) continue;
      const sequence = documentSequence(document);
      if (sequence !== undefined && sequence > maxId) maxId = sequence;
    }

    return maxId;
  }
}
