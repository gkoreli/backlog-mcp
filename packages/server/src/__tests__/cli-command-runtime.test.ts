import { MemoryComposer, type MemoryEntry } from '@backlog-mcp/memory';
import { EntityType, type Memory } from '@backlog-mcp/shared';
import { Command } from 'commander';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBacklogHome } from '../storage/local/backlog-home.js';
import { createOperationLogger } from '../operations/logger.js';
import { buildEntity } from '../storage/entity-factory.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import type { IBacklogService } from '../core/backlog-service.contract.js';
import type { CliRuntime } from '../cli/runner.types.js';
import { resolveWorkspaceHome } from '../storage/local/backlog-home.js';

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
  };
});

vi.mock('../core/create.js', function mockCreate() {
  return { createEntity: mocks.createEntity };
});

import { registerCreate } from '../cli/commands/create.js';
import { registerRecall } from '../cli/commands/recall.js';
import { registerSearch } from '../cli/commands/search.js';
import { registerWakeup } from '../cli/commands/wakeup.js';
import { registerRemember } from '../cli/commands/remember.js';
import { registerContradictions } from '../cli/commands/contradictions.js';
import { registerUpdate } from '../cli/commands/update.js';

function createRuntime(): CliRuntime {
  const service = {
    scan: vi.fn(async function list() { return []; }),
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
    close: async function close(): Promise<void> {},
  };
}

describe('direct CLI command runtime wiring', function describeCommandRuntime() {
  beforeEach(function resetMocks() {
    mocks.run.mockReset();
    mocks.runAcrossHomes.mockReset();
    mocks.createEntity.mockReset();
  });

  it('passes one remember time through delayed storage and advisory analysis', async function rememberTime() {
    const now = Date.parse('2026-10-04T00:00:00Z');
    let clockTime = now;
    const runtime = createRuntime();
    const clock = vi.fn(function clock() { return clockTime; });
    runtime.writeContext.clock = clock;
    const focal: Memory = { id: 'MEMO-0001', title: 'Cache policy', content: 'Cache policy', type: 'memory', layer: 'semantic', parent_id: 'FLDR-0001', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), valid_until: new Date(now + 1).toISOString() };
    const neighbor = { ...focal, id: 'MEMO-0002' };
    runtime.service.scan = vi.fn(async function scan() { return [focal, neighbor]; });
    runtime.service.searchUnified = vi.fn(async function search() { return [focal, neighbor].map(item => ({ id: item.id, type: 'memory', item, score: 1 })); });
    let entered = function unused() {}; let release = function unused() {};
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const store = vi.spyOn(runtime.memoryComposer, 'store').mockImplementation(async function store(entry: MemoryEntry) {
      entered(); await waiting; return { ...entry, id: focal.id };
    });
    let receipt: unknown;
    mocks.run.mockImplementation(async function runSelected(handler: (runtime: CliRuntime) => Promise<unknown>) { receipt = await handler(runtime); });
    const program = new Command().option('--json'); registerRemember(program);
    const pending = program.parseAsync(['node', 'backlog', 'remember', 'Cache policy', '--title', 'Cache policy', '--context', 'FLDR-0001']);
    await enteredPromise; clockTime = now + 1; release(); await pending;
    expect(store.mock.calls[0]?.[0].createdAt).toBe(now);
    expect(receipt).toMatchObject({ created_at: new Date(now).toISOString(), collision_candidates: [{ id: neighbor.id }] });
    expect(clock).toHaveBeenCalledOnce(); expect(runtime.service.scan).toHaveBeenCalledOnce();
    const rows = runtime.operationLogger.read();
    expect(rows).toHaveLength(1); expect(rows[0]?.ts).toBe(new Date(now).toISOString());
  });

  it('selects the workspace resolver for unflagged wakeup', async function selectsWakeupWorkspace() {
    const program = new Command().option('--json');
    registerWakeup(program);
    await program.parseAsync(['node', 'backlog', 'wakeup']);
    expect(mocks.run.mock.calls[0]?.[3]).toEqual({ resolveHome: resolveWorkspaceHome });
    expect(mocks.runAcrossHomes).not.toHaveBeenCalled();
  });

  it('rejects malformed wakeup home flags before starting a runtime', async function rejectsInvalidWakeupHome() {
    const program = new Command().option('--home <home>');
    registerWakeup(program);
    await expect(program.parseAsync(['node', 'backlog', '--home', 'elsewhere', 'wakeup']))
      .rejects.toThrow('expected "global", "project", or "all"');
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.runAcrossHomes).not.toHaveBeenCalled();
  });

  it('routes create body-file reads and writes through the selected bundle', async function routesCreate() {
    writeFileSync('/cli-command-runtime-input.md', 'body file content');
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
      '/cli-command-runtime-input.md',
      '--home',
      'project',
      '--project-root',
      '/workspace/repo',
    ]);

    expect(mocks.createEntity).toHaveBeenCalledWith(
      runtime.service,
      expect.objectContaining({
        title: 'Selected task',
        content: 'body file content',
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
          memory_protocol: { recall: 'recall rubric', remember: 'remember rubric' },
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
      join(home.documentsDir, 'memories', 'MEMO-0001-cloudflare-deployment-note.md'),
      'utf8',
    );
    expect(matter(markdown).data.distinct_from).toEqual(['MEMO-0002']);
    expect(await localRuntime.service.get('MEMO-0001')).toMatchObject({
      distinct_from: ['MEMO-0002'],
    });
  });
});


describe('CLI read clocks', function cliReadTime() {
  it('supplies the command clock before delayed recall and wakeup reads', async function delayedReadCommands() {
    const runtime = createRuntime();
    const now = Date.parse('2026-10-05T00:00:00Z');
    let observedAt = now;
    const clock = vi.fn(function clock() { return observedAt; });
    runtime.writeContext.clock = clock;
    vi.spyOn(runtime.memoryComposer, 'recall').mockImplementation(async function delayedRecall() {
      await Promise.resolve(); observedAt += 3 * 86400000;
      return [{ score: 1, entry: { id: 'MEMO-1', title: 'Convention', content: 'Convention', layer: 'semantic', source: 'fixture', createdAt: now - 86400000 } }];
    });
    let result: unknown;
    mocks.run.mockImplementation(async function selected(handler: (runtime: CliRuntime) => Promise<unknown>) { result = await handler(runtime); });
    const recallProgram = new Command().option('--json'); registerRecall(recallProgram);
    await recallProgram.parseAsync(['node', 'backlog', 'recall', 'convention']);
    expect(result).toMatchObject({ items: [{ age_days: 1 }] });
    expect(clock).toHaveBeenCalledOnce();
    observedAt = now; clock.mockClear();
    runtime.service.scan = vi.fn(async function delayedScan(filter) {
      await Promise.resolve(); observedAt += 86400000;
      return filter?.status?.includes('in_progress') && filter.type === undefined
        ? [{ id: 'TASK-1', title: 'Active', type: 'task', status: 'in_progress', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }]
        : [];
    });
    const wakeupProgram = new Command().option('--json'); registerWakeup(wakeupProgram);
    await wakeupProgram.parseAsync(['node', 'backlog', 'wakeup']);
    expect(result).toMatchObject({ now: { active_tasks: [{ age_days: 0 }] } });
    expect(clock).toHaveBeenCalledOnce();
  });
});
