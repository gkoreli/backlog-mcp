import { MemoryComposer } from '@backlog-mcp/memory';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOperationLogger } from '../operations/logger.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { CliRuntime } from '../cli/runner.types.js';

const mocks = vi.hoisted(function createMocks() {
  return {
    run: vi.fn(),
    createEntity: vi.fn(),
  };
});

vi.mock('../cli/runner.js', function mockRunner() {
  return {
    run: mocks.run,
    cliRuntimeDependencies(program: Command) {
      const options = program.opts<{
        home?: 'global' | 'project';
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

function createRuntime(): CliRuntime {
  const service = {} as IBacklogService;
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
});
