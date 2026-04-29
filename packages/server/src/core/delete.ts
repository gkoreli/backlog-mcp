import type { IBacklogService } from '../storage/service-types.js';
import type { DeleteParams, DeleteResult, WriteContext } from './types.js';
import { recordMutation } from './operation-log.js';

/**
 * Delete a backlog item. Idempotent — returns `deleted: false` if the id
 * didn't exist rather than throwing. (Matches existing callers that rely
 * on this contract for CLI not-found messaging.)
 *
 * Journal: appends a `backlog_delete` entry only when an actual deletion
 * occurred (`deleted === true`). Mutations, not activity — see ADR 0094.
 */
export async function deleteItem(
  service: IBacklogService,
  params: DeleteParams,
  ctx: WriteContext,
): Promise<DeleteResult> {
  const deleted = await service.delete(params.id);
  const result: DeleteResult = { id: params.id, deleted };
  if (deleted) {
    recordMutation(ctx, 'backlog_delete', params as unknown as Record<string, unknown>, result);
  }
  return result;
}
