import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { Operation } from '@backlog-mcp/shared';
import { applyOperation } from '../resources/operations.js';
import {
  NotFoundError,
  type EditParams,
  type EditResult,
  type MutationAttribution,
  type WriteContext,
} from './types.js';
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
  attribution: MutationAttribution,
): Promise<EditResult> {
  const { id, operation } = params;
  const task = await service.get(id);
  if (!task) throw new NotFoundError(id);

  try {
    const newBody = applyOperation(task.content ?? '', operation as Operation);
    await service.save({ ...task, content: newBody, updated_at: new Date().toISOString() });
    const result: EditResult = { success: true, message: `Successfully applied ${operation.type} to ${id}` };
    recordMutation(
      ctx,
      attribution,
      id,
      params as unknown as Record<string, unknown>,
      result,
    );
    return result;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
