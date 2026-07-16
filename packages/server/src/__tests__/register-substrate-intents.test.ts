import type {
  AnyEntity,
  CompiledSubstrateIntent,
} from '@backlog-mcp/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { OperationEntry } from '../operations/types.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { registerSubstrateIntents } from '../tools/register-substrate-intents.js';
import type { SubstrateIntentQuarantineDiagnostic } from '../tools/register-substrate-intents.types.js';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

interface RegisteredTool {
  description?: string;
  inputSchema: z.ZodObject;
  handler: ToolHandler;
}

function captureServer(): {
  server: McpServer;
  tools: Map<string, RegisteredTool>;
} {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(
      name: string,
      metadata: { description?: string; inputSchema: z.ZodObject },
      handler: ToolHandler,
    ): void {
      tools.set(name, { ...metadata, handler });
    },
  } as unknown as McpServer;
  return { server, tools };
}

function serviceHarness(): {
  service: IBacklogService;
  store: Map<string, AnyEntity>;
} {
  const store = new Map<string, AnyEntity>();
  const service = {
    get: vi.fn(async function getEntity(id: string) {
      return store.get(id);
    }),
    getMarkdown: vi.fn(async function getMarkdown() {
      return null;
    }),
    list: vi.fn(async function listEntities() {
      return [...store.values()];
    }),
    add: vi.fn(async function addEntity(entity: AnyEntity) {
      store.set(entity.id, entity);
      return entity;
    }),
    save: vi.fn(async function saveEntity(entity: AnyEntity) {
      store.set(entity.id, entity);
      return entity;
    }),
    delete: vi.fn(async function deleteEntity(id: string) {
      return store.delete(id);
    }),
    counts: vi.fn(async function counts() {
      return {
        total_tasks: 0,
        total_epics: 0,
        by_status: {},
        by_type: {},
      };
    }),
    getMaxId: vi.fn(async function getMaxId() {
      return 0;
    }),
    allocateId: vi.fn(async function allocateId() {
      return 'requirement-001-root';
    }),
    searchUnified: vi.fn(async function searchUnified() {
      return [];
    }),
  } as IBacklogService;
  return { service, store };
}

function createRequirementIntent(): CompiledSubstrateIntent {
  return {
    sourcePath: 'packaged:requirement',
    substrateType: 'requirement',
    verb: 'capture_requirement',
    toolName: 'backlog_capture_requirement',
    description: 'Capture a requirement through its semantic intent.',
    intentInputSchema: z.object({
      title: z.string(),
      content: z.string(),
    }).strict(),
    operation: {
      kind: 'create',
      fields: [
        { input: 'title', field: 'title' },
        { input: 'content', field: 'content' },
      ],
      fixedFields: { status: 'intake' },
    },
  };
}

function relateIntent(): CompiledSubstrateIntent {
  return {
    sourcePath: '.backlog/substrates/decision.yaml',
    substrateType: 'decision',
    verb: 'link',
    toolName: 'backlog_link_decision',
    description: 'Link one decision to another.',
    intentInputSchema: z.object({
      source_id: z.string(),
      target_id: z.string(),
    }).strict(),
    operation: {
      kind: 'relate',
      sourceInput: 'source_id',
      targetInput: 'target_id',
      relation: {
        field: 'related_to',
        cardinality: 'many',
        targets: ['decision'],
      },
    },
  };
}

function registrationOptions(
  intents: readonly CompiledSubstrateIntent[],
  entries: OperationEntry[],
  reportQuarantine: (diagnostic: SubstrateIntentQuarantineDiagnostic) => void,
) {
  return {
    intentRegistry: {
      listIntents: function listIntents() {
        return intents;
      },
    },
    validator: {
      validateWrite: function validateWrite(candidate: unknown) {
        return { ok: true as const, entity: candidate as AnyEntity };
      },
    },
    toolDeps: {
      actor: { type: 'agent' as const, name: 'registrar-test' },
      operationLog: {
        append: function append(entry: OperationEntry) {
          entries.push(entry);
        },
        query: async function query() {
          return [];
        },
        countForTask: async function countForTask() {
          return 0;
        },
      },
    },
    reportQuarantine,
  };
}

describe('registerSubstrateIntents', function describeIntentRegistrar() {
  it('passes compiler-owned metadata through and executes with semantic attribution', async function registersIntent() {
    const intent = createRequirementIntent();
    const { server, tools } = captureServer();
    const { service, store } = serviceHarness();
    const entries: OperationEntry[] = [];

    const result = registerSubstrateIntents(
      server,
      service,
      registrationOptions([intent], entries, vi.fn()),
    );
    const registered = tools.get(intent.toolName);
    if (registered === undefined) throw new Error('semantic intent was not registered');

    expect(result.registered).toEqual([intent]);
    expect(result.quarantined).toEqual([]);
    expect(registered.description).toBe(intent.description);
    expect(registered.inputSchema).toBe(intent.intentInputSchema);
    expect(registered.inputSchema.safeParse({
      title: 'Local storage',
      content: 'The core path stays local-first.',
      home: 'project',
    }).success).toBe(false);

    const response = await registered.handler({
      title: 'Local storage',
      content: 'The core path stays local-first.',
    });

    expect(response).toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify({
          ids: ['requirement-001-root'],
          changed: true,
        }),
      }],
    });
    expect(store.get('requirement-001-root')).toMatchObject({
      type: 'requirement',
      title: 'Local storage',
      status: 'intake',
    });
    expect(entries).toEqual([
      expect.objectContaining({
        tool: 'backlog_capture_requirement',
        mutation: 'create',
        resourceId: 'requirement-001-root',
      }),
    ]);
  });

  it('visibly quarantines unsupported relation operations without exposing a failing tool', function quarantinesDeferredOperation() {
    const intent = relateIntent();
    const { server, tools } = captureServer();
    const { service } = serviceHarness();
    const entries: OperationEntry[] = [];
    const diagnostics: SubstrateIntentQuarantineDiagnostic[] = [];

    const result = registerSubstrateIntents(
      server,
      service,
      registrationOptions(
        [intent],
        entries,
        function reportQuarantine(diagnostic) {
          diagnostics.push(diagnostic);
        },
      ),
    );

    expect(tools.has(intent.toolName)).toBe(false);
    expect(result.registered).toEqual([]);
    expect(result.quarantined).toEqual(diagnostics);
    expect(diagnostics).toEqual([{
      code: 'substrate-intent-operation-not-executable',
      sourcePath: intent.sourcePath,
      substrateType: intent.substrateType,
      verb: intent.verb,
      toolName: intent.toolName,
      operationKind: 'relate',
      reason: 'operation kind not yet executable — 0106.5 R5 initial-16 scope',
      escapePath: 'The first real project declaration needing relate or append-relation triggers implementation.',
    }]);
    expect(entries).toEqual([]);
  });
});
