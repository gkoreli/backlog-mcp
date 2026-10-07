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
import type { SubstrateDefinition } from './substrates/base.js';

export { EntityType, ENTITY_TYPES } from './entity-type.js';

// ============================================================================
// Prefix map — derived from SUBSTRATES
// ============================================================================

export const TYPE_PREFIXES: Record<EntityType, string> = Object.fromEntries(
  (Object.keys(SUBSTRATES) as EntityType[]).map(type => [type, SUBSTRATES[type].prefix]),
) as Record<EntityType, string>;

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

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function identityParts(type: EntityType): { prefix: string; suffix: string; threaded: boolean; minimumDigits: number } {
  const substrate: SubstrateDefinition = SUBSTRATES[type];
  const identity = substrate.identity;
  const template = identity?.displayTemplate ?? `${substrate.prefix}-{key}`;
  const [prefix = '', suffix = ''] = template.split('{key}');
  return { prefix, suffix, threaded: identity?.strategy === 'numbered-threaded', minimumDigits: identity?.minimumDigits ?? 4 };
}

/** Validate canonical native identities, including ADR thread children (ADR 0113.2). */
export function isValidEntityId(id: unknown): id is string {
  return typeof id === 'string' && parseEntityId(id) !== null;
}

/** Recover a native type and its root sequence; dotted children retain that root. */
export function parseEntityId(id: string): { type: EntityType; num: number } | null {
  for (const type of Object.values(EntityType)) {
    const identity = identityParts(type);
    const keyPattern = `\\d{${identity.minimumDigits},}${identity.threaded ? '(?:\\.\\d+)*' : ''}`;
    const pattern = new RegExp(`^${escapePattern(identity.prefix)}(${keyPattern})${escapePattern(identity.suffix)}$`, 'u');
    const key = pattern.exec(id)?.[1];
    if (key === undefined) continue;
    const num = Number(key.split('.')[0]);
    return Number.isSafeInteger(num) ? { type, num } : null;
  }
  return null;
}

/** Parse just the numeric portion of an entity ID. */
export function parseEntityNum(id: string): number | null {
  return parseEntityId(id)?.num ?? null;
}

export function formatEntityId(num: number, type: EntityType = EntityType.Task): string {
  const identity = identityParts(type);
  return `${identity.prefix}${num.toString().padStart(identity.minimumDigits, '0')}${identity.suffix}`;
}

export function nextEntityId(maxId: number, type: EntityType = EntityType.Task): string {
  return formatEntityId(maxId + 1, type);
}

export function getTypeFromId(id: string): EntityType {
  return parseEntityId(id)?.type ?? EntityType.Task;
}
