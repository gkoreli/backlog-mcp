/** Body editing shares managed stamping and acknowledges committed effects. */
import { readEntityForWrite, saveEntityCommitted, withWriteWarnings } from './entity-mutation.js';
import { EntityWriteConflictError } from './entity-mutation.contract.js';
import { stampUpdatePostimage } from './update.js';
import type { EntityUpdateRepository } from './entity-repository.contract.js';
import type { Operation } from '@backlog-mcp/shared';
import { applyOperation } from './text-operations.js';
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
  service: EntityUpdateRepository,
  params: EditParams,
  ctx: WriteContext,
  attribution: MutationAttribution,
): Promise<EditResult> {
  const { id, operation } = params;
  const preimage = await readEntityForWrite(service, id);
  if (preimage === undefined) throw new NotFoundError(id);
  const task = preimage.entity;
  let newBody: string;
  try {
    newBody = applyOperation(task.content ?? '', operation as Operation);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  let committed;
  try {
    committed = await saveEntityCommitted(service, stampUpdatePostimage(task, { ...task, content: newBody }), { expected: preimage });
  } catch (error) {
    if (error instanceof EntityWriteConflictError) throw error;
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  const result: EditResult = withWriteWarnings({ success: true, message: `Successfully applied ${operation.type} to ${id}` }, committed.warnings);
  return withWriteWarnings(result, recordMutation(
    ctx, attribution, id, params as unknown as Record<string, unknown>, result,
  ));
}
