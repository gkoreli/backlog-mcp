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
 *  - Failures become committed-write diagnostics; they don't reject the caller.
 *    The user's mutation already succeeded — capturing failure is a
 *    derived side effect, not a first-class outcome.
 */

import type { Entity, WriteWarning } from '@backlog-mcp/shared';
import type { MemoryComposer, MemoryEntry } from '@backlog-mcp/memory';
import type { Actor } from './operation-log.contract.js';

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
    title: entity.title,
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
  const desc = (entity.content ?? '').trim();
  const content = desc
    ? `${entity.title} — ${desc}`.slice(0, entity.title.length + 3 + ARTIFACT_DESC_MAX)
    : entity.title;

  return {
    id: `mem-${entity.id}-${now}`,
    layer: 'episodic',
    title: entity.title,
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

async function captureEntry(composer: Pick<MemoryComposer, 'store'>, entry: MemoryEntry): Promise<WriteWarning[]> {
  try {
    const stored = await composer.store(entry);
    return [...(stored.writeWarnings ?? [])];
  } catch {
    return [{ code: 'memory_capture_failed', message: 'Markdown committed; episodic memory capture failed.' }];
  }
}

/** Completion capture uses the operation time and returns advisory diagnostics (ADR 0136 R5). */
export async function captureCompletion(
  composer: Pick<MemoryComposer, 'store'>,
  entity: Entity,
  actor: Actor,
  now: number,
): Promise<WriteWarning[]> {
  return captureEntry(composer, buildCompletionEntry(entity, actor, now));
}

/** Artifact capture shares the same post-commit failure contract (ADR 0136 R5). */
export async function captureArtifact(
  composer: Pick<MemoryComposer, 'store'>,
  entity: Entity,
  actor: Actor,
  now: number,
): Promise<WriteWarning[]> {
  return captureEntry(composer, buildArtifactEntry(entity, actor, now));
}
