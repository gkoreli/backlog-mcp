import type { WriteWarning } from '@backlog-mcp/shared';
/** Shared managed-write mechanics; adapters retain semantic receipt formatting. */
import type { AnyEntity } from '@backlog-mcp/shared';
import type { IBacklogService } from './backlog-service.contract.js';
import type { Committed, EntityPreimage, MutationReceipt, StorageSaveOptions } from './entity-mutation.contract.js';

/** Prefer the local exact-document preimage; legacy ports retain semantic checks. */
export async function readEntityForWrite(
  service: Pick<IBacklogService, 'get' | 'getForWrite'>,
  id: string,
): Promise<EntityPreimage | undefined> {
  if (service.getForWrite !== undefined) return service.getForWrite(id);
  const entity = await service.get(id);
  return entity === undefined ? undefined : { entity };
}

/** Preserve committed effect diagnostics without changing entity payloads. */
export async function saveEntityCommitted(
  service: Pick<IBacklogService, 'save' | 'saveCommitted'>,
  entity: AnyEntity,
  options?: StorageSaveOptions,
): Promise<Committed<AnyEntity>> {
  return service.saveCommitted === undefined
    ? { value: await service.save(entity, options) }
    : service.saveCommitted(entity, options);
}

/** Add diagnostics only when present, preserving existing successful wire shapes. */
export function withWriteWarnings<T extends object>(result: T, warnings: readonly WriteWarning[] = []): T & MutationReceipt {
  return warnings.length === 0 ? result : { ...result, warnings: [...((result as MutationReceipt).warnings ?? []), ...warnings] };
}
