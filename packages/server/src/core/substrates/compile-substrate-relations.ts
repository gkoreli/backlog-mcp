/** Retain every declared relation independently of disclosure (ADR 0113.4, 0136 R4). */
import type { CompiledSubstrateRelationEdge, RuntimeSubstrateDefinition } from '@backlog-mcp/shared';

/** Compile relation metadata once for integrity and selective-read consumers. */
export function compileSubstrateRelations(definition: RuntimeSubstrateDefinition): readonly CompiledSubstrateRelationEdge[] {
  return Object.entries(definition.relations ?? {}).map(function compileRelation([field, relation]) {
    return { sourceType: definition.type, field, targets: relation.targets, cardinality: relation.cardinality,
      ...(relation.inverse === undefined ? {} : { inverse: relation.inverse }) };
  });
}
