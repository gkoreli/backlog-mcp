/**
 * Wake-up core (ADR-0092.1 Phase 2).
 *
 * Produces a dense briefing for "what am I working on?" — no focal entity
 * required. Wake-up is time-oriented; use ``backlog_get({ context: true })``
 * to expand a specific entity or recall to retrieve learned knowledge.
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

import type { Entity, Memory } from '@backlog-mcp/shared';
import type { MemoryEntry } from '@backlog-mcp/memory';
import { EntityType, getSubstrate, isValidEntityId, parseEntityId } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { BacklogMemoryStore } from '../memory/backlog-memory-store.js';
import { asBuiltinEntity } from './substrates/index.js';
import {
  ValidationError,
  type WakeupParams,
  type WakeupResult,
  type WakeupEntitySummary,
  type WakeupCompletion,
  type WakeupActivity,
  type WakeupKnowledgeItem,
} from './types.js';

function toSummary(e: Entity): WakeupEntitySummary {
  const s: WakeupEntitySummary = {
    id: e.id,
    title: e.title,
    status: e.status ?? 'open',
    type: e.type ?? 'task',
  };
  const parent = e.parent_id;
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
  const parsed = parseEntityId(scope);
  if (parsed === null) {
    throw new ValidationError(`Invalid scope ID: ${JSON.stringify(scope)}`);
  }
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

  function inScope<T extends { id: string }>(entities: T[]): T[] {
    const filter = scopeFilter;
    return filter === null
      ? entities
      : entities.filter(function isInScope(entity) {
          return filter(entity.id);
        });
  }

  // L1 Now — active tasks (in_progress | blocked), epics excluded;
  // and current epics as their own section.
  const active = await service.list({ status: ['in_progress', 'blocked'] });
  const activeTasks = inScope(active.flatMap(function getActiveBuiltin(entity) {
    const builtin = asBuiltinEntity(entity);
    return builtin === undefined || builtin.type === 'epic' ? [] : [builtin];
  }))
    .sort(byUpdatedAtDesc)
    .map(toSummary);

  const epics = await service.list({ type: EntityType.Epic, status: ['open', 'in_progress'] });
  const currentEpics = inScope(epics.flatMap(function getEpic(entity) {
    const builtin = asBuiltinEntity(entity);
    return builtin?.type === EntityType.Epic ? [builtin] : [];
  })).sort(byUpdatedAtDesc).map(toSummary);

  // L2.5 Knowledge (ADR-0092.5 R-6, after MemPalace's L1 "essential story"):
  // top semantic/procedural memories for the scope — what the agent KNOWS
  // here, not what happened. Char-bounded lines, one source pointer each.
  const maxKnowledge = params.maxKnowledge ?? 5;
  let knowledge: WakeupKnowledgeItem[] = [];
  if (maxKnowledge > 0) {
    const memories = (await service.list({ type: EntityType.Memory }))
      .flatMap(function getMemory(entity) {
        const builtin = asBuiltinEntity(entity);
        return builtin?.type === EntityType.Memory ? [builtin] : [];
      });
    const fallbackStore = new BacklogMemoryStore(function getWakeupService() {
      return service;
    });
    const mintMemoryEntry = params.mintMemoryEntry
      ?? function mintFrontmatterMemory(memory: Memory): MemoryEntry {
        return fallbackStore.toMemoryEntry(memory);
      };
    const now = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    knowledge = memories
      .sort(byUpdatedAtDesc)
      // R-5 store boundary (ADR 0115): provenance/usage signals reach read
      // surfaces only via the store's MemoryEntry minting. Wakeup stays a
      // pure list fold — sort is on the raw entity, everything the item
      // surfaces comes off the minted entry.
      .map(function mintKnowledgeMemory(memory) {
        return mintMemoryEntry(memory as Memory);
      })
      .filter(e =>
        (e.layer === 'semantic' || e.layer === 'procedural') &&
        (e.expiresAt === undefined || e.expiresAt > now) &&
        (!scopeFilter || (e.context !== undefined && scopeFilter(e.context)) || (params.scope !== undefined && e.context === params.scope)),
      )
      .slice(0, maxKnowledge)
      .map(e => {
        // Provenance (ADR 0115 R-4): same age/usage grammar as recall stubs,
        // anchored on the knowledge's own timeline (occurred_at ?? created_at;
        // malformed dates already normalized at the mint).
        const meta = e.metadata ?? {};
        const occurred = typeof meta.occurred_at === 'string' ? Date.parse(meta.occurred_at) : NaN;
        const anchor = Number.isNaN(occurred) ? e.createdAt : occurred;
        const item: WakeupKnowledgeItem = {
          id: e.id,
          layer: e.layer,
          title: e.title.length > 100 ? e.title.slice(0, 99) + '…' : e.title,
          age_days: Math.max(0, Math.floor((now - anchor) / MS_PER_DAY)),
          uses: typeof meta.usageCount === 'number' ? meta.usageCount : 0,
        };
        if (typeof meta.memory_kind === 'string') item.kind = meta.memory_kind;
        const refs = Array.isArray(meta.entity_refs) ? meta.entity_refs : [];
        if (typeof refs[0] === 'string') item.source_ref = refs[0];
        return item;
      });
  }

  // L2 Recent — last N done tasks by updated_at, + last N ops from the log.
  const done = await service.list({ status: ['done'] });
  const completions = inScope(done.flatMap(function getCompletedBuiltin(entity) {
    const builtin = asBuiltinEntity(entity);
    return builtin === undefined ? [] : [builtin];
  }))
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
  const activityScopeFilter = scopeFilter;
  const filteredOps = activityScopeFilter === null
    ? ops
    : ops.filter(op => {
        const eid = opEntityId(op);
        return eid !== undefined && activityScopeFilter(eid);
      });
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
    knowledge,
    recent: {
      completions,
      activity,
    },
    metadata: {
      generated_at: new Date().toISOString(),
      identity_present: identity !== undefined,
      active_task_count: activeTasks.length,
      epic_count: currentEpics.length,
      knowledge_count: knowledge.length,
      completion_count: completions.length,
      activity_count: activity.length,
    },
  };
}
