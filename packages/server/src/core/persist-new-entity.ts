import { nextEntityId, type AnyEntity } from '@backlog-mcp/shared';
import type { IBacklogService } from './backlog-service.contract.js';
import type { EntityDraft } from './entity-creation.contract.js';
import { isBuiltinSubstrateType } from './substrates/index.js';
import { ValidationError } from './types.js';
import { normalizeWriteError } from './write-errors.js';
import type { Committed } from './entity-mutation.contract.js';

/** Prefer atomic repository creation; retain explicit-ID compatibility for constrained adapters. */
export async function persistNewEntity(service: IBacklogService, draft: EntityDraft): Promise<AnyEntity> {
  return (await persistNewEntityCommitted(service, draft)).value;
}

/** Creation receipt preserves derived-effect warnings without polluting Markdown. */
export async function persistNewEntityCommitted(service: IBacklogService, draft: EntityDraft): Promise<Committed<AnyEntity>> {
  try {
    if (service.createCommitted !== undefined) return await service.createCommitted(draft);
    if (service.create !== undefined) return { value: await service.create(draft) };
    const id = await allocateEntityId(service, draft.type);
    return { value: await service.add({ ...draft, id }) };
  } catch (error) {
    normalizeWriteError(error);
  }
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
    normalizeWriteError(error);
  }
}
