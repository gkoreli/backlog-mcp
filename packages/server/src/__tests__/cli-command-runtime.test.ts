import { MemoryComposer } from '@backlog-mcp/memory';
import { EntityType } from '@backlog-mcp/shared';
import { Command } from 'commander';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBacklogHome } from '../core/backlog-home.js';
import { createOperationLogger } from '../operations/logger.js';
import { buildEntity } from '../storage/entity-factory.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { CliRuntime } from '../cli/runner.types.js';

const mocks = vi.hoisted(function createMocks() {
  return {
    run: vi.fn(),
    runAcrossHomes: vi.fn(),
    createEntity: vi.fn(),
  };
});

vi.mock('../cli/runner.js', async function mockRunner(importOriginal) {
  // Real withAgentIdentity (ADR 0119) and helpers; only the runners are stubbed.
  const actual = await importOriginal<typeof import('../cli/runner.js')>();
  return {
    ...actual,
    run: mocks.run,
    runAcrossHomes: mocks.runAcrossHomes,
    cliRuntimeDependencies(program: Command) {
      const options = program.opts<{
        home?: 'global' | 'project' | 'all';
        projectRoot?: string;
      }>();
      return {
        ...(options.home === undefined ? {} : { home: options.home }),
        ...(options.projectRoot === undefined
          ? {}
          : { projectRoot: options.projectRoot }),
      };
    },
  };
});

vi.mock('../core/create.js', function mockCreate() {
  return { createEntity: mocks.createEntity };
});

import { registerCreate } from '../cli/commands/create.js';
import { registerRecall } from '../cli/commands/recall.js';
import { registerSearch } from '../cli/commands/search.js';
import { registerWakeup } from '../cli/commands/wakeup.js';
import { registerContradictions } from '../cli/commands/contradictions.js';
import { registerUpdate } from '../cli/commands/update.js';

function createRuntime(): CliRuntime {
  const service = {
    list: vi.fn(async function list() { return []; }),
    searchUnified: vi.fn(async function search() { return []; }),
  } as unknown as IBacklogService;
  const operationLogger = createOperationLogger(
    '/cli-command-runtime/operations.jsonl',
  );
  const memoryComposer = new MemoryComposer();

  return {
    service,
    writeContext: {
      actor: { type: 'agent', name: 'command-agent' },
      operationLog: operationLogger,
      memoryComposer,
    },
    memoryComposer,
    operationLogger,
    readIdentity: function readIdentity() {
      return undefined;
    },
    resolveSourcePath: vi.fn(function resolveSourcePath(sourcePath) {
      return `selected home content: ${sourcePath}`;
    }),
    close: async function close(): Promise<void> {},
  };
}

describe('direct CLI command runtime wiring', function describeCommandRuntime() {
  beforeEach(function resetMocks() {
    mocks.run.mockReset();
    mocks.runAcrossHomes.mockReset();
    mocks.createEntity.mockReset();
  });

  it('routes create source reads and writes through the selected bundle', async function routesCreate() {
    const runtime = createRuntime();
    mocks.createEntity.mockResolvedValue({ id: 'TASK-0001' });
    mocks.run.mockImplementation(async function runSelected(
      handler: (selected: CliRuntime) => Promise<unknown>,
    ) {
      await handler(runtime);
    });
    const program = new Command()
      .option('--json')
      .option('--home <home>')
      .option('--project-root <path>');
    registerCreate(program);

    await program.parseAsync([
      'node',
      'backlog-mcp',
      'create',
      'Selected task',
      '--source',
      'input.md',
      '--home',
      'project',
      '--project-root',
      '/workspace/repo',
    ]);

    expect(runtime.resolveSourcePath).toHaveBeenCalledWith('input.md');
    expect(mocks.createEntity).toHaveBeenCalledWith(
      runtime.service,
      expect.objectContaining({
        title: 'Selected task',
        content: 'selected home content: input.md',
        type: 'task',
      }),
      runtime.writeContext,
      {
        tool: 'backlog create',
        mutation: 'create',
      },
    );
    expect(mocks.run.mock.calls[0]?.[3]).toEqual({
      home: 'project',
      projectRoot: '/workspace/repo',
    });
  });

  it('routes only search, recall, and wakeup through home:all', async function routesCrossHomeReads() {
    const unavailableHome = {
      home: 'project' as const,
      home_id: '/workspace/repo',
      available: false as const,
      reason: 'project unavailable',
    };
    const coordinator = {
      search: vi.fn(async function search() {
        return {
          results: [],
          total: 0,
          query: 'needle',
          search_mode: 'cross-home',
          homes: [unavailableHome],
        };
      }),
      recall: vi.fn(async function recall() {
        return {
          items: [],
          total: 0,
          query: 'memory',
          homes: [unavailableHome],
        };
      }),
      wakeup: vi.fn(async function wakeup() {
        return {
          groups: [],
          homes: [unavailableHome],
        };
      }),
    };
    const formatted: string[] = [];
    mocks.runAcrossHomes.mockImplementation(async function runAll(
      handler: (
        selected: typeof coordinator,
        selection: { projectRoot: string },
      ) => Promise<unknown>,
      format: (result: never) => string,
      _json: boolean,
      deps: { projectRoot: string },
    ) {
      const result = await handler(
        coordinator,
        { projectRoot: deps.projectRoot },
      );
      formatted.push(format(result as never));
    });
    function program(): Command {
      return new Command()
        .option('--json')
        .option('--home <home>')
        .option('--project-root <path>');
    }

    const searchProgram = program();
    registerSearch(searchProgram);
    await searchProgram.parseAsync([
      'node',
      'backlog-mcp',
      'search',
      'needle',
      '--limit',
      '4',
      '--home',
      'all',
      '--project-root',
      '/workspace/repo',
    ]);
    expect(coordinator.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'needle', limit: 4 }),
      { projectRoot: '/workspace/repo' },
    );

    const recallProgram = program();
    registerRecall(recallProgram);
    await recallProgram.parseAsync([
      'node',
      'backlog-mcp',
      'recall',
      'memory',
      '--context',
      'FLDR-0001',
      '--budget',
      '200',
      '--home',
      'all',
      '--project-root',
      '/workspace/repo',
    ]);
    expect(coordinator.recall).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'memory',
        context: 'FLDR-0001',
        token_budget: 200,
      }),
      { projectRoot: '/workspace/repo' },
    );

    const wakeupProgram = program();
    registerWakeup(wakeupProgram);
    await wakeupProgram.parseAsync([
      'node',
      'backlog-mcp',
      'wakeup',
      '--scope',
      'FLDR-0001',
      '--max-activity',
      '2',
      '--home',
      'all',
      '--project-root',
      '/workspace/repo',
    ]);
    expect(coordinator.wakeup).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'FLDR-0001',
        maxActivity: 2,
      }),
      { projectRoot: '/workspace/repo' },
    );

    expect(mocks.runAcrossHomes).toHaveBeenCalledTimes(3);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(formatted).toEqual([
      expect.stringContaining(
        'unavailable: /workspace/repo — project unavailable',
      ),
      expect.stringContaining(
        'unavailable: /workspace/repo — project unavailable',
      ),
      expect.stringContaining(
        '══ unavailable: /workspace/repo ══\nproject unavailable',
      ),
    ]);
  });

  it('keeps writes on the rejecting single-home runner for home:all', async function rejectsAllWritesCentrally() {
    const program = new Command()
      .option('--json')
      .option('--home <home>')
      .option('--project-root <path>');
    registerCreate(program);

    await program.parseAsync([
      'node',
      'backlog-mcp',
      'create',
      'Not cross-home',
      '--home',
      'all',
    ]);

    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.run.mock.calls[0]?.[3]).toEqual({ home: 'all' });
    expect(mocks.runAcrossHomes).not.toHaveBeenCalled();
  });

  it('routes --candidates to the same-home collision queue', async function routesCollisionCandidates() {
    const runtime = createRuntime();
    const formatted: string[] = [];
    mocks.run.mockImplementation(async function runSelected(
      handler: (selected: CliRuntime) => Promise<unknown>,
      format: (result: never) => string,
    ) {
      formatted.push(format(await handler(runtime) as never));
    });
    const program = new Command().option('--json');
    registerContradictions(program);

    await program.parseAsync(['node', 'backlog-mcp', 'contradictions', '--candidates']);

    expect(formatted).toEqual(['No collision candidates (0 live memories scanned).']);
  });

  it('round-trips distinct_from through the local update escape hatch', async function roundTripsDistinctFrom() {
    const root = join(tmpdir(), 'cli-command-runtime', 'distinct-from');
    mkdirSync(join(root, 'docs'), { recursive: true });
    const home = createBacklogHome({ kind: 'project', root });
    const localRuntime = createLocalRuntime(home);
    localRuntime.storage.add(buildEntity({
      id: 'MEMO-0001',
      title: 'Cloudflare deployment note',
      type: EntityType.Memory,
      content: 'Production deploys to Cloudflare Workers.',
      layer: 'semantic',
    }));
    localRuntime.storage.add(buildEntity({
      id: 'MEMO-0002',
      title: 'Local VPS deployment note',
      type: EntityType.Memory,
      content: 'Production deploys to a local VPS.',
      layer: 'semantic',
    }));
    const runtime: CliRuntime = {
      home,
      service: localRuntime.service,
      writeContext: {
        actor: { type: 'agent', name: 'command-agent' },
        operationLog: localRuntime.operationLogger,
        memoryComposer: localRuntime.memoryComposer,
      },
      memoryComposer: localRuntime.memoryComposer,
      operationLogger: localRuntime.operationLogger,
      readIdentity: function readIdentity() {
        return undefined;
      },
      resolveSourcePath: function resolveSourcePath(sourcePath) {
        return sourcePath;
      },
      close: async function close(): Promise<void> {
        await localRuntime.stop();
      },
    };
    mocks.run.mockImplementation(async function runSelected(
      handler: (selected: CliRuntime) => Promise<unknown>,
    ) {
      await handler(runtime);
    });
    const program = new Command().option('--json');
    registerUpdate(program);

    await program.parseAsync([
      'node',
      'backlog-mcp',
      'update',
      'MEMO-0001',
      '--fields',
      '{"distinct_from":["MEMO-0002"]}',
    ]);

    const markdown = readFileSync(
      join(home.documentsDir, 'memories', 'MEMO-0001.md'),
      'utf8',
    );
    expect(matter(markdown).data.distinct_from).toEqual(['MEMO-0002']);
    expect(await localRuntime.service.get('MEMO-0001')).toMatchObject({
      distinct_from: ['MEMO-0002'],
    });
  });
});
