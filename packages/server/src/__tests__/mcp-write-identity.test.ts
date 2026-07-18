import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { OperationEntry } from '../operations/types.js';
import { registerBacklogDeleteTool } from '../tools/backlog-delete.js';
import { registerWriteResourceTool } from '../tools/backlog-write-resource.js';

type ToolHandler = (
  input: Record<string, unknown>,
) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function captureHandler(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | undefined;
  const server = {
    registerTool(
      _name: string,
      _metadata: unknown,
      registeredHandler: ToolHandler,
    ): void {
      handler = registeredHandler;
    },
  } as unknown as McpServer;
  register(server);
  if (handler === undefined) throw new Error('tool did not register a handler');
  return handler;
}

function writeDeps(entries: OperationEntry[]) {
  return {
    actor: { type: 'user' as const, name: 'ambient-user' },
    operationLog: {
      append(entry: OperationEntry): void {
        entries.push(entry);
      },
      query: async function query(): Promise<OperationEntry[]> {
        return [];
      },
      countForTask: async function countForTask(): Promise<number> {
        return 0;
      },
    },
  };
}

describe('MCP explicit write identity', function describeWriteIdentity() {
  it('trims delete `as` and treats whitespace-only as ambient', async function attributesDelete() {
    const entries: OperationEntry[] = [];
    const service = {
      delete: vi.fn(async function deleteEntity() {
        return true;
      }),
    } as unknown as IBacklogService;
    const handler = captureHandler(function register(server) {
      registerBacklogDeleteTool(server, service, writeDeps(entries));
    });

    await handler({ id: 'TASK-0001', as: '  aime:delete-agent  ' });
    await handler({ id: 'TASK-0002', as: '   ' });

    expect(entries.map(function actorName(entry) {
      return entry.actor;
    })).toEqual([
      { type: 'agent', name: 'aime:delete-agent' },
      { type: 'user', name: 'ambient-user' },
    ]);
  });

  it('trims write_resource `as` and treats whitespace-only as ambient', async function attributesEdit() {
    const entries: OperationEntry[] = [];
    const entity: Entity = {
      id: 'TASK-0001',
      title: 'Editable task',
      type: 'task',
      status: 'open',
      content: 'before',
      created_at: '2026-07-18T00:00:00.000Z',
      updated_at: '2026-07-18T00:00:00.000Z',
    };
    const service = {
      get: vi.fn(async function getEntity() {
        return entity;
      }),
      save: vi.fn(async function saveEntity() {}),
    } as unknown as IBacklogService;
    const handler = captureHandler(function register(server) {
      registerWriteResourceTool(server, service, writeDeps(entries));
    });

    await handler({
      id: entity.id,
      operation: { type: 'append', new_str: 'explicit' },
      as: '  aime:edit-agent  ',
    });
    await handler({
      id: entity.id,
      operation: { type: 'append', new_str: 'ambient' },
      as: '   ',
    });

    expect(entries.map(function actorName(entry) {
      return entry.actor;
    })).toEqual([
      { type: 'agent', name: 'aime:edit-agent' },
      { type: 'user', name: 'ambient-user' },
    ]);
  });
});
