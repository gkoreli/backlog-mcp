/**
 * Mutation recorder — core's single entry point for the write journal.
 *
 * Pure function: builds an OperationEntry, appends it to the log, emits a
 * live-event if the context carries an event bus. No module state, no
 * singletons, no wrappers.
 *
 * Called by core write functions (createItem, updateItem, deleteItem,
 * editItem) after their mutation completes successfully. The write and
 * its journal entry are a single operation — you cannot perform the
 * mutation without recording it, because both live inside the same core
 * function.
 *
 * See ADR 0094.
 */

import type { WriteContext } from './types.js';
import type { ToolName, OperationEntry } from '../operations/types.js';
import { extractResourceId } from '../operations/resource-id.js';

/** Tool → SSE event-type mapping. Only write tools emit events. */
const TOOL_EVENT_MAP: Record<ToolName, string> = {
  backlog_create: 'task_created',
  backlog_update: 'task_changed',
  backlog_delete: 'task_deleted',
  write_resource: 'resource_changed',
};

/**
 * Append a mutation entry to the operation log and emit a live event.
 *
 * `ts` is captured once here so the log entry and the event share a timestamp.
 */
export function recordMutation(
  ctx: WriteContext,
  tool: ToolName,
  params: Record<string, unknown>,
  result: unknown,
): void {
  const ts = new Date().toISOString();

  const entry: OperationEntry = {
    ts,
    tool,
    params,
    result,
    resourceId: extractResourceId(tool, params, result),
    actor: ctx.actor,
  };

  ctx.operationLog.append(entry);

  ctx.eventBus?.emit({
    type: TOOL_EVENT_MAP[tool],
    id: entry.resourceId ?? '',
    tool,
    actor: ctx.actor.name,
    ts,
  });
}
