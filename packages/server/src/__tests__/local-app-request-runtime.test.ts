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
import { createBacklogHome } from '../core/backlog-home.js';
import type {
  DocsTreeReconcileCallback,
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
  DocsTreeWatcherSubscription,
} from '../storage/local/docs-tree-watcher.contract.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import {
  createLocalAppRequestRuntime,
} from '../server/local-app-request-runtime.js';

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

  it('rejects source paths outside the selected home and symlink escapes', async function scopesSourcePaths() {
    const runtime = createRuntime('source-path');
    await runtime.start();
    const inside = join(runtime.home.root, 'input.md');
    const outsideDirectory = join(tmpdir(), 'source-path-outside');
    mkdirSync(outsideDirectory, { recursive: true });
    writeFileSync(inside, 'inside source');
    writeFileSync(join(outsideDirectory, 'outside.md'), 'outside source');
    symlinkSync(
      outsideDirectory,
      join(runtime.home.root, 'linked-outside'),
    );
    const appRuntime = createLocalAppRequestRuntime(runtime);

    expect(appRuntime.resolveSourcePath?.('input.md')).toBe('inside source');
    expect(function readOutsideHome() {
      appRuntime.resolveSourcePath?.(join(outsideDirectory, 'outside.md'));
    }).toThrow(/inside backlog home/);
    expect(function readSymlinkEscape() {
      appRuntime.resolveSourcePath?.('linked-outside/outside.md');
    }).toThrow(/inside backlog home/);

    await runtime.stop();
  });
});
