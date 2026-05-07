import { EntitySchema } from '@backlog-mcp/shared';
import { ZodError } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { NotFoundError, ValidationError, type UpdateParams, type UpdateResult, type WriteContext } from './types.js';
import { formatZodError } from './zod-errors.js';
import { recordMutation } from './operation-log.js';
import { shouldCaptureCompletion } from '../memory/capture-rules.js';
import { captureCompletion } from '../memory/capture.js';

/**
 * Update an existing backlog item.
 *
 * Validation authority: EntitySchema (substrate discriminated union). We merge
 * the update onto the current entity, then `.parse()` the result. Per-substrate
 * `.strict()` automatically rejects cross-type fields (e.g. `schedule` on a
 * task). Nullable fields (parent_id, epic_id, due_date, content_type, last_run,
 * next_run) use `null` to clear; absence leaves the field alone.
 *
 * Journal: on success, appends a `backlog_update` entry to ctx.operationLog
 * and emits a `task_changed` event. See ADR 0094.
 */
export async function updateItem(
  service: IBacklogService,
  params: UpdateParams,
  ctx: WriteContext,
): Promise<UpdateResult> {
  const { id, ...updates } = params;

  const task = await service.get(id);
  if (!task) throw new NotFoundError(id);

  // Apply updates. null = clear the field; undefined = leave as-is; any other
  // value sets. Casting via Record<string, unknown> because the input type
  // is a flat union of all possible updates and the current task is a narrowed
  // substrate member.
  const merged: Record<string, unknown> = { ...task };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  merged.updated_at = new Date().toISOString();

  // parent_id/epic_id legacy sync — keep them consistent when either changes.
  // updates.parent_id explicitly null → both cleared (handled above for parent_id).
  // updates.epic_id (legacy): mirror into parent_id when set, or clear both on null.
  if ('epic_id' in updates && !('parent_id' in updates)) {
    if (updates.epic_id === null) delete merged.parent_id;
    else if (typeof updates.epic_id === 'string') merged.parent_id = updates.epic_id;
  }
  if ('parent_id' in updates && !('epic_id' in updates)) {
    if (updates.parent_id === null) delete merged.epic_id;
  }

  let validated;
  try {
    validated = EntitySchema.parse(merged);
  } catch (err) {
    if (err instanceof ZodError) throw new ValidationError(formatZodError(err));
    throw err;
  }

  await service.save(validated);

  if (ctx.memoryComposer && shouldCaptureCompletion(task, validated)) {
    await captureCompletion(ctx.memoryComposer, validated, ctx.actor);
  }

  const result: UpdateResult = { id };
  recordMutation(ctx, 'backlog_update', params as unknown as Record<string, unknown>, result);
  return result;
}
