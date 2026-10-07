/** Legacy create façade over the internal creation operation (ADR 0106.6). */
import { executeEntityCreation } from './create-entity-operation.js';
import type { EntityCreateRoutingRepository } from './entity-repository.contract.js';
import type { CreateEntityParams, CreateResult, MutationAttribution, WriteContext } from './types.js';

/** Retain create callers while declared actions own thread selectors (ADR 0106.6). */
export function createEntity(
  service: EntityCreateRoutingRepository,
  params: CreateEntityParams,
  ctx: WriteContext,
  attribution: MutationAttribution,
): Promise<CreateResult> {
  return executeEntityCreation(service, params, ctx, attribution);
}
