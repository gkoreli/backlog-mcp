/**
 * search-races.test.ts — ADR 0116 Phase 1A correctness races.
 *
 * Three proven races from the as-built audit:
 *   1. Search initialization has no shared promise — concurrent first
 *      searches each run a full index build (single-flight required).
 *   2. Writes fire index mutations without awaiting them — an acknowledged
 *      write may not be searchable yet, and same-entity mutations can apply
 *      out of order (awaited, ordered mutation chain required).
 *   3. Resource drift must reconcile on the search path — deletions and
 *      external edits converge on first search (reconcileResources()).
 *
 * Interleavings are made deterministic with explicit gates: the first call
 * to a gated search-service method blocks until the test opens the gate, so
 * the racy schedule is forced rather than hoped for.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OramaSearchService,
  type Resource,
} from '@backlog-mcp/memory/search';
import {
  EntitySchema,
  type AnyEntity,
  type Entity,
  type Status,
  type SubstrateType,
} from '@backlog-mcp/shared';
import { ResourceManager } from '../resources/manager.js';
import { BacklogService } from '../storage/local/backlog-service.js';
import type {
  ListFilter,
  StorageAdapter,
} from '../storage/storage-adapter.js';
import { buildEntity } from '../storage/entity-factory.js';

let pathSequence = 0;

function uniquePath(label: string): string {
  pathSequence += 1;
  return join(tmpdir(), 'search-races', `${label}-${Date.now()}-${pathSequence}`);
}

function makeDocumentsDir(label: string): string {
  const documentsDir = uniquePath(label);
  mkdirSync(documentsDir, { recursive: true });
  return documentsDir;
}

function createSearch(cachePath: string): OramaSearchService {
  return new OramaSearchService({ cachePath, hybridSearch: false });
}

/** Deterministic interleaving control: block a gated call until opened. */
function createGate(): { open: () => void; wait: Promise<void> } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, wait };
}

function settle(milliseconds = 25): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    return Array.from(this.entities.values()).slice(0, filter?.limit);
  }

  add(candidate: AnyEntity): Entity {
    const entity = EntitySchema.parse(candidate);
    this.entities.set(entity.id, entity);
    return entity;
  }

  save(candidate: AnyEntity): Entity {
    const entity = EntitySchema.parse(candidate);
    this.entities.set(entity.id, entity);
    return entity;
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
    return {
      total_tasks: this.entities.size,
      total_epics: 0,
      by_status: { open: this.entities.size, in_progress: 0, blocked: 0, done: 0 },
      by_type: { task: this.entities.size },
    };
  }

  getMaxId(_type: SubstrateType): number {
    return 0;
  }

  *iterateEntities(): Generator<Entity> {
    yield* this.entities.values();
  }

  getFilePath(): string | null {
    return null;
  }
}

function createService(
  label: string,
  initialEntities: Entity[],
): { service: BacklogService; search: OramaSearchService } {
  const search = createSearch(join(uniquePath(`${label}-cache`), 'search-index.json'));
  const service = new BacklogService({
    storage: new MemoryStorage(initialEntities),
    search,
    resourceManager: new ResourceManager(makeDocumentsDir(`${label}-docs`)),
  });
  return { service, search };
}

function resultIds(results: Array<{ item: { id: string } }>): string[] {
  return results.map((result) => result.item.id);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('search initialization single-flight (ADR 0116 Phase 1A)', () => {
  it('concurrent first searches share exactly one index initialization', async () => {
    const seed = buildEntity({
      id: 'TASK-0001',
      title: 'Seeded entity',
      content: 'seedmarker',
    });
    const { service, search } = createService('single-flight', [seed]);

    const gate = createGate();
    const originalIndex = search.index.bind(search);
    const indexSpy = vi
      .spyOn(search, 'index')
      .mockImplementation(async (documents) => {
        await gate.wait;
        return originalIndex(documents);
      });

    const first = service.searchUnified('seedmarker');
    const second = service.searchUnified('seedmarker');
    gate.open();
    const [firstResults, secondResults] = await Promise.all([first, second]);

    expect(indexSpy).toHaveBeenCalledTimes(1);
    expect(resultIds(firstResults)).toContain('TASK-0001');
    expect(resultIds(secondResults)).toContain('TASK-0001');

    // Once initialized, later searches never re-run the build.
    await service.searchUnified('seedmarker');
    expect(indexSpy).toHaveBeenCalledTimes(1);
  });
});

describe('awaited ordered search mutation chain (ADR 0116 Phase 1A)', () => {
  it('an acknowledged add is searchable when the ack resolves', async () => {
    const { service, search } = createService('awaited-ack', []);
    await service.reconcile();

    const gate = createGate();
    const originalAdd = search.addDocument.bind(search);
    vi.spyOn(search, 'addDocument').mockImplementation(async (document) => {
      await gate.wait;
      return originalAdd(document);
    });

    let acknowledged = false;
    const ack = service
      .add(buildEntity({
        id: 'TASK-0002',
        title: 'Chained entity',
        content: 'chainmarker',
      }))
      .then((entity) => {
        acknowledged = true;
        return entity;
      });

    await settle();
    // The ack must not resolve while its index mutation is still pending.
    expect(acknowledged).toBe(false);

    gate.open();
    await ack;
    expect(resultIds(await service.searchUnified('chainmarker')))
      .toContain('TASK-0002');
  });

  it('same-entity saves apply in submission order', async () => {
    const base = buildEntity({
      id: 'TASK-0003',
      title: 'Ordered entity',
      content: 'orderingbase',
    });
    const { service, search } = createService('ordered-saves', [base]);
    await service.reconcile();

    const gate = createGate();
    const originalUpdate = search.updateDocument.bind(search);
    let firstUpdateCall = true;
    vi.spyOn(search, 'updateDocument').mockImplementation(async (document) => {
      if (firstUpdateCall) {
        firstUpdateCall = false;
        await gate.wait; // stall only the first submitted update
      }
      return originalUpdate(document);
    });

    const firstSave = service.save({ ...base, content: 'firstrevisionmarker' });
    const secondSave = service.save({ ...base, content: 'secondrevisionmarker' });
    gate.open();
    await Promise.all([firstSave, secondSave]);
    await settle();

    expect(resultIds(await service.searchUnified('secondrevisionmarker')))
      .toContain('TASK-0003');
    expect(resultIds(await service.searchUnified('firstrevisionmarker')))
      .not.toContain('TASK-0003');
  });

  it('an add followed by a delete leaves no ghost document', async () => {
    const { service, search } = createService('add-delete', []);
    await service.reconcile();

    const gate = createGate();
    const originalAdd = search.addDocument.bind(search);
    vi.spyOn(search, 'addDocument').mockImplementation(async (document) => {
      await gate.wait;
      return originalAdd(document);
    });

    const ghost = buildEntity({
      id: 'TASK-0004',
      title: 'Ghost entity',
      content: 'ghostmarker',
    });
    const added = service.add(ghost);
    const removed = service.delete(ghost.id);
    gate.open();
    await Promise.all([added, removed]);
    await settle();

    expect(resultIds(await service.searchUnified('ghostmarker')))
      .not.toContain('TASK-0004');
  });

  it('a write during in-flight initialization is indexed once initialization completes', async () => {
    // Regression guard: the pre-chain implementation covered this window
    // with a pendingOps queue; the ordered chain must preserve the
    // guarantee that a write racing the first index build is not lost.
    const seed = buildEntity({
      id: 'TASK-0005',
      title: 'Init seed',
      content: 'initseedmarker',
    });
    const { service, search } = createService('write-during-init', [seed]);

    const gate = createGate();
    const originalIndex = search.index.bind(search);
    vi.spyOn(search, 'index').mockImplementation(async (documents) => {
      await gate.wait;
      return originalIndex(documents);
    });

    const firstSearch = service.searchUnified('initseedmarker');
    const ack = service.add(buildEntity({
      id: 'TASK-0006',
      title: 'Late arrival',
      content: 'lateaddmarker',
    }));
    gate.open();
    await Promise.all([firstSearch, ack]);

    expect(resultIds(await service.searchUnified('lateaddmarker')))
      .toContain('TASK-0006');
  });
});

describe('resource reconciliation on the search path (ADR 0116 Phase 1A)', () => {
  it('first search converges deleted and edited resources from a stale persisted index', async () => {
    const cachePath = join(uniquePath('resource-reconcile-cache'), 'search-index.json');

    // Persist a stale index claiming two resources, one soon-deleted.
    const staleSearch = createSearch(cachePath);
    await staleSearch.index([]);
    const staleResources: Resource[] = [
      {
        id: 'mcp://backlog/kept.md',
        path: 'kept.md',
        title: 'Kept guide',
        content: '# Kept guide\nstaleresourcemarker',
      },
      {
        id: 'mcp://backlog/removed.md',
        path: 'removed.md',
        title: 'Removed guide',
        content: '# Removed guide\nremovedresourcemarker',
      },
    ];
    await staleSearch.indexResources(staleResources);
    staleSearch.flush();

    // Store truth: kept.md externally edited, removed.md deleted.
    const documentsDir = makeDocumentsDir('resource-reconcile-docs');
    writeFileSync(
      join(documentsDir, 'kept.md'),
      '# Kept guide\neditedresourcemarker',
    );

    const service = new BacklogService({
      storage: new MemoryStorage([]),
      search: createSearch(cachePath),
      resourceManager: new ResourceManager(documentsDir),
    });

    // The first search — not an explicit reconcile — must converge the
    // index to the store after the missed delete/edit events.
    expect(resultIds(await service.searchUnified('editedresourcemarker')))
      .toContain('mcp://backlog/kept.md');
    expect(resultIds(await service.searchUnified('staleresourcemarker')))
      .not.toContain('mcp://backlog/kept.md');
    expect(resultIds(await service.searchUnified('removedresourcemarker')))
      .not.toContain('mcp://backlog/removed.md');
  });
});
