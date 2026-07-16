import type { DiscoveredSubstrateDeclaration } from '../document-discovery.types.js';
import { PACKAGED_SUBSTRATE_DEFINITIONS } from '../../substrate-definitions/packaged-substrate-definitions.js';
import { compileSubstrateDefinition } from './compile-substrate-definition.js';
import { createProjectSubstrateRegistry } from './project-substrate-registry.js';
import type {
  CompileSubstrateDefinitionParams,
  CompiledSubstrateDefinition,
  LoadSubstrateDefinitionsParams,
  LoadSubstrateDefinitionsResult,
  SubstrateDefinitionDiagnostic,
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
  return {
    registry: composed.registry,
    diagnostics: [
      ...packaged.diagnostics,
      ...project.diagnostics,
      ...composed.diagnostics,
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
  reservedWakeupSections: readonly string[] = RESERVED_WAKEUP_SECTIONS,
): LoadSubstrateDefinitionsResult {
  return loadSubstrateDefinitions({
    builtins,
    packagedDefinitions: PACKAGED_SUBSTRATE_DEFINITIONS,
    declarations,
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
