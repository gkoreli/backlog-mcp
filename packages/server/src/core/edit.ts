import type { IBacklogService } from '../storage/service-types.js';
import type { Operation } from '../resources/types.js';
import { applyOperation } from '../resources/operations.js';
import { NotFoundError, type EditParams, type EditResult, type WriteContext } from './types.js';
import { recordMutation } from './operation-log.js';

/**
 * Apply a text-editing operation to an entity's markdown body.
 *
 * Journal: records a `write_resource` mutation only on success. Failed
 * applies (pattern not found, bad insert line) return `{ success: false }`
 * and are NOT logged — they didn't change state. See ADR 0094.
 */
export async function editItem(
  service: IBacklogService,
  params: EditParams,
  ctx: WriteContext,
): Promise<EditResult> {
  const { id, operation } = params;
  const task = await service.get(id);
  if (!task) throw new NotFoundError(id);

  try {
    const newBody = applyOperation(task.description ?? '', operation as Operation);
    await service.save({ ...task, description: newBody, updated_at: new Date().toISOString() });
    const result: EditResult = { success: true, message: `Successfully applied ${operation.type} to ${id}` };
    recordMutation(ctx, 'write_resource', params as unknown as Record<string, unknown>, result);
    return result;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
