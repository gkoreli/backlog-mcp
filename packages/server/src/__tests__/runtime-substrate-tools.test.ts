import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { registerBacklogCreateTool } from '../tools/backlog-create.js';
import { registerBacklogListTool } from '../tools/backlog-list.js';
import { registerBacklogUpdateTool } from '../tools/backlog-update.js';

interface RegisteredTool {
  inputSchema: {
    safeParse(value: unknown): { success: boolean };
  };
}

function captureTools(
  register: (server: McpServer, service: IBacklogService) => void,
): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(
      name: string,
      config: RegisteredTool,
    ): void {
      tools.set(name, config);
    },
  } as unknown as McpServer;
  register(server, {} as IBacklogService);
  return tools;
}

function tool(
  tools: ReadonlyMap<string, RegisteredTool>,
  name: string,
): RegisteredTool {
  const registered = tools.get(name);
  if (registered === undefined) throw new Error(`missing registered tool: ${name}`);
  return registered;
}

describe('generic runtime substrate tools', function describeRuntimeTools() {
  it('accepts open substrate types and schema-specific field bags', function acceptsRuntimeFields() {
    const createTools = captureTools(registerBacklogCreateTool);
    const updateTools = captureTools(registerBacklogUpdateTool);
    const listTools = captureTools(registerBacklogListTool);

    expect(tool(createTools, 'backlog_create').inputSchema.safeParse({
      title: 'Decision',
      type: 'decision',
      fields: { summary: 'Use the runtime registry' },
    }).success).toBe(true);
    expect(tool(updateTools, 'backlog_update').inputSchema.safeParse({
      id: 'decision-001-root',
      status: 'accepted',
      fields: { reviewer: 'goga' },
    }).success).toBe(true);
    expect(tool(listTools, 'backlog_list').inputSchema.safeParse({
      type: 'decision',
      status: ['accepted'],
    }).success).toBe(true);
  });

  it('rejects the retired epic_id alias instead of stripping it', function rejectsLegacyAlias() {
    const createTools = captureTools(registerBacklogCreateTool);
    const updateTools = captureTools(registerBacklogUpdateTool);
    const listTools = captureTools(registerBacklogListTool);

    expect(tool(createTools, 'backlog_create').inputSchema.safeParse({
      title: 'Legacy',
      epic_id: 'EPIC-0001',
    }).success).toBe(false);
    expect(tool(updateTools, 'backlog_update').inputSchema.safeParse({
      id: 'TASK-0001',
      epic_id: 'EPIC-0001',
    }).success).toBe(false);
    expect(tool(listTools, 'backlog_list').inputSchema.safeParse({
      epic_id: 'EPIC-0001',
    }).success).toBe(false);
  });
});
