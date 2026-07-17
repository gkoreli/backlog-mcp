/**
 * Remember — the explicit memory write verb (ADR 0092.3 Phase C).
 *
 * Implicit capture (ADR 0092.2) feeds the episodic layer automatically;
 * `remember` is how distilled knowledge enters: semantic facts, procedures,
 * preferences. ADD-only per ADR 0092.5 R-1 — corrections happen through
 * `supersedes` (predecessor soft-expired, lineage recorded) or `state_key`
 * (R-2: previous holders of the same evolving-fact key are closed), never
 * by rewriting bodies.
 *
 * Boundary validation per R-7 (MemPalace's battle scars): strict ISO dates
 * with explicit errors — agents WILL pass "March 2026" — and inverted
 * validity intervals are rejected at write time because they make facts
 * silently invisible.
 */

import { isValidEntityId, parseEntityId, EntityType } from '@backlog-mcp/shared';
import type { MemoryComposer, MemoryEntry } from '@backlog-mcp/memory';
import {
  ValidationError,
  type CollisionCandidate,
  type RememberParams,
  type RememberResult,
} from './types.js';

export interface RememberDeps {
  memoryComposer?: MemoryComposer;
  /** Actor name recorded as source when params.source is absent. */
  actorName?: string;
  /**
   * Optional post-commit advisory scan. Core does not construct search
   * dependencies: callers compose this from their selected home runtime.
   */
  findCollisionCandidates?: (memoryId: string) => Promise<CollisionCandidate[]>;
}

/** Strict-ish ISO check: must start YYYY-MM-DD and parse. R-7. */
function assertIsoDate(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(parsed)) {
    throw new ValidationError(
      `${field} must be an ISO date or datetime (e.g. "2026-06-10" or "2026-06-10T12:00:00Z"); got ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

export async function remember(params: RememberParams, deps: RememberDeps): Promise<RememberResult> {
  const content = (params.content ?? '').trim();
  if (!content) throw new ValidationError('content is required');

  const title = (params.title ?? '').trim();
  if (!title) throw new ValidationError('title is required');

  if (!deps.memoryComposer) {
    throw new ValidationError('No memory store is configured — cannot remember');
  }

  if (params.context !== undefined && !isValidEntityId(params.context)) {
    throw new ValidationError(`context must be a valid entity id (e.g. "FLDR-0001"); got ${JSON.stringify(params.context)}`);
  }
  for (const ref of params.entity_refs ?? []) {
    if (!isValidEntityId(ref)) {
      throw new ValidationError(`entity_refs must contain valid entity ids; got ${JSON.stringify(ref)}`);
    }
  }
  if (params.supersedes !== undefined) {
    const parsed = isValidEntityId(params.supersedes) ? parseEntityId(params.supersedes) : null;
    if (!parsed || parsed.type !== EntityType.Memory) {
      throw new ValidationError(`supersedes must be a MEMO- id; got ${JSON.stringify(params.supersedes)}`);
    }
  }
  // Provenance invariant (ADR 0092.5 R-8 / 0092.7 D1): inference must cite
  // its evidence. A derived memory without sources is unauditable.
  if (params.derived === true && (params.entity_refs?.length ?? 0) === 0) {
    throw new ValidationError('derived memories must cite their sources: entity_refs is required when derived is true');
  }

  let occurredAtMs: number | undefined;
  if (params.occurred_at !== undefined) occurredAtMs = assertIsoDate(params.occurred_at, 'occurred_at');
  let validUntilMs: number | undefined;
  if (params.valid_until !== undefined) validUntilMs = assertIsoDate(params.valid_until, 'valid_until');
  // R-7: reject inverted intervals — they create silently invisible facts.
  if (occurredAtMs !== undefined && validUntilMs !== undefined && validUntilMs <= occurredAtMs) {
    throw new ValidationError(
      `valid_until (${params.valid_until}) must be after occurred_at (${params.occurred_at})`,
    );
  }

  const now = Date.now();
  const layer = params.layer ?? 'semantic';

  const entry: MemoryEntry = {
    id: `mem-remember-${now}`,  // transient — the store mints the canonical MEMO- id
    layer,
    content,
    title,
    source: params.source ?? deps.actorName ?? 'unknown',
    ...(params.context ? { context: params.context } : {}),
    ...(params.tags && params.tags.length > 0 ? { tags: params.tags } : {}),
    createdAt: now,
    ...(validUntilMs !== undefined ? { expiresAt: validUntilMs } : {}),
    metadata: {
      kind_origin: 'remember',
      ...(params.entity_refs && params.entity_refs.length > 0 ? { entity_refs: params.entity_refs } : {}),
      ...(params.kind ? { memory_kind: params.kind } : {}),
      ...(params.state_key ? { state_key: params.state_key } : {}),
      ...(params.occurred_at ? { occurred_at: params.occurred_at } : {}),
      ...(params.supersedes ? { supersedes: params.supersedes } : {}),
      ...(params.derived === true ? { derived: true } : {}),
    },
  };

  const stored = await deps.memoryComposer.store(entry);

  // The memory is durable before this best-effort read. A failed or absent
  // scanner deliberately leaves the receipt unannotated rather than making a
  // false scanned-clean claim or affecting the write outcome.
  let collisionCandidates: CollisionCandidate[] | undefined;
  if (deps.findCollisionCandidates !== undefined) {
    try {
      collisionCandidates = await deps.findCollisionCandidates(stored.id);
    } catch {
      // Advisory scan failures must never fail or roll back a remembered fact.
    }
  }

  return {
    id: stored.id,
    layer: stored.layer,
    created_at: new Date(stored.createdAt).toISOString(),
    ...(params.supersedes ? { supersedes: params.supersedes } : {}),
    ...(params.state_key ? { state_key: params.state_key } : {}),
    ...(collisionCandidates === undefined ? {} : { collision_candidates: collisionCandidates }),
  };
}
