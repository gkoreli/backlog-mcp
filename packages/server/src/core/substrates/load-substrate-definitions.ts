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
    packaged: packaged.substrates,
    project: project.substrates,
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
): LoadSubstrateDefinitionsResult {
  return loadSubstrateDefinitions({
    packagedDefinitions: PACKAGED_SUBSTRATE_DEFINITIONS,
    declarations,
  });
}
