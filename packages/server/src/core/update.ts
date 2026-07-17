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
  type MutationAttribution,
  type UpdateEntityParams,
  type UpdateResult,
  type WriteContext,
} from './types.js';
import { formatZodError } from './zod-errors.js';
import { recordMutation } from './operation-log.js';

function applyChanges(
  target: Record<string, unknown>,
  changes: Record<string, unknown>,
  effectiveChanges: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    effectiveChanges[key] = value;
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

/** Pin update identity and apply the shared server-owned timestamp policy. */
export function stampUpdatePostimage(
  current: AnyEntity,
  postimage: AnyEntity,
  options: {
    readonly advanceTimestamp?: boolean;
    readonly updatedAt?: string;
  } = {},
): AnyEntity {
  const stamped = {
    ...(postimage as unknown as Record<string, unknown>),
  };
  stamped.id = current.id;
  stamped.type = current.type;
  if ('created_at' in current) stamped.created_at = current.created_at;
  else delete stamped.created_at;
  const advanceTimestamp = options.advanceTimestamp
    ?? isBuiltinSubstrateType(current.type);
  if (advanceTimestamp) {
    stamped.updated_at = options.updatedAt ?? new Date().toISOString();
  } else if ('updated_at' in current) {
    stamped.updated_at = current.updated_at;
  } else {
    delete stamped.updated_at;
  }
  return stamped as AnyEntity;
}

/**
 * Persist one already-constructed update postimage through the shared capture,
 * journal, event, identity, and timestamp funnel.
 *
 * Compiled semantic intents use this path because literal `null` is a valid
 * substrate value, while the low-level `updateEntity` contract retains its
 * historical `null`-means-delete behavior.
 */
export async function updateEntityPostimage(
  service: IBacklogService,
  current: AnyEntity,
  postimage: AnyEntity,
  effectiveChanges: Record<string, unknown>,
  ctx: WriteContext,
  attribution: MutationAttribution,
): Promise<UpdateResult> {
  delete effectiveChanges.id;
  delete effectiveChanges.type;
  delete effectiveChanges.created_at;
  delete effectiveChanges.updated_at;
  const merged = stampUpdatePostimage(current, postimage);

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
  recordMutation(
    ctx,
    attribution,
    stored.id,
    { id: stored.id, ...effectiveChanges },
    result,
  );
  return result;
}

/** Merge an update and let the active registry perform the canonical write. */
export async function updateEntity(
  service: IBacklogService,
  params: UpdateEntityParams,
  ctx: WriteContext,
  attribution: MutationAttribution,
): Promise<UpdateResult> {
  const { id, fields, ...updates } = params;
  const current = await service.get(id);
  if (!current) throw new NotFoundError(id);

  const merged: Record<string, unknown> = { ...current };
  const effectiveChanges: Record<string, unknown> = {};
  applyChanges(merged, fields ?? {}, effectiveChanges);
  applyChanges(merged, updates, effectiveChanges);

  return updateEntityPostimage(
    service,
    current,
    merged as AnyEntity,
    effectiveChanges,
    ctx,
    attribution,
  );
}
