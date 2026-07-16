import { ZodError } from 'zod';
import type { AnyEntity } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { shouldCaptureCompletion } from '../memory/capture-rules.js';
import { captureCompletion } from '../memory/capture.js';
import {
  asBuiltinEntity,
  isBuiltinSubstrateType,
  SubstrateWriteError,
} from './substrates/index.js';
import {
  NotFoundError,
  ValidationError,
  type UpdateParams,
  type UpdateResult,
  type WriteContext,
} from './types.js';
import { formatZodError } from './zod-errors.js';
import { recordMutation } from './operation-log.js';

function applyChanges(
  target: Record<string, unknown>,
  changes: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (value === null) delete target[key];
    else target[key] = value;
  }
}

function normalizeWriteError(error: unknown): never {
  if (error instanceof SubstrateWriteError) {
    throw new ValidationError(error.message);
  }
  if (error instanceof ZodError) {
    throw new ValidationError(formatZodError(error));
  }
  throw error;
}

/** Merge an update and let the active registry perform the canonical write. */
export async function updateItem(
  service: IBacklogService,
  params: UpdateParams,
  ctx: WriteContext,
): Promise<UpdateResult> {
  const { id, fields, ...updates } = params;
  const current = await service.get(id);
  if (!current) throw new NotFoundError(id);

  const merged: Record<string, unknown> = { ...current };
  applyChanges(merged, fields ?? {});
  applyChanges(merged, updates);
  merged.id = current.id;
  merged.type = current.type;
  if (isBuiltinSubstrateType(current.type)) {
    merged.updated_at = new Date().toISOString();
  }

  let stored: AnyEntity;
  try {
    stored = await service.save(merged as AnyEntity);
  } catch (error) {
    normalizeWriteError(error);
  }

  const before = asBuiltinEntity(current);
  const after = asBuiltinEntity(stored);
  if (
    ctx.memoryComposer
    && before !== undefined
    && after !== undefined
    && shouldCaptureCompletion(before, after)
  ) {
    await captureCompletion(ctx.memoryComposer, after, ctx.actor);
  }

  const result: UpdateResult = { id: stored.id };
  recordMutation(ctx, 'backlog_update', params as unknown as Record<string, unknown>, result);
  return result;
}
