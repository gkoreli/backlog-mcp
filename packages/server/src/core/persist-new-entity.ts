import { nextEntityId, type AnyEntity } from '@backlog-mcp/shared';
import type { EntityCreationRepository } from './entity-repository.contract.js';
import type { EntityDraft } from './entity-creation.contract.js';
import { isBuiltinSubstrateType } from './substrates/index.js';
import { ValidationError } from './types.js';
import { normalizeWriteError } from './write-errors.js';
import type { Committed } from './entity-mutation.contract.js';

/** Prefer atomic repository creation; retain explicit-ID compatibility for constrained adapters. */
export async function persistNewEntity(service: EntityCreationRepository, draft: EntityDraft): Promise<AnyEntity> {
  return (await persistNewEntityCommitted(service, draft)).value;
}

/** Creation receipt preserves derived-effect warnings without polluting Markdown. */
export async function persistNewEntityCommitted(service: EntityCreationRepository, draft: EntityDraft, thread?: string): Promise<Committed<AnyEntity>> {
  try {
    if (thread !== undefined) {
      if (service.createThreadChildCommitted === undefined) throw new ValidationError('Atomic thread creation capability is unavailable');
      return await service.createThreadChildCommitted(draft, thread);
    }
    if (service.createCommitted !== undefined) return await service.createCommitted(draft);
    if (service.create !== undefined) return { value: await service.create(draft) };
    const id = await allocateEntityId(service, draft.type);
    return { value: await service.add({ ...draft, id }) };
  } catch (error) {
    normalizeWriteError(error);
  }
}

async function allocateBuiltinId(
  service: EntityCreationRepository,
  type: string,
): Promise<string> {
  if (!isBuiltinSubstrateType(type)) {
    throw new ValidationError(`Unknown substrate type: ${type}`);
  }
  return nextEntityId(await service.getMaxId(type), type);
}

async function allocateEntityId(
  service: EntityCreationRepository,
  type: string,
): Promise<string> {
  if (service.allocateId === undefined) {
    return allocateBuiltinId(service, type);
  }
  try {
    return await service.allocateId(type);
  } catch (error) {
    normalizeWriteError(error);
  }
}
