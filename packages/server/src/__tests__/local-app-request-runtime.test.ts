import {
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { Entity } from '@backlog-mcp/shared';
import { describe, expect, it } from 'vitest';
import { createBacklogHome } from '../storage/local/backlog-home.js';
import type {
  DocsTreeReconcileCallback,
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
  DocsTreeWatcherSubscription,
} from '../storage/local/docs-tree-watcher.contract.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import {
  createLocalAppRequestRuntime,
} from '../composition/local-app-request-runtime.js';

class FakeDocsTreeWatcher implements DocsTreeWatcher {
  async subscribe(
    _documentsDir: string,
    _onReconcile: DocsTreeReconcileCallback,
    _onError?: DocsTreeWatcherErrorCallback,
  ): Promise<DocsTreeWatcherSubscription> {
    return {
      unsubscribe: async function unsubscribe(): Promise<void> {},
    };
  }
}

function createRuntime(name: string) {
  const root = join(tmpdir(), 'local-app-runtime', name);
  const home = createBacklogHome({ kind: 'project', root });
  return createLocalRuntime(home, {
    watcher: new FakeDocsTreeWatcher(),
    createSearch: function createBm25Search(selectedHome) {
      return new OramaSearchService({
        cachePath: join(
          selectedHome.controlDir,
          'cache',
          'search-index.json',
        ),
        hybridSearch: false,
      });
    },
  });
}

describe('createLocalAppRequestRuntime', function describeLocalAppRuntime() {
  it('maps one isolated runtime graph into Hono dependencies', async function mapsRuntime() {
    const runtime = createRuntime('mapping');
    await runtime.start();
    const entity: Entity = {
      id: 'TASK-0001',
      title: 'Mapped task',
      status: 'open',
      type: 'task',
      created_at: '2026-07-16T00:00:00.000Z',
      updated_at: '2026-07-16T00:00:00.000Z',
    };
    runtime.storage.createDocument(
      entity,
      'tasks/TASK-0001-mapped-task.md',
    );

    const appRuntime = createLocalAppRequestRuntime(runtime);

    expect(appRuntime).toMatchObject({
      home: runtime.home,
      service: runtime.service,
      operationLog: runtime.operationLogger,
      operationLogger: runtime.operationLogger,
      eventBus: runtime.eventBus,
      memoryComposer: runtime.memoryComposer,
      usageTracker: runtime.usageTracker,
      resourceManager: runtime.resourceManager,
      readUsageLines: runtime.readUsageLines,
      identityPath: join(runtime.home.documentsDir, 'identity.md'),
      intentRegistrationMode: 'required',
      intentRegistry: runtime.substrateRegistry,
      intentWriteValidator: runtime.substrateRegistry,
    });
    expect(appRuntime.mintMemoryEntry).toBeTypeOf('function');
    expect(appRuntime.getSourcePath?.(entity.id)).toBe(
      'tasks/TASK-0001-mapped-task.md',
    );
    await runtime.stop();
  });

  it('reads resources only from the selected documents tree', async function scopesResourceReads() {
    const runtime = createRuntime('resource-read');
    await runtime.start();
    const inside = join(runtime.home.documentsDir, 'guide.md');
    const outside = join(tmpdir(), 'outside-guide.md');
    writeFileSync(inside, 'inside');
    writeFileSync(outside, 'outside');
    const appRuntime = createLocalAppRequestRuntime(runtime);

    expect(appRuntime.readLocalFile?.(inside)).toBe('inside');
    expect(appRuntime.readLocalFile?.('guide.md')).toBe('inside');
    expect(appRuntime.readLocalFile?.(outside)).toBeNull();

    await runtime.stop();
  });

  it('rejects documents-tree reads that escape through a symlink', async function scopesSymlinkEscapes() {
    const runtime = createRuntime('symlink-escape');
    await runtime.start();
    const outsideDirectory = join(tmpdir(), 'symlink-escape-outside');
    mkdirSync(outsideDirectory, { recursive: true });
    writeFileSync(join(outsideDirectory, 'outside.md'), 'outside');
    symlinkSync(
      outsideDirectory,
      join(runtime.home.documentsDir, 'linked-outside'),
    );
    const appRuntime = createLocalAppRequestRuntime(runtime);

    expect(appRuntime.readLocalFile?.('linked-outside/outside.md')).toBeNull();

    await runtime.stop();
  });
});
