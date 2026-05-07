/**
 * Capture — write episodic memory entries for significant backlog events.
 *
 * See ADR 0092.2. Called from core/update.ts and core/create.ts after the
 * backlog mutation succeeds, before the operation-log entry is recorded.
 *
 * Design:
 *  - Pure builders + one async writer per event type. No shared state.
 *  - The memory is a **pointer + digest**: `metadata.entity_id` is the
 *    canonical reference back to the backlog; `content` is a short
 *    human-scannable summary. Callers who want the full story follow
 *    the pointer to the live entity.
 *  - Errors are caught and logged; they don't propagate into the caller.
 *    The user's mutation already succeeded — capturing failure is a
 *    derived side effect, not a first-class outcome.
 */

import type { Entity } from '@backlog-mcp/shared';
import type { MemoryComposer, MemoryEntry } from '@backlog-mcp/memory';
import type { Actor } from '../operations/types.js';

const DIGEST_MAX = 200;
const ARTIFACT_DESC_MAX = 160;

/** Build a memory entry for a task completion. Exported for unit tests. */
export function buildCompletionEntry(entity: Entity, actor: Actor, now: number): MemoryEntry {
  const firstEvidence = (entity.evidence?.[0] ?? '').trim();
  const content = firstEvidence
    ? `${entity.title} — ${firstEvidence}`.slice(0, DIGEST_MAX)
    : entity.title.slice(0, DIGEST_MAX);

  return {
    id: `mem-${entity.id}-${now}`,
    layer: 'episodic',
    content,
    source: actor.name,
    ...(entity.parent_id ? { context: entity.parent_id } : {}),
    tags: [entity.type ?? 'task'],
    createdAt: now,
    metadata: {
      entity_id: entity.id,
      kind: 'completion',
      actor_type: actor.type,
      usageCount: 0,   // Phase 4 will update this on echo
    },
  };
}

/** Build a memory entry for an artifact creation. Exported for unit tests. */
export function buildArtifactEntry(entity: Entity, actor: Actor, now: number): MemoryEntry {
  const desc = (entity.description ?? '').trim();
  const content = desc
    ? `${entity.title} — ${desc}`.slice(0, entity.title.length + 3 + ARTIFACT_DESC_MAX)
    : entity.title;

  return {
    id: `mem-${entity.id}-${now}`,
    layer: 'episodic',
    content,
    source: actor.name,
    ...(entity.parent_id ? { context: entity.parent_id } : {}),
    tags: ['artifact'],
    createdAt: now,
    metadata: {
      entity_id: entity.id,
      kind: 'artifact',
      actor_type: actor.type,
      usageCount: 0,
    },
  };
}

/**
 * Capture a completion memory. Safe to call even if the composer has no
 * `episodic` store registered — we log and swallow.
 */
export async function captureCompletion(
  composer: MemoryComposer,
  entity: Entity,
  actor: Actor,
): Promise<void> {
  try {
    await composer.store(buildCompletionEntry(entity, actor, Date.now()));
  } catch (err) {
    console.error('[memory] capture-completion failed', { id: entity.id, err });
  }
}

export async function captureArtifact(
  composer: MemoryComposer,
  entity: Entity,
  actor: Actor,
): Promise<void> {
  try {
    await composer.store(buildArtifactEntry(entity, actor, Date.now()));
  } catch (err) {
    console.error('[memory] capture-artifact failed', { id: entity.id, err });
  }
}
