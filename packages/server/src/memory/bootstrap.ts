/**
 * Default memory composer wiring — ADR 0092.2, upgraded by ADR 0092.3.
 *
 * Phase 3 (0092.2) registered an `InMemoryStore` for the episodic layer —
 * memories died with the process, and one-shot CLI invocations could never
 * recall anything (capture and recall ran in different processes).
 *
 * ADR 0092.3 Phase B replaces it with `BacklogMemoryStore`: memories are
 * `memory`-substrate entities (MEMO- ids) persisted through the singleton
 * `BacklogService`. Capture in one process is recallable from any other —
 * the R1 durability contract.
 *
 * The store serves all three persisted layers (episodic / semantic /
 * procedural). The transient 'session' layer is intentionally unregistered —
 * session memory dies with the process by design; register an InMemoryStore
 * for it if a transport ever wants one.
 *
 * The service is resolved lazily (at first store/recall), so importing this
 * module doesn't force singleton construction before paths are configured.
 */

import { MemoryComposer } from '@backlog-mcp/memory';
import { BacklogMemoryStore } from './backlog-memory-store.js';
import { BacklogService } from '../storage/backlog-service.js';
import type { IBacklogService } from '../storage/service-types.js';

export function createDefaultComposer(
  getService: () => IBacklogService = () => BacklogService.getInstance(),
): MemoryComposer {
  const composer = new MemoryComposer();
  const store = new BacklogMemoryStore(getService);
  composer.register('episodic', store);
  composer.register('semantic', store);
  composer.register('procedural', store);
  return composer;
}

/**
 * Module-level composer shared by the Node server and CLI transports.
 * Durable since ADR 0092.3 Phase B — memories survive process boundaries
 * because they live in the backlog itself.
 */
export const defaultMemoryComposer: MemoryComposer = createDefaultComposer();
