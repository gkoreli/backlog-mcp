import { mkdirSync } from 'node:fs';
import { MemoryComposer } from '@backlog-mcp/memory';
import { describe, expect, it, vi } from 'vitest';
import { LocalEventBus } from '../events/local-event-bus.js';
import { MemoryUsageTracker } from '../memory/usage-tracker.js';
import { createOperationLogger } from '../operations/logger.js';
import type { AppRequestRuntime } from '../server/app-request-runtime.types.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { LocalRuntime } from '../storage/local/local-runtime.js';
import {
  createCliRuntime,
  run,
} from '../cli/runner.js';
import type { CliRuntime } from '../cli/runner.types.js';

function createService(): IBacklogService {
  return {
    flush: vi.fn(),
  } as unknown as IBacklogService;
}

function createLegacyRuntime(): CliRuntime {
  const service = createService();
  const operationLogger = createOperationLogger('/legacy/operations.jsonl');
  const memoryComposer = new MemoryComposer();
  const usageTracker = new MemoryUsageTracker({
    getService: function getService() {
      return service;
    },
  });

  return {
    service,
    writeContext: {
      actor: { type: 'user', name: 'legacy-user' },
      operationLog: operationLogger,
      memoryComposer,
    },
    memoryComposer,
    usageTracker,
    operationLogger,
    readUsageLines: function readLegacyUsage() {
      return [];
    },
    readIdentity: function readLegacyIdentity() {
      return undefined;
    },
    resolveSourcePath: function resolveLegacySource() {
      return 'legacy source';
    },
    close: vi.fn(async function closeLegacy(): Promise<void> {}),
  };
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
  return {
    service: runtime.service,
    operationLog: runtime.operationLogger,
    operationLogger: runtime.operationLogger,
    eventBus: runtime.eventBus,
    memoryComposer: runtime.memoryComposer,
    resolveSourcePath: function resolveProjectSource(sourcePath) {
      return `project source: ${sourcePath}`;
    },
    identityPath: '/workspace/repo/docs/identity.md',
  };
}

describe('direct CLI invocation runtime', function describeCliRuntime() {
  it('keeps the legacy bundle as the unflagged default', async function defaultsLegacy() {
    const legacyRuntime = createLegacyRuntime();
    const createLegacy = vi.fn(function createLegacy() {
      return legacyRuntime;
    });
    const createLocal = vi.fn(function createLocal() {
      return createFakeLocalGraph('unused').runtime;
    });

    const selected = await createCliRuntime({
      env: {},
      createLegacyRuntime: createLegacy,
      createLocalRuntime: createLocal,
    });

    expect(selected).toBe(legacyRuntime);
    expect(createLegacy).toHaveBeenCalledOnce();
    expect(createLocal).not.toHaveBeenCalled();
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
        BACKLOG_DOCS_NATIVE: '1',
        BACKLOG_HOME: 'project',
      },
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
    expect(selected.resolveSourcePath('input.md')).toBe(
      'project source: input.md',
    );
    expect(selected.usageTracker).toBeUndefined();
    expect(selected.readUsageLines).toBeUndefined();

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
          BACKLOG_DOCS_NATIVE: '1',
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
          BACKLOG_DOCS_NATIVE: '1',
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
