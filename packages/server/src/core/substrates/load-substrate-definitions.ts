import type {
  DiscoveredSubstrateDeclaration,
  DiscoveredSubstrateHistoryFile,
} from '../document-discovery.types.js';
import { PACKAGED_SUBSTRATE_DEFINITIONS } from '../../substrate-definitions/packaged-substrate-definitions.js';
import { compileSubstrateDefinition } from './compile-substrate-definition.js';
import { createProjectSubstrateRegistry } from './project-substrate-registry.js';
import type {
  CompileSubstrateDefinitionParams,
  CompiledSubstrateDefinition,
  LoadSubstrateDefinitionsParams,
  LoadSubstrateDefinitionsResult,
  SubstrateDefinitionDiagnostic,
  SubstrateDefinitionIssue,
} from './types.js';

function declarationToCompileParams(
  declaration: DiscoveredSubstrateDeclaration,
): CompileSubstrateDefinitionParams {
  return {
    sourcePath: declaration.sourcePath,
    value: declaration.value,
    ...(declaration.content === undefined ? {} : { content: declaration.content }),
  };
}

function compileDefinitions(
  definitions: readonly CompileSubstrateDefinitionParams[],
): {
  substrates: CompiledSubstrateDefinition[];
  diagnostics: SubstrateDefinitionDiagnostic[];
} {
  const substrates: CompiledSubstrateDefinition[] = [];
  const diagnostics: SubstrateDefinitionDiagnostic[] = [];
  for (const definition of definitions) {
    const result = compileSubstrateDefinition(definition);
    if (result.ok) substrates.push(result.substrate);
    else diagnostics.push(result.diagnostic);
  }
  return { substrates, diagnostics };
}

/**
 * Freeze-on-bump verification (ADR 0122 R2): a declaration at
 * `definitionVersion: N > 1` must have every outgoing definition frozen at
 * `substrates/history/<type>@<version>.json` for versions `1..N-1`. A missing
 * link is a loud registry diagnostic — never a load failure: the substrate
 * still loads and functions while its lineage is incomplete.
 */
function collectVersionHistoryDiagnostics(
  substrates: readonly CompiledSubstrateDefinition[],
  substrateHistory: readonly DiscoveredSubstrateHistoryFile[],
): SubstrateDefinitionDiagnostic[] {
  const frozenPaths = new Set(substrateHistory.map(function getSourcePath(history) {
    return history.sourcePath;
  }));
  const diagnostics: SubstrateDefinitionDiagnostic[] = [];
  for (const substrate of substrates) {
    const version = substrate.definition.definitionVersion;
    const issues: SubstrateDefinitionIssue[] = [];
    for (let priorVersion = 1; priorVersion < version; priorVersion += 1) {
      const historyPath =
        `substrates/history/${substrate.definition.type}@${priorVersion}.json`;
      if (frozenPaths.has(historyPath)) continue;
      issues.push({
        code: 'history',
        path: '/definitionVersion',
        message: `definitionVersion ${version} requires frozen history ${historyPath}; the substrate stays active, but its version lineage is unaddressable until the missing definition is frozen (ADR 0122 R2)`,
      });
    }
    if (issues.length > 0) {
      diagnostics.push({
        code: 'missing-version-history',
        sourcePath: substrate.sourcePath,
        type: substrate.definition.type,
        issues,
      });
    }
  }
  return diagnostics;
}

/** Compile discovered declarations without rereading files or aborting sibling definitions. */
export function loadSubstrateDefinitions(
  params: LoadSubstrateDefinitionsParams,
): LoadSubstrateDefinitionsResult {
  const packaged = compileDefinitions(params.packagedDefinitions);
  const project = compileDefinitions(params.declarations.map(declarationToCompileParams));
  const composed = createProjectSubstrateRegistry({
    builtins: params.builtins,
    packaged: packaged.substrates,
    project: project.substrates,
    reservedToolNames: params.reservedToolNames,
    reservedWakeupSections: params.reservedWakeupSections,
  });
  const historyDiagnostics = collectVersionHistoryDiagnostics(
    [...packaged.substrates, ...project.substrates],
    params.substrateHistory ?? [],
  );
  return {
    registry: composed.registry,
    diagnostics: [
      ...packaged.diagnostics,
      ...project.diagnostics,
      ...composed.diagnostics,
      ...historyDiagnostics,
    ].sort(function compareDiagnostics(left, right) {
      return left.sourcePath.localeCompare(right.sourcePath);
    }),
  };
}

/** Load the pre-installed ADR/Requirement/Prompt definitions plus project declarations. */
export function loadProjectSubstrateDefinitions(
  declarations: readonly DiscoveredSubstrateDeclaration[],
  builtins: LoadSubstrateDefinitionsParams['builtins'] = [],
  reservedToolNames: readonly string[] = [],
  substrateHistory: readonly DiscoveredSubstrateHistoryFile[] = [],
  reservedWakeupSections: readonly string[] = RESERVED_WAKEUP_SECTIONS,
): LoadSubstrateDefinitionsResult {
  return loadSubstrateDefinitions({
    builtins,
    packagedDefinitions: PACKAGED_SUBSTRATE_DEFINITIONS,
    declarations,
    substrateHistory,
    reservedToolNames,
    reservedWakeupSections,
  });
}

/**
 * Section names the wakeup briefing composes itself (ADR 0113.1 guardrail,
 * ADR 0113 C.2): substrates may not claim them. `constraints` is NOT here —
 * it is registry-declared by the packaged Requirement definition and owned
 * by the constraint fold.
 */
export const RESERVED_WAKEUP_SECTIONS: readonly string[] = [
  'identity', 'scope', 'now', 'knowledge', 'recent', 'metadata', 'vision',
];
