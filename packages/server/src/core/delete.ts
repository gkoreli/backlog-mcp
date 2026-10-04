import { withWriteWarnings } from './entity-mutation.js';
import type { IBacklogService } from './backlog-service.contract.js';
import type {
  DeleteParams,
  DeleteResult,
  MutationAttribution,
  WriteContext,
} from './types.js';
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
  attribution: MutationAttribution,
): Promise<DeleteResult> {
  const committed = service.deleteCommitted === undefined
    ? { value: await service.delete(params.id) }
    : await service.deleteCommitted(params.id);
  const deleted = committed.value;
  let result: DeleteResult = withWriteWarnings({ id: params.id, deleted }, committed.warnings);
  if (deleted) {
    const warnings = recordMutation(
      ctx,
      attribution,
      params.id,
      params as unknown as Record<string, unknown>,
      result,
    );
    result = withWriteWarnings(result, warnings);
  }
  return result;
}
