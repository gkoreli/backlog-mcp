/** Repository capabilities consumed by the durable memory adapter. */
import type { IBacklogService } from '../core/backlog-service.contract.js';
import type { EntityCorpusReadPort } from '../core/entity-corpus.contract.js';
import type { EntityCreationRepository, EntityUpdateRepository, EntityDeletionRepository } from '../core/entity-repository.contract.js';
import type { MemoryCorrectionPort } from '../core/memory-correction.contract.js';

export interface MemoryRepository extends EntityCreationRepository, EntityUpdateRepository, EntityDeletionRepository, Partial<EntityCorpusReadPort>, Partial<MemoryCorrectionPort> {
  searchUnified: IBacklogService['searchUnified'];
}
