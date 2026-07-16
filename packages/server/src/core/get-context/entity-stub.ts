/**
 * Entity → stage-currency / stub conversions (ADR 0114).
 *
 * `taskToContextEntity` was re-homed from the deleted
 * `context/stages/focal-resolution.ts` (query-mode focal resolution was
 * dropped by ADR 0114 R-3; this converter is what the surviving stages
 * actually shared). `toStub` is the composer's final normalization: whatever
 * fidelity a stage produced, the surface exposes id + title + status + type.
 */

import type { Entity } from '@backlog-mcp/shared';
import { EntityType } from '@backlog-mcp/shared';
import type { ContextEntity, ContextStub, Fidelity } from './types.js';

/**
 * Convert an Entity to a ContextEntity at the given fidelity.
 */
export function taskToContextEntity(task: Entity, fidelity: Fidelity = 'full'): ContextEntity {
  const entity: ContextEntity = {
    id: task.id,
    title: task.title,
    status: task.status,
    type: (task.type ?? EntityType.Task) as EntityType,
    fidelity,
  };

  const parentId = task.parent_id ?? task.epic_id;
  if (parentId) entity.parent_id = parentId;

  if (fidelity === 'reference') return entity;

  // Summary and full: include timestamps and references
  entity.created_at = task.created_at;
  entity.updated_at = task.updated_at;
  if (task.references?.length) entity.references = task.references;

  if (fidelity === 'summary') return entity;

  // Full: include content, evidence, blocked_reason
  if (task.content) entity.content = task.content;
  if (task.evidence?.length) entity.evidence = task.evidence;
  if (task.blocked_reason?.length) entity.blocked_reason = task.blocked_reason;

  return entity;
}

/**
 * Normalize a stage-produced ContextEntity down to a surface stub.
 */
export function toStub(entity: ContextEntity): ContextStub {
  const stub: ContextStub = {
    id: entity.id,
    title: entity.title,
    type: entity.type,
  };
  if (entity.status !== undefined) stub.status = entity.status;
  if (entity.relevance_score !== undefined) stub.relevance_score = entity.relevance_score;
  if (entity.graph_depth !== undefined) stub.graph_depth = entity.graph_depth;
  return stub;
}
