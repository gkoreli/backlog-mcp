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
    });

    expect(tools.has('backlog_capture_requirement')).toBe(true);
    expect(tools.has('backlog_create')).toBe(false);
    expect(tools.has('backlog_update')).toBe(false);
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
    }, 0)).toBe(7180);
    expect(manifest).toEqual([
      {
        name: 'backlog_accept_adr',
        description: 'Use when ratifying an existing proposed ADR.',
        schemaBytes: 189,
        schemaSha256: 'ae9158a98860c11aef4fd430f8fe1a07c798ec2754db240423ad8c1a47674077',
      },
      {
        name: 'backlog_attach_artifact',
        description: 'Use when attaching an artifact to a project item.',
        schemaBytes: 476,
        schemaSha256: 'b1d630613d54e20d6eab62df5fcbfb7ebde0569bb43e5fe1f8ab5d73f323c279',
      },
      {
        name: 'backlog_block_task',
        description: 'Use when blocking a task with a reason.',
        schemaBytes: 266,
        schemaSha256: '0fdfac36ecc34ca0e30a9cf6f2f43f9b9883245662fc5840a8cdc972c2f912d8',
      },
      {
        name: 'backlog_capture_prompt',
        description: 'Use when preserving a verbatim human directive as a chronological project prompt.',
        schemaBytes: 739,
        schemaSha256: 'd56400bedf9a95d9fd004de64d66f8e4af636d1bf13200f53a494da9ecdb9029',
      },
      {
        name: 'backlog_capture_requirement',
        description: 'Use when recording a human or system requirement in the current project.',
        schemaBytes: 1770,
        schemaSha256: '39a9721dfc5f91d7078b2e8028fcc0423a19b68bc2e0963c0e93938df475ad6c',
      },
      {
        name: 'backlog_complete_task',
        description: 'Use when completing a task, optionally with evidence.',
        schemaBytes: 243,
        schemaSha256: 'f919cfe918a5540be54ccc78f8fec2d4ccf1c733752b975049a83b39df12f9f9',
      },
      {
        name: 'backlog_create_work',
        description: 'Use when creating a project work item.',
        schemaBytes: 406,
        schemaSha256: '01c3c363a9fc12b41b0866cad562a6579a67c1136432e131b642277dd2771f83',
      },
      {
        name: 'backlog_organize_folder',
        description: 'Use when creating a folder to organize project items.',
        schemaBytes: 237,
        schemaSha256: 'def7aedd445122642dbf14cdec89429415d838716df7c12bc6266cca5d493050',
      },
      {
        name: 'backlog_pause_cron',
        description: 'Use when pausing a scheduled intake.',
        schemaBytes: 189,
        schemaSha256: 'ae9158a98860c11aef4fd430f8fe1a07c798ec2754db240423ad8c1a47674077',
      },
      {
        name: 'backlog_plan_epic',
        description: 'Use when planning an epic that groups related work.',
        schemaBytes: 406,
        schemaSha256: '01c3c363a9fc12b41b0866cad562a6579a67c1136432e131b642277dd2771f83',
      },
      {
        name: 'backlog_propose_adr',
        description: 'Use when recording a proposed architectural decision in the current project.',
        schemaBytes: 770,
        schemaSha256: '8da5493e466d14722752a6f92c2db3546632e2e72e7e520b0a325ec17c57c992',
      },
      {
        name: 'backlog_resume_cron',
        description: 'Use when resuming a scheduled intake.',
        schemaBytes: 189,
        schemaSha256: 'ae9158a98860c11aef4fd430f8fe1a07c798ec2754db240423ad8c1a47674077',
      },
      {
        name: 'backlog_schedule_cron',
        description: 'Use when scheduling recurring project intake.',
        schemaBytes: 383,
        schemaSha256: 'eb8e4fa305ff5d5c266575d6c399c36f6641b92b4a1f440418ced4a2e605aa89',
      },
      {
        name: 'backlog_start_task',
        description: 'Use when starting active work on a task.',
        schemaBytes: 189,
        schemaSha256: 'ae9158a98860c11aef4fd430f8fe1a07c798ec2754db240423ad8c1a47674077',
      },
      {
        name: 'backlog_supersede_adr',
        description: 'Use when a newer ADR replaces an accepted or living ADR while preserving lineage.',
        schemaBytes: 293,
        schemaSha256: '63ba7b9fa2266eea283d80962e58101b58989dc2c790fa4ce9182128553524f1',
      },
      {
        name: 'backlog_target_milestone',
        description: 'Use when creating a milestone for a project target.',
        schemaBytes: 435,
        schemaSha256: 'f100de1e41d33cde71382cce41260987276ecc3eec68ee2c55b6ac1be3590313',
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
