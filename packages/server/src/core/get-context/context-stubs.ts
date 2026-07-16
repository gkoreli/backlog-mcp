/**
 * Context-stub composer (ADR 0114 R-1) — the fold of the ADR 0074–0078
 * hydration pipeline into `backlog_get(context: true)`.
 *
 * Composes the three surviving stages (relational expansion, cross-reference
 * traversal, semantic enrichment) into role-grouped stubs around a focal
 * entity: parent, children, siblings, references (forward), referenced_by
 * (reverse), related (semantic) — plus ancestors/descendants at depth 2.
 *
 * Stubs, not bodies: hydration is another `backlog_get`, exactly the recall
 * pattern (ADR 0092.3). Count caps, not token packing — the 12-level token
 * budgeter was retired with the bundle tool. Time-oriented context stays
 * with `backlog_wakeup` (R-2); query-based discovery stays with
 * `backlog_search` (R-3).
 */

import type { Entity } from '@backlog-mcp/shared';
import type { ContextStub, ContextStubs } from './types.js';
import { toStub } from './entity-stub.js';
import { expandRelations, type RelationalExpansionDeps } from './relational-expansion.js';
import { traverseCrossReferences } from './cross-reference-traversal.js';
import { enrichSemantic, type SemanticEnrichmentDeps } from './semantic-enrichment.js';

/** Cap on children/siblings per group — stubs are cheap but not free. */
const MAX_GROUP_STUBS = 20;

export interface ComposeContextDeps {
  /** Look up an entity by ID (sync — local storage only). */
  getTask: RelationalExpansionDeps['getTask'];
  /** List entities with optional parent_id filter (sync — local storage only). */
  listTasks: RelationalExpansionDeps['listTasks'];
  /**
   * List all resources. Optional: the stub surface exposes entity roles only
   * (ADR 0114 R-1), so this feeds nothing user-visible today — pass it when
   * cheaply available, omit otherwise.
   */
  listResources?: RelationalExpansionDeps['listResources'];
  /** Unified search — powers the `related` group. Omit to skip semantic stubs. */
  searchUnified?: SemanticEnrichmentDeps['searchUnified'];
}

function capped(stubs: ContextStub[], cap: number = MAX_GROUP_STUBS): ContextStub[] {
  return stubs.length > cap ? stubs.slice(0, cap) : stubs;
}

/**
 * Compose the relational neighborhood of a focal entity as role-grouped stubs.
 *
 * @param focalTask - The focal entity (already resolved by the caller)
 * @param depth - 1 = direct relations (default); 2 = grandparent/grandchildren
 * @param deps - Injected storage/search dependencies
 */
export async function composeContextStubs(
  focalTask: Entity,
  depth: number,
  deps: ComposeContextDeps,
): Promise<ContextStubs> {
  const clampedDepth = Math.min(Math.max(depth, 1), 2);

  const expansion = expandRelations(focalTask, clampedDepth, {
    getTask: deps.getTask,
    listTasks: deps.listTasks,
    listResources: deps.listResources ?? (() => []),
  });

  // Visited set mirrors the stages' dedup contract: cross-refs and semantic
  // enrichment must not repeat entities already placed in a relational role.
  const visited = new Set<string>([focalTask.id]);
  if (expansion.parent) visited.add(expansion.parent.id);
  for (const c of expansion.children) visited.add(c.id);
  for (const s of expansion.siblings) visited.add(s.id);
  for (const a of expansion.ancestors) visited.add(a.id);
  for (const d of expansion.descendants) visited.add(d.id);

  const parentTask = expansion.parent ? deps.getTask(expansion.parent.id) ?? null : null;
  const crossRefs = traverseCrossReferences(focalTask, parentTask, visited, {
    getTask: deps.getTask,
    listTasks: deps.listTasks,
  });

  let related: ContextStub[] = [];
  if (deps.searchUnified) {
    const enrichment = await enrichSemantic(focalTask, visited, new Set(), {
      searchUnified: deps.searchUnified,
    });
    related = enrichment.related_entities.map(toStub);
  }

  const stubs: ContextStubs = {};
  if (expansion.parent) stubs.parent = toStub(expansion.parent);
  if (expansion.children.length > 0) stubs.children = capped(expansion.children.map(toStub));
  if (expansion.siblings.length > 0) stubs.siblings = capped(expansion.siblings.map(toStub));
  if (crossRefs.cross_referenced.length > 0) stubs.references = crossRefs.cross_referenced.map(toStub);
  if (crossRefs.referenced_by.length > 0) stubs.referenced_by = crossRefs.referenced_by.map(toStub);
  if (related.length > 0) stubs.related = related;
  if (expansion.ancestors.length > 0) stubs.ancestors = expansion.ancestors.map(toStub);
  if (expansion.descendants.length > 0) stubs.descendants = capped(expansion.descendants.map(toStub));
  return stubs;
}
