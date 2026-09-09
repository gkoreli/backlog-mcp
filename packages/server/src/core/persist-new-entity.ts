import { nextEntityId, type AnyEntity } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { EntityDraft } from './entity-creation.contract.js';
import { isBuiltinSubstrateType, SubstrateWriteError } from './substrates/index.js';
import { ValidationError } from './types.js';

/** Prefer atomic repository creation; retain explicit-ID compatibility for constrained adapters. */
export async function persistNewEntity(service: IBacklogService, draft: EntityDraft): Promise<AnyEntity> {
  if (service.create !== undefined) {
    try {
      return await service.create(draft);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('No storage claim for entity type:')) {
        throw new ValidationError(`Unknown substrate type: ${draft.type}`);
      }
      throw error;
    }
  }
  const id = await allocateEntityId(service, draft.type);
  return service.add({ ...draft, id });
}

async function allocateBuiltinId(
  service: IBacklogService,
  type: string,
): Promise<string> {
  if (!isBuiltinSubstrateType(type)) {
    throw new ValidationError(`Unknown substrate type: ${type}`);
  }
  return nextEntityId(await service.getMaxId(type), type);
}

async function allocateEntityId(
  service: IBacklogService,
  type: string,
): Promise<string> {
  if (service.allocateId === undefined) {
    return allocateBuiltinId(service, type);
  }
  try {
    return await service.allocateId(type);
  } catch (error) {
    if (error instanceof SubstrateWriteError) {
      throw new ValidationError(error.message);
    }
    if (
      error instanceof Error
      && error.message.startsWith('No storage claim for entity type:')
    ) {
      throw new ValidationError(`Unknown substrate type: ${type}`);
    }
    throw error;
  }
}
