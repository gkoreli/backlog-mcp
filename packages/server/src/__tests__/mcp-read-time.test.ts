/** Cold tool registration forwards the bound command clock into read presentation. */
import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryComposer } from '@backlog-mcp/memory';
import type { IBacklogService } from '../core/backlog-service.contract.js';
import { registerTools } from '../tools/index.js';

type Handler = (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text?: string }> }>;
function registerReads(service: IBacklogService, deps: Parameters<typeof registerTools>[2]): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const server = { registerTool(name: string, _configuration: unknown, handler: Handler) { handlers.set(name, handler); } };
  const selectedDeps = Object.assign(deps ?? {}, { intentRegistration: { mode: 'unavailable' as const, reason: 'constrained-runtime' as const } });
  registerTools(server as unknown as McpServer, service, selectedDeps);
  return handlers;
}
function readHandler(handlers: Map<string, Handler>, name: string): Handler {
  const handler = handlers.get(name);
  if (handler === undefined) throw new Error(`Missing registered tool ${name}`);
  return handler;
}

describe('MCP read observation time', function readClock() {
  it('forwards one bound clock into recall ages before delayed retrieval', async function recallClock() {
    const now = Date.parse('2026-10-05T00:00:00Z');
    const composer = new MemoryComposer();
    const deps = { time: now, memoryComposer: composer, clock: vi.fn(function clock(this: { time: number }) { return this.time; }) };
    vi.spyOn(composer, 'recall').mockImplementation(async function delayedRecall() {
      await Promise.resolve(); deps.time += 5 * 86400000;
      return [{ score: 1, entry: { id: 'MEMO-1', title: 'Convention', content: 'Convention', layer: 'semantic', source: 'fixture', createdAt: now - 86400000 } }];
    });
    const handlers = registerReads({} as IBacklogService, deps);
    const response = await readHandler(handlers, 'backlog_recall')({ query: 'convention' });
    expect(JSON.parse(response.content[0]?.text ?? '{}').items[0]).toMatchObject({ age_days: 1 });
    expect(deps.clock).toHaveBeenCalledOnce();
  });
  it('forwards one bound clock into wakeup before delayed corpus reads', async function wakeupClock() {
    const now = Date.parse('2026-10-05T00:00:00Z');
    const deps = { time: now, clock: vi.fn(function clock(this: { time: number }) { return this.time; }) };
    const service = { scan: vi.fn(async function delayedScan(filter?: { type?: string; status?: string[] }) {
      await Promise.resolve(); deps.time += 86400000;
      return filter?.status?.includes('in_progress') && filter.type === undefined
        ? [{ id: 'TASK-1', title: 'Active', type: 'task', status: 'in_progress', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }]
        : [];
    }) } as unknown as IBacklogService;
    const handlers = registerReads(service, deps);
    const response = await readHandler(handlers, 'backlog_wakeup')({});
    expect(JSON.parse(response.content[0]?.text ?? '{}').now.active_tasks[0]).toMatchObject({ age_days: 0 });
    expect(deps.clock).toHaveBeenCalledOnce();
  });
});
