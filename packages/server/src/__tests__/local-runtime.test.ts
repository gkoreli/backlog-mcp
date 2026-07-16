import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { Entity } from '@backlog-mcp/shared';
import { describe, expect, it, vi } from 'vitest';
import { createBacklogHome } from '../core/backlog-home.js';
import type { BacklogHome } from '../core/backlog-home.types.js';
import { createItem } from '../core/create.js';
import { updateItem } from '../core/update.js';
import { createEntity } from '../storage/entity-factory.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';
import type {
  DocsTreeReconcileCallback,
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
  DocsTreeWatcherSubscription,
} from '../storage/local/docs-tree-watcher.contract.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import type {
  SubstrateStorageCatalog,
  SubstrateStorageClaim,
} from '../storage/substrate-storage-catalog.contract.js';

class FakeDocsTreeWatcher implements DocsTreeWatcher {
  private onReconcile: DocsTreeReconcileCallback | undefined;
  private onError: DocsTreeWatcherErrorCallback | undefined;
  unsubscribeCount = 0;

  async subscribe(
    _documentsDir: string,
    onReconcile: DocsTreeReconcileCallback,
    onError?: DocsTreeWatcherErrorCallback,
  ): Promise<DocsTreeWatcherSubscription> {
    this.onReconcile = onReconcile;
    this.onError = onError;
    return {
      unsubscribe: async (): Promise<void> => {
        this.unsubscribeCount += 1;
      },
    };
  }

  async emit(): Promise<void> {
    const callback = this.onReconcile;
    if (callback === undefined) {
      throw new Error('Watcher has not been subscribed');
    }
    await callback();
  }

  fail(error: Error): void {
    this.onError?.(error);
  }
}

function createHome(name: string): BacklogHome {
  return createBacklogHome({
    kind: 'project',
    root: join(tmpdir(), 'local-runtime', name),
  });
}

function createBm25Search(home: BacklogHome): OramaSearchService {
  return new OramaSearchService({
    cachePath: join(home.controlDir, 'cache', 'search-index.json'),
    hybridSearch: false,
    halfLifeDays: 30,
  });
}

function writeEntity(
  home: BacklogHome,
  sourcePath: string,
  entity: Entity,
): void {
  const absolutePath = join(home.documentsDir, ...sourcePath.split('/'));
  mkdirSync(dirname(absolutePath), { recursive: true });
  const { content, ...frontmatter } = entity;
  writeFileSync(absolutePath, matter.stringify(content ?? '', frontmatter));
}

describe('LocalRuntime', function describeLocalRuntime() {
  it('mints and writes ids from the runtime storage claim', async function createsClaimShapedId() {
    const home = createHome('claim-allocation');
    const builtinCatalog = new BuiltinSubstrateStorageCatalog();
    const taskClaim: Readonly<SubstrateStorageClaim> = {
      type: 'task',
      folder: 'tasks',
      identity: {
        strategy: 'prefixed-number',
        prefix: 'TASK',
        minimumDigits: 4,
        displayTemplate: 'TASK-0{key}',
      },
    };
    const catalog: SubstrateStorageCatalog = {
      getStorageClaim(type): Readonly<SubstrateStorageClaim> | undefined {
        return type === 'task'
          ? taskClaim
          : builtinCatalog.getStorageClaim(type);
      },
    };
    const runtime = createLocalRuntime(home, {
      catalog,
      watcher: new FakeDocsTreeWatcher(),
      createSearch: createBm25Search,
    });

    const result = await createItem(
      runtime.service,
      { title: 'Claim-shaped task' },
      {
        actor: { type: 'agent', name: 'quartz' },
        operationLog: runtime.operationLogger,
      },
    );

    expect(result.id).toBe('TASK-00001');
    expect(runtime.service.getSync(result.id)?.title).toBe(
      'Claim-shaped task',
    );
    expect(existsSync(
      join(home.documentsDir, 'tasks', 'TASK-0001.md'),
    )).toBe(true);
  });

  it('loads a project substrate and routes create and update through its schema', async function writesProjectSubstrate() {
    const home = createHome('project-substrate');
    mkdirSync(join(home.documentsDir, 'substrates'), { recursive: true });
    writeFileSync(
      join(home.documentsDir, 'substrates', 'decision.json'),
      JSON.stringify({
        $schema: 'urn:backlog-mcp:schema:substrate-definition:1',
        definitionVersion: 1,
        type: 'decision',
        label: { singular: 'Decision', plural: 'Decisions' },
        folder: 'decisions',
        identity: {
          strategy: 'numbered',
          minimumDigits: 3,
          displayTemplate: 'decision-{key}-root',
        },
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { const: 'decision' },
            title: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['id', 'type', 'title', 'summary'],
          additionalProperties: false,
        },
      }),
    );
    const runtime = createLocalRuntime(home, {
      watcher: new FakeDocsTreeWatcher(),
      createSearch: createBm25Search,
    });
    const context = {
      actor: { type: 'agent' as const, name: 'basalt' },
      operationLog: runtime.operationLogger,
    };

    const created = await createItem(
      runtime.service,
      {
        title: 'Runtime decision',
        type: 'decision',
        fields: { summary: 'Initial summary' },
      },
      context,
    );
    await updateItem(
      runtime.service,
      {
        id: created.id,
        fields: { summary: 'Updated summary' },
      },
      context,
    );

    expect(created.id).toBe('decision-001-root');
    expect(runtime.service.getSync(created.id)).toMatchObject({
      type: 'decision',
      summary: 'Updated summary',
    });
    expect(existsSync(
      join(home.documentsDir, 'decisions', '001.md'),
    )).toBe(true);
    const storedPath = join(home.documentsDir, 'decisions', '001.md');
    const beforeRejectedUpdate = readFileSync(storedPath, 'utf8');
    await expect(updateItem(
      runtime.service,
      {
        id: created.id,
        fields: { undeclared: true },
      },
      context,
    )).rejects.toThrow(/additional properties/);
    expect(readFileSync(storedPath, 'utf8')).toBe(beforeRejectedUpdate);

    await expect(createItem(
      runtime.service,
      {
        title: 'Invalid runtime decision',
        type: 'decision',
        fields: { summary: 42 },
      },
      context,
    )).rejects.toThrow(/must be string/);
    expect(existsSync(
      join(home.documentsDir, 'decisions', '002.md'),
    )).toBe(false);

    await expect(createItem(
      runtime.service,
      { title: 'Unknown', type: 'unknown' },
      context,
    )).rejects.toThrow(/Unknown substrate type/);
  });

  it('owns docs, search, resources, memory, and operation state for one home', async function ownsPerHomeGraph() {
    const home = createHome('owned-graph');
    const watcher = new FakeDocsTreeWatcher();
    const runtime = createLocalRuntime(home, {
      watcher,
      createSearch: createBm25Search,
    });
    const siblingRuntime = createLocalRuntime(createHome('owned-graph-sibling'), {
      watcher: new FakeDocsTreeWatcher(),
      createSearch: createBm25Search,
    });
    const task = createEntity({
      id: 'TASK-0001',
      title: 'Runtime-owned task',
      content: 'typedquartzzephyr',
    });
    runtime.storage.add(task);
    mkdirSync(join(home.documentsDir, 'guides'), { recursive: true });
    writeFileSync(
      join(home.documentsDir, 'guides/runtime.md'),
      '# Runtime guide\n\ngenericopalnebula',
    );

    await runtime.start();

    expect((await runtime.service.searchUnified('typedquartzzephyr')).map(
      function getResultType(result) {
        return result.type;
      },
    )).toEqual(['task']);
    expect((await runtime.service.searchUnified('genericopalnebula')).map(
      function getResultType(result) {
        return result.type;
      },
    )).toEqual(['resource']);

    const storedMemory = await runtime.memoryComposer.store({
      id: 'transient',
      title: 'Runtime memory',
      content: 'per-home memory marker',
      layer: 'semantic',
      source: 'test',
      createdAt: Date.now(),
    });
    expect(storedMemory.id).toBe('MEMO-0001');
    expect(runtime.service.getSync('MEMO-0001')?.title).toBe('Runtime memory');

    runtime.operationLogger.append({
      ts: '2026-07-16T00:00:00.000Z',
      tool: 'backlog_create',
      params: { title: 'Runtime-owned task' },
      result: { id: task.id },
      resourceId: task.id,
      actor: { type: 'agent', name: 'quartz' },
    });

    await runtime.stop();

    expect(existsSync(
      join(home.controlDir, 'cache', 'search-index.json'),
    )).toBe(true);
    expect(readFileSync(
      join(home.controlDir, 'state', 'operations.jsonl'),
      'utf-8',
    )).toContain(task.id);
    expect(runtime.eventBus).not.toBe(siblingRuntime.eventBus);
    expect(watcher.unsubscribeCount).toBe(1);
  });

  it('reconciles native edits without indexing typed Markdown twice', async function reconcilesNativeEdits() {
    const home = createHome('native-reconcile');
    const watcher = new FakeDocsTreeWatcher();
    const runtime = createLocalRuntime(home, {
      watcher,
      createSearch: createBm25Search,
    });
    await runtime.start();

    const task = createEntity({
      id: 'TASK-0002',
      title: 'Native runtime task',
      content: 'singletypezephyr',
    });
    writeEntity(home, 'tasks/TASK-0002-native-runtime.md', task);
    mkdirSync(join(home.documentsDir, 'notes'), { recursive: true });
    writeFileSync(
      join(home.documentsDir, 'notes/native.md'),
      '# Native note\n\ngenericnativeopal',
    );

    await watcher.emit();

    const typedResults = await runtime.service.searchUnified(
      'singletypezephyr',
    );
    expect(typedResults).toHaveLength(1);
    expect(typedResults[0]?.type).toBe('task');
    expect((await runtime.service.searchUnified(
      'genericnativeopal',
    ))[0]?.type).toBe('resource');

    await runtime.stop();
  });

  it('coalesces watcher bursts while preserving a trailing reconciliation', async function coalescesWatcherBursts() {
    const home = createHome('coalesced-reconcile');
    const watcher = new FakeDocsTreeWatcher();
    const runtime = createLocalRuntime(home, {
      watcher,
      createSearch: createBm25Search,
    });
    await runtime.start();

    let releaseFirst: (() => void) | undefined;
    let reconcileCalls = 0;
    vi.spyOn(runtime.service, 'reconcile').mockImplementation(
      async function reconcileWithGate() {
        reconcileCalls += 1;
        if (reconcileCalls === 1) {
          await new Promise<void>(function waitForRelease(resolve) {
            releaseFirst = resolve;
          });
        }
      },
    );

    const first = watcher.emit();
    const second = watcher.emit();
    await Promise.resolve();

    expect(reconcileCalls).toBe(1);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(reconcileCalls).toBe(2);

    await runtime.stop();
  });

  it('forwards watcher failures to the runtime error boundary', async function forwardsWatcherErrors() {
    const home = createHome('watcher-error');
    const watcher = new FakeDocsTreeWatcher();
    const onWatcherError = vi.fn();
    const runtime = createLocalRuntime(home, {
      watcher,
      createSearch: createBm25Search,
      onWatcherError,
    });
    await runtime.start();

    watcher.fail(new Error('watch failed'));

    expect(onWatcherError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'watch failed' }),
    );
    await runtime.stop();
  });
});
