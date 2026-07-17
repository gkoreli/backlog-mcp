/**
 * MCP wiring of the consolidation demand gate (ADR 0115 review item).
 *
 * The CLI wired readUsageLines from day one; the MCP registration passed no
 * deps, so the demand gate was silently dead over MCP — ripeness degraded to
 * age-only. This proves demand-ripeness works end-to-end through the
 * registered tool handler, not just through core.
 */
import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Entity } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { registerBacklogConsolidationTool } from '../tools/backlog-consolidation.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

/** Capture the handler the tool registers, so the test drives the MCP path. */
function captureHandler(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _meta: unknown, h: ToolHandler) => { handler = h; },
  } as unknown as McpServer;
  register(fakeServer);
  if (!handler) throw new Error('tool did not register a handler');
  return handler;
}

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function makeMemory(id: string): Entity {
  return {
    id, type: 'memory', title: `note ${id}`, content: `note ${id}`,
    layer: 'episodic', parent_id: 'FLDR-0001', usage_count: 0,
    created_at: daysAgo(1), updated_at: daysAgo(1),
  } as Entity;
}

describe('backlog_consolidation_candidates via MCP', () => {
  const memories = [makeMemory('MEMO-0001'), makeMemory('MEMO-0002'), makeMemory('MEMO-0003')];
  const service = {
    list: async () => memories,
    searchUnified: async () => [],
  } as unknown as IBacklogService;
  // Three recalls of bundle members within the window — meets min_demand 3.
  const usageLines = [
    JSON.stringify({ ts: daysAgo(2), type: 'recall', query: 'q', ids: ['MEMO-0001'] }),
    JSON.stringify({ ts: daysAgo(2), type: 'recall', query: 'q', ids: ['MEMO-0001', 'MEMO-0002'] }),
    JSON.stringify({ ts: daysAgo(2), type: 'recall', query: 'q', ids: ['MEMO-0001'] }),
  ];

  it('demand gate ripens a young bundle when readUsageLines is wired (CLI parity)', async () => {
    const handler = captureHandler(s =>
      registerBacklogConsolidationTool(s, service, { readUsageLines: () => usageLines }));
    const res = await handler({ min_age_days: 7, min_demand: 3 });
    const result = JSON.parse(res.content[0]?.text ?? '{}');
    expect(result.bundles[0]?.demand).toBe(3);
    expect(result.bundles[0]?.ripe).toBe(true);
  });

  it('without deps the same bundle stays unripe — the regression this wiring fixes', async () => {
    const handler = captureHandler(s => registerBacklogConsolidationTool(s, service));
    const res = await handler({ min_age_days: 7, min_demand: 3 });
    const result = JSON.parse(res.content[0]?.text ?? '{}');
    expect(result.bundles[0]?.demand).toBe(0);
    expect(result.bundles[0]?.ripe).toBe(false);
  });
});
