import {
  EntitySchema,
  EntityType,
  type AnyEntity,
  type Entity,
} from '@backlog-mcp/shared';

/** Narrow an open runtime projection to one canonical compiled entity. */
export function asBuiltinEntity(candidate: AnyEntity): Entity | undefined {
  const result = EntitySchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}

/** Report whether an open type key belongs to the compiled built-in registry. */
export function isBuiltinSubstrateType(type: string): type is EntityType {
  return Object.values(EntityType).some(function matchesType(candidate) {
    return candidate === type;
  });
}
