import {
  EntityType,
  SUBSTRATES,
  type AnyEntity,
} from '@backlog-mcp/shared';
import type { SubstrateStorageCatalog } from '../../storage/substrate-storage-catalog.contract.js';
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
    return {
      kind: 'compiled',
      sourcePath: `builtin:${type}@compiled`,
      type,
      intents: [],
      storageClaim,
      validateWrite: function validateWrite(candidate) {
        return validateBuiltin(type, candidate);
      },
    };
  });
}
