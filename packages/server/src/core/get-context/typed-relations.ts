/**
 * Typed-relation traversal (ADR 0113.1 R-3; registry-driven since 0113 C.2)
 * — compliance and lineage as first-class relations in `get(context: true)`.
 *
 * ADR 0114's cross-reference stage discovers links by scraping entity ids
 * out of `references[]` URLs. Document substrates (ADR 0113) declare
 * relations as typed frontmatter fields (0113 R6: field name = the relation
 * type, value = canonical ids). This module traverses those, with the edge
 * set supplied by the substrate registry's compiled disclosure relations
 * (`listDisclosureRelations()` — deterministic order) instead of the
 * retired interim table.
 *
 * Reverse relations are computed on read, never persisted (store-doesn't-
 * act; beryl, 0113.1 design review): a REQ discovers who respects/violates
 * it by scanning the declaring documents at query time. Relations declared
 * without an `inverse` are forward-only by declaration.
 */

import type { AnyEntity, CompiledDisclosureRelation, RuntimeEntity } from '@backlog-mcp/shared';
import { requirementCompliance } from '../requirements/index.js';
import type { ContextStub } from './types.js';

/** Same cap spirit as the cross-reference groups (ADR 0114): bounded lists. */
const MAX_RELATION_STUBS = 10;

export interface TypedRelationDeps {
  /** Look up any entity (builtin or runtime) by id. */
  getEntity: (id: string) => AnyEntity | undefined;
  /** List entities of one substrate type (no query — plain storage list). */
  listByType: (type: string) => AnyEntity[];
  /** Registry-compiled relation edges (deterministic order). Absent → no typed relations. */
  listRelationEdges?: () => readonly CompiledDisclosureRelation[];
}

function idArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Minimal relation stub. Requirement targets carry `compliance` so a
 * violated constraint reads red in the relation list without hydration.
 */
function toRelationStub(entity: AnyEntity): ContextStub {
  const stub: ContextStub = {
    id: entity.id,
    title: entity.title,
    type: typeof entity.type === 'string' ? entity.type : 'task',
  };
  if (typeof entity.status === 'string') stub.status = entity.status;
  if (entity.type === 'requirement') {
    // Through the constraint mint (0113.1 R-1) — one requirement read
    // boundary, one defaulting/normalization policy.
    stub.compliance = requirementCompliance(entity as RuntimeEntity);
  }
  return stub;
}

function push(groups: Map<string, ContextStub[]>, role: string, stub: ContextStub): void {
  const list = groups.get(role) ?? [];
  if (list.length >= MAX_RELATION_STUBS) return;
  if (list.some(s => s.id === stub.id)) return;
  list.push(stub);
  groups.set(role, list);
}

/**
 * Traverse declared relations around a focal entity, both directions.
 *
 * Forward: fields the focal itself declares (only when its type has edges).
 * Reverse: every declaring substrate is scanned for fields naming the focal
 * — this is how a TASK learns it was `spawned_by` a requirement, or a REQ
 * learns which ADRs respect it, without those documents linking back.
 */
export function traverseTypedRelations(
  focal: AnyEntity,
  deps: TypedRelationDeps,
): Record<string, ContextStub[]> {
  const groups = new Map<string, ContextStub[]>();
  const edges = deps.listRelationEdges?.() ?? [];
  if (edges.length === 0) return {};

  // Forward — the focal's own declared relation fields.
  const focalRecord = focal as Record<string, unknown>;
  for (const edge of edges) {
    if (edge.sourceType !== focal.type) continue;
    for (const id of idArray(focalRecord[edge.field])) {
      if (id === focal.id) continue;
      const target = deps.getEntity(id);
      if (!target) continue;
      push(groups, edge.field, toRelationStub(target));
    }
  }

  // Reverse — who declares a relation to the focal? Computed on read.
  // Same-substrate scans included: a REQ superseded by another REQ must
  // surface superseded_by (the per-declarer self skip below is sufficient).
  // Only edges WITH a declared inverse participate — no inverse, no reverse.
  const reverseEdges = edges.filter(edge => edge.inverse !== undefined);
  for (const declaringType of new Set(reverseEdges.map(e => e.sourceType))) {
    const declarers = deps.listByType(declaringType);
    for (const declarer of declarers) {
      if (declarer.id === focal.id) continue;
      const record = declarer as Record<string, unknown>;
      for (const edge of reverseEdges) {
        if (edge.sourceType !== declaringType) continue;
        if (edge.inverse === undefined) continue;
        if (!idArray(record[edge.field]).includes(focal.id)) continue;
        push(groups, edge.inverse, toRelationStub(declarer));
      }
    }
  }

  return Object.fromEntries(groups);
}
