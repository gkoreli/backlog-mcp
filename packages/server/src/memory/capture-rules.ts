/**
 * Capture rules — when does a backlog mutation become an episodic memory?
 *
 * Pure predicates; no side effects, no I/O. See ADR 0092.2 §D6.
 *
 * Two events trigger capture:
 *   1. A task transitions into `done` (and wasn't done before).
 *   2. An artifact is created.
 *
 * Every other mutation is intentionally *not* captured. A task that bounces
 * between `open ↔ in_progress ↔ blocked` is noise; the memory-worthy moment
 * is when it actually finishes. A task created in `open` state is a promise,
 * not an event — capture it when it completes.
 */

import type { Entity } from '@backlog-mcp/shared';

/**
 * Returns true when the update represents a "task completed" transition
 * worth remembering. False for same-status no-ops, undone-to-open
 * reversals, or any transition whose target isn't `done`.
 */
export function shouldCaptureCompletion(prev: Entity, next: Entity): boolean {
  return next.status === 'done' && prev.status !== 'done';
}

/**
 * Returns true when the create is for an artifact (user/agent explicitly
 * materialized a memory-shaped entity).
 */
export function shouldCaptureArtifact(entity: Entity): boolean {
  return entity.type === 'artifact';
}
