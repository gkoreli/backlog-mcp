import { EntityType, nextEntityId } from '@backlog-mcp/shared';
import { ZodError } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { createTask } from '../storage/schema.js';
import { ValidationError } from './types.js';
import type { CreateParams, CreateResult } from './types.js';
import { formatZodError } from './zod-errors.js';

/**
 * Create a new backlog item.
 *
 * Validation authority: the substrate schema for the requested type
 * (via EntitySchema.parse() inside createTask). This means:
 *   - schedule/command/enabled on a non-cron type are rejected
 *   - invalid cron expressions are rejected (CronSchema refinement)
 *   - cron entities without schedule/command are rejected
 *   - cron entities get enabled=true by default (CronSchema default)
 *
 * Note: source_path resolution is a transport concern — MCP and CLI
 * resolve the file and pass the content as `description`. Core never
 * touches the filesystem.
 */
export async function createItem(service: IBacklogService, params: CreateParams): Promise<CreateResult> {
  const { title, description, type, epic_id, parent_id, references, schedule, command, enabled } = params;

  const resolvedType = (type ?? EntityType.Task) as EntityType;
  const resolvedParent = parent_id ?? epic_id;
  const id = nextEntityId(await service.getMaxId(resolvedType), resolvedType);

  let task;
  try {
    task = createTask({
      id, title, description, type: resolvedType,
      parent_id: resolvedParent, references,
      schedule, command, enabled,
    });
  } catch (err) {
    if (err instanceof ZodError) throw new ValidationError(formatZodError(err));
    throw err;
  }

  // Preserve legacy epic_id compat: setting parent_id=X shouldn't drop the epic_id
  // already captured when callers provide both. When only epic_id was provided,
  // createTask already copied it into raw; we also mirror to parent_id for
  // back-compat (list({epic_id}) path expects parent_id).
  if (epic_id && !parent_id) task.epic_id = epic_id;

  await service.add(task);
  return { id: task.id };
}
