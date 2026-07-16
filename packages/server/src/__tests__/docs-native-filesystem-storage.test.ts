import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import { EntityType, type Entity } from '@backlog-mcp/shared';
import { describe, expect, it } from 'vitest';
import { createBacklogHome } from '../core/backlog-home.js';
import type { BacklogHome } from '../core/backlog-home.types.js';
import { createEntity } from '../storage/entity-factory.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';
import { DocsNativeFilesystemStorage } from '../storage/local/docs-native-filesystem-storage.js';
import type { SubstrateStorageCatalog } from '../storage/substrate-storage-catalog.contract.js';

interface StorageHarness {
  home: BacklogHome;
  storage: DocsNativeFilesystemStorage;
}

const builtinCatalog = new BuiltinSubstrateStorageCatalog();

function createStorage(
  name: string,
  catalog: SubstrateStorageCatalog = builtinCatalog,
): StorageHarness {
  const root = join(tmpdir(), 'docs-native-storage', name);
  mkdirSync(join(root, 'docs'), { recursive: true });
  const home = createBacklogHome({ kind: 'project', root });
  return {
    home,
    storage: new DocsNativeFilesystemStorage(home, catalog),
  };
}

function writeRawDocument(
  home: BacklogHome,
  sourcePath: string,
  markdown: string,
): void {
  const absolutePath = join(home.documentsDir, ...sourcePath.split('/'));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, markdown);
}

function entityMarkdown(entity: Entity, content = entity.content ?? ''): string {
  const { content: _content, ...frontmatter } = entity;
  return matter.stringify(content, frontmatter);
}

describe('DocsNativeFilesystemStorage', function describeDocsNativeStorage() {
  it('routes built-in tasks and memories to their claimed folders', function routesBuiltins() {
    const { home, storage } = createStorage('builtin-routing');
    const task = createEntity({ id: 'TASK-0001', title: 'Task' });
    const memory = createEntity({
      id: 'MEMO-0001',
      title: 'Memory',
      type: EntityType.Memory,
      content: 'Remember this.',
      layer: 'semantic',
    });

    storage.add(task);
    storage.add(memory);

    expect(existsSync(join(home.documentsDir, 'tasks/TASK-0001.md'))).toBe(true);
    expect(existsSync(join(home.documentsDir, 'memories/MEMO-0001.md'))).toBe(true);
    expect(storage.get('TASK-0001')).toMatchObject({ type: 'task', title: 'Task' });
    expect(storage.get('MEMO-0001')).toMatchObject({
      type: 'memory',
      content: 'Remember this.',
    });
  });

  it('looks up exact source paths and retains neutral document identity', function looksUpSourcePaths() {
    const { storage } = createStorage('source-path-identity');
    const task = createEntity({ id: 'TASK-0002', title: 'Native task' });
    const sourcePath = 'tasks/native/TASK-0002-original-slug.md';

    storage.createDocument(task, sourcePath);

    expect(storage.getDocumentBySourcePath(sourcePath)).toMatchObject({
      sourcePath,
      entity: { id: 'TASK-0002' },
      identity: {
        sourcePath,
        pathKey: 'TASK-0002',
        slug: 'original-slug',
        declaredId: 'TASK-0002',
      },
    });
    expect(storage.getDocumentById('TASK-0002')?.markdown).toContain(
      'title: Native task',
    );
  });

  it('observes native Markdown edits on the next read', function observesNativeEdits() {
    const { home, storage } = createStorage('native-edit');
    const task = createEntity({
      id: 'TASK-0001',
      title: 'Before edit',
      content: 'Original body',
    });
    storage.add(task);

    writeRawDocument(
      home,
      'tasks/TASK-0001.md',
      entityMarkdown({ ...task, title: 'Edited natively' }, 'Native body'),
    );

    expect(storage.get('TASK-0001')).toMatchObject({
      title: 'Edited natively',
      content: 'Native body',
    });
    expect(storage.getMarkdown('TASK-0001')).toContain('Native body');
  });

  it('keeps generic, out-of-claim, malformed, and invalid documents out of typed storage', function ignoresUntypedDocuments() {
    const { home, storage } = createStorage('ignored-documents');
    const validTask = createEntity({ id: 'TASK-0001', title: 'Valid task' });
    const outOfClaimTask = createEntity({
      id: 'TASK-0002',
      title: 'Wrong folder',
    });
    storage.add(validTask);
    writeRawDocument(home, 'README.md', '# Generic docs');
    writeRawDocument(
      home,
      'notes/TASK-0002.md',
      entityMarkdown(outOfClaimTask),
    );
    writeRawDocument(
      home,
      'tasks/TASK-0003.md',
      '---\ntype: task\nid: TASK-0003\ntitle: [\n---\nBroken',
    );
    writeRawDocument(
      home,
      'tasks/TASK-0004.md',
      '---\ntype: task\nid: TASK-0004\ncreated_at: now\nupdated_at: now\n---\nMissing title',
    );
    writeRawDocument(
      home,
      'tasks/UNKNOWN-0001.md',
      '---\ntype: unknown\nid: UNKNOWN-0001\ntitle: Unknown\ncreated_at: now\nupdated_at: now\n---',
    );

    expect(Array.from(storage.iterateDocuments()).map(function getId(document) {
      return document.entity.id;
    })).toEqual(['TASK-0001']);
    expect(storage.get('TASK-0002')).toBeUndefined();
    expect(storage.getDocumentBySourcePath('README.md')).toBeUndefined();
  });

  it('rejects explicit paths outside the entity claim and missing claims', function rejectsInvalidClaims() {
    const { storage } = createStorage('claim-containment');
    const task = createEntity({ id: 'TASK-0001', title: 'Task' });

    expect(function createInWrongFolder() {
      storage.createDocument(task, 'memories/TASK-0001.md');
    }).toThrow(/under tasks/);
    expect(function createWithTraversal() {
      storage.createDocument(task, 'tasks/../../outside.md');
    }).toThrow(/Invalid document source path/);
    expect(function createWithMismatchedIdentity() {
      storage.createDocument(task, 'tasks/TASK-0002-wrong-identity.md');
    }).toThrow(/filename identity must match entity id/);
    const customPrefixTask = createEntity({
      id: 'CUSTOM-0012',
      title: 'Wrong prefix',
    });
    expect(function createWithWrongPrefix() {
      storage.createDocument(
        customPrefixTask,
        'tasks/CUSTOM-0012-wrong-prefix.md',
      );
    }).toThrow(/prefix TASK/);
    const shortIdentityTask = createEntity({
      id: 'TASK-001',
      title: 'Short identity',
    });
    expect(function createWithShortIdentity() {
      storage.createDocument(
        shortIdentityTask,
        'tasks/TASK-001-short-identity.md',
      );
    }).toThrow(/at least 4 digits/);

    const noClaimsCatalog: SubstrateStorageCatalog = {
      getStorageClaim: function getNoStorageClaim() {
        return undefined;
      },
    };
    const unclaimedStorage = createStorage(
      'missing-claim',
      noClaimsCatalog,
    ).storage;

    expect(function addWithoutClaim() {
      unclaimedStorage.add(task);
    }).toThrow(/No storage claim/);
  });

  it('rejects writes through a claimed-folder symlink outside the documents directory', function rejectsSymlinkEscape() {
    const { home, storage } = createStorage('symlink-escape');
    const outsideDirectory = join(tmpdir(), 'docs-native-storage-outside');
    mkdirSync(outsideDirectory, { recursive: true });
    symlinkSync(outsideDirectory, join(home.documentsDir, 'tasks'));
    const task = createEntity({ id: 'TASK-0001', title: 'Escaping task' });

    expect(function writeThroughEscapingSymlink() {
      storage.add(task);
    }).toThrow(/escapes the documents directory/);
    expect(existsSync(join(outsideDirectory, 'TASK-0001.md'))).toBe(false);
  });

  it('uses exclusive creation and leaves the colliding document intact', function createsAtomically() {
    const { storage } = createStorage('atomic-create');
    const first = createEntity({ id: 'TASK-0001', title: 'First writer' });
    const second = { ...first, title: 'Second writer' };

    storage.add(first);

    expect(function collideWithExistingDocument() {
      storage.add(second);
    }).toThrow(/EEXIST/);
    expect(storage.get('TASK-0001')?.title).toBe('First writer');
  });

  it('preserves an existing slugged source path when saving', function preservesNativePath() {
    const { home, storage } = createStorage('save-native-path');
    const task = createEntity({ id: 'TASK-0007', title: 'Original' });
    const newTask = createEntity({ id: 'TASK-0008', title: 'New through save' });
    const sourcePath = 'tasks/archive/TASK-0007-human-title.md';
    storage.createDocument(task, sourcePath);

    storage.save({ ...task, title: 'Updated' });
    storage.save(newTask);

    expect(storage.getDocumentById(task.id)).toMatchObject({
      sourcePath,
      entity: { title: 'Updated' },
    });
    expect(existsSync(join(home.documentsDir, sourcePath))).toBe(true);
    expect(existsSync(join(home.documentsDir, 'tasks/TASK-0007.md'))).toBe(false);
    expect(existsSync(join(home.documentsDir, 'tasks/TASK-0008.md'))).toBe(true);
  });

  it('supports recursive CRUD, filtering, counts, and type-local max ids', function supportsStorageOperations() {
    const { home, storage } = createStorage('storage-operations');
    const parentId = 'EPIC-0002';
    const nestedTask = createEntity({
      id: 'TASK-0012',
      title: 'Nested task',
      parent_id: parentId,
    });
    const doneTask = createEntity({
      id: 'TASK-0003',
      title: 'Done task',
      status: 'done',
    });
    const epic = createEntity({
      id: parentId,
      title: 'Epic',
      type: EntityType.Epic,
    });
    const memory = createEntity({
      id: 'MEMO-0007',
      title: 'Memory',
      type: EntityType.Memory,
      content: 'Durable fact.',
    });

    storage.createDocument(
      nestedTask,
      'tasks/nested/TASK-0012-native-task.md',
    );
    storage.add(doneTask);
    storage.add(epic);
    storage.add(memory);
    const resourcePath = join(home.root, 'resources', nestedTask.id, 'note.md');
    mkdirSync(dirname(resourcePath), { recursive: true });
    writeFileSync(resourcePath, '# Associated resource');

    expect(storage.get(nestedTask.id)?.title).toBe('Nested task');
    expect(storage.list({ type: EntityType.Task }).map(function getId(entity) {
      return entity.id;
    })).toEqual(expect.arrayContaining(['TASK-0012', 'TASK-0003']));
    expect(storage.list({ status: ['done'] })).toHaveLength(1);
    expect(storage.list({ parent_id: parentId })).toEqual([
      expect.objectContaining({ id: nestedTask.id }),
    ]);
    expect(storage.counts()).toEqual({
      total_tasks: 3,
      total_epics: 1,
      by_status: {
        open: 2,
        in_progress: 0,
        blocked: 0,
        done: 1,
        cancelled: 0,
      },
      by_type: {
        task: 2,
        epic: 1,
        memory: 1,
      },
    });
    expect(storage.getMaxId(EntityType.Task)).toBe(12);
    expect(storage.getMaxId(EntityType.Epic)).toBe(2);
    expect(storage.getMaxId(EntityType.Memory)).toBe(7);

    expect(storage.delete(nestedTask.id)).toBe(true);
    expect(storage.delete(nestedTask.id)).toBe(false);
    expect(storage.get(nestedTask.id)).toBeUndefined();
    expect(readFileSync(resourcePath, 'utf8')).toBe('# Associated resource');
  });
});
