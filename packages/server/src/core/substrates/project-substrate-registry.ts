import type {
  CompiledSubstrateIntent,
} from '@backlog-mcp/shared';
import type {
  SubstrateStorageCatalog,
  SubstrateStorageClaim,
} from '../../storage/substrate-storage-catalog.contract.js';
import type {
  CompiledBuiltinSubstrate,
  CompiledSubstrateDefinition,
  CreateProjectSubstrateRegistryParams,
  CreateProjectSubstrateRegistryResult,
  RegisteredSubstrate,
  SubstrateDefinitionDiagnostic,
  SubstrateDefinitionIssue,
  SubstrateWriteValidationResult,
} from './types.js';

type CollisionField = 'folder' | 'identity.prefix' | 'intents.toolName';

interface Collision {
  field: CollisionField;
  sources: readonly RegisteredSubstrate[];
}

function substrateType(substrate: RegisteredSubstrate): string {
  return substrate.kind === 'compiled'
    ? substrate.type
    : substrate.definition.type;
}

/** Project-scoped write router and storage catalog for every active substrate. */
export class ProjectSubstrateRegistry implements SubstrateStorageCatalog {
  readonly #substrates: ReadonlyMap<string, RegisteredSubstrate>;

  constructor(substrates: readonly RegisteredSubstrate[]) {
    this.#substrates = new Map(substrates.map(function createEntry(substrate) {
      return [substrateType(substrate), substrate];
    }));
  }

  getStorageClaim(type: string): Readonly<SubstrateStorageClaim> | undefined {
    return this.#substrates.get(type)?.storageClaim;
  }

  getSubstrate(type: string): RegisteredSubstrate | undefined {
    return this.#substrates.get(type);
  }

  listSubstrates(): readonly RegisteredSubstrate[] {
    return [...this.#substrates.values()].sort(function compareSources(left, right) {
      return left.sourcePath.localeCompare(right.sourcePath);
    });
  }

  listIntents(): readonly CompiledSubstrateIntent[] {
    return [...this.#substrates.values()]
      .flatMap(function substrateIntents(substrate) {
        return [...substrate.intents];
      })
      .sort(function compareIntents(left, right) {
        const nameOrder = left.toolName.localeCompare(right.toolName);
        return nameOrder !== 0
          ? nameOrder
          : left.sourcePath.localeCompare(right.sourcePath);
      });
  }

  /** Validate one canonical managed write through its registered implementation. */
  validateWrite(candidate: unknown): SubstrateWriteValidationResult {
    const type = typeof candidate === 'object'
      && candidate !== null
      && 'type' in candidate
      && typeof candidate.type === 'string'
      ? candidate.type
      : undefined;
    if (!type) {
      return {
        ok: false,
        issues: [{
          code: 'shape',
          path: '/type',
          message: 'candidate must declare a substrate type',
        }],
      };
    }

    const substrate = this.#substrates.get(type);
    if (!substrate) {
      return {
        ok: false,
        issues: [{
          code: 'shape',
          path: '/type',
          message: `unknown substrate type: ${type}`,
        }],
      };
    }
    return substrate.validateWrite(candidate);
  }
}

function compareSources(
  left: RegisteredSubstrate,
  right: RegisteredSubstrate,
): number {
  return left.sourcePath.localeCompare(right.sourcePath);
}

function createDiagnostic(
  substrate: CompiledSubstrateDefinition,
  issues: readonly SubstrateDefinitionIssue[],
): SubstrateDefinitionDiagnostic {
  return {
    code: 'invalid-substrate-definition',
    sourcePath: substrate.sourcePath,
    type: substrate.definition.type,
    issues,
  };
}

function createCollisionIssue(collision: Collision): SubstrateDefinitionIssue {
  const sourcePaths = collision.sources.map(function getSourcePath(source) {
    return source.sourcePath;
  }).sort();
  const path = collision.field === 'folder'
    ? '/folder'
    : collision.field === 'identity.prefix'
      ? '/identity/prefix'
      : '/intents';
  return {
    code: 'shape',
    path,
    message: `${collision.field} claim collides across ${sourcePaths.join(', ')}`,
  };
}

function groupByType(
  definitions: readonly CompiledSubstrateDefinition[],
): Map<string, CompiledSubstrateDefinition[]> {
  const groups = new Map<string, CompiledSubstrateDefinition[]>();
  for (const definition of definitions) {
    const group = groups.get(definition.definition.type) ?? [];
    group.push(definition);
    groups.set(definition.definition.type, group);
  }
  for (const group of groups.values()) group.sort(compareSources);
  return groups;
}

function findClaimCollisions(
  definitions: readonly RegisteredSubstrate[],
): Collision[] {
  const collisions: Collision[] = [];
  const prefixes = new Map<string, RegisteredSubstrate[]>();
  const intentTools = new Map<string, RegisteredSubstrate[]>();

  for (const definition of definitions) {
    const prefix = definition.storageClaim.identity.prefix;
    if (prefix) {
      const prefixGroup = prefixes.get(prefix) ?? [];
      prefixGroup.push(definition);
      prefixes.set(prefix, prefixGroup);
    }
    for (const intent of definition.intents) {
      const toolGroup = intentTools.get(intent.toolName) ?? [];
      toolGroup.push(definition);
      intentTools.set(intent.toolName, toolGroup);
    }
  }

  for (let leftIndex = 0; leftIndex < definitions.length; leftIndex += 1) {
    const left = definitions[leftIndex];
    if (!left) continue;
    const leftFolder = left.storageClaim.folder.toLowerCase();
    for (let rightIndex = leftIndex + 1; rightIndex < definitions.length; rightIndex += 1) {
      const right = definitions[rightIndex];
      if (!right) continue;
      const rightFolder = right.storageClaim.folder.toLowerCase();
      if (
        leftFolder === rightFolder
        || leftFolder.startsWith(`${rightFolder}/`)
        || rightFolder.startsWith(`${leftFolder}/`)
      ) {
        collisions.push({
          field: 'folder',
          sources: [left, right].sort(compareSources),
        });
      }
    }
  }
  for (const sources of prefixes.values()) {
    if (sources.length > 1) {
      collisions.push({ field: 'identity.prefix', sources: sources.sort(compareSources) });
    }
  }
  for (const sources of intentTools.values()) {
    if (sources.length > 1) {
      collisions.push({
        field: 'intents.toolName',
        sources: sources.sort(compareSources),
      });
    }
  }
  return collisions.sort(function compareCollisions(left, right) {
    const fieldOrder = left.field.localeCompare(right.field);
    if (fieldOrder !== 0) return fieldOrder;
    return left.sources[0]?.sourcePath.localeCompare(right.sources[0]?.sourcePath ?? '') ?? 0;
  });
}

function composeDefinitions(
  builtins: readonly CompiledBuiltinSubstrate[],
  packaged: readonly CompiledSubstrateDefinition[],
  candidates: readonly CompiledSubstrateDefinition[],
  rejectedSources: ReadonlySet<string>,
): RegisteredSubstrate[] {
  const acceptedCandidates = candidates.filter(function isAccepted(candidate) {
    return !rejectedSources.has(candidate.sourcePath);
  });
  const replacedSources = new Set(acceptedCandidates.flatMap(function getReplaced(candidate) {
    return candidate.definition.replaces ? [candidate.definition.replaces] : [];
  }));
  return [
    ...builtins,
    ...packaged.filter(function isNotReplaced(definition) {
      return !replacedSources.has(definition.sourcePath);
    }),
    ...acceptedCandidates,
  ].sort(compareSources);
}

/**
 * Compose compiled definitions without load-order winners.
 *
 * Invalid project definitions are quarantined while packaged definitions remain
 * active, matching ADR 0113's graceful-degradation rule.
 */
export function createProjectSubstrateRegistry(
  params: CreateProjectSubstrateRegistryParams,
): CreateProjectSubstrateRegistryResult {
  const builtins = [...(params.builtins ?? [])].sort(compareSources);
  const packaged = [...params.packaged].sort(compareSources);
  const project = [...params.project].sort(compareSources);
  const builtinsByType = new Map<string, CompiledBuiltinSubstrate>();
  const packagedByType = groupByType(packaged);
  const projectByType = groupByType(project);
  const rejectedSources = new Set<string>();
  const issuesBySource = new Map<string, SubstrateDefinitionIssue[]>();
  const candidates: CompiledSubstrateDefinition[] = [];
  const reservedToolNames = new Set(params.reservedToolNames ?? []);

  for (const builtin of builtins) {
    const type = substrateType(builtin);
    if (builtinsByType.has(type)) {
      throw new Error(`duplicate compiled substrate type: ${type}`);
    }
    builtinsByType.set(type, builtin);
  }

  for (const [type, packagedGroup] of packagedByType) {
    if (packagedGroup.length > 1) {
      throw new Error(`duplicate packaged substrate type: ${type}`);
    }
    if (builtinsByType.has(type)) {
      throw new Error(`packaged substrate type collides with compiled type: ${type}`);
    }
  }

  function reject(
    definition: CompiledSubstrateDefinition,
    issue: SubstrateDefinitionIssue,
  ): void {
    rejectedSources.add(definition.sourcePath);
    const issues = issuesBySource.get(definition.sourcePath) ?? [];
    issues.push(issue);
    issuesBySource.set(definition.sourcePath, issues);
  }

  for (const [type, group] of projectByType) {
    if (group.length > 1) {
      const sourcePaths = group.map(function getSourcePath(source) {
        return source.sourcePath;
      }).sort();
      for (const definition of group) {
        reject(definition, {
          code: 'shape',
          path: '/type',
          message: `type ${type} is declared by ${sourcePaths.join(', ')}`,
        });
      }
      continue;
    }

    const definition = group[0];
    if (!definition) continue;
    if (builtinsByType.has(type)) {
      reject(definition, {
        code: 'shape',
        path: '/type',
        message: `compiled substrate type ${type} cannot be replaced by project data`,
      });
      continue;
    }
    const packagedDefinition = packagedByType.get(type)?.[0];
    if (packagedDefinition) {
      if (definition.definition.replaces !== packagedDefinition.sourcePath) {
        reject(definition, {
          code: 'shape',
          path: '/replaces',
          message: `type ${type} must explicitly replace ${packagedDefinition.sourcePath}`,
        });
        continue;
      }
    } else if (definition.definition.replaces !== undefined) {
      reject(definition, {
        code: 'shape',
        path: '/replaces',
        message: `replacement target ${definition.definition.replaces} is not active`,
      });
      continue;
    }
    candidates.push(definition);
  }

  let addedRejection = true;
  while (addedRejection) {
    addedRejection = false;
    const composed = composeDefinitions(
      builtins,
      packaged,
      candidates,
      rejectedSources,
    );
    for (const source of composed) {
      const reservedIntent = source.intents.find(function isReserved(intent) {
        return reservedToolNames.has(intent.toolName);
      });
      if (!reservedIntent) continue;
      const collisionIssue: SubstrateDefinitionIssue = {
        code: 'shape',
        path: '/intents',
        message: `intent tool name ${reservedIntent.toolName} is reserved by the consumer`,
      };
      if (
        source.kind === 'declarative'
        && candidates.includes(source)
        && !rejectedSources.has(source.sourcePath)
      ) {
        reject(source, collisionIssue);
        addedRejection = true;
        continue;
      }
      throw new Error(collisionIssue.message);
    }
    if (addedRejection) continue;
    for (const collision of findClaimCollisions(composed)) {
      const issue = createCollisionIssue(collision);
      const projectSources = collision.sources.filter(
        function isProjectSource(
          source,
        ): source is CompiledSubstrateDefinition {
          return source.kind === 'declarative'
            && candidates.includes(source)
            && !rejectedSources.has(source.sourcePath);
        },
      );
      if (projectSources.length === 0) {
        throw new Error(issue.message);
      }
      for (const source of projectSources) {
        reject(source, issue);
        addedRejection = true;
      }
    }
  }

  const active = composeDefinitions(
    builtins,
    packaged,
    candidates,
    rejectedSources,
  );
  const diagnostics = project
    .filter(function wasRejected(definition) {
      return rejectedSources.has(definition.sourcePath);
    })
    .map(function createRejectionDiagnostic(definition) {
      return createDiagnostic(definition, issuesBySource.get(definition.sourcePath) ?? []);
    });

  return {
    registry: new ProjectSubstrateRegistry(active),
    diagnostics,
  };
}
