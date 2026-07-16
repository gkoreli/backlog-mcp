import { describe, expect, it } from 'vitest';
import { parseDocumentIdentity } from '../core/document-identity.js';
import {
  claimSubstrateDocuments,
  compileSubstrateDefinition,
  createProjectSubstrateRegistry,
  loadProjectSubstrateDefinitions,
  loadSubstrateDefinitions,
} from '../core/substrates/index.js';
import type {
  CompiledSubstrateDefinition,
  CompileSubstrateDefinitionParams,
} from '../core/substrates/types.js';
import type { DiscoveredDocument } from '../core/document-discovery.types.js';

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

function document(sourcePath: string): DiscoveredDocument {
  return {
    sourcePath,
    absolutePath: `/project/docs/${sourcePath}`,
    format: 'markdown',
    identity: parseDocumentIdentity({ sourcePath }),
  };
}

const PACKAGED_RESULT = loadProjectSubstrateDefinitions([]);
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
