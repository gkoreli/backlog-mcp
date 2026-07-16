/**
 * Default memory composer wiring — ADR 0092.2, upgraded by ADR 0092.3.
 *
 * Phase 3 (0092.2) registered an `InMemoryStore` for the episodic layer —
 * memories died with the process, and one-shot CLI invocations could never
 * recall anything (capture and recall ran in different processes).
 *
 * ADR 0092.3 Phase B replaces it with `BacklogMemoryStore`: memories are
 * `memory`-substrate entities (MEMO- ids) persisted through the selected
 * home runtime. Capture in one process is recallable from any other process
 * selecting that home — the R1 durability contract.
 *
 * The store serves all three persisted layers (episodic / semantic /
 * procedural). The transient 'session' layer is intentionally unregistered —
 * session memory dies with the process by design; register an InMemoryStore
 * for it if a transport ever wants one.
 *
 * The service is injected by the owning home runtime; this module has no
 * process-global storage or telemetry state.
 */

import { MemoryComposer } from '@backlog-mcp/memory';
import { BacklogMemoryStore } from './backlog-memory-store.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';

export function createDefaultComposer(
  getService: () => IBacklogService,
): MemoryComposer {
  return createComposerForStore(new BacklogMemoryStore(getService));
}

/** Register one store instance for every persisted memory layer. */
export function createComposerForStore(
  store: BacklogMemoryStore,
): MemoryComposer {
  const composer = new MemoryComposer();
  composer.register('episodic', store);
  composer.register('semantic', store);
  composer.register('procedural', store);
  return composer;
}
