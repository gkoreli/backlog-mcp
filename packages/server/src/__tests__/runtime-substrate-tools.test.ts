import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { registerBacklogListTool } from '../tools/backlog-list.js';

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

describe('runtime substrate read tools', function describeRuntimeTools() {
  it('accepts open substrate types', function acceptsRuntimeTypes() {
    const listTools = captureTools(registerBacklogListTool);

    expect(tool(listTools, 'backlog_list').inputSchema.safeParse({
      type: 'decision',
      status: ['accepted'],
    }).success).toBe(true);
  });

  it('rejects the retired epic_id alias instead of stripping it', function rejectsLegacyAlias() {
    const listTools = captureTools(registerBacklogListTool);

    expect(tool(listTools, 'backlog_list').inputSchema.safeParse({
      epic_id: 'EPIC-0001',
    }).success).toBe(false);
  });
});
