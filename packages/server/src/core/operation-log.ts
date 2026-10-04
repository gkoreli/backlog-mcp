import type { WriteWarning } from '@backlog-mcp/shared';
/**
 * One semantic journal append attempt and live notification after commit.
 * ADR 0117 makes the local journal best-effort, not crash-atomic with Markdown.
 * ADR 0135 R3 returns known sink failures as committed-write diagnostics.
 */

import type { WriteContext } from './types.js';
import type { Mutation, MutationAttribution, MutationNotice, OperationEntry } from './operation-log.contract.js';

/** Mutation class → SSE event type. Semantic tool names remain payload data. */
const MUTATION_EVENT_MAP: Record<Mutation, MutationNotice['type']> = {
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
  ts: string = new Date().toISOString(),
): WriteWarning[] {

  const entry: OperationEntry = {
    ts,
    tool: attribution.tool,
    mutation: attribution.mutation,
    params,
    result,
    resourceId,
    actor: ctx.actor,
  };

  const warnings: WriteWarning[] = [];
  try {
    ctx.operationLog.append(entry);
  } catch {
    warnings.push({ code: 'journal_append_failed', message: 'Markdown committed; the journal append attempt failed.' });
  }

  try {
    ctx.eventBus?.emit({
      type: MUTATION_EVENT_MAP[attribution.mutation],
      id: resourceId,
      tool: attribution.tool,
      actor: ctx.actor.name,
      ts,
    });
  } catch {
    warnings.push({ code: 'notification_failed', message: 'Markdown committed; live notification failed. Refresh the viewer to read current state.' });
  }
  return warnings;
}
