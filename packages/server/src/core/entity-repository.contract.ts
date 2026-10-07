/** Actual managed-write consumers, independent of listing, search and resources. */
import type { IBacklogService } from './backlog-service.contract.js';

export type EntityCreationRepository = Pick<IBacklogService, 'create' | 'createCommitted' | 'createThreadChildCommitted' | 'add' | 'allocateId' | 'getMaxId'>;
export type EntityUpdateRepository = Pick<IBacklogService, 'get' | 'getForWrite' | 'save' | 'saveCommitted'>;
export type EntityDeletionRepository = Pick<IBacklogService, 'delete' | 'deleteCommitted'>;
export type EntityCreateRoutingRepository = EntityCreationRepository & Pick<IBacklogService, 'get'>;
