/**
 * Substrate registry — the single source of truth for entity type metadata.
 *
 * Exports:
 *   - SUBSTRATES: keyed record of every substrate definition
 *   - EntitySchema: discriminated union of all per-type schemas
 *     (validation authority used by storage writes)
 *   - Entity: z.infer of EntitySchema — the discriminated TypeScript union
 *
 * Adding a new entity type:
 *   1. Create `./<newtype>.ts` exporting `<NewType>Substrate`
 *   2. Add a key to EntityType enum in ../entity-types.ts
 *   3. Register below in SUBSTRATES and the EntitySchema branches
 *
 * That's it — no switch statements to update elsewhere. TYPE_PREFIXES,
 * ID_PATTERN, ENTITY_TYPES, viewer metadata, MCP tool hints all derive
 * from SUBSTRATES.
 */
import { z } from 'zod';
import { EntityType } from '../entity-type.js';
import { TaskSubstrate } from './task.js';
import { EpicSubstrate } from './epic.js';
import { FolderSubstrate } from './folder.js';
import { ArtifactSubstrate } from './artifact.js';
import { MilestoneSubstrate } from './milestone.js';
import { CronSubstrate } from './cron.js';
import type { SubstrateDefinition } from './base.js';

export const SUBSTRATES = {
  [EntityType.Task]: TaskSubstrate,
  [EntityType.Epic]: EpicSubstrate,
  [EntityType.Folder]: FolderSubstrate,
  [EntityType.Artifact]: ArtifactSubstrate,
  [EntityType.Milestone]: MilestoneSubstrate,
  [EntityType.Cron]: CronSubstrate,
} as const satisfies Record<EntityType, SubstrateDefinition>;

/**
 * Discriminated union over `type` — Zod narrows the correct branch by the
 * literal `type` value and enforces that branch's shape (including .strict()
 * which rejects cross-type fields, e.g. `schedule` on a task).
 *
 * Used at storage write boundaries to validate whole-entity shape.
 */
export const EntitySchema = z.discriminatedUnion('type', [
  TaskSubstrate.schema,
  EpicSubstrate.schema,
  FolderSubstrate.schema,
  ArtifactSubstrate.schema,
  MilestoneSubstrate.schema,
  CronSubstrate.schema,
]);

/** The canonical Entity type — discriminated union across all substrates. */
export type Entity = z.infer<typeof EntitySchema>;

/** Per-type inferred aliases — consumers narrow via `.type` to use these. */
export type { Task } from './task.js';
export type { Epic } from './epic.js';
export type { Folder } from './folder.js';
export type { Artifact } from './artifact.js';
export type { Milestone } from './milestone.js';
export type { Cron } from './cron.js';

/** Look up a substrate by EntityType enum value. */
export function getSubstrate(type: EntityType): SubstrateDefinition {
  return SUBSTRATES[type];
}
