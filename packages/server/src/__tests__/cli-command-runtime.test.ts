import { MemoryComposer } from '@backlog-mcp/memory';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOperationLogger } from '../operations/logger.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { CliRuntime } from '../cli/runner.types.js';

const mocks = vi.hoisted(function createMocks() {
  return {
    run: vi.fn(),
    createItem: vi.fn(),
  };
});

vi.mock('../cli/runner.js', function mockRunner() {
  return { run: mocks.run };
});

vi.mock('../core/create.js', function mockCreate() {
  return { createItem: mocks.createItem };
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
    mocks.createItem.mockReset();
  });

  it('routes create source reads and writes through the selected bundle', async function routesCreate() {
    const runtime = createRuntime();
    mocks.createItem.mockResolvedValue({ id: 'TASK-0001' });
    mocks.run.mockImplementation(async function runSelected(
      handler: (selected: CliRuntime) => Promise<unknown>,
    ) {
      await handler(runtime);
    });
    const program = new Command().option('--json');
    registerCreate(program);

    await program.parseAsync([
      'node',
      'backlog-mcp',
      'create',
      'Selected task',
      '--source',
      'input.md',
    ]);

    expect(runtime.resolveSourcePath).toHaveBeenCalledWith('input.md');
    expect(mocks.createItem).toHaveBeenCalledWith(
      runtime.service,
      expect.objectContaining({
        title: 'Selected task',
        content: 'selected home content: input.md',
      }),
      runtime.writeContext,
    );
  });
});
