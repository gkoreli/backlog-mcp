/** Required capabilities for the writable docs-native graph (constrained graphs remain explicit). */
import type { IBacklogService } from '../core/backlog-service.contract.js';
import type { EntityCorpusReadPort, SyncEntityCorpusReadPort } from '../core/entity-corpus.contract.js';
import type { EntityMutationPort } from '../core/entity-mutation.contract.js';
import type { MemoryCorrectionPort } from '../core/memory-correction.contract.js';

export type LocalManagedRepository = IBacklogService & EntityCorpusReadPort & SyncEntityCorpusReadPort & EntityMutationPort & MemoryCorrectionPort & Required<Pick<IBacklogService, 'getSync'>>;
const REQUIRED = ['scan', 'scanSync', 'getSync', 'getForWrite', 'saveCommitted', 'createCommitted', 'deleteCommitted', 'correctMemory'] as const;

/** Detect a miswired writable graph before reads can silently degrade or writes lose guarantees. */
export function requireLocalManagedRepository(service: IBacklogService): asserts service is LocalManagedRepository {
  const missing = REQUIRED.filter(function absent(name) { return typeof service[name] !== 'function'; });
  if (missing.length > 0) throw new Error(`Writable local runtime is missing required capabilities: ${missing.join(', ')}`);
}
