/**
 * Default memory composer wiring — ADR 0092.2.
 *
 * Creates a MemoryComposer with an InMemoryStore registered for the
 * `episodic` layer. This is the configuration Node's server and CLI use.
 * The Worker build omits the composer entirely (memory is Node-only on
 * day one; D1-backed episodic storage is a later ADR).
 *
 * `InMemoryStore` is intentional for Phase 3: see ADR 0092.2 §D4.
 * Durable storage comes after we have correctness and a functioning
 * recall tool.
 */

import { MemoryComposer, InMemoryStore } from '@backlog-mcp/memory';

export function createDefaultComposer(): MemoryComposer {
  const composer = new MemoryComposer();
  composer.register('episodic', new InMemoryStore());
  return composer;
}

/**
 * Module-level composer. Shared across the Node server process and any
 * CLI commands run via the same process. Phase 3 memories live only in
 * this process's heap — see ADR 0092.2 §D4.
 *
 * One-shot CLI commands run in their own process, so each invocation gets
 * a fresh (empty) composer. That's fine for capture (the mutation + its
 * memory are co-located); recall across separate processes is a
 * durability concern deferred to Phase 3.1 (OramaEpisodicStore).
 */
export const defaultMemoryComposer: MemoryComposer = createDefaultComposer();
