/**
 * Mutation recorder — core's single entry point for the write journal.
 *
 * Pure function: builds an OperationEntry, appends it to the log, emits a
 * live-event if the context carries an event bus. No module state, no
 * singletons, no wrappers.
 *
 * Called by core write functions (createEntity, updateEntity, deleteItem,
 * editItem) after their mutation completes successfully. The write and
 * its journal entry are a single operation — you cannot perform the
 * mutation without recording it, because both live inside the same core
 * function.
 *
 * See ADR 0094.
 */

import type { WriteContext } from './types.js';
import type { Mutation, MutationAttribution, OperationEntry } from '../operations/types.js';

/** Mutation class → SSE event type. Semantic tool names remain payload data. */
const MUTATION_EVENT_MAP: Record<Mutation, string> = {
  create: 'task_created',
  update: 'task_changed',
  delete: 'task_deleted',
  'resource-edit': 'resource_changed',
};

/**
 * Append a mutation entry to the operation log and emit a live event.
 *
 * `ts` is captured once here so the log entry and the event share a timestamp.
 */
export function recordMutation(
  ctx: WriteContext,
  attribution: MutationAttribution,
  resourceId: string,
  params: Record<string, unknown>,
  result: unknown,
): void {
  const ts = new Date().toISOString();

  const entry: OperationEntry = {
    ts,
    tool: attribution.tool,
    mutation: attribution.mutation,
    params,
    result,
    resourceId,
    actor: ctx.actor,
  };

  ctx.operationLog.append(entry);

  ctx.eventBus?.emit({
    type: MUTATION_EVENT_MAP[attribution.mutation],
    id: resourceId,
    tool: attribution.tool,
    actor: ctx.actor.name,
    ts,
  });
}
