/** Shared construction after the adapter selects home, actor and context policy. */
import type { WriteContext } from '../core/types.js';

export type ManagedWriteDependencies = Omit<WriteContext, 'actor' | 'operationLog'> & Partial<Pick<WriteContext, 'actor' | 'operationLog'>>;

/** Fail loudly on missing write authority; do not synthesize an ambient actor or log. */
export function createManagedWriteContext(deps: ManagedWriteDependencies | undefined): WriteContext {
  if (deps?.actor === undefined || deps.operationLog === undefined) {
    throw new Error('Managed write dependencies missing actor or operationLog; check selected-home composition');
  }
  return { ...managedWriteDependencies(deps), actor: deps.actor, operationLog: deps.operationLog };
}

/** Pick only write capabilities from a runtime; presence is enforced when constructing a write. */
export function managedWriteDependencies(deps: ManagedWriteDependencies): ManagedWriteDependencies {
  return {
    ...(deps.actor === undefined ? {} : { actor: deps.actor }),
    ...(deps.operationLog === undefined ? {} : { operationLog: deps.operationLog }),
    ...(deps.substrateRegistry === undefined ? {} : { substrateRegistry: deps.substrateRegistry }),
    ...(deps.scopeRoot === undefined ? {} : { scopeRoot: deps.scopeRoot }),
    ...(deps.eventBus === undefined ? {} : { eventBus: deps.eventBus }),
    ...(deps.memoryComposer === undefined ? {} : { memoryComposer: deps.memoryComposer }),
  };
}
