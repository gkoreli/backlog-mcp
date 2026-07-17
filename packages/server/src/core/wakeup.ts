/**
 * Wake-up core (ADR-0092.1 Phase 2).
 *
 * Produces a dense briefing for "what am I working on?" — no focal entity
 * required. Wake-up is time-oriented; use ``backlog_get({ context: true })``
 * to expand a specific entity or recall to retrieve learned knowledge.
 *
 * ``wakeup(operation=X)`` (north-star Amnesia contract) turns one declared
 * disclosure document into the briefing's centerpiece: its declared
 * projection rides ``focus`` while every non-focal section yields budget
 * deterministically (see WakeupParams.operation). The declaration drives
 * everything — core has no builtin notion of an "operation".
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
import { loadAgentAttributionIndex } from './agent-attribution.js';
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * THE MEMORY PROTOCOL — the rubric pair (ADR 0118.1 R2 + memory-flywheel
 * F1). Policy text, not retrieved data: it rides every briefing once, as
 * the payload's final block, and is non-droppable under the wire ceiling.
 *
 * ``recall`` is the session-start rubric (0118.1 Slice A): the agent
 * keeps the intent decision; this makes it legible and cheap. ``remember``
 * is its session-end twin (flywheel F1): the three capture triggers, and
 * PROMPT 0006's first-person law — the agent that did the work writes the
 * memory, at its own checkpoint, in its own words, while the context that
 * earned the lesson is still live. Never post-hoc, never ghost-written.
 *
 * Every word here is permanent context tax on every session (Tenet 8).
 * Tighten before extending; the recall line must stay ~50–100 tokens.
 */
export const MEMORY_PROTOCOL = {
  recall:
    'Recall before re-deriving what a prior session likely solved, on '
    + 'unfamiliar identifiers, and before contradicting a recorded decision. '
    + 'Skip what is generic or already visible. Stubs first; get only the '
    + 'IDs that matter.',
  remember:
    'Before this session ends, remember what it earned: a lesson proven by '
    + 'failure, a decision that changed direction, a fact that cost tokens '
    + 'to derive and will be needed again. Write at your own checkpoint, in '
    + "your own words — never summarize another agent's work into memory.",
} as const;

/**
 * `sectionType` is the section's implied type: a summary carries `type`
 * only when it differs (an artifact among active tasks). Staleness rides
 * as `age_days` — the same provenance grammar as knowledge and recall
 * stubs (ADR 0115 R-4) at a fraction of a full ISO timestamp's bytes.
 * Every byte in the briefing earns its place (Tenet 8).
 */
function toSummary(e: Entity, sectionType: string, now: number): WakeupEntitySummary {
  const s: WakeupEntitySummary = {
    id: e.id,
    title: e.title,
    status: e.status ?? 'open',
  };
  const type = e.type ?? 'task';
  if (type !== sectionType) s.type = type;
  const parent = e.parent_id;
  if (parent) s.parent_id = parent;
  const updated = e.updated_at === undefined ? Number.NaN : Date.parse(e.updated_at);
  if (!Number.isNaN(updated)) {
    s.age_days = Math.max(0, Math.floor((now - updated) / MS_PER_DAY));
  }
  return s;
}

function toCompletion(e: Entity, snippetChars: number, now: number): WakeupCompletion {
  const base = toSummary(e, 'task', now);
  // Everything in this section is done by construction — restating the
  // status on each row is transport redundancy (Tenet 8).
  delete (base as { status?: unknown }).status;
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

/**
 * Under operation focus every declared section's limit caps here (part of
 * the focal yield rule — see WakeupParams.operation; recorded as law in
 * wakeup-wire-budget.test.ts). The focal doc itself never counts against
 * this: it rides `focus`, not its section.
 */
const FOCAL_SECTION_LIMIT = 2;

/** Max nearby candidates named by the honest unknown-operation error. */
const FOCAL_CANDIDATE_LIMIT = 5;

/**
 * Shape one entity through a declared wakeup projection (ADR 0113 C.2).
 * id/title always lead; every other surfaced field was named by the
 * declaration — core adds nothing.
 */
function projectSectionStub(
  entity: { id: string; title: string },
  projection: readonly string[],
): WakeupSectionStub {
  const record = entity as unknown as Record<string, unknown>;
  const stub: WakeupSectionStub = { id: entity.id, title: entity.title };
  for (const field of projection) {
    if (field === 'id' || field === 'title') continue;
    const value = record[field];
    if (value !== undefined && value !== null) stub[field] = value;
  }
  return stub;
}

/**
 * Order the honest-error candidate list: IDs sharing the requested ID's
 * leading non-digit prefix first (asking for "OP-9999" names other OPs
 * before anything else), then stable id order. Deterministic — no ranking
 * model, no fuzzy match.
 */
function nearbyFocalCandidates(
  requested: string,
  pool: ReadonlyArray<{ id: string; section: string }>,
): Array<{ id: string; section: string }> {
  const prefix = /^[^0-9]*/.exec(requested)?.[0] ?? '';
  const sharesPrefix = (id: string): boolean =>
    prefix.length > 0 && id.startsWith(prefix);
  return [...pool]
    .sort((a, b) => {
      const prefixDelta = Number(sharesPrefix(b.id)) - Number(sharesPrefix(a.id));
      if (prefixDelta !== 0) return prefixDelta;
      const sectionDelta = a.section.localeCompare(b.section);
      if (sectionDelta !== 0) return sectionDelta;
      return a.id.localeCompare(b.id);
    })
    .slice(0, FOCAL_CANDIDATE_LIMIT);
}

function describeFocalCandidates(
  candidates: ReadonlyArray<{ id: string; section: string }>,
): string {
  if (candidates.length === 0) {
    return ' No live operation documents exist in this home.';
  }
  return ` Live candidates: ${candidates
    .map(c => `${c.id} (${c.section})`)
    .join(', ')}.`;
}

export async function wakeup(
  service: IBacklogService,
  params: WakeupParams = {},
): Promise<WakeupResult> {
  // Focal yield rule (north-star Amnesia contract): when an operation focus
  // is requested, non-focal defaults yield budget to the focal section —
  // completions 5→2, activity 5→2, knowledge 5→3, declared sections capped
  // at FOCAL_SECTION_LIMIT. Constraints never yield (the amnesiac must
  // state its constraints). Explicit caller caps always win.
  const focalId = params.operation;
  const maxCompletions = params.maxCompletions ?? (focalId !== undefined ? 2 : 5);
  const maxActivity = params.maxActivity ?? (focalId !== undefined ? 2 : 5);
  const snippetChars = params.evidenceSnippetChars ?? 160;

  const identity = params.readIdentity?.();
  // Implicit identity disclosure (ADR 0119.1 R2): the composition already
  // resolved the ladder — core only names the value and its winning rung.
  // Display resolution reuses the fail-open read-side index (ADR 0119
  // R2/R3): a declared value renders as its Agent title, an undeclared
  // value renders raw, and a home without the agent substrate changes
  // nothing. Absent identity emits nothing — byte-identical to today.
  const agentIdentity = params.agentIdentity;
  let identityDisclosure: string | undefined;
  if (agentIdentity !== undefined) {
    const attributionIndex = await loadAgentAttributionIndex(service);
    const display = attributionIndex.titleFor(agentIdentity.value)
      ?? agentIdentity.value;
    identityDisclosure = `${display} (${agentIdentity.source})`;
  }
  // One time anchor for every age_days in the briefing.
  const nowMs = Date.now();
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
    .map(e => toSummary(e, 'task', nowMs));

  const epics = await service.list({ type: EntityType.Epic, status: ['open', 'in_progress'] });
  const currentEpics = inScope(epics.flatMap(function getEpic(entity) {
    const builtin = asBuiltinEntity(entity);
    return builtin?.type === EntityType.Epic ? [builtin] : [];
  })).sort(byUpdatedAtDesc).map(e => toSummary(e, 'epic', nowMs));

  // L2.5 Knowledge (ADR-0092.5 R-6, after MemPalace's L1 "essential story"):
  // top semantic/procedural memories for the scope — what the agent KNOWS
  // here, not what happened. Char-bounded lines, one source pointer each.
  const maxKnowledge = params.maxKnowledge ?? (focalId !== undefined ? 3 : 5);
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
    const now = nowMs;
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
  const maxConstraints = params.maxConstraints ?? 3;
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
  // total order, per-section omitted counts, scope rule (parented follows
  // scope; unparented is home-wide). The Requirement declaration
  // ('constraints') is satisfied by the specialized fold above — its
  // beryl-approved worst-first ordering is law, not a generic projection.
  //
  // Ordering comparator (charter Slice B): (1) valid frontmatter updated_at;
  // (2) injected observed recency when updated_at is absent; (3) stable id
  // order. Without the injected map, timestamp-less legacy corpora tie and
  // fall back to oldest IDs (EXP-1b B-2) — the map orders disclosed
  // evidence, it never invents work or interprets repository history.
  const observedRecency = grounding?.observedRecency;
  const entityRecencyMs = (e: { id: string; updated_at?: unknown }): number => {
    const updated = typeof e.updated_at === 'string'
      ? Date.parse(e.updated_at)
      : Number.NaN;
    if (!Number.isNaN(updated)) return updated;
    const observed = observedRecency?.[e.id];
    const observedMs = observed === undefined
      ? Number.NaN
      : Date.parse(observed);
    return Number.isNaN(observedMs) ? Number.NEGATIVE_INFINITY : observedMs;
  };
  const sections: Record<string, WakeupSectionStub[]> = {};
  const sectionsOmitted: Record<string, number> = {};
  const declaredSections = service.listWakeupDisclosures?.() ?? [];
  // Focal resolution (north-star Amnesia contract) rides the SAME fold:
  // the operation argument selects one status-eligible document out of the
  // declared disclosure pipeline — no new substrate, no classifier. The
  // candidate pool doubles as the honest-error vocabulary.
  let focus: WakeupResult['focus'];
  let focalStatusConflict: { section: string; status: unknown } | undefined;
  const focalPool: Array<{ id: string; section: string }> = [];
  for (const declared of declaredSections) {
    if (declared.type === REQUIREMENT_TYPE && declared.wakeup.section === 'constraints') continue;
    const entities = await service.list({ type: declared.type, limit: 100_000 });
    const statusIncluded = entities
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
      });
    if (focalId !== undefined) {
      // Focal selection is by explicit ID and status-eligibility only —
      // scope never gates an explicitly named focus. The declaration's
      // includeStatuses DOES gate it: a closed operation must not resurface,
      // not even as a focus (it errors honestly below instead).
      const focalEntity = statusIncluded.find(e => e.id === focalId);
      if (focalEntity !== undefined) {
        focus = {
          section: declared.wakeup.section,
          doc: projectSectionStub(focalEntity, declared.wakeup.projection),
        };
      } else {
        const shelved = entities.find(e => e.id === focalId);
        if (shelved !== undefined) {
          focalStatusConflict = {
            section: declared.wakeup.section,
            status: (shelved as Record<string, unknown>)['status'],
          };
        }
      }
      for (const e of statusIncluded) {
        if (e.id !== focalId) {
          focalPool.push({ id: e.id, section: declared.wakeup.section });
        }
      }
    }
    const included = statusIncluded
      .filter(e => {
        const parentId = typeof e.parent_id === 'string' ? e.parent_id : undefined;
        return !scopeFilter || parentId === undefined ||
          scopeFilter(parentId) || parentId === params.scope;
      })
      // The focal doc leaves its own section's stubs — it is the
      // centerpiece, and the briefing never carries the same fact twice.
      .filter(e => e.id !== focalId)
      .sort((a, b) => {
        const recencyDelta = entityRecencyMs(b) - entityRecencyMs(a);
        if (recencyDelta !== 0 && !Number.isNaN(recencyDelta)) return recencyDelta;
        return a.id.localeCompare(b.id);
      });
    const limit = focalId !== undefined
      ? Math.min(declared.wakeup.limit, FOCAL_SECTION_LIMIT)
      : declared.wakeup.limit;
    const stubs = included.slice(0, limit)
      .map(e => projectSectionStub(e, declared.wakeup.projection));
    sections[declared.wakeup.section] = stubs;
    sectionsOmitted[declared.wakeup.section] = included.length - stubs.length;
  }

  // The honest error (never a silent generic briefing): an unresolved focus
  // names what CAN be focused, distinguishing "excluded by its declared
  // statuses" and "exists but isn't an operation-style document" from
  // "unknown".
  if (focalId !== undefined && focus === undefined) {
    const candidates = describeFocalCandidates(
      nearbyFocalCandidates(focalId, focalPool),
    );
    if (focalStatusConflict !== undefined) {
      throw new ValidationError(
        `Operation ${JSON.stringify(focalId)} exists in section "${focalStatusConflict.section}" `
        + `but its status ${JSON.stringify(focalStatusConflict.status)} is not disclosed at wakeup `
        + `(closed operations never resurface in a live briefing).${candidates}`,
      );
    }
    const other = await service.get(focalId);
    if (other !== undefined) {
      throw new ValidationError(
        `${focalId} is a ${other.type ?? 'document'}, not an operation-style document — `
        + `wakeup(operation=…) focuses documents whose substrate declares disclosure.wakeup.${candidates}`,
      );
    }
    throw new ValidationError(
      `Unknown operation ${JSON.stringify(focalId)}.${candidates}`,
    );
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
    .map(e => toCompletion(e, snippetChars, nowMs));

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
    // A focal operation IS project grounding — the centerpiece left its
    // section's stubs, so the stub check alone would misread a focused
    // briefing as an empty project.
    const grounded = focus !== undefined
      || activeTasks.length > 0
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

  // Worktree meta line (LATTICE W1): when (and only when) the resolved
  // home is a linked worktree, the briefing names its family, branch, and
  // divergence in one short line. Plain data injected by the composition
  // (git plumbing stays outside core); the fold only formats it.
  const worktree = grounding?.worktree;

  // Zero-valued omission counters are redundant transport metadata:
  // absence means complete (charter trim ruling).
  const nonZeroEntries = Object.entries(sectionsOmitted)
    .filter(([, count]) => count > 0);
  const nonZeroSectionsOmitted = nonZeroEntries.length === 0
    ? undefined
    : Object.fromEntries(nonZeroEntries);

  return {
    ...(identity ? { identity } : {}),
    ...(params.scope ? { scope: params.scope } : {}),
    // The centerpiece leads the payload: an amnesiac reads its own
    // operation before anything else (north-star Amnesia contract).
    ...(focus === undefined ? {} : { focus }),
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
    // Metadata carries only what the payload cannot derive: omission
    // truths, quarantine, diagnostics, and the home-wide unfiled count.
    // Per-section counts are the arrays' own lengths, zero-valued
    // counters are absent, and no generation timestamp rides the wire
    // (Tenet 8 — every context byte earns its place; redundant
    // transport metadata does not. Charter trim ruling, 0118.1 Slice A).
    metadata: {
      ...(identityDisclosure === undefined ? {} : { identity: identityDisclosure }),
      ...(constraintsOmitted > 0 ? { constraints_omitted: constraintsOmitted } : {}),
      ...(nonZeroSectionsOmitted === undefined ? {} : { sections_omitted: nonZeroSectionsOmitted }),
      ...(quarantined.length === 0 ? {} : { quarantined }),
      ...(ambiguousVision === undefined ? {} : { vision_candidates: ambiguousVision }),
      ...(worktree === undefined ? {} : {
        worktree: `${worktree.family} @ ${worktree.branch}, `
          + `${worktree.behind} behind ${worktree.defaultBranch}`,
      }),
      ...(unfiledCount > 0 ? { unfiled_count: unfiledCount } : {}),
    },
    // The protocol closes the payload: the last line a session reads is
    // what it must do before it ends (flywheel F1's placement law).
    memory_protocol: MEMORY_PROTOCOL,
  };
}
