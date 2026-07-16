import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { Entity } from '@backlog-mcp/shared';
import { describe, expect, it } from 'vitest';
import { createDevApp } from '../server/dev-app.js';
import type {
  DocsTreeReconcileCallback,
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
  DocsTreeWatcherSubscription,
} from '../storage/local/docs-tree-watcher.contract.js';
import {
  createLocalRuntime,
  type LocalRuntime,
} from '../storage/local/local-runtime.js';
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

const projectTask: Entity = {
  id: 'TASK-0001',
  title: 'Project runtime task',
  status: 'open',
  type: 'task',
  created_at: '2026-07-16T00:00:00.000Z',
  updated_at: '2026-07-16T00:00:00.000Z',
};

describe('Vite dev entry docs-native runtime', function describeDevEntry() {
  it('serves an unscoped request through the selected project runtime', async function servesProjectRuntime() {
    let selectedRuntime: LocalRuntime | undefined;
    const registry = new LocalRuntimeRegistry(function createRuntime(home) {
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
      runtime.storage.createDocument(
        {
          ...projectTask,
          title: home.kind === 'project'
            ? 'Project runtime task'
            : 'Global runtime task',
        },
        'tasks/TASK-0001-project-runtime-task.md',
      );
      selectedRuntime = runtime;
      return runtime;
    });
    mkdirSync('/workspace/project/.git', { recursive: true });
    mkdirSync('/workspace/project/docs', { recursive: true });
    const composition = await createDevApp(
      {},
      registry,
      '/workspace/project',
    );

    try {
      const response = await composition.app.request(`/tasks/${projectTask.id}`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: projectTask.id,
        title: projectTask.title,
        home: 'project',
        home_id: '/workspace/project',
        source_path: 'tasks/TASK-0001-project-runtime-task.md',
      });
      expect(selectedRuntime?.home).toMatchObject({
        kind: 'project',
        root: '/workspace/project',
      });

      const globalResponse = await composition.app.request(
        `/tasks/${projectTask.id}`,
        { headers: { 'X-Backlog-Home': 'global' } },
      );
      expect(await globalResponse.json()).toMatchObject({
        title: 'Global runtime task',
        home: 'global',
      });
      expect(await composition.app.request('/shutdown', {
        method: 'POST',
      })).toMatchObject({ status: 404 });
    } finally {
      await composition.close();
    }
  });
});
