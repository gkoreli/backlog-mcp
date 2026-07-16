import { describe, expect, it } from 'vitest';
import { parseDocumentIdentity } from '../core/document-identity.js';
import {
  claimSubstrateDocuments,
  compileSubstrateDefinition,
  createBuiltinSubstrateRegistrations,
  createProjectSubstrateRegistry,
  loadProjectSubstrateDefinitions,
  loadSubstrateDefinitions,
} from '../core/substrates/index.js';
import type {
  CompiledSubstrateDefinition,
  CompileSubstrateDefinitionParams,
} from '../core/substrates/types.js';
import type { DiscoveredDocument } from '../core/document-discovery.types.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';

function canonicalSchema(type: string): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200 },
      type: { const: type },
      title: { type: 'string', minLength: 1, maxLength: 300 },
    },
    required: ['id', 'type', 'title'],
    additionalProperties: false,
  };
}

interface DefinitionOptions {
  sourcePath: string;
  type: string;
  folder: string;
  strategy?: 'numbered' | 'numbered-threaded' | 'prefixed-number';
  prefix?: string;
  replaces?: string;
}

function definition(options: DefinitionOptions): CompileSubstrateDefinitionParams {
  const strategy = options.strategy ?? 'numbered';
  return {
    sourcePath: options.sourcePath,
    value: {
      definitionVersion: 1,
      type: options.type,
      label: {
        singular: options.type,
        plural: `${options.type}s`,
      },
      folder: options.folder,
      identity: {
        strategy,
        ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
        minimumDigits: 4,
        displayTemplate: '{key}',
      },
      schema: canonicalSchema(options.type),
      ...(options.replaces === undefined ? {} : { replaces: options.replaces }),
    },
  };
}

function compileDefinition(options: DefinitionOptions): CompiledSubstrateDefinition {
  const result = compileSubstrateDefinition(definition(options));
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostic));
  }
  return result.substrate;
}

function compileIntentDefinition(
  options: DefinitionOptions,
  toolName: string,
): CompiledSubstrateDefinition {
  const params = definition(options);
  const value = params.value as Record<string, unknown>;
  const result = compileSubstrateDefinition({
    ...params,
    value: {
      ...value,
      intents: [{
        verb: 'capture',
        toolName,
        operation: 'create',
        description: `Capture ${options.type}.`,
        requiredInputs: ['title'],
      }],
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostic));
  return result.substrate;
}

function compileDisclosureDefinition(
  options: DefinitionOptions,
  section: string,
): CompiledSubstrateDefinition {
  const params = definition(options);
  const value = params.value as Record<string, unknown>;
  const result = compileSubstrateDefinition({
    ...params,
    value: {
      ...value,
      disclosure: {
        search: {
          enabled: true,
          fields: ['title'],
        },
        wakeup: {
          section,
          limit: 5,
          projection: ['id', 'title'],
        },
      },
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostic));
  return result.substrate;
}

function document(sourcePath: string): DiscoveredDocument {
  return {
    sourcePath,
    absolutePath: `/project/docs/${sourcePath}`,
    format: 'markdown',
    identity: parseDocumentIdentity({ sourcePath }),
  };
}

const BUILTIN_SUBSTRATES = createBuiltinSubstrateRegistrations(
  new BuiltinSubstrateStorageCatalog(),
);
const PACKAGED_RESULT = loadProjectSubstrateDefinitions([], BUILTIN_SUBSTRATES);
if (PACKAGED_RESULT.diagnostics.length > 0) {
  throw new Error(JSON.stringify(PACKAGED_RESULT.diagnostics));
}
const PACKAGED_SUBSTRATES = PACKAGED_RESULT.registry.listSubstrates();

function packagedSubstrate(type: string): CompiledSubstrateDefinition {
  const substrate = PACKAGED_RESULT.registry.getSubstrate(type);
  if (!substrate) throw new Error(`missing packaged substrate ${type}`);
  return substrate;
}

const PACKAGED_ADR = packagedSubstrate('adr');
const PACKAGED_REQUIREMENT = packagedSubstrate('requirement');
const PACKAGED_PROMPT = packagedSubstrate('prompt');

describe('ProjectSubstrateRegistry', function describeRegistry() {
  it('implements Quartz storage catalog for packaged definitions', () => {
    const result = createProjectSubstrateRegistry({
      packaged: [PACKAGED_ADR, PACKAGED_REQUIREMENT, PACKAGED_PROMPT],
      project: [],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.registry.getStorageClaim('requirement')).toEqual({
      type: 'requirement',
      folder: 'requirements',
      identity: {
        strategy: 'prefixed-number',
        prefix: 'REQ',
        minimumDigits: 4,
        displayTemplate: 'REQ-{key}',
      },
    });
  });

  it('lists packaged semantic intents in deterministic compiler-owned order', () => {
    expect(PACKAGED_RESULT.registry.listIntents().map(function intentName(intent) {
      return intent.toolName;
    })).toEqual([
      'backlog_accept_adr',
      'backlog_attach_artifact',
      'backlog_block_task',
      'backlog_capture_prompt',
      'backlog_capture_requirement',
      'backlog_complete_task',
      'backlog_create_work',
      'backlog_organize_folder',
      'backlog_pause_cron',
      'backlog_plan_epic',
      'backlog_propose_adr',
      'backlog_resume_cron',
      'backlog_schedule_cron',
      'backlog_start_task',
      'backlog_supersede_adr',
      'backlog_target_milestone',
    ]);
  });

  it('projects packaged disclosure and relation edges deterministically', () => {
    expect(PACKAGED_RESULT.registry.getDisclosure('requirement')).toMatchObject({
      search: {
        fields: expect.arrayContaining(['title', 'content', 'compliance']),
      },
      get: {
        relations: ['spawned', 'supersedes', 'violated_by'],
      },
      wakeup: {
        section: 'constraints',
        limit: 5,
      },
    });
    expect(PACKAGED_RESULT.registry.listDisclosureRelations().map(
      function relationIdentity(relation) {
        return [
          relation.sourceType,
          relation.field,
          relation.inverse,
        ].join(':');
      },
    )).toEqual([
      'adr:backlog_item:',
      'adr:extends:',
      'adr:implements:implemented_by',
      'adr:respects:respected_by',
      'adr:spawned_by:spawned',
      'adr:supersedes:superseded_by',
      'adr:violates:violated_by',
      'prompt:spawned:spawned_by',
      'prompt:supersedes:superseded_by',
      'requirement:spawned:spawned_by',
      'requirement:supersedes:superseded_by',
      'requirement:violated_by:violates',
    ]);
  });

  it('enforces the packaged Requirement field contract and human-authority invariants', () => {
    const base = {
      id: 'REQ-0001',
      type: 'requirement',
      title: 'Protect the vision',
      content: 'Architecture work must preserve product intent.',
      created_at: '2026-07-16T10:00:00.000Z',
      updated_at: '2026-07-16T10:00:00.000Z',
      status: 'building',
    };

    const candidate = {
      ...base,
      compliance: 'unchecked',
      domain: ['fleet', 'requirements'],
    };
    expect(PACKAGED_RESULT.registry.validateWrite(candidate)).toEqual({
      ok: true,
      entity: candidate,
    });
    expect(PACKAGED_RESULT.registry.validateWrite({
      ...base,
      compliance: 'at_risk',
    }).ok).toBe(false);
    expect(PACKAGED_RESULT.registry.validateWrite({
      ...base,
      compliance: 'satisfied',
      checked_at: '2026-07-16T11:00:00.000Z',
      checked_by: 'goga',
      violated_by: ['ADR-9999'],
    }).ok).toBe(false);
  });

  it('routes compiled Zod substrates through the same registry and preserves defaults', () => {
    const task = PACKAGED_RESULT.registry.validateWrite({
      id: 'TASK-0001',
      type: 'task',
      title: 'Use the registry',
      created_at: '2026-07-16T10:00:00.000Z',
      updated_at: '2026-07-16T10:00:00.000Z',
    });
    expect(task).toMatchObject({
      ok: true,
      entity: {
        type: 'task',
        status: 'open',
      },
    });

    const cron = PACKAGED_RESULT.registry.validateWrite({
      id: 'CRON-0001',
      type: 'cron',
      title: 'Invalid cron',
      schedule: 'not a cron',
      command: 'run',
      created_at: '2026-07-16T10:00:00.000Z',
      updated_at: '2026-07-16T10:00:00.000Z',
    });
    expect(cron.ok).toBe(false);
    expect(PACKAGED_RESULT.registry.validateWrite({
      id: 'UNKNOWN-0001',
      type: 'unknown',
      title: 'Unknown',
    })).toMatchObject({
      ok: false,
      issues: [{
        path: '/type',
        message: 'unknown substrate type: unknown',
      }],
    });
  });

  it('quarantines project declarations that shadow compiled built-in types', () => {
    const shadow = compileDefinition({
      sourcePath: 'substrates/task.json',
      type: 'task',
      folder: 'project-tasks',
      strategy: 'prefixed-number',
      prefix: 'PTASK',
      replaces: 'builtin:task@compiled',
    });
    const result = createProjectSubstrateRegistry({
      builtins: BUILTIN_SUBSTRATES,
      packaged: [PACKAGED_ADR, PACKAGED_REQUIREMENT, PACKAGED_PROMPT],
      project: [shadow],
    });

    expect(result.registry.getStorageClaim('task')?.folder).toBe('tasks');
    expect(result.diagnostics).toMatchObject([{
      sourcePath: 'substrates/task.json',
      type: 'task',
      issues: [{
        path: '/type',
        message: 'compiled substrate type task cannot be replaced by project data',
      }],
    }]);
  });

  it('quarantines duplicate project types without a load-order winner', () => {
    const left = compileDefinition({
      sourcePath: 'substrates/decision-a.json',
      type: 'decision',
      folder: 'decisions-a',
    });
    const right = compileDefinition({
      sourcePath: 'substrates/decision-b.json',
      type: 'decision',
      folder: 'decisions-b',
    });
    const result = createProjectSubstrateRegistry({
      packaged: [],
      project: [right, left],
    });

    expect(result.registry.getStorageClaim('decision')).toBeUndefined();
    expect(result.diagnostics.map(function projectPath(item) {
      return item.sourcePath;
    })).toEqual([
      'substrates/decision-a.json',
      'substrates/decision-b.json',
    ]);
    expect(result.diagnostics[0]?.issues[0]?.message).toContain(
      'substrates/decision-a.json, substrates/decision-b.json',
    );
  });

  it('requires explicit replacement and applies a valid replacement atomically', () => {
    const implicit = compileDefinition({
      sourcePath: 'substrates/adr.json',
      type: 'adr',
      folder: 'decisions',
      strategy: 'numbered-threaded',
    });
    const rejected = createProjectSubstrateRegistry({
      packaged: [PACKAGED_ADR],
      project: [implicit],
    });
    expect(rejected.registry.getStorageClaim('adr')?.folder).toBe('adr');
    expect(rejected.diagnostics).toHaveLength(1);

    const explicit = compileDefinition({
      sourcePath: 'substrates/adr.json',
      type: 'adr',
      folder: 'decisions',
      strategy: 'numbered-threaded',
      replaces: 'builtin:adr@1',
    });
    const accepted = createProjectSubstrateRegistry({
      packaged: [PACKAGED_ADR],
      project: [explicit],
    });
    expect(accepted.diagnostics).toEqual([]);
    expect(accepted.registry.getStorageClaim('adr')?.folder).toBe('decisions');
    expect(accepted.registry.getSubstrate('adr')?.sourcePath).toBe('substrates/adr.json');
  });

  it('quarantines overlapping folder and duplicate prefix claims deterministically', () => {
    const folderParent = compileDefinition({
      sourcePath: 'substrates/decision.json',
      type: 'decision',
      folder: 'records',
    });
    const folderChild = compileDefinition({
      sourcePath: 'substrates/note.json',
      type: 'note',
      folder: 'records/notes',
    });
    const prefixLeft = compileDefinition({
      sourcePath: 'substrates/constraint.json',
      type: 'constraint',
      folder: 'constraints',
      strategy: 'prefixed-number',
      prefix: 'SPEC',
    });
    const prefixRight = compileDefinition({
      sourcePath: 'substrates/specification.json',
      type: 'specification',
      folder: 'specifications',
      strategy: 'prefixed-number',
      prefix: 'SPEC',
    });
    const result = createProjectSubstrateRegistry({
      packaged: [],
      project: [prefixRight, folderChild, prefixLeft, folderParent],
    });

    expect(result.registry.listSubstrates()).toEqual([]);
    expect(result.diagnostics.map(function projectPath(item) {
      return item.sourcePath;
    })).toEqual([
      'substrates/constraint.json',
      'substrates/decision.json',
      'substrates/note.json',
      'substrates/specification.json',
    ]);
  });

  it('quarantines project intent collisions and restores packaged replacements', () => {
    const collidingProject = compileIntentDefinition({
      sourcePath: 'substrates/decision.json',
      type: 'decision',
      folder: 'decisions',
    }, 'backlog_propose_adr');
    const collidingReplacement = compileIntentDefinition({
      sourcePath: 'substrates/adr.json',
      type: 'adr',
      folder: 'decisions',
      strategy: 'numbered-threaded',
      replaces: 'builtin:adr@1',
    }, 'backlog_delete');
    const result = createProjectSubstrateRegistry({
      packaged: [PACKAGED_ADR, PACKAGED_REQUIREMENT, PACKAGED_PROMPT],
      project: [collidingProject, collidingReplacement],
      reservedToolNames: ['backlog_delete'],
    });

    expect(result.registry.getStorageClaim('decision')).toBeUndefined();
    expect(result.registry.getStorageClaim('adr')?.folder).toBe('adr');
    expect(result.registry.listIntents().map(function intentName(intent) {
      return intent.toolName;
    })).toContain('backlog_propose_adr');
    expect(result.diagnostics.map(function projectPath(item) {
      return item.sourcePath;
    })).toEqual([
      'substrates/adr.json',
      'substrates/decision.json',
    ]);
    expect(result.diagnostics.flatMap(function diagnosticIssues(item) {
      return item.issues;
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '/intents',
        message: expect.stringContaining('reserved by the consumer'),
      }),
      expect.objectContaining({
        path: '/intents',
        message: expect.stringContaining('intents.toolName claim collides'),
      }),
    ]));
  });

  it('treats packaged intent collisions with reserved consumer tools as invariants', () => {
    const packaged = compileIntentDefinition({
      sourcePath: 'builtin:decision@1',
      type: 'decision',
      folder: 'decisions',
    }, 'backlog_delete');

    expect(function createInvalidRegistry() {
      createProjectSubstrateRegistry({
        packaged: [packaged],
        project: [],
        reservedToolNames: ['backlog_delete'],
      });
    }).toThrow('intent tool name backlog_delete is reserved by the consumer');
  });

  it('quarantines project wakeup-section collisions deterministically', () => {
    const decision = compileDisclosureDefinition({
      sourcePath: 'substrates/decision.json',
      type: 'decision',
      folder: 'decisions',
    }, 'attention');
    const rule = compileDisclosureDefinition({
      sourcePath: 'substrates/rule.json',
      type: 'rule',
      folder: 'rules',
      strategy: 'prefixed-number',
      prefix: 'RULE',
    }, 'attention');
    const result = createProjectSubstrateRegistry({
      packaged: [],
      project: [rule, decision],
    });

    expect(result.registry.listSubstrates()).toEqual([]);
    expect(result.diagnostics.map(function sourcePath(diagnostic) {
      return diagnostic.sourcePath;
    })).toEqual([
      'substrates/decision.json',
      'substrates/rule.json',
    ]);
    expect(result.diagnostics.flatMap(function issues(diagnostic) {
      return diagnostic.issues;
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '/disclosure/wakeup/section',
        message: expect.stringContaining('disclosure.wakeup.section claim collides'),
      }),
    ]));
  });

  it('loads parsed discovery values without rereading and keeps valid siblings active', () => {
    const valid = definition({
      sourcePath: 'substrates/decision.json',
      type: 'decision',
      folder: 'decisions',
    });
    const result = loadSubstrateDefinitions({
      packagedDefinitions: [],
      declarations: [
        {
          sourcePath: valid.sourcePath,
          absolutePath: '/project/docs/substrates/decision.json',
          value: valid.value,
        },
        {
          sourcePath: 'substrates/broken.json',
          absolutePath: '/project/docs/substrates/broken.json',
          value: { definitionVersion: 1, type: 'broken' },
        },
      ],
    });

    expect(result.registry.getStorageClaim('decision')?.folder).toBe('decisions');
    expect(result.diagnostics).toMatchObject([
      {
        sourcePath: 'substrates/broken.json',
        type: 'broken',
      },
    ]);
  });
});

describe('claimSubstrateDocuments', function describeClaims() {
  const substrates = PACKAGED_SUBSTRATES;

  it('leaves generic date-named documents unclaimed', () => {
    const result = claimSubstrateDocuments({
      homeKey: '/project',
      substrates,
      documents: [document('requirements/2026-07-16-notes.md')],
    });

    expect(result).toEqual({
      claimed: [],
      diagnostics: [],
    });
  });

  it('reports duplicate Requirement semantic keys after the claim gate', () => {
    const result = claimSubstrateDocuments({
      homeKey: '/project',
      substrates,
      documents: [
        document('requirements/REQ-00001-long-form.md'),
        document('requirements/REQ-0001-short-form.md'),
      ],
    });

    expect(result.claimed).toEqual([]);
    expect(result.diagnostics).toEqual([{
      code: 'duplicate-substrate-document',
      homeKey: '/project',
      type: 'requirement',
      semanticKey: '1',
      sourcePaths: [
        'requirements/REQ-00001-long-form.md',
        'requirements/REQ-0001-short-form.md',
      ],
    }]);
  });

  it('normalizes prefixed identities containing digits before collision checks', () => {
    const specification = compileDefinition({
      sourcePath: 'builtin:specification@1',
      type: 'specification',
      folder: 'specifications',
      strategy: 'prefixed-number',
      prefix: 'R2D2',
    });
    const result = claimSubstrateDocuments({
      homeKey: '/project',
      substrates: [specification],
      documents: [
        document('specifications/R2D2-00001-long-form.md'),
        document('specifications/R2D2-0001-short-form.md'),
      ],
    });

    expect(result.claimed).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      type: 'specification',
      semanticKey: '1',
    });
  });

  it('does not collide identical numeric keys across substrate types', () => {
    const result = claimSubstrateDocuments({
      homeKey: '/project',
      substrates,
      documents: [
        document('adr/0001-decision.md'),
        document('prompts/0001-directive.md'),
      ],
    });

    expect(result.claimed.map(function claimedType(item) {
      return item.type;
    })).toEqual(['adr', 'prompt']);
    expect(result.diagnostics).toEqual([]);
  });
});
