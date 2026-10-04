/** Managed update owns postimage policy, capture and semantic acknowledgement. */
import { normalizeWriteError } from './write-errors.js';
import { readEntityForWrite, saveEntityCommitted, withWriteWarnings } from './entity-mutation.js';
import type { Committed, EntityPreimage } from './entity-mutation.contract.js';
import type { AnyEntity } from '@backlog-mcp/shared';
import type { EntityUpdateRepository } from './entity-repository.contract.js';
import { shouldCaptureCompletion } from './memory-capture-rules.js';
import { captureCompletion } from './memory-capture.js';
import {
  asBuiltinEntity,
  isBuiltinSubstrateType,
} from './substrates/index.js';
import {
  NotFoundError,
  ValidationError,
  type MutationAttribution,
  type UpdateEntityParams,
  type UpdateResult,
  type WriteContext,
} from './types.js';
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
  service: EntityUpdateRepository,
  current: AnyEntity,
  postimage: AnyEntity,
  effectiveChanges: Record<string, unknown>,
  ctx: WriteContext,
  attribution: MutationAttribution,
  preimage: EntityPreimage = { entity: current },
): Promise<UpdateResult> {
  const now = ctx.clock?.() ?? Date.now();
  const timestamp = new Date(now).toISOString();
  delete effectiveChanges.id;
  delete effectiveChanges.type;
  delete effectiveChanges.created_at;
  delete effectiveChanges.updated_at;
  const merged = stampUpdatePostimage(current, postimage, { updatedAt: timestamp });

  let committed: Committed<AnyEntity>;
  try {
    committed = await saveEntityCommitted(service, merged, { expected: preimage });
  } catch (error) {
    normalizeWriteError(error);
  }

  const stored = committed.value;
  const before = asBuiltinEntity(current);
  const after = asBuiltinEntity(stored);
  let captureWarnings: Awaited<ReturnType<typeof captureCompletion>> = [];
  if (
    ctx.memoryComposer
    && before !== undefined
    && after !== undefined
    && shouldCaptureCompletion(before, after)
  ) {
    captureWarnings = await captureCompletion(ctx.memoryComposer, after, ctx.actor, now);
  }

  const result: UpdateResult = withWriteWarnings({ id: stored.id }, [...(committed.warnings ?? []), ...captureWarnings]);
  const warnings = recordMutation(
    ctx,
    attribution,
    stored.id,
    { id: stored.id, ...effectiveChanges },
    result,
    timestamp,
  );
  return withWriteWarnings(result, warnings);
}

/** Merge an update and let the active registry perform the canonical write. */
export async function updateEntity(
  service: EntityUpdateRepository,
  params: UpdateEntityParams,
  ctx: WriteContext,
  attribution: MutationAttribution,
): Promise<UpdateResult> {
  const { id, fields, ...updates } = params;
  const preimage = await readEntityForWrite(service, id);
  if (preimage === undefined) throw new NotFoundError(id);
  const current = preimage.entity;

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
    preimage,
  );
}
