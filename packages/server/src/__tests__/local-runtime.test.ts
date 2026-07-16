import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import matter from 'gray-matter';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { Entity, Memory } from '@backlog-mcp/shared';
import { describe, expect, it, vi } from 'vitest';
import { createBacklogHome } from '../core/backlog-home.js';
import type { BacklogHome } from '../core/backlog-home.types.js';
import { createEntity as createEntityCore } from '../core/create.js';
import { editItem } from '../core/edit.js';
import { recall } from '../core/recall.js';
import { updateEntity as updateEntityCore } from '../core/update.js';
import { buildEntity } from '../storage/entity-factory.js';
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

const CREATE_ATTRIBUTION = {
  tool: 'backlog_create_work',
  mutation: 'create',
} as const;

const UPDATE_ATTRIBUTION = {
  tool: 'backlog_complete_task',
  mutation: 'update',
} as const;

const EDIT_ATTRIBUTION = {
  tool: 'write_resource',
  mutation: 'resource-edit',
} as const;

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

function createGlobalHome(name: string): BacklogHome {
  return createBacklogHome({
    kind: 'global',
    root: join(tmpdir(), 'local-runtime-global', name),
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

function snapshotFiles(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  function walk(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      const relativePath = relative(root, path).split(sep).join('/');
      snapshot.set(relativePath, readFileSync(path).toString('base64'));
    }
  }
  if (existsSync(root)) walk(root);
  return snapshot;
}

function changedPaths(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(function changed(path) {
      return before.get(path) !== after.get(path);
    })
    .sort();
}

function ignoredByRecommendedControlLayout(path: string): boolean {
  return path === '.backlog/config.local.json'
    || path.startsWith('.backlog/cache/')
    || path.startsWith('.backlog/state/');
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

    const result = await createEntityCore(
      runtime.service,
      { title: 'Claim-shaped task', type: 'task' },
      {
        actor: { type: 'agent', name: 'quartz' },
        operationLog: runtime.operationLogger,
      },
      CREATE_ATTRIBUTION,
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
            content: { type: 'string' },
            summary: { type: 'string' },
            private_note: { type: 'string' },
          },
          required: ['id', 'type', 'title', 'summary'],
          additionalProperties: false,
        },
        disclosure: {
          search: {
            enabled: true,
            fields: ['title', 'summary'],
          },
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

    const created = await createEntityCore(
      runtime.service,
      {
        title: 'Runtime decision',
        type: 'decision',
        content: 'undeclaredcontentmarker',
        fields: {
          summary: 'Initial summary',
          private_note: 'hiddenambermarker',
        },
      },
      context,
      CREATE_ATTRIBUTION,
    );
    await updateEntityCore(
      runtime.service,
      {
        id: created.id,
        fields: { summary: 'Updated summary' },
      },
      context,
      UPDATE_ATTRIBUTION,
    );

    expect(created.id).toBe('decision-001-root');
    expect(runtime.service.getSync(created.id)).toMatchObject({
      type: 'decision',
      summary: 'Updated summary',
    });
    const searchResults = await runtime.service.searchUnified(
      'Updated summary',
    );
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({
      type: 'decision',
      item: {
        id: created.id,
        summary: 'Updated summary',
      },
      snippet: {
        matched_fields: ['summary'],
      },
    });
    expect(searchResults[0]?.item).not.toHaveProperty('status');
    expect(await runtime.service.searchUnified(
      'Updated summary',
      { status: ['open'] },
    )).toEqual([]);
    expect(await runtime.service.searchUnified('hiddenambermarker')).toEqual([]);
    expect(await runtime.service.searchUnified(
      'undeclaredcontentmarker',
    )).toEqual([]);
    expect((await runtime.service.searchUnified(
      'Updated summary',
      { types: ['decision'] },
    )).map(function resultId(result) {
      return result.item.id;
    })).toEqual([created.id]);
    expect(existsSync(
      join(home.documentsDir, 'decisions', '001.md'),
    )).toBe(true);
    const storedPath = join(home.documentsDir, 'decisions', '001.md');
    const beforeRejectedUpdate = readFileSync(storedPath, 'utf8');
    await expect(updateEntityCore(
      runtime.service,
      {
        id: created.id,
        fields: { undeclared: true },
      },
      context,
      UPDATE_ATTRIBUTION,
    )).rejects.toThrow(/additional properties/);
    expect(readFileSync(storedPath, 'utf8')).toBe(beforeRejectedUpdate);

    await expect(createEntityCore(
      runtime.service,
      {
        title: 'Invalid runtime decision',
        type: 'decision',
        fields: { summary: 42 },
      },
      context,
      CREATE_ATTRIBUTION,
    )).rejects.toThrow(/must be string/);
    expect(existsSync(
      join(home.documentsDir, 'decisions', '002.md'),
    )).toBe(false);

    await expect(createEntityCore(
      runtime.service,
      { title: 'Unknown', type: 'unknown' },
      context,
      CREATE_ATTRIBUTION,
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
    const task = buildEntity({
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
    const memoryEntity = runtime.service.getSync('MEMO-0001');
    expect(memoryEntity?.title).toBe('Runtime memory');
    if (memoryEntity === undefined) {
      throw new Error('Runtime memory was not stored');
    }
    const markdownBeforeUsage = await runtime.service.getMarkdown(
      storedMemory.id,
    );
    expect(markdownBeforeUsage).not.toContain('usage_count');

    await runtime.usageTracker.recordExpand(storedMemory.id);

    expect(await runtime.service.getMarkdown(storedMemory.id)).toBe(
      markdownBeforeUsage,
    );
    expect(runtime.memoryStore.toMemoryEntry(
      memoryEntity as Memory,
    ).metadata).toMatchObject({
      usageCount: 1,
    });
    expect(siblingRuntime.memoryStore.toMemoryEntry(
      memoryEntity as Memory,
    ).metadata).toMatchObject({
      usageCount: 0,
    });
    expect(runtime.readUsageLines().map(function parseUsageLine(line) {
      return JSON.parse(line) as { type?: string };
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'expand' }),
      expect.objectContaining({ type: 'usage_summary' }),
    ]));

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
    expect(readFileSync(
      join(home.controlDir, 'state', 'memory-usage.jsonl'),
      'utf-8',
    )).toContain('"type":"usage_summary"');
    expect(runtime.eventBus).not.toBe(siblingRuntime.eventBus);
    expect(watcher.unsubscribeCount).toBe(1);
  });

  it('keeps global usage summaries in memory frontmatter', async function keepsGlobalFrontmatter() {
    const home = createGlobalHome('frontmatter-usage');
    const runtime = createLocalRuntime(home, {
      watcher: new FakeDocsTreeWatcher(),
      createSearch: createBm25Search,
    });
    await runtime.start();

    const stored = await runtime.memoryComposer.store({
      id: 'transient',
      title: 'Global memory',
      content: 'Global usage remains in frontmatter',
      layer: 'semantic',
      source: 'test',
      createdAt: Date.now(),
    });
    await runtime.usageTracker.recordExpand(stored.id);

    const markdown = await runtime.service.getMarkdown(stored.id);
    expect(markdown).toContain('usage_count: 1');
    expect(markdown).toContain('last_used_at:');
    expect(readFileSync(
      join(home.controlDir, 'state', 'memory-usage.jsonl'),
      'utf-8',
    )).toContain('"type":"expand"');

    await runtime.stop();
  });

  it('keeps project Git status clean after recall and expand under the recommended ignore layout', async function keepsProjectGitClean() {
    const home = createHome('git-clean-read-telemetry');
    const runtime = createLocalRuntime(home, {
      watcher: new FakeDocsTreeWatcher(),
      createSearch: createBm25Search,
    });
    await runtime.start();
    writeFileSync(
      join(home.controlDir, '.gitignore'),
      'config.local.json\ncache/\nstate/\n',
    );
    const stored = await runtime.memoryComposer.store({
      id: 'transient',
      title: 'Git-clean project memory',
      content: 'Read telemetry must remain ignored project state',
      layer: 'semantic',
      source: 'test',
      createdAt: Date.now(),
    });
    const markdownBeforeRead = await runtime.service.getMarkdown(stored.id);
    const before = snapshotFiles(home.root);

    const result = await recall(
      { query: 'ignored project state' },
      { memoryComposer: runtime.memoryComposer },
    );
    runtime.usageTracker.recordRecall(
      result.query,
      result.items.map(function itemId(item) {
        return item.id;
      }),
    );
    await runtime.usageTracker.recordExpand(stored.id);

    const changed = changedPaths(before, snapshotFiles(home.root));
    expect(changed).toEqual([
      '.backlog/state/memory-usage.jsonl',
    ]);
    expect(changed.filter(function unignored(path) {
      return !ignoredByRecommendedControlLayout(path);
    })).toEqual([]);
    expect(await runtime.service.getMarkdown(stored.id)).toBe(
      markdownBeforeRead,
    );

    await runtime.stop();
  });

  it('reconciles native edits without indexing typed Markdown twice', async function reconcilesNativeEdits() {
    const home = createHome('native-reconcile');
    const watcher = new FakeDocsTreeWatcher();
    const runtime = createLocalRuntime(home, {
      watcher,
      createSearch: createBm25Search,
    });
    await runtime.start();

    const task = buildEntity({
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
    const malformedPath = join(
      home.documentsDir,
      'tasks/TASK-0003-malformed.md',
    );
    const malformedMarkdown = [
      '---',
      'title: [unterminated',
      '---',
      '# Malformed task',
      '',
      'malformedclaimmarker',
    ].join('\n');
    writeFileSync(malformedPath, malformedMarkdown);
    const invalidPath = join(
      home.documentsDir,
      'tasks/TASK-0004-schema-invalid.md',
    );
    const invalidMarkdown = [
      '---',
      'type: task',
      'id: TASK-0004',
      'title: Schema-invalid task',
      'unexpected: external',
      '---',
      'schemainvalidmarker',
    ].join('\n');
    writeFileSync(invalidPath, invalidMarkdown);

    await watcher.emit();

    const typedResults = await runtime.service.searchUnified(
      'singletypezephyr',
    );
    expect(typedResults).toHaveLength(1);
    expect(typedResults[0]?.type).toBe('task');
    expect((await runtime.service.searchUnified(
      'genericnativeopal',
    ))[0]?.type).toBe('resource');
    expect((await runtime.service.searchUnified(
      'malformedclaimmarker',
    ))[0]?.type).toBe('resource');
    expect(readFileSync(malformedPath, 'utf8')).toBe(malformedMarkdown);
    expect(readFileSync(invalidPath, 'utf8')).toBe(invalidMarkdown);

    await runtime.stop();
  });

  it('does not treat a body edit as canonical-adoption consent', async function keepsAdoptionSeparate() {
    const home = createHome('body-edit-adoption');
    const runtime = createLocalRuntime(home, {
      watcher: new FakeDocsTreeWatcher(),
      createSearch: createBm25Search,
    });
    const sourcePath = join(home.documentsDir, 'adr/0004-external.md');
    const original = '# External ADR\n\nOriginal body.';
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, original);

    const result = await editItem(
      runtime.service,
      {
        id: 'ADR 0004',
        operation: {
          type: 'str_replace',
          old_str: 'Original body.',
          new_str: 'Edited body.',
        },
      },
      { actor: { type: 'agent', name: 'basalt' } },
      EDIT_ATTRIBUTION,
    );

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/canonical adoption requires separate explicit consent/iu),
    });
    expect(readFileSync(sourcePath, 'utf8')).toBe(original);
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
