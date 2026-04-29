/**
 * EntityType enum — the canonical string identifier for each substrate.
 *
 * Kept in its own module to prevent circular imports:
 *   entity-types.ts  →  substrates/registry.ts  →  EntityType
 * Every substrate module imports EntityType here; registry.ts imports
 * substrate modules; entity-types.ts derives TYPE_PREFIXES/ID_PATTERN from
 * the registry. Separating this enum from the other helpers breaks the cycle.
 */

export enum EntityType {
  Task = 'task',
  Epic = 'epic',
  Folder = 'folder',
  Artifact = 'artifact',
  Milestone = 'milestone',
  Cron = 'cron',
}

export const ENTITY_TYPES = Object.values(EntityType);
