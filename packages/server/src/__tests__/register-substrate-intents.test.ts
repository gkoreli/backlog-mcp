import type {
  AnyEntity,
  CompiledSubstrateIntent,
} from '@backlog-mcp/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { OperationEntry } from '../operations/types.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { registerSubstrateIntents } from '../tools/register-substrate-intents.js';
import type { SubstrateIntentQuarantineDiagnostic } from '../tools/register-substrate-intents.types.js';
import {
  createBuiltinSubstrateRegistrations,
  loadProjectSubstrateDefinitions,
} from '../core/substrates/index.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';
import { RESERVED_TOOL_NAMES } from '../server/tool-name-reservations.js';
import { registerTools } from '../tools/index.js';

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
  it('adds semantic intents through the composed tool surface without generic CRUD', function composesToolSurface() {
    const intent = createRequirementIntent();
    const { server, tools } = captureServer();
    const { service } = serviceHarness();

    registerTools(server, service, {
      intentRegistration: {
        mode: 'required',
        intentRegistry: {
          listIntents: function listIntents() {
            return [intent];
          },
        },
        intentWriteValidator: {
          validateWrite: function validateWrite(candidate: unknown) {
            return { ok: true as const, entity: candidate as AnyEntity };
          },
        },
        reportIntentQuarantine: vi.fn(),
      },
    });

    expect(tools.has('backlog_capture_requirement')).toBe(true);
    expect(tools.has('backlog_create')).toBe(false);
    expect(tools.has('backlog_update')).toBe(false);
  });

  it('fails before exposing a partial surface when intent mode is missing or incomplete', function rejectsPartialComposition() {
    const { service } = serviceHarness();
    const missing = captureServer();
    expect(function registerMissingMode() {
      registerTools(missing.server, service, undefined);
    }).toThrow(/explicit complete intent registration mode/);
    expect(missing.tools.size).toBe(0);

    const intentRegistry = {
      listIntents: function listIntents() {
        return [];
      },
    };
    const intentWriteValidator = {
      validateWrite: function validateWrite(candidate: unknown) {
        return { ok: true as const, entity: candidate as AnyEntity };
      },
    };
    const incompleteRegistrations = [
      { mode: 'required', intentWriteValidator, reportIntentQuarantine: vi.fn() },
      { mode: 'required', intentRegistry, reportIntentQuarantine: vi.fn() },
      { mode: 'required', intentRegistry, intentWriteValidator },
    ];
    for (const intentRegistration of incompleteRegistrations) {
      const incomplete = captureServer();
      expect(function registerIncompleteMode() {
        registerTools(incomplete.server, service, {
          intentRegistration,
        } as never);
      }).toThrow(/explicit complete intent registration mode/);
      expect(incomplete.tools.size).toBe(0);
    }
  });

  it('freezes the initial semantic tool manifest including descriptions and schemas', function freezesManifest() {
    const definitions = loadProjectSubstrateDefinitions(
      [],
      createBuiltinSubstrateRegistrations(
        new BuiltinSubstrateStorageCatalog(),
      ),
      RESERVED_TOOL_NAMES,
    );
    expect(definitions.diagnostics).toEqual([]);
    const { server, tools } = captureServer();
    const { service } = serviceHarness();
    const entries: OperationEntry[] = [];

    const result = registerSubstrateIntents(
      server,
      service,
      registrationOptions(
        definitions.registry.listIntents(),
        entries,
        vi.fn(),
      ),
    );
    const manifest = [...tools.entries()].map(function manifestEntry(entry) {
      const [name, registered] = entry;
      const schema = JSON.stringify(z.toJSONSchema(registered.inputSchema));
      return {
        name,
        description: registered.description,
        schemaBytes: Buffer.byteLength(schema),
        schemaSha256: createHash('sha256').update(schema).digest('hex'),
      };
    }).sort(function compareNames(left, right) {
      return left.name.localeCompare(right.name);
    });

    expect(result.registered).toHaveLength(16);
    expect(result.quarantined).toEqual([]);
    for (const registered of tools.values()) {
      expect(Object.keys(registered.inputSchema.shape)).not.toEqual(
        expect.arrayContaining(['home', 'project_root', 'source_path', 'type']),
      );
    }
    expect(manifest.reduce(function schemaBytes(total, entry) {
      return total + entry.schemaBytes;
    }, 0)).toBe(10444);
    expect(manifest).toEqual([
      {
        name: 'backlog_accept_adr',
        description: 'Use when ratifying an existing proposed ADR.',
        schemaBytes: 393,
        schemaSha256: '50ae18217851ea1b12c0d976782a6969bf537f94e1abafe321af282ee456ee4b',
      },
      {
        name: 'backlog_attach_artifact',
        description: 'Use when attaching an artifact to a project item. parent_id is required.',
        schemaBytes: 680,
        schemaSha256: '629be781a8921321edd8afc9adbf52354510646f3ce2cb3a18c63131526628da',
      },
      {
        name: 'backlog_block_task',
        description: 'Use when blocking a task with a reason.',
        schemaBytes: 470,
        schemaSha256: '2510efbb1c304b0520ed55f7ef8ec25a33159d454c49fe9ab81ae842b23b3899',
      },
      {
        name: 'backlog_capture_prompt',
        description: 'Use when preserving a verbatim human directive as a chronological project prompt.',
        schemaBytes: 943,
        schemaSha256: 'ac49f9e49f24ecfb6e9902f7da7ec0a67e9998262e465381e20222a5cddd016c',
      },
      {
        name: 'backlog_capture_requirement',
        description: 'Use when recording a human or system requirement in the current project.',
        schemaBytes: 1974,
        schemaSha256: 'e3681c4a088cd1fa9a24347e008e0322245392947877ebb9ecd3948bfb95a4f2',
      },
      {
        name: 'backlog_complete_task',
        description: 'Use when completing a task, optionally with evidence.',
        schemaBytes: 447,
        schemaSha256: 'ee4219e6c4913cde9f64c857e7040663c1d2d364ba9028131a21168f461bba00',
      },
      {
        name: 'backlog_create_work',
        description: 'Use when creating a project work item. Pass parent_id when known; parentless work surfaces as unfiled at wakeup.',
        schemaBytes: 610,
        schemaSha256: 'fb5ddee7e2d5ca7fb7d536398baafacbc96a5387954a56e6bec7b7d6a5cf674c',
      },
      {
        name: 'backlog_organize_folder',
        description: 'Use when creating a folder to organize project items. Pass parent_id when known; parentless work surfaces as unfiled at wakeup.',
        schemaBytes: 441,
        schemaSha256: '82448bb1c43a2323001442c08a89669fa0744c19cac625c20d1129196175b6d8',
      },
      {
        name: 'backlog_pause_cron',
        description: 'Use when pausing a scheduled intake.',
        schemaBytes: 393,
        schemaSha256: '50ae18217851ea1b12c0d976782a6969bf537f94e1abafe321af282ee456ee4b',
      },
      {
        name: 'backlog_plan_epic',
        description: 'Use when planning an epic that groups related work. Pass parent_id when known; parentless work surfaces as unfiled at wakeup.',
        schemaBytes: 610,
        schemaSha256: 'fb5ddee7e2d5ca7fb7d536398baafacbc96a5387954a56e6bec7b7d6a5cf674c',
      },
      {
        name: 'backlog_propose_adr',
        description: 'Use when recording a proposed architectural decision in the current project.',
        schemaBytes: 974,
        schemaSha256: '68e889fbf2b4d0170ef905098a1fe83244923d07c7580ffeefe69206b9cdd556',
      },
      {
        name: 'backlog_resume_cron',
        description: 'Use when resuming a scheduled intake.',
        schemaBytes: 393,
        schemaSha256: '50ae18217851ea1b12c0d976782a6969bf537f94e1abafe321af282ee456ee4b',
      },
      {
        name: 'backlog_schedule_cron',
        description: 'Use when scheduling recurring project intake. Pass parent_id when known; parentless work surfaces as unfiled at wakeup.',
        schemaBytes: 587,
        schemaSha256: '6c2c763c02f9059041b0dd7ec05d2b6e9d3d6f99cd92066e08b520612581c9b5',
      },
      {
        name: 'backlog_start_task',
        description: 'Use when starting active work on a task.',
        schemaBytes: 393,
        schemaSha256: '50ae18217851ea1b12c0d976782a6969bf537f94e1abafe321af282ee456ee4b',
      },
      {
        name: 'backlog_supersede_adr',
        description: 'Use when a newer ADR replaces an accepted or living ADR while preserving lineage.',
        schemaBytes: 497,
        schemaSha256: '7efe552bf14a2256ca3194f361b4faa4dc6ec1120f4d2b146ec8ee804e5f552f',
      },
      {
        name: 'backlog_target_milestone',
        description: 'Use when creating a milestone for a project target. Pass parent_id when known; parentless work surfaces as unfiled at wakeup.',
        schemaBytes: 639,
        schemaSha256: '5e4daf8f633c80ee2d4cc855cc2277308b4ea8baa839191b63930896375a9fb1',
      },
    ]);
  });

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
    expect(registered.inputSchema).not.toBe(intent.intentInputSchema);
    expect(registered.inputSchema.safeParse({
      title: 'Local storage',
      content: 'The core path stays local-first.',
      as: 'aime:registrar',
    }).success).toBe(true);
    expect(registered.inputSchema.safeParse({
      title: 'Local storage',
      content: 'The core path stays local-first.',
      home: 'project',
    }).success).toBe(false);

    const response = await registered.handler({
      title: 'Local storage',
      content: 'The core path stays local-first.',
      as: '  aime:registrar  ',
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
        actor: { type: 'agent', name: 'aime:registrar' },
      }),
    ]);

    await registered.handler({
      title: 'Ambient storage',
      content: 'Whitespace identity is absent.',
      as: '   ',
    });
    expect(entries.at(-1)?.actor).toEqual({
      type: 'agent',
      name: 'registrar-test',
    });
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
