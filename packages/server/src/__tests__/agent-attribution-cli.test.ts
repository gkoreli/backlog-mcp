/**
 * ADR 0119 Slice A — CLI attribution wiring (`--as <agent>`).
 *
 * Proves the flag threads an OPTIONAL agent identity into the runner
 * dependencies on every write command, that its ABSENCE leaves the deps
 * byte-identical to today (no actor override at all), and that the recall
 * renderer resolves stored identities to "by <agent-title>" while the
 * "by goga" fallback stays untouched.
 */
import { Command } from 'commander';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { MemoryComposer } from '@backlog-mcp/memory';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { CliRuntime } from '../cli/runner.types.js';

const mocks = vi.hoisted(function createMocks() {
  return {
    run: vi.fn(),
    runAcrossHomes: vi.fn(),
  };
});

vi.mock('../cli/runner.js', async function mockRunner(importOriginal) {
  const actual = await importOriginal<typeof import('../cli/runner.js')>();
  return {
    ...actual,
    run: mocks.run,
    runAcrossHomes: mocks.runAcrossHomes,
  };
});

import { registerCreate } from '../cli/commands/create.js';
import { registerRemember } from '../cli/commands/remember.js';
import { registerEdit } from '../cli/commands/edit.js';
import { registerRecall } from '../cli/commands/recall.js';
import type { CliRunnerDependencies } from '../cli/runner.types.js';

function newProgram(): Command {
  return new Command()
    .option('--json')
    .option('--home <home>')
    .option('--project-root <path>');
}

function lastRunDeps(): CliRunnerDependencies {
  const call = mocks.run.mock.calls.at(-1);
  if (!call) throw new Error('run was not invoked');
  return call[3] as CliRunnerDependencies;
}

describe('CLI --as agent attribution (ADR 0119 Slice A)', () => {
  beforeEach(() => {
    mocks.run.mockReset();
    mocks.runAcrossHomes.mockReset();
    mocks.run.mockResolvedValue(undefined);
  });

  it('remember --as AGENT-0001 supplies an agent actor to the runner', async () => {
    const program = newProgram();
    registerRemember(program);

    await program.parseAsync([
      'node', 'backlog-mcp', 'remember', 'the fixture is green',
      '--title', 'checkpoint', '--as', 'AGENT-0001',
    ]);

    const actor = lastRunDeps().actor?.();
    expect(actor).toMatchObject({ type: 'agent', name: 'AGENT-0001' });
  });

  it('remember without --as passes deps with NO actor override — byte-identical to today', async () => {
    const program = newProgram();
    registerRemember(program);

    await program.parseAsync([
      'node', 'backlog-mcp', 'remember', 'plain write', '--title', 'control',
    ]);

    expect(lastRunDeps().actor).toBeUndefined();
  });

  it('create --as accepts a declared principal', async () => {
    const program = newProgram();
    registerCreate(program);

    await program.parseAsync([
      'node', 'backlog-mcp', 'create', 'Slice A task', '--as', 'aime:granite',
    ]);

    const actor = lastRunDeps().actor?.();
    expect(actor).toMatchObject({ type: 'agent', name: 'aime:granite' });
  });

  it('edit replace --as threads the identity through the shared edit action', async () => {
    const program = newProgram();
    registerEdit(program);

    await program.parseAsync([
      'node', 'backlog-mcp', 'edit', 'replace', 'TASK-0001', 'old', 'new',
      '--as', 'aime:onyx',
    ]);

    const actor = lastRunDeps().actor?.();
    expect(actor).toMatchObject({ type: 'agent', name: 'aime:onyx' });
  });

  it('recall renders "by <agent-title>" for resolvable sources and keeps "by goga" verbatim', async () => {
    const agentDoc = {
      id: 'AGENT-0001',
      type: 'agent',
      title: 'granite',
      principal: 'aime:granite',
      content: 'orchestrator',
    };
    const runtime = {
      service: {
        list: vi.fn(async () => [agentDoc]),
      } as unknown as IBacklogService,
      memoryComposer: {
        recall: async () => [
          {
            entry: {
              id: 'MEMO-0001', layer: 'semantic', title: 'agent-written',
              content: 'written through --as', source: 'aime:granite',
              createdAt: Date.now(), metadata: {},
            },
            score: 0.9,
          },
          {
            entry: {
              id: 'MEMO-0002', layer: 'semantic', title: 'human-written',
              content: 'written with no identity', source: 'goga',
              createdAt: Date.now(), metadata: {},
            },
            score: 0.8,
          },
        ],
      } as unknown as MemoryComposer,
      readIdentity: () => undefined,
      resolveSourcePath: (p: string) => p,
      close: async () => {},
    } as unknown as CliRuntime;

    let rendered = '';
    mocks.run.mockImplementation(async (handler, format) => {
      const result = await handler(runtime);
      rendered = (format as (r: unknown) => string)(result);
    });

    const program = newProgram();
    registerRecall(program);
    await program.parseAsync(['node', 'backlog-mcp', 'recall', 'attribution']);

    expect(rendered).toContain('by granite');           // resolved via principal
    expect(rendered).not.toContain('by aime:granite');  // title replaces the raw key
    expect(rendered).toContain('by goga');              // fallback untouched
  });
});
