/**
 * Remember journaling through the REAL runtime (EXP-1 B-4 regression).
 *
 * Five successful dogfood remembers once produced zero operations rows.
 * This exercises the registered MCP tool against a LocalRuntime with its
 * real JSONL operation logger and proves the intent journals exactly once
 * — the store's internal entity creation must not add a second row.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import { createBacklogHome } from '../core/backlog-home.js';
import { createLocalRuntime, type LocalRuntime } from '../storage/local/local-runtime.js';
import { registerTools } from '../tools/register-tools.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function captureHandler(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | undefined;
  const fakeServer = {
    registerTool: (name: string, _meta: unknown, h: ToolHandler) => {
      if (name === 'backlog_remember') handler = h;
    },
  } as unknown as McpServer;
  register(fakeServer);
  if (!handler) throw new Error('tool did not register a handler');
  return handler;
}

describe('remember intent journaling (B-4, real runtime)', () => {
  const homeRoot = join(tmpdir(), 'remember-journal', 'repo');
  let runtime: LocalRuntime;
  let rememberTool: ToolHandler;
  let journalPath: string;

  function journalRows(): Array<Record<string, any>> {
    try {
      return readFileSync(journalPath, 'utf-8')
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  beforeAll(() => {
    const home = createBacklogHome({ kind: 'project', root: homeRoot });
    mkdirSync(home.documentsDir, { recursive: true });
    runtime = createLocalRuntime(home, {
      createSearch: () => new OramaSearchService({
        cachePath: join(home.controlDir, 'cache', 'search-index.json'),
        hybridSearch: false,
        halfLifeDays: 30,
      }),
    });
    journalPath = join(home.controlDir, 'state', 'operations.jsonl');
    rememberTool = captureHandler(s => registerTools(s, runtime.service, {
      memoryComposer: runtime.memoryComposer,
      actor: { type: 'agent', name: 'onyx' },
      operationLog: runtime.operationLogger,
      substrateRegistry: runtime.substrateRegistry,
      intentRegistration: {
        mode: 'required', intentRegistry: runtime.substrateRegistry,
        intentWriteValidator: runtime.substrateRegistry,
        reportIntentQuarantine: function reportQuarantine() {},
      },
    }));
  });

  it('one successful MCP remember → exactly one actor-attributed row with the MEMO id', async () => {
    const res = await rememberTool({
      content: 'The first wakeup indexed docs but returned an empty briefing.',
      title: 'EXP-1 friction',
    });
    expect(res.isError).not.toBe(true);
    const result = JSON.parse(res.content[0]?.text ?? '{}');
    expect(result.id).toMatch(/^MEMO-/);

    const rows = journalRows();
    expect(rows).toHaveLength(1);                            // never double-counted
    expect(rows[0]).toMatchObject({
      tool: 'backlog_remember',
      mutation: 'create',
      resourceId: result.id,
      actor: { type: 'agent', name: 'onyx' },
    });
  });

  it('a failed remember adds no row', async () => {
    const before = journalRows().length;
    const res = await rememberTool({ content: '   ', title: 'empty content' });
    expect(res.isError).toBe(true);
    expect(journalRows()).toHaveLength(before);
  });

  it('the composed MCP surface accepts a live requirement as provenance (#120)', async function remembersRequirement() {
    await runtime.service.add({
      id: 'REQ-0001', type: 'requirement', title: 'Aggregate telemetry',
      content: 'Keep adoption telemetry aggregate.', status: 'ruled', compliance: 'unchecked',
    });
    const before = journalRows().length;
    const response = await rememberTool({
      title: 'Adoption strategy', content: 'Telemetry follows the requirement.',
      entity_refs: ['REQ-0001'], layer: 'semantic', kind: 'plan',
    });
    expect(response.isError).not.toBe(true);
    const result = JSON.parse(response.content[0]?.text ?? '{}');
    expect(await runtime.service.get(result.id)).toMatchObject({ entity_refs: ['REQ-0001'] });
    expect(journalRows()).toHaveLength(before + 1);
    const rejected = await rememberTool({
      title: 'Unknown source', content: 'Invalid provenance.', entity_refs: ['UNKNOWN-0001'],
    });
    expect(rejected.isError).toBe(true);
    expect(journalRows()).toHaveLength(before + 1);
  });
});
