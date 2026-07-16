import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  OramaSearchService,
  type Resource,
} from '@backlog-mcp/memory/search';
import type { Entity, EntityType, Status } from '@backlog-mcp/shared';
import { describe, expect, it } from 'vitest';
import { createBacklogHome } from '../core/backlog-home.js';
import { ResourceManager } from '../resources/manager.js';
import { BacklogService } from '../storage/local/backlog-service.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';
import { DocsNativeFilesystemStorage } from '../storage/local/docs-native-filesystem-storage.js';
import type {
  ListFilter,
  StorageAdapter,
} from '../storage/storage-adapter.js';
import { createEntity } from '../storage/entity-factory.js';

let pathSequence = 0;

function uniquePath(label: string): string {
  pathSequence += 1;
  return join(tmpdir(), 'backlog-service-composition', `${label}-${pathSequence}`);
}

function createSearch(label: string): OramaSearchService {
  return new OramaSearchService({
    cachePath: join(uniquePath(label), 'search-index.json'),
    hybridSearch: false,
  });
}

function writeDocument(
  rootDir: string,
  sourcePath: string,
  content: string,
): void {
  const absolutePath = join(rootDir, ...sourcePath.split('/'));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

class MemoryStorage implements StorageAdapter {
  private readonly entities = new Map<string, Entity>();

  constructor(initialEntities: Entity[] = []) {
    for (const entity of initialEntities) {
      this.entities.set(entity.id, entity);
    }
  }

  get(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  getMarkdown(id: string): string | null {
    return this.entities.has(id) ? `# ${id}` : null;
  }

  list(filter?: ListFilter): Entity[] {
    let entities = Array.from(this.entities.values());
    if (filter?.status) {
      entities = entities.filter(function hasStatus(entity) {
        return entity.status !== undefined
          && filter.status?.includes(entity.status);
      });
    }
    if (filter?.type) {
      entities = entities.filter(function hasType(entity) {
        return entity.type === filter.type;
      });
    }
    return entities.slice(0, filter?.limit);
  }

  add(entity: Entity): void {
    this.entities.set(entity.id, entity);
  }

  save(entity: Entity): void {
    this.entities.set(entity.id, entity);
  }

  delete(id: string): boolean {
    return this.entities.delete(id);
  }

  counts(): {
    total_tasks: number;
    total_epics: number;
    by_status: Record<Status, number>;
    by_type: Record<string, number>;
  } {
    const entities = Array.from(this.entities.values());
    const byStatus = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
    };
    const byType: Record<string, number> = {};
    for (const entity of entities) {
      const status = entity.status ?? 'open';
      byStatus[status] += 1;
      byType[entity.type] = (byType[entity.type] ?? 0) + 1;
    }
    return {
      total_tasks: byType.task ?? 0,
      total_epics: byType.epic ?? 0,
      by_status: byStatus,
      by_type: byType,
    };
  }

  getMaxId(type?: EntityType): number {
    const prefix = `${type ?? 'task'}-`;
    return Array.from(this.entities.values()).reduce(function getMaximum(
      maximum,
      entity,
    ) {
      if (entity.type !== type && type !== undefined) return maximum;
      const numericPart = entity.id.startsWith(prefix)
        ? entity.id.slice(prefix.length)
        : entity.id.slice(entity.id.lastIndexOf('-') + 1);
      const value = Number.parseInt(numericPart, 10);
      return Number.isNaN(value) ? maximum : Math.max(maximum, value);
    }, 0);
  }

  *iterateEntities(): Generator<Entity> {
    yield* this.entities.values();
  }

  getFilePath(): string | null {
    return null;
  }
}

describe('BacklogService composition', function describeComposition() {
  it('constructs with runtime-owned dependencies instead of the legacy singleton', async function constructsIndependently() {
    const entity = createEntity({
      id: 'TASK-0001',
      title: 'Injected storage entity',
    });
    const documentsDir = uniquePath('construction-docs');
    mkdirSync(documentsDir, { recursive: true });
    const service = new BacklogService({
      storage: new MemoryStorage([entity]),
      search: createSearch('construction-cache'),
      resourceManager: new ResourceManager(documentsDir),
    });

    expect(await service.get(entity.id)).toEqual(entity);
    expect(await service.list()).toEqual([entity]);
  });

  it('defaults allocation to the legacy formatter when no runtime allocator is injected', async function defaultsAllocation() {
    const entity = createEntity({
      id: 'TASK-0004',
      title: 'Existing task',
    });
    const documentsDir = uniquePath('allocation-docs');
    mkdirSync(documentsDir, { recursive: true });
    const service = new BacklogService({
      storage: new MemoryStorage([entity]),
      search: createSearch('allocation-cache'),
      resourceManager: new ResourceManager(documentsDir),
    });

    await expect(service.allocateId('task')).resolves.toBe('TASK-0005');
  });

  it('reconciles added, removed, and updated entities and resources together', async function reconcilesFullHome() {
    const cachePath = join(uniquePath('reconcile-cache'), 'search-index.json');
    const staleSearch = new OramaSearchService({
      cachePath,
      hybridSearch: false,
    });
    const staleEntity = createEntity({
      id: 'TASK-0001',
      title: 'Stale entity',
      content: 'old entity marker',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const removedEntity = createEntity({
      id: 'TASK-0002',
      title: 'Removed entity',
      content: 'obsoleteentityzephyr',
    });
    const staleResources: Resource[] = [
      {
        id: 'mcp://backlog/guide.md',
        path: 'guide.md',
        title: 'Stale guide',
        content: '# Stale guide\nold resource marker',
      },
      {
        id: 'mcp://backlog/removed.md',
        path: 'removed.md',
        title: 'Removed guide',
        content: '# Removed guide\nobsoleteresourcezephyr',
      },
    ];
    await staleSearch.index([staleEntity, removedEntity]);
    await staleSearch.indexResources(staleResources);
    staleSearch.flush();

    const currentEntity = {
      ...staleEntity,
      title: 'Updated entity',
      content: 'updated entity marker',
      updated_at: '2026-02-01T00:00:00.000Z',
    };
    const addedEntity = createEntity({
      id: 'TASK-0003',
      title: 'Added entity',
      content: 'added entity marker',
    });
    const documentsDir = uniquePath('reconcile-documents');
    writeDocument(
      documentsDir,
      'guide.md',
      '# Updated guide\nupdated resource marker',
    );
    writeDocument(
      documentsDir,
      'added.md',
      '# Added guide\nadded resource marker',
    );
    const search = new OramaSearchService({
      cachePath,
      hybridSearch: false,
    });
    const service = new BacklogService({
      storage: new MemoryStorage([currentEntity, addedEntity]),
      search,
      resourceManager: new ResourceManager(documentsDir),
    });

    await expect(service.reconcile()).resolves.toEqual({
      entities: { added: 1, removed: 1, updated: 1 },
      resources: { added: 1, removed: 1, updated: 1 },
    });
    expect((await search.search('updated entity marker')).map(function getId(result) {
      return result.task.id;
    })).toContain('TASK-0001');
    expect((await search.search('obsoleteentityzephyr')).map(function getId(result) {
      return result.task.id;
    })).not.toContain('TASK-0002');
    expect((await search.searchResources('updated resource marker')).map(function getId(result) {
      return result.resource.id;
    })).toContain('mcp://backlog/guide.md');
    expect((await search.searchResources('obsoleteresourcezephyr')).map(function getId(result) {
      return result.resource.id;
    })).not.toContain('mcp://backlog/removed.md');
  });

  it('indexes typed Markdown as an entity without duplicating it as a resource', async function excludesTypedDocuments() {
    const root = uniquePath('docs-native-home');
    mkdirSync(join(root, 'docs'), { recursive: true });
    const home = createBacklogHome({ kind: 'project', root });
    const docsStorage = new DocsNativeFilesystemStorage(
      home,
      new BuiltinSubstrateStorageCatalog(),
    );
    const typedEntity = createEntity({
      id: 'TASK-0004',
      title: 'Typed marker entity',
      content: 'typed marker body',
    });
    docsStorage.add(typedEntity);
    writeDocument(
      home.documentsDir,
      'README.md',
      '# Generic marker guide\ngeneric marker body',
    );
    const search = createSearch('docs-native-cache');
    const service = new BacklogService({
      storage: docsStorage,
      search,
      resourceManager: new ResourceManager(home.documentsDir),
    });

    await expect(service.reconcile()).resolves.toEqual({
      entities: { added: 0, removed: 0, updated: 0 },
      resources: { added: 1, removed: 0, updated: 0 },
    });
    expect((await search.search('typed marker')).map(function getId(result) {
      return result.task.id;
    })).toContain(typedEntity.id);
    expect((await search.searchResources('TASK-0004')).map(function getPath(result) {
      return result.resource.path;
    })).not.toContain('tasks/TASK-0004.md');
    expect((await search.searchResources('generic marker')).map(function getPath(result) {
      return result.resource.path;
    })).toEqual(['README.md']);
  });
});
