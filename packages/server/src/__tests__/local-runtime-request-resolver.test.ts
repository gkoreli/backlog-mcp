import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import { describe, expect, it } from 'vitest';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type {
  DocsTreeReconcileCallback,
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
  DocsTreeWatcherSubscription,
} from '../storage/local/docs-tree-watcher.contract.js';
import { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';
import {
  createLocalRuntime,
  type LocalRuntime,
} from '../storage/local/local-runtime.js';
import {
  LocalRuntimeRequestResolver,
  validateLocalRuntimeSelection,
} from '../server/local-runtime-request-resolver.js';

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

function createRuntime(home: BacklogHome): LocalRuntime {
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
        halfLifeDays: 30,
      });
    },
  });
}

function createResolver(name: string): LocalRuntimeRequestResolver {
  return new LocalRuntimeRequestResolver(
    new LocalRuntimeRegistry(createRuntime),
    { globalRoot: join(tmpdir(), 'runtime-request-resolver', name, 'global') },
  );
}

describe('validateLocalRuntimeSelection', function describeSelectionValidation() {
  it('defaults an unscoped detached-server request to global', function defaultsGlobal() {
    expect(validateLocalRuntimeSelection()).toEqual({ home: 'global' });
  });

  it('infers project selection from an explicit project root', function infersProject() {
    expect(validateLocalRuntimeSelection({
      projectRoot: '/workspace/project',
    })).toEqual({
      home: 'project',
      projectRoot: '/workspace/project',
    });
  });

  it('rejects ambiguous or contradictory selections', function rejectsInvalidSelection() {
    expect(function selectProjectWithoutRoot() {
      validateLocalRuntimeSelection({ home: 'project' });
    }).toThrow(/requires an explicit project root/);
    expect(function selectGlobalWithRoot() {
      validateLocalRuntimeSelection({
        home: 'global',
        projectRoot: '/workspace/project',
      });
    }).toThrow(/cannot be combined/);
    expect(function selectUnknownHome() {
      validateLocalRuntimeSelection({ home: 'elsewhere' });
    }).toThrow(/expected "global" or "project"/);
  });
});

describe('LocalRuntimeRequestResolver', function describeRequestResolver() {
  it('resolves an unscoped request to the configured global root', async function resolvesGlobal() {
    const resolver = createResolver('global-default');

    const runtime = await resolver.resolve();

    expect(runtime.home).toMatchObject({
      kind: 'global',
      id: 'global',
      root: join(
        tmpdir(),
        'runtime-request-resolver',
        'global-default',
        'global',
      ),
    });
    await runtime.stop();
  });

  it('canonicalizes and isolates explicit project roots', async function resolvesProjects() {
    const root = join(
      tmpdir(),
      'runtime-request-resolver',
      'projects',
      'project-a',
    );
    mkdirSync(join(root, 'docs'), { recursive: true });
    const resolver = createResolver('projects');

    const runtime = await resolver.resolve({
      home: 'project',
      projectRoot: root,
    });

    expect(runtime.home).toMatchObject({
      kind: 'project',
      id: root,
      root,
      documentsDir: join(root, 'docs'),
    });
    await runtime.stop();
  });

  it('does not read caller defaults from the server process environment', async function ignoresProcessEnvironment() {
    const originalHome = process.env.BACKLOG_HOME;
    const originalProjectRoot = process.env.BACKLOG_PROJECT_ROOT;
    process.env.BACKLOG_HOME = 'project';
    process.env.BACKLOG_PROJECT_ROOT = '/wrong/server/process/project';
    const resolver = createResolver('ignored-process-env');

    try {
      const runtime = await resolver.resolve();
      expect(runtime.home.kind).toBe('global');
      await runtime.stop();
    } finally {
      if (originalHome === undefined) delete process.env.BACKLOG_HOME;
      else process.env.BACKLOG_HOME = originalHome;
      if (originalProjectRoot === undefined) {
        delete process.env.BACKLOG_PROJECT_ROOT;
      } else {
        process.env.BACKLOG_PROJECT_ROOT = originalProjectRoot;
      }
    }
  });
});
