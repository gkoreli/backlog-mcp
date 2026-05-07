/**
 * Wake-up core (ADR-0092.1 Phase 2).
 *
 * Produces a dense briefing for "what am I working on?" — no focal entity
 * required. Distinct from ``backlog_context`` (which hydrates around a
 * specific task); wake-up is time-oriented rather than entity-oriented.
 *
 * Layering mirrors MemPalace's L0–L3 adapted to our substrates:
 *
 *   L0 Identity  — static text from the caller's environment (``readIdentity``)
 *   L1 Now       — active tasks (in_progress, blocked) + current epics
 *   L2 Recent    — last N completions with evidence snippets + last N activity
 *
 * Per ADR-0090 core is transport-free: filesystem reads (``identity.md``)
 * and the operation-log read are injected as optional functions on
 * ``WakeupParams``. Transports wrap the real IO; tests pass stubs.
 */

import type { Entity } from '@backlog-mcp/shared';
import { EntityType, getSubstrate, isValidEntityId, parseEntityId } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/service-types.js';
import {
  ValidationError,
  type WakeupParams,
  type WakeupResult,
  type WakeupEntitySummary,
  type WakeupCompletion,
  type WakeupActivity,
} from './types.js';

function toSummary(e: Entity): WakeupEntitySummary {
  const s: WakeupEntitySummary = {
    id: e.id,
    title: e.title,
    status: e.status ?? 'open',
    type: e.type ?? 'task',
  };
  const parent = e.parent_id ?? e.epic_id;
  if (parent) s.parent_id = parent;
  if (e.updated_at) s.updated_at = e.updated_at;
  return s;
}

function toCompletion(e: Entity, snippetChars: number): WakeupCompletion {
  const base = toSummary(e);
  const first = e.evidence?.[0];
  if (first) {
    const snippet = first.length > snippetChars
      ? first.slice(0, snippetChars - 1) + '…'
      : first;
    return { ...base, evidence_snippet: snippet };
  }
  return base;
}

function byUpdatedAtDesc(a: Entity, b: Entity): number {
  return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
}

/**
 * Derive a focal entity id from an operation's params. Knows the shape of
 * the four write tools (ADR 0094) but degrades gracefully for unknown tools.
 */
function opEntityId(op: {
  params: Record<string, unknown>;
  resourceId?: string;
}): string | undefined {
  const p = op.params ?? {};
  const candidate = p.id ?? p.task_id ?? p.entity_id;
  if (typeof candidate === 'string') return candidate;
  return op.resourceId;
}

/**
 * Validate a scope ID at the core boundary (ADR-0092.1).
 *
 * Throws ``ValidationError`` if:
 *   - the ID is malformed (doesn't parse via ``parseEntityId``)
 *   - the referenced type isn't a container (task/artifact/cron are leaves;
 *     scope only makes sense for folder/milestone/epic)
 *
 * Does NOT check existence in storage — that's a cheap follow-up (``service.get``)
 * done at the same point, letting us give the caller a single clear error
 * regardless of which check fails.
 */
function assertValidScope(scope: string): void {
  if (!isValidEntityId(scope)) {
    throw new ValidationError(`Invalid scope ID: ${JSON.stringify(scope)} (expected e.g. "FLDR-0001")`);
  }
  const parsed = parseEntityId(scope)!;  // safe — isValidEntityId returned true
  const substrate = getSubstrate(parsed.type);
  if (!substrate.structure.isContainer) {
    throw new ValidationError(
      `Scope must be a container (folder/milestone/epic); got ${parsed.type} (${scope})`,
    );
  }
}

/**
 * Build the transitive descendant set of ``scopeId`` using ``service.list``.
 * Returns the set of IDs that are scope-or-descendants (scope included).
 *
 * Implementation: BFS layer-by-layer. Each layer queries ``list(parent_id: X)``
 * for every frontier node. The tree is small enough that this is cheap —
 * backlogs of hundreds of entities finish in a handful of queries.
 */
async function descendantSet(
  service: IBacklogService,
  scopeId: string,
): Promise<Set<string>> {
  const set = new Set<string>([scopeId]);
  let frontier: string[] = [scopeId];

  while (frontier.length > 0) {
    const children = await Promise.all(
      frontier.map(id => service.list({ parent_id: id })),
    );
    const next: string[] = [];
    for (const batch of children) {
      for (const child of batch) {
        if (!set.has(child.id)) {
          set.add(child.id);
          next.push(child.id);
        }
      }
    }
    frontier = next;
  }

  return set;
}

export async function wakeup(
  service: IBacklogService,
  params: WakeupParams = {},
): Promise<WakeupResult> {
  const maxCompletions = params.maxCompletions ?? 5;
  const maxActivity = params.maxActivity ?? 5;
  const snippetChars = params.evidenceSnippetChars ?? 160;

  const identity = params.readIdentity?.();

  // Scope validation + descendant set.
  // Scope is validated at the boundary — see assertValidScope + the
  // WakeupParams.scope JSDoc in ./types.ts for the reasoning behind
  // string-over-brand here.
  let scopeFilter: ((id: string) => boolean) | null = null;
  if (params.scope !== undefined) {
    assertValidScope(params.scope);
    const set = await descendantSet(service, params.scope);
    // Exclude the scope entity itself from result sections — the caller
    // asked for "what's inside this folder", not "this folder".
    set.delete(params.scope);
    scopeFilter = (id: string) => set.has(id);
  }

  const inScope = <T extends { id: string }>(xs: T[]): T[] =>
    scopeFilter ? xs.filter(e => scopeFilter!(e.id)) : xs;

  // L1 Now — active tasks (in_progress | blocked), epics excluded;
  // and current epics as their own section.
  const active = await service.list({ status: ['in_progress', 'blocked'] });
  const activeTasks = inScope(active.filter(e => e.type !== 'epic'))
    .sort(byUpdatedAtDesc)
    .map(toSummary);

  const epics = await service.list({ type: EntityType.Epic, status: ['open', 'in_progress'] });
  const currentEpics = inScope(epics).sort(byUpdatedAtDesc).map(toSummary);

  // L2 Recent — last N done tasks by updated_at, + last N ops from the log.
  const done = await service.list({ status: ['done'] });
  const completions = inScope(done)
    .sort(byUpdatedAtDesc)
    .slice(0, maxCompletions)
    .map(e => toCompletion(e, snippetChars));

  // Pull extra activity entries when scoped — we filter client-side and
  // want to end up with at least maxActivity after filtering when possible.
  // 5x over-fetch covers the common "most ops touched other scopes" case
  // without unbounded cost.
  const opLimit = scopeFilter ? maxActivity * 5 : maxActivity;
  const ops = params.readOperations
    ? params.readOperations({ limit: opLimit })
    : [];
  const filteredOps = scopeFilter
    ? ops.filter(op => {
        const eid = opEntityId(op);
        return eid !== undefined && scopeFilter!(eid);
      })
    : ops;
  const activity: WakeupActivity[] = filteredOps.slice(0, maxActivity).map(op => {
    const a: WakeupActivity = {
      ts: op.ts,
      tool: op.tool,
      actor: op.actor?.name ?? 'unknown',
    };
    const eid = opEntityId(op);
    if (eid) a.entity_id = eid;
    return a;
  });

  return {
    ...(identity ? { identity } : {}),
    ...(params.scope ? { scope: params.scope } : {}),
    now: {
      active_tasks: activeTasks,
      current_epics: currentEpics,
    },
    recent: {
      completions,
      activity,
    },
    metadata: {
      generated_at: new Date().toISOString(),
      identity_present: identity !== undefined,
      active_task_count: activeTasks.length,
      epic_count: currentEpics.length,
      completion_count: completions.length,
      activity_count: activity.length,
    },
  };
}
