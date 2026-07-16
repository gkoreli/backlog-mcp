import type {
  SubstrateStorageCatalog,
  SubstrateStorageClaim,
} from '../../storage/substrate-storage-catalog.contract.js';
import type {
  CompiledSubstrateDefinition,
  CreateProjectSubstrateRegistryParams,
  CreateProjectSubstrateRegistryResult,
  SubstrateDefinitionDiagnostic,
  SubstrateDefinitionIssue,
} from './types.js';

type CollisionField = 'folder' | 'identity.prefix';

interface Collision {
  field: CollisionField;
  sources: readonly CompiledSubstrateDefinition[];
}

/** Project-scoped runtime catalog composed from packaged and project definitions. */
export class ProjectSubstrateRegistry implements SubstrateStorageCatalog {
  readonly #substrates: ReadonlyMap<string, CompiledSubstrateDefinition>;

  constructor(substrates: readonly CompiledSubstrateDefinition[]) {
    this.#substrates = new Map(substrates.map(function createEntry(substrate) {
      return [substrate.definition.type, substrate];
    }));
  }

  getStorageClaim(type: string): Readonly<SubstrateStorageClaim> | undefined {
    return this.#substrates.get(type)?.storageClaim;
  }

  getSubstrate(type: string): CompiledSubstrateDefinition | undefined {
    return this.#substrates.get(type);
  }

  listSubstrates(): readonly CompiledSubstrateDefinition[] {
    return [...this.#substrates.values()].sort(function compareSources(left, right) {
      return left.sourcePath.localeCompare(right.sourcePath);
    });
  }
}

function compareSources(
  left: CompiledSubstrateDefinition,
  right: CompiledSubstrateDefinition,
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
  const path = collision.field === 'folder' ? '/folder' : '/identity/prefix';
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
  definitions: readonly CompiledSubstrateDefinition[],
): Collision[] {
  const collisions: Collision[] = [];
  const prefixes = new Map<string, CompiledSubstrateDefinition[]>();

  for (const definition of definitions) {
    const prefix = definition.storageClaim.identity.prefix;
    if (prefix) {
      const prefixGroup = prefixes.get(prefix) ?? [];
      prefixGroup.push(definition);
      prefixes.set(prefix, prefixGroup);
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
  return collisions.sort(function compareCollisions(left, right) {
    const fieldOrder = left.field.localeCompare(right.field);
    if (fieldOrder !== 0) return fieldOrder;
    return left.sources[0]?.sourcePath.localeCompare(right.sources[0]?.sourcePath ?? '') ?? 0;
  });
}

function composeDefinitions(
  packaged: readonly CompiledSubstrateDefinition[],
  candidates: readonly CompiledSubstrateDefinition[],
  rejectedSources: ReadonlySet<string>,
): CompiledSubstrateDefinition[] {
  const acceptedCandidates = candidates.filter(function isAccepted(candidate) {
    return !rejectedSources.has(candidate.sourcePath);
  });
  const replacedSources = new Set(acceptedCandidates.flatMap(function getReplaced(candidate) {
    return candidate.definition.replaces ? [candidate.definition.replaces] : [];
  }));
  return [
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
  const packaged = [...params.packaged].sort(compareSources);
  const project = [...params.project].sort(compareSources);
  const packagedByType = groupByType(packaged);
  const projectByType = groupByType(project);
  const rejectedSources = new Set<string>();
  const issuesBySource = new Map<string, SubstrateDefinitionIssue[]>();
  const candidates: CompiledSubstrateDefinition[] = [];

  for (const [type, packagedGroup] of packagedByType) {
    if (packagedGroup.length > 1) {
      throw new Error(`duplicate packaged substrate type: ${type}`);
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
    const composed = composeDefinitions(packaged, candidates, rejectedSources);
    for (const collision of findClaimCollisions(composed)) {
      const issue = createCollisionIssue(collision);
      const projectSources = collision.sources.filter(function isProjectSource(source) {
        return candidates.includes(source) && !rejectedSources.has(source.sourcePath);
      });
      if (projectSources.length === 0) {
        throw new Error(issue.message);
      }
      for (const source of projectSources) {
        reject(source, issue);
        addedRejection = true;
      }
    }
  }

  const active = composeDefinitions(packaged, candidates, rejectedSources);
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
