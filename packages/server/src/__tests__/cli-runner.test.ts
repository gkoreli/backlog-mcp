import { mkdirSync } from 'node:fs';
import { MemoryComposer } from '@backlog-mcp/memory';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { LocalEventBus } from '../events/local-event-bus.js';
import { MemoryUsageTracker } from '../memory/usage-tracker.js';
import { createOperationLogger } from '../operations/logger.js';
import type { AppRequestRuntime } from '../server/app-request-runtime.types.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { LocalRuntime } from '../storage/local/local-runtime.js';
import {
  cliRuntimeDependencies,
  createCliRuntime,
  run,
  runAcrossHomes,
} from '../cli/runner.js';
import type { CliRuntime } from '../cli/runner.types.js';

function createService(): IBacklogService {
  return {
    flush: vi.fn(),
    searchUnified: vi.fn(async function searchUnified() {
      return [];
    }),
    isHybridSearchActive: function isHybridSearchActive() {
      return false;
    },
  } as unknown as IBacklogService;
}

interface FakeLocalGraph {
  runtime: LocalRuntime;
  service: IBacklogService;
  memoryComposer: MemoryComposer;
  operationLogger: ReturnType<typeof createOperationLogger>;
  eventBus: LocalEventBus;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function createFakeLocalGraph(name: string): FakeLocalGraph {
  const service = createService();
  const memoryComposer = new MemoryComposer();
  const operationLogger = createOperationLogger(
    `/docs-native/${name}/operations.jsonl`,
  );
  const eventBus = new LocalEventBus();
  const start = vi.fn(async function start(): Promise<void> {});
  const stop = vi.fn(async function stop(): Promise<void> {});
  const runtime = {
    service,
    memoryComposer,
    operationLogger,
    eventBus,
    start,
    stop,
  } as unknown as LocalRuntime;

  return {
    runtime,
    service,
    memoryComposer,
    operationLogger,
    eventBus,
    start,
    stop,
  };
}

function adaptFakeLocalRuntime(runtime: LocalRuntime): AppRequestRuntime {
  const usageTracker = new MemoryUsageTracker({
    getService: function getService() {
      return runtime.service;
    },
  });
  return {
    service: runtime.service,
    operationLog: runtime.operationLogger,
    operationLogger: runtime.operationLogger,
    eventBus: runtime.eventBus,
    memoryComposer: runtime.memoryComposer,
    mintMemoryEntry: function mintMemoryEntry(memory) {
      return {
        id: memory.id,
        title: memory.title,
        content: memory.content,
        layer: memory.layer,
        source: memory.source ?? 'unknown',
        createdAt: Date.parse(memory.created_at),
        metadata: { usageCount: 0 },
      };
    },
    usageTracker,
    readUsageLines: function readProjectUsage() {
      return ['project usage'];
    },
    getSourcePath: function getSourcePath(id) {
      return `tasks/${id}.md`;
    },
    resolveSourcePath: function resolveProjectSource(sourcePath) {
      return `project source: ${sourcePath}`;
    },
    identityPath: '/workspace/repo/docs/identity.md',
  };
}

describe('direct CLI invocation runtime', function describeCliRuntime() {
  it('uses the docs-native global home by default without a feature flag', async function defaultsGlobal() {
    const graph = createFakeLocalGraph('global-default');
    const createLocal = vi.fn(function createLocal() {
      return graph.runtime;
    });

    const selected = await createCliRuntime({
      env: {},
      createLocalRuntime: createLocal,
      adaptLocalRuntime: adaptFakeLocalRuntime,
    });

    expect(createLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'global',
    }));
    expect(graph.start).toHaveBeenCalledOnce();
    expect(selected.home?.kind).toBe('global');
    await selected.close();
    expect(graph.stop).toHaveBeenCalledOnce();
  });

  it('parses all but rejects it on ordinary single-home runtime construction', async function reservesAllForReads() {
    const program = new Command()
      .option('--home <home>')
      .option('--project-root <path>');
    program.parse([
      'node',
      'backlog-mcp',
      '--home',
      'all',
      '--project-root',
      '/workspace/repo',
    ]);

    expect(cliRuntimeDependencies(program)).toEqual({
      home: 'all',
      projectRoot: '/workspace/repo',
    });
    await expect(createCliRuntime({
      env: {},
      home: 'all',
      projectRoot: '/workspace/repo',
    })).rejects.toThrow(
      'CLI home "all" is read-only; use search, recall, or wakeup',
    );
  });

  it('rejects contradictory explicit docs-native selection', async function rejectsContradictorySelection() {
    await expect(createCliRuntime({
      env: {},
      home: 'global',
      projectRoot: '/workspace/repo',
    })).rejects.toThrow(
      'Project root cannot be combined with home "global"',
    );
  });

  it('selects a project runtime from caller cwd and env', async function selectsProject() {
    mkdirSync('/workspace/repo/.git', { recursive: true });
    mkdirSync('/workspace/repo/packages/server', { recursive: true });
    const graph = createFakeLocalGraph('selection');
    const createLocal = vi.fn(function createLocal() {
      return graph.runtime;
    });

    const selected = await createCliRuntime({
      env: {
        BACKLOG_HOME: 'global',
      },
      home: 'project',
      projectRoot: '/workspace/repo',
      cwd: '/workspace/repo/packages/server',
      actor: function actor() {
        return { type: 'agent', name: 'selected-agent' };
      },
      createLocalRuntime: createLocal,
      adaptLocalRuntime: adaptFakeLocalRuntime,
    });

    expect(createLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'project',
      root: '/workspace/repo',
    }));
    expect(graph.start).toHaveBeenCalledOnce();
    expect(selected.service).toBe(graph.service);
    expect(selected.writeContext).toMatchObject({
      actor: { type: 'agent', name: 'selected-agent' },
      operationLog: graph.operationLogger,
      memoryComposer: graph.memoryComposer,
    });
    expect(selected.memoryComposer).toBe(graph.memoryComposer);
    expect(selected.operationLogger).toBe(graph.operationLogger);
    expect(selected.home).toMatchObject({
      kind: 'project',
      root: '/workspace/repo',
    });
    expect(selected.getSourcePath?.('TASK-0001')).toBe(
      'tasks/TASK-0001.md',
    );
    expect(selected.resolveSourcePath('input.md')).toBe(
      'project source: input.md',
    );
    expect(selected.mintMemoryEntry).toBeTypeOf('function');
    expect(selected.usageTracker).toBeInstanceOf(MemoryUsageTracker);
    expect(selected.readUsageLines?.()).toEqual(['project usage']);

    const writeEventBus = selected.writeContext.eventBus;
    if (writeEventBus === undefined) {
      throw new Error('Docs-native write context has no event bus');
    }
    const emit = vi.spyOn(graph.eventBus, 'emit');
    writeEventBus.emit({
      type: 'task_created',
      id: 'TASK-0001',
      tool: 'backlog_create',
      actor: 'selected-agent',
      ts: '2026-07-16T00:00:00.000Z',
    });
    expect(emit).toHaveBeenCalledOnce();

    await selected.close();
    expect(graph.stop).toHaveBeenCalledOnce();
  });

  it('runs home:all against global only when no project root is supplied', async function runsGlobalAll() {
    const created: Array<{
      kind: string;
      graph: FakeLocalGraph;
    }> = [];
    const log = vi.spyOn(console, 'log').mockImplementation(
      function ignoreLog(): void {},
    );

    await runAcrossHomes(
      (coordinator, selection) => coordinator.search(
        { query: 'global only' },
        selection,
      ),
      function format(result) {
        return `${result.homes.length} homes`;
      },
      false,
      {
        env: {},
        home: 'all',
        createLocalRuntime: function createLocal(home) {
          const graph = createFakeLocalGraph(home.kind);
          created.push({ kind: home.kind, graph });
          return graph.runtime;
        },
        adaptLocalRuntime: adaptFakeLocalRuntime,
      },
    );

    expect(created.map(function kind(item) {
      return item.kind;
    })).toEqual(['global']);
    expect(created[0]?.graph.stop).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('1 homes');
    log.mockRestore();
  });

  it('runs home:all against global plus one project and closes both after failure', async function closesAllRuntimes() {
    const created: Array<{
      kind: string;
      graph: FakeLocalGraph;
    }> = [];
    const failure = new Error('cross-home handler failed');

    await expect(runAcrossHomes(
      async function failAfterRead(coordinator, selection) {
        await coordinator.search({ query: 'both homes' }, selection);
        throw failure;
      },
      function format() {
        return 'unused';
      },
      false,
      {
        env: {},
        home: 'all',
        projectRoot: '/workspace/project',
        createLocalRuntime: function createLocal(home) {
          const graph = createFakeLocalGraph(home.kind);
          created.push({ kind: home.kind, graph });
          return graph.runtime;
        },
        adaptLocalRuntime: adaptFakeLocalRuntime,
      },
    )).rejects.toBe(failure);

    expect(created.map(function kind(item) {
      return item.kind;
    })).toEqual(['global', 'project']);
    for (const item of created) {
      expect(item.graph.stop).toHaveBeenCalledOnce();
    }
  });

  it('closes the selected runtime after a successful handler', async function closesOnSuccess() {
    const graph = createFakeLocalGraph('success');
    const log = vi.spyOn(console, 'log').mockImplementation(
      function ignoreLog(): void {},
    );

    await run(
      async function handle(runtime) {
        expect(runtime.service).toBe(graph.service);
        return { status: 'ok' };
      },
      function format(result) {
        return result.status;
      },
      false,
      {
        env: {
          BACKLOG_PROJECT_ROOT: '/workspace/success',
        },
        createLocalRuntime: function createLocal() {
          return graph.runtime;
        },
        adaptLocalRuntime: adaptFakeLocalRuntime,
      },
    );

    expect(graph.stop).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('ok');
    log.mockRestore();
  });

  it('closes the selected runtime after a thrown handler', async function closesOnFailure() {
    const graph = createFakeLocalGraph('failure');
    const failure = new Error('handler failed');

    await expect(run(
      async function handle() {
        throw failure;
      },
      function format() {
        return 'unused';
      },
      false,
      {
        env: {
          BACKLOG_PROJECT_ROOT: '/workspace/failure',
        },
        createLocalRuntime: function createLocal() {
          return graph.runtime;
        },
        adaptLocalRuntime: adaptFakeLocalRuntime,
      },
    )).rejects.toBe(failure);

    expect(graph.stop).toHaveBeenCalledOnce();
  });
});
