import {
  EntityType,
  RuntimeSubstrateDefinitionSchema,
  SUBSTRATES,
  type AnyEntity,
  type CompiledSubstrateIntent,
  type SubstrateDefinition,
} from '@backlog-mcp/shared';
import { z } from 'zod';
import {
  BUILTIN_SUBSTRATE_INTENT_DEFINITIONS,
} from '../../substrate-definitions/builtin-substrate-intent-definitions.js';
import type { SubstrateStorageCatalog } from './substrate-storage-catalog.contract.js';
import { compileSubstrateIntents } from './compile-substrate-intents.js';
import { compileSubstrateDisclosure } from './compile-substrate-disclosure.js';
import type {
  CompiledBuiltinSubstrate,
  SubstrateDefinitionIssue,
  SubstrateWriteValidationResult,
} from './types.js';

function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '/';
  return `/${path.map(function escapeSegment(segment) {
    return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
  }).join('/')}`;
}

function validateBuiltin(
  type: EntityType,
  candidate: unknown,
): SubstrateWriteValidationResult {
  const result = SUBSTRATES[type].schema.safeParse(candidate);
  if (result.success) {
    return {
      ok: true,
      entity: result.data as AnyEntity,
    };
  }

  const issues: SubstrateDefinitionIssue[] = result.error.issues.map(
    function normalizeIssue(issue) {
      return {
        code: 'shape',
        path: issuePath(issue.path),
        message: issue.message,
      };
    },
  );
  return { ok: false, issues };
}

function compileBuiltinIntents(
  type: EntityType,
  storageClaim: CompiledBuiltinSubstrate['storageClaim'],
): { intents: readonly CompiledSubstrateIntent[]; disclosure: ReturnType<typeof compileSubstrateDisclosure> } {
  const declaration = BUILTIN_SUBSTRATE_INTENT_DEFINITIONS[type];
  if (!declaration) return { intents: [], disclosure: { disclosure: {}, relations: [], issues: [] } };

  const sourcePath = `builtin:${type}@compiled`;
  const definition = RuntimeSubstrateDefinitionSchema.parse({
    definitionVersion: 1,
    type,
    label: {
      singular: SUBSTRATES[type].label,
      plural: `${SUBSTRATES[type].label}s`,
    },
    folder: storageClaim.folder,
    identity: storageClaim.identity,
    schema: z.toJSONSchema(SUBSTRATES[type].schema),
    workflow: declaration.workflow,
    intents: declaration.intents,
    relations: declaration.relations,
    disclosure: declaration.disclosure,
  });
  const result = compileSubstrateIntents(sourcePath, definition);
  const disclosure = compileSubstrateDisclosure(definition);
  if (result.issues.length > 0 || disclosure.issues.length > 0) {
    throw new Error(
      `Invalid built-in intent declaration for ${type}: ${JSON.stringify([...result.issues, ...disclosure.issues])}`,
    );
  }
  return { intents: result.intents, disclosure };
}

/**
 * Wrap the compiled Zod substrates behind the runtime registry contract.
 *
 * Storage identity remains injected so core never depends on the concrete
 * local catalog implementation.
 */
export function createBuiltinSubstrateRegistrations(
  catalog: SubstrateStorageCatalog,
): readonly CompiledBuiltinSubstrate[] {
  return Object.values(EntityType).map(function createRegistration(type) {
    const storageClaim = catalog.getStorageClaim(type);
    if (!storageClaim) {
      throw new Error(`Missing built-in storage claim for ${type}`);
    }
    const substrate: SubstrateDefinition = SUBSTRATES[type];
    const compiled = compileBuiltinIntents(type, storageClaim);
    const workflow = BUILTIN_SUBSTRATE_INTENT_DEFINITIONS[type]?.workflow;
    return {
      kind: 'compiled',
      sourcePath: `builtin:${type}@compiled`,
      type,
      ...(substrate.intake === undefined
        ? {}
        : { intake: substrate.intake }),
      acceptsParent: substrate.structure.validParents.length > 0,
      ...(workflow === undefined ? {} : { workflow }),
      disclosure: compiled.disclosure.disclosure,
      disclosureRelations: compiled.disclosure.relations,
      intents: compiled.intents,
      storageClaim,
      validateWrite: function validateWrite(candidate) {
        return validateBuiltin(type, candidate);
      },
    };
  });
}
