/**
 * Forget — the memory correction/retraction verb (ADR 0092.3 Phase C).
 *
 * Soft by default (ADR 0092.5 R-12): forgetting sets `valid_until = now`,
 * which removes the memory from recall while keeping the record auditable
 * in the viewer. `expired: true` is the GC path — it hard-deletes memories
 * that are ALREADY expired. Hard deletion of live memories stays a human
 * action (`backlog_delete`), per "agents mutate, humans steer".
 */

import { isValidEntityId, parseEntityId, EntityType } from '@backlog-mcp/shared';
import type { MemoryComposer, ForgetFilter } from '@backlog-mcp/memory';
import { ValidationError, type ForgetParams, type ForgetResult } from './types.js';

export interface ForgetDeps {
  memoryComposer?: MemoryComposer;
}

export async function forget(params: ForgetParams, deps: ForgetDeps): Promise<ForgetResult> {
  const hasCriterion =
    (params.ids && params.ids.length > 0) ||
    params.context !== undefined ||
    params.layer !== undefined ||
    params.older_than !== undefined ||
    params.expired === true;

  if (!hasCriterion) {
    throw new ValidationError('forget requires at least one criterion: ids, context, layer, older_than, or expired');
  }
  if (!deps.memoryComposer) {
    return { forgotten: 0 };  // no memory store → nothing to forget
  }

  for (const id of params.ids ?? []) {
    const parsed = isValidEntityId(id) ? parseEntityId(id) : null;
    if (!parsed || parsed.type !== EntityType.Memory) {
      throw new ValidationError(`ids must be MEMO- ids; got ${JSON.stringify(id)}`);
    }
  }
  if (params.context !== undefined && !isValidEntityId(params.context)) {
    throw new ValidationError(`context must be a valid entity id; got ${JSON.stringify(params.context)}`);
  }

  let olderThanMs: number | undefined;
  if (params.older_than !== undefined) {
    olderThanMs = Date.parse(params.older_than);
    if (!/^\d{4}-\d{2}-\d{2}/.test(params.older_than) || Number.isNaN(olderThanMs)) {
      throw new ValidationError(
        `older_than must be an ISO date or datetime; got ${JSON.stringify(params.older_than)}`,
      );
    }
  }

  const filter: ForgetFilter = {
    ...(params.ids && params.ids.length > 0 ? { ids: params.ids } : {}),
    ...(params.context !== undefined ? { context: params.context } : {}),
    ...(params.layer !== undefined ? { layer: params.layer } : {}),
    ...(olderThanMs !== undefined ? { olderThan: olderThanMs } : {}),
    ...(params.expired === true ? { expired: true } : {}),
  };

  const forgotten = await deps.memoryComposer.forget(filter);
  return { forgotten };
}
