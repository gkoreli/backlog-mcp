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

import type { Entity, Memory, RuntimeEntity } from '@backlog-mcp/shared';
import type { MemoryEntry } from '@backlog-mcp/memory';
import { EntityType, getSubstrate, isValidEntityId, parseEntityId } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { BacklogMemoryStore } from '../memory/backlog-memory-store.js';
import { asBuiltinEntity } from './substrates/index.js';
import { markdownTitle } from './orientation.js';
import { matchesDeclaredStatus } from './status-token.js';
import {
  REQUIREMENT_TYPE,
  compareConstraints,
  isActiveConstraint,
  toConstraintStub,
  type ConstraintStub,
} from './requirements/constraint-stub.js';
import {
  ValidationError,
  type WakeupSectionStub,
  type WakeupOrientationDoc,
  type WakeupParams,
  type WakeupResult,
  type WakeupEntitySummary,
  type WakeupCompletion,
  type WakeupActivity,
  type WakeupKnowledgeItem,
} from './types.js';

/**
 * Pointer budget for the orientation map (charter Slice A): the line stays
 * a bounded set of stubs — readme, agents, then index documents in stable
 * path order fill the remainder. Titles are char-bounded like knowledge.
 */
const MAX_ORIENTATION_DOCS = 6;
const MAX_ORIENTATION_TITLE_CHARS = 80;
const ORIENTATION_ROLE_ORDER: Record<WakeupOrientationDoc['role'], number> = {
  readme: 0,
  agents: 1,
  vision: 2,
  index: 3,
};

function compareOrientationDocs(
  a: WakeupOrientationDoc,
  b: WakeupOrientationDoc,
): number {
  const roleDelta = ORIENTATION_ROLE_ORDER[a.role] - ORIENTATION_ROLE_ORDER[b.role];
  return roleDelta !== 0 ? roleDelta : a.path.localeCompare(b.path);
}

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

function isUnfiledWorkEntity(
  entity: RuntimeEntity,
  acceptsParent?: WakeupParams['acceptsParent'],
): boolean {
  const builtin = asBuiltinEntity(entity);
  if (builtin !== undefined) {
    if (builtin.type === EntityType.Memory) return false;
    const identity = parseEntityId(builtin.id);
    if (identity === null) return false;
    return !getSubstrate(identity.type).structure.isContainer
      && builtin.parent_id === undefined;
  }
  return acceptsParent?.(entity.type) === true
    && entity.parent_id === undefined;
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

/** First markdown heading of the legacy-injected vision doc. */
function visionTitle(text: string): string {
  return markdownTitle(text, 'NORTH-STAR');
}

export async function wakeup(
  service: IBacklogService,
  params: WakeupParams = {},
): Promise<WakeupResult> {
  const maxCompletions = params.maxCompletions ?? 5;
  const maxActivity = params.maxActivity ?? 5;
  const snippetChars = params.evidenceSnippetChars ?? 160;

  const identity = params.readIdentity?.();
  // First-impression grounding (charter Slices A/B): composition-discovered
  // plain data — orientation pointers, vision candidates, observed recency.
  const grounding = params.readGrounding?.();

  // Home-wide by necessity: an unattached entity has no subtree ancestry by
  // which to assign it to a narrower wakeup scope.
  const unfiledCount = (await service.list({ limit: 100_000 }))
    .filter(function isUnfiled(entity) {
      return isUnfiledWorkEntity(entity, params.acceptsParent);
    })
    .length;

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
        // anchored on the knowledge's own timeline (occurred_at ?? created_at).
        // created_at is normalized at the mint; a malformed occurred_at falls
        // back to that normalized createdAt here.
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

  // L1.5 Constraints (ADR 0113.1 R-2) — live requirements as stubs,
  // worst-first. Pure list fold through the constraint mint (R-5 boundary):
  // everything surfaced comes off toConstraintStub; only ordering reads the
  // raw entity (updated_at — ordering, not provenance). Scope: requirements
  // with a parent_id follow the scope filter like knowledge; requirements
  // without one are home-wide constraints and always appear — a violated
  // REQ must not vanish because the briefing was folder-scoped.
  const maxConstraints = params.maxConstraints ?? 5;
  let constraints: ConstraintStub[] = [];
  let constraintsOmitted = 0;
  if (maxConstraints > 0) {
    // Exhaustive read (no paging in ListFilter): the omitted count must be
    // the whole truth, and worst-first ordering must see every live REQ —
    // a storage-side cap would cut oldest-first BEFORE the band sort.
    const requirements = await service.list({ type: REQUIREMENT_TYPE, limit: 100_000 });
    const now = Date.now();
    const live = requirements
      .map(r => ({
        stub: toConstraintStub(r as RuntimeEntity, now),
        updated_at: typeof r.updated_at === 'string' ? r.updated_at : '',
        parent_id: typeof r.parent_id === 'string' ? r.parent_id : undefined,
      }))
      .filter(({ stub }) => isActiveConstraint(stub))
      .filter(({ parent_id }) =>
        !scopeFilter || parent_id === undefined ||
        scopeFilter(parent_id) || parent_id === params.scope,
      )
      .sort(compareConstraints);
    constraints = live.slice(0, maxConstraints).map(({ stub }) => stub);
    constraintsOmitted = live.length - constraints.length;
  }

  // L1.6 Registry-declared disclosure sections (ADR 0113 C.2) — substrates
  // that declared `disclosure.wakeup` surface as projection-shaped stubs.
  // Same discipline as constraints: pure list fold, exhaustive read, stable
  // total order (updated_at desc, id asc), per-section omitted counts, scope
  // rule (parented follows scope; unparented is home-wide). The Requirement
  // declaration ('constraints') is satisfied by the specialized fold above —
  // its beryl-approved worst-first ordering is law, not a generic projection.
  const sections: Record<string, WakeupSectionStub[]> = {};
  const sectionsOmitted: Record<string, number> = {};
  const declaredSections = service.listWakeupDisclosures?.() ?? [];
  for (const declared of declaredSections) {
    if (declared.type === REQUIREMENT_TYPE && declared.wakeup.section === 'constraints') continue;
    const entities = await service.list({ type: declared.type, limit: 100_000 });
    const included = entities
      .filter(e => {
        if (declared.wakeup.includeStatuses.length === 0) return true;
        // Workflow states are JsonScalars (string | number | boolean) — read
        // the raw value; the RuntimeEntity type narrows status to string but
        // frontmatter parsing does not. Freeform human statuses compare by
        // leading token ("Accepted (goga, 2026-07-16)" → accepted); missing
        // status stays excluded (fail-closed).
        const status: unknown = (e as Record<string, unknown>)['status'];
        return (declared.wakeup.includeStatuses as readonly unknown[])
          .some(declaredStatus => matchesDeclaredStatus(status, declaredStatus));
      })
      .filter(e => {
        const parentId = typeof e.parent_id === 'string' ? e.parent_id : undefined;
        return !scopeFilter || parentId === undefined ||
          scopeFilter(parentId) || parentId === params.scope;
      })
      .sort((a, b) => {
        const updated = (typeof b.updated_at === 'string' ? b.updated_at : '')
          .localeCompare(typeof a.updated_at === 'string' ? a.updated_at : '');
        return updated !== 0 ? updated : a.id.localeCompare(b.id);
      });
    const limit = declared.wakeup.limit;
    const stubs = included.slice(0, limit).map(e => {
      const record = e as Record<string, unknown>;
      const stub: WakeupSectionStub = { id: e.id, title: e.title };
      for (const field of declared.wakeup.projection) {
        if (field === 'id' || field === 'title') continue;
        const value = record[field];
        if (value !== undefined && value !== null) stub[field] = value;
      }
      return stub;
    });
    sections[declared.wakeup.section] = stubs;
    sectionsOmitted[declared.wakeup.section] = included.length - stubs.length;
  }

  // Visible quarantine (EXP-1 B-3): claimed documents that could not compile
  // are named in the briefing so no typed section can imply completeness
  // while a claimed document is missing from it. Path + type only — the
  // lossless resource carries the full diagnostic on hydration.
  const quarantined = (service.listClaimQuarantines?.() ?? []).map(entry => ({
    type: entry.type,
    path: entry.sourcePath,
  }));

  // Vision pointer (ADR 0113 C.2; Cold-Open's fifth orientation): path +
  // title only — the briefing points at the vision, the agent hydrates it
  // when it matters. Never inlined (budget discipline). Grounding-based
  // discovery wins when supplied; multiple north-star candidates surface as
  // a diagnostic instead of a silently chosen authority (charter Slice A).
  const visionCandidates = grounding?.visionCandidates ?? [];
  let vision: { path: string; title: string } | undefined;
  let ambiguousVision: string[] | undefined;
  if (grounding !== undefined) {
    if (visionCandidates.length > 1) {
      ambiguousVision = [...visionCandidates].sort();
    } else {
      const visionDoc = (grounding.orientation ?? [])
        .find(doc => doc.role === 'vision');
      if (visionDoc !== undefined) {
        vision = { path: visionDoc.path, title: visionDoc.title };
      }
    }
  } else {
    const visionText = params.readVision?.();
    if (visionText !== undefined) {
      vision = { path: 'NORTH-STAR.md', title: visionTitle(visionText) };
    }
  }

  // The orientation map (charter Slice A): a bounded line of openable
  // pointer stubs — path + role + short title, never bodies. The vision
  // doc rides the dedicated pointer above, so it never repeats here.
  let orientation: WakeupResult['orientation'];
  if (grounding !== undefined) {
    const docs = [...(grounding.orientation ?? [])]
      .filter(doc => doc.role !== 'vision')
      .sort(compareOrientationDocs)
      .slice(0, MAX_ORIENTATION_DOCS)
      .map(doc => ({
        path: doc.path,
        role: doc.role,
        title: doc.title.length > MAX_ORIENTATION_TITLE_CHARS
          ? doc.title.slice(0, MAX_ORIENTATION_TITLE_CHARS - 1) + '…'
          : doc.title,
      }));
    orientation = { docs, indexed_documents: grounding.indexedDocuments ?? 0 };
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

  // A rich corpus must never render as an authoritative empty project
  // (charter Slice A / EXP-1 BUG-0002): when the typed briefing has no
  // project grounding but documents were indexed, the briefing says so and
  // names the first places to open. Deterministic emptiness check — not a
  // classifier; the pointer line itself remains regardless.
  if (orientation !== undefined && orientation.indexed_documents > 0) {
    const grounded = activeTasks.length > 0
      || currentEpics.length > 0
      || knowledge.length > 0
      || constraints.length > 0
      || completions.length > 0
      || Object.values(sections).some(stubs => stubs.length > 0);
    if (!grounded) {
      const firstPaths = [
        ...orientation.docs.map(doc => doc.path),
        ...(vision === undefined ? [] : [vision.path]),
      ].slice(0, 3);
      orientation.note =
        `No tasks, memories, or constraints are recorded yet, but ${orientation.indexed_documents} existing documents are indexed and searchable.`
        + (firstPaths.length > 0 ? ` Open first: ${firstPaths.join(', ')}.` : '');
    }
  }

  return {
    ...(identity ? { identity } : {}),
    ...(params.scope ? { scope: params.scope } : {}),
    now: {
      active_tasks: activeTasks,
      current_epics: currentEpics,
    },
    knowledge,
    constraints,
    sections,
    ...(vision === undefined ? {} : { vision }),
    ...(orientation === undefined ? {} : { orientation }),
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
      constraints_omitted: constraintsOmitted,
      sections_omitted: sectionsOmitted,
      ...(quarantined.length === 0 ? {} : { quarantined }),
      ...(ambiguousVision === undefined ? {} : { vision_candidates: ambiguousVision }),
      completion_count: completions.length,
      activity_count: activity.length,
      unfiled_count: unfiledCount,
    },
  };
}
