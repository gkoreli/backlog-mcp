import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { Entity } from '@backlog-mcp/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  BACKLOG_HOME_HEADER,
  BACKLOG_PROJECT_ROOT_HEADER,
} from '../core/backlog-home.js';
import { createLocalNodeApp } from '../server/local-node-app.js';
import type {
  DocsTreeReconcileCallback,
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
  DocsTreeWatcherSubscription,
} from '../storage/local/docs-tree-watcher.contract.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';

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

function task(title: string): Entity {
  return {
    id: 'TASK-0001',
    title,
    status: 'open',
    type: 'task',
    created_at: '2026-07-16T00:00:00.000Z',
    updated_at: '2026-07-16T00:00:00.000Z',
  };
}

describe('production local Node app', function describeLocalNodeApp() {
  it('serves global by default and bridge-selected project homes independently', async function selectsRequestHome() {
    const shutdown = vi.fn();
    const createdRoots: string[] = [];
    const registry = new LocalRuntimeRegistry(function createRuntime(home) {
      createdRoots.push(home.root);
      const runtime = createLocalRuntime(home, {
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
      const title = home.kind === 'global' ? 'Global task' : 'Project task';
      runtime.storage.createDocument(
        task(title),
        `tasks/TASK-0001-${home.kind}.md`,
      );
      return runtime;
    });
    const composition = await createLocalNodeApp({
      globalRoot: '/workspace/global-home',
      registry,
      requestShutdown: shutdown,
    });

    try {
      const globalResponse = await composition.app.request('/tasks/TASK-0001');
      expect(await globalResponse.json()).toMatchObject({
        title: 'Global task',
        home: 'global',
        home_id: 'global',
      });

      const projectResponse = await composition.app.request(
        '/tasks/TASK-0001',
        {
          headers: {
            [BACKLOG_HOME_HEADER]: 'project',
            [BACKLOG_PROJECT_ROOT_HEADER]: '/workspace/project',
          },
        },
      );
      expect(await projectResponse.json()).toMatchObject({
        title: 'Project task',
        home: 'project',
        home_id: '/workspace/project',
      });
      expect(createdRoots).toEqual([
        '/workspace/global-home',
        '/workspace/project',
      ]);

      const shutdownResponse = await composition.app.request('/shutdown', {
        method: 'POST',
      });
      expect(shutdownResponse.status).toBe(200);
      expect(shutdown).toHaveBeenCalledOnce();
    } finally {
      await registry.closeAll();
    }
  });

  it('refuses a retired custom root before serving an empty global home', async function guardsCustomRoot() {
    const legacyRoot = '/workspace/custom-legacy';
    mkdirSync(join(legacyRoot, 'tasks'), { recursive: true });

    await expect(createLocalNodeApp({
      globalRoot: '/workspace/new-global',
      env: { BACKLOG_DATA_DIR: legacyRoot },
    })).rejects.toThrow('backlog migrate docs-native --home global');
  });
});
