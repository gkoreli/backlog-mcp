/**
 * CLI/MCP get-context parity (report 0010 F3): the ADR 0114 neighborhood
 * option reaches the CLI surface, plain gets stay byte-identical, and the
 * Tier-1 `expand` telemetry event (ADR 0121 R7) fires exactly on the
 * context path — entity-id gets with context expand; plain gets and
 * resource-path gets read, they do not expand.
 */
import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityType } from '@backlog-mcp/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createBacklogHome, type BacklogHome } from '../core/backlog-home.js';
import { buildEntity } from '../storage/entity-factory.js';
import { createLocalRuntime, type LocalRuntime } from '../storage/local/local-runtime.js';
import {
  ambientAgentIdentity,
  resetAmbientAgentIdentityCacheForTests,
} from '../storage/local/agent-identity.js';
import type { CliRuntime } from '../cli/runner.types.js';

const mocks = vi.hoisted(function createMocks() {
  return { run: vi.fn() };
});

vi.mock('../cli/runner.js', async function mockRunner(importOriginal) {
  // Real helpers; only the runner is stubbed so tests inject the runtime.
  const actual = await importOriginal<typeof import('../cli/runner.js')>();
  return { ...actual, run: mocks.run };
});

import { registerGet } from '../cli/commands/get.js';
import { registerBacklogGetTool } from '../tools/backlog-get.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

/** Capture a registered MCP handler — drive the real tool boundary. */
function captureHandler(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _meta: unknown, h: ToolHandler) => { handler = h; },
  } as unknown as McpServer;
  register(fakeServer);
  if (!handler) throw new Error('tool did not register a handler');
  return handler;
}

describe('get --context parity (report 0010 F3)', () => {
  const root = join(tmpdir(), 'cli-get-context', 'repo');
  let home: BacklogHome;
  let localRuntime: LocalRuntime;
  let cliRuntime: CliRuntime;

  function telemetryLines(): Array<Record<string, unknown>> {
    const path = join(home.controlDir, 'state', 'retrieval-telemetry.jsonl');
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8').trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  /** Run the registered CLI get command and return its formatted output. */
  async function runGetCommand(...args: string[]): Promise<string> {
    const formatted: string[] = [];
    mocks.run.mockImplementation(async function runSelected(
      handler: (selected: CliRuntime) => Promise<unknown>,
      format: (result: never) => string,
    ) {
      formatted.push(format(await handler(cliRuntime) as never));
    });
    const program = new Command().option('--json');
    registerGet(program);
    await program.parseAsync(['node', 'backlog-mcp', 'get', ...args]);
    return formatted[0] ?? '';
  }

  beforeAll(() => {
    // Hermetic identity: seed the process git-rung cache so the actor stamp
    // is deterministic and the host repo's real config never leaks in.
    resetAmbientAgentIdentityCacheForTests();
    ambientAgentIdentity({ runGit: () => 'worktree\tbuilder:test', env: {} });

    mkdirSync(join(root, 'docs'), { recursive: true });
    home = createBacklogHome({ kind: 'project', root });
    localRuntime = createLocalRuntime(home);
    localRuntime.storage.add(buildEntity({
      id: 'EPIC-0001',
      title: 'Hydration epic',
      type: EntityType.Epic,
    }));
    localRuntime.storage.add(buildEntity({
      id: 'TASK-0100',
      title: 'Focal task',
      type: EntityType.Task,
      parent_id: 'EPIC-0001',
      content: 'Focal work item body.',
    }));
    localRuntime.storage.add(buildEntity({
      id: 'TASK-0101',
      title: 'Sibling task',
      type: EntityType.Task,
      parent_id: 'EPIC-0001',
      content: 'Sibling body.',
    }));
    cliRuntime = {
      home,
      service: localRuntime.service,
      writeContext: {
        actor: { type: 'agent', name: 'command-agent' },
        operationLog: localRuntime.operationLogger,
        memoryComposer: localRuntime.memoryComposer,
      },
      memoryComposer: localRuntime.memoryComposer,
      usageTracker: localRuntime.usageTracker,
      operationLogger: localRuntime.operationLogger,
      readIdentity: () => undefined,
      resolveSourcePath: (sourcePath) => sourcePath,
      close: async () => {},
    };
  });

  beforeEach(function resetRunner() {
    mocks.run.mockReset();
  });

  afterAll(async () => {
    resetAmbientAgentIdentityCacheForTests();
    await localRuntime.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('renders the ADR 0114 neighborhood as CLI stubs with --context', async () => {
    const out = await runGetCommand('TASK-0100', '--context');
    expect(out).toContain('--- TASK-0100 ---');
    expect(out).toContain('Focal work item body.');
    expect(out).toContain('── context: relational stubs (hydrate with get) ──');
    expect(out).toContain('parent:');
    expect(out).toContain('- EPIC-0001 · epic');
    expect(out).toContain('— Hydration epic');
    expect(out).toContain('siblings (1):');
    expect(out).toContain('- TASK-0101 · task');
  });

  it('plain get stays byte-identical: exactly the pre-F3 format, no context section', async () => {
    const out = await runGetCommand('TASK-0100');
    const markdown = await localRuntime.service.getMarkdown('TASK-0100');
    // The exact string the pre-change formatter produced for this item.
    expect(out).toBe(`--- TASK-0100 ---\n${markdown}`);
    expect(out).not.toContain('── context');
  });

  it('CLI: Tier-1 expand fires with --context (session + actor stamps), not without', async () => {
    const before = telemetryLines().length;
    await runGetCommand('TASK-0100');
    expect(telemetryLines()).toHaveLength(before);   // reading is not expansion

    await runGetCommand('TASK-0100', '--context');
    const lines = telemetryLines();
    expect(lines).toHaveLength(before + 1);
    expect(lines[lines.length - 1]).toMatchObject({
      event: 'expand',
      ids: ['TASK-0100'],
      home: home.id,
      actor: 'builder:test',
    });
    expect(typeof lines[lines.length - 1]?.['session']).toBe('string');
  });

  it('CLI: a resource-path get with --context reads, never expands (granite ruling)', async () => {
    const before = telemetryLines().length;
    const out = await runGetCommand('docs/tasks/TASK-0100.md', '--context');
    expect(out).toContain('Focal work item body.');
    expect(telemetryLines()).toHaveLength(before);
  });

  it('MCP: backlog_get emits the same expand event with context:true, not without', async () => {
    const getTool = captureHandler(s => registerBacklogGetTool(
      s,
      localRuntime.service,
      { usageTracker: localRuntime.usageTracker },
    ));
    const before = telemetryLines().length;

    await getTool({ id: 'TASK-0100' });
    expect(telemetryLines()).toHaveLength(before);

    const res = await getTool({ id: 'TASK-0100', context: true });
    expect(res.content[0]?.text ?? '').toContain('## Context — relational stubs');
    const lines = telemetryLines();
    expect(lines).toHaveLength(before + 1);
    expect(lines[lines.length - 1]).toMatchObject({
      event: 'expand',
      ids: ['TASK-0100'],
      home: home.id,
      actor: 'builder:test',
    });
  });
});
