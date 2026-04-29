/**
 * Entity type helpers derived from the substrate system.
 *
 * The `EntityType` enum lives in `./entity-type.ts` to break a circular import
 * (substrate modules need EntityType; this module imports SUBSTRATES which
 * depends on all substrate modules).
 *
 * Everything else — TYPE_PREFIXES, ID_PATTERN, the Entity TypeScript type —
 * derives from `./substrates/registry.ts` so adding a new type only requires
 * writing one substrate module and registering it.
 */

import { EntityType } from './entity-type.js';
import { SUBSTRATES } from './substrates/registry.js';

export { EntityType, ENTITY_TYPES } from './entity-type.js';

// ============================================================================
// Prefix map — derived from SUBSTRATES
// ============================================================================

export const TYPE_PREFIXES: Record<EntityType, string> = Object.fromEntries(
  (Object.keys(SUBSTRATES) as EntityType[]).map(type => [type, SUBSTRATES[type].prefix]),
) as Record<EntityType, string>;

const PREFIX_TO_TYPE: Record<string, EntityType> = Object.fromEntries(
  Object.entries(TYPE_PREFIXES).map(([type, prefix]) => [prefix, type as EntityType]),
);

// ============================================================================
// Status + Reference — re-exported from the substrate base for convenience
// ============================================================================

export { STATUSES, type Status } from './substrates/base.js';
export type { Reference } from './substrates/base.js';

// ============================================================================
// Canonical Entity type — discriminated union derived from the substrate registry
// ============================================================================

export type { Entity } from './substrates/registry.js';

// ============================================================================
// ID utilities — pattern derived from TYPE_PREFIXES
// ============================================================================

function buildIdPattern(): RegExp {
  const alternation = Object.values(TYPE_PREFIXES).join('|');
  return new RegExp(`^(${alternation})-(\\d{4,})$`);
}

const ID_PATTERN = buildIdPattern();

export function isValidEntityId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function parseEntityId(id: string): { type: EntityType; num: number } | null {
  const match = ID_PATTERN.exec(id);
  if (!match?.[1] || !match[2]) return null;
  const type = PREFIX_TO_TYPE[match[1]];
  return type ? { type, num: parseInt(match[2], 10) } : null;
}

/** Parse just the numeric portion of an entity ID. */
export function parseEntityNum(id: string): number | null {
  return parseEntityId(id)?.num ?? null;
}

export function formatEntityId(num: number, type: EntityType = EntityType.Task): string {
  return `${TYPE_PREFIXES[type]}-${num.toString().padStart(4, '0')}`;
}

export function nextEntityId(maxId: number, type: EntityType = EntityType.Task): string {
  return formatEntityId(maxId + 1, type);
}

export function getTypeFromId(id: string): EntityType {
  for (const [type, prefix] of Object.entries(TYPE_PREFIXES)) {
    if (id.startsWith(prefix + '-')) return type as EntityType;
  }
  return EntityType.Task;
}
