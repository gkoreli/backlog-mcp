/**
 * Core function types — transport-agnostic.
 *
 * Design contracts:
 * - All operations take a single params object (consistent signature)
 * - NotFoundError: thrown when a required entity doesn't exist (update, edit)
 * - ValidationError: thrown for invalid input (create with both desc+source_path, empty search query)
 * - get: returns null per missing entity (not-found is a normal outcome for reads)
 * - delete: returns { id, deleted } so caller knows if it existed
 * - edit: returns { success, error? } for operation failures (expected outcome, not exceptional)
 */
import type {
  EditOperation,
  Memory,
  Reference,
  Status,
  SubstrateType,
} from '@backlog-mcp/shared';
import type {
  MemoryComposer,
  MemoryEntry,
  MemoryLayer,
} from '@backlog-mcp/memory';
import type { ResourceContent } from '../resources/manager.js';
import type {
  Actor,
  IOperationLog,
  MutationAttribution,
} from '../operations/types.js';
import type { ContextStubs } from './get-context/types.js';
import type { ConstraintStub } from './requirements/constraint-stub.js';
import type { ProjectSubstrateRegistry } from './substrates/project-substrate-registry.js';
import type { ContainerRouteProvenance } from './container-routing.js';

export type {
  Actor,
  IOperationLog,
  MutationAttribution,
} from '../operations/types.js';
export type { MemoryEntry, MemoryResult, RecallQuery, MemoryLayer } from '@backlog-mcp/memory';

// ── Write boundary ──

/**
 * Per-write contextual dependencies. Every core write function requires one.
 *
 * - `actor`: who initiated this write (user, agent, scheduler, system)
 * - `operationLog`: append-only mutation journal (JSONL locally, D1 in cloud)
 * - `eventBus`: optional real-time notification bus (local only; cloud is stateless)
 *
 * This is how transport-specific attribution flows into core without coupling
 * core to transports. Each adapter (MCP handler, CLI command, scheduler tick)
 * builds a ctx and passes it in. Core functions build the mutation entry
 * and append before returning — logging is part of the operation, not a wrapper.
 *
 * See ADR 0094.
 */
export interface WriteContext {
  actor: Actor;
  operationLog: IOperationLog;
  /** Active project declarations used only to resolve bounded intake policy. */
  substrateRegistry?: Pick<
    ProjectSubstrateRegistry,
    'acceptsParent' | 'getIntake'
  >;
  /** Selected home's configured default container. */
  scopeRoot?: string;
  eventBus?: { emit: (event: {
    type: string;
    id: string;
    tool: string;
    actor: string;
    ts: string;
  }) => void };
  /**
   * Optional episodic memory composer. When present, core write functions
   * capture significant events (task completions, artifact creations) as
   * `layer: 'episodic'` memories — see ADR 0092.2.
   *
   * Optional so transports that don't care about memory (edge worker, tests,
   * minimal scripts) can omit without changing core semantics.
   */
  memoryComposer?: MemoryComposer;
}

// ── Errors ──

export class NotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ── List ──

export interface ListParams {
  status?: string[];
  type?: SubstrateType;
  parent_id?: string;
  query?: string;
  counts?: boolean;
  limit?: number;
}

export interface ListItem {
  id: string;
  title: string;
  status?: string;
  type: string;
  parent_id?: string;
}

export interface ListResult {
  tasks: ListItem[];
  counts?: {
    total_tasks: number;
    total_epics: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
  };
}

// ── Get ──

export interface GetParams {
  ids: string[];
  /**
   * Expand each entity's relational neighborhood as stubs (ADR 0114 R-1).
   * Ignored for resource URIs; degrades to no context when the service
   * lacks sync storage access (remote/D1).
   */
  context?: boolean;
  /** Relational expansion depth when context is set: 1 (default) or 2. */
  depth?: number;
}

export interface GetItem {
  id: string;
  content: string | null;
  /** Present only for resource URIs — transport uses this for formatting */
  resource?: ResourceContent;
  /** Role-grouped relational stubs — present only when requested via GetParams.context */
  context?: ContextStubs;
}

export interface GetResult {
  items: GetItem[];
}

// ── Create ──

export interface CreateEntityParams {
  title: string;
  content?: string;
  type: SubstrateType;
  parent_id?: string;
  references?: Reference[];
  fields?: Record<string, unknown>;
  // Cron-only fields (validated in core/create.ts)
  schedule?: string;
  command?: string;
  enabled?: boolean;
}

export interface CreateResult {
  id: string;
  parent_id?: string;
  routed_by?: ContainerRouteProvenance;
}

// ── Update ──

export interface UpdateEntityParams {
  id: string;
  title?: string;
  status?: string;
  parent_id?: string | null;
  fields?: Record<string, unknown>;
  blocked_reason?: string[];
  evidence?: string[];
  references?: Reference[];
  due_date?: string | null;
  content_type?: string | null;
  // Cron fields — validated in core/update.ts, only permitted on cron entities.
  schedule?: string;
  command?: string;
  enabled?: boolean;
  last_run?: string | null;   // null clears (e.g. scheduler reset)
  next_run?: string | null;   // null clears
}

export interface UpdateResult {
  id: string;
}

// ── Delete ──

export interface DeleteParams {
  id: string;
}

export interface DeleteResult {
  id: string;
  deleted: boolean;
}

// ── Search ──

export interface SearchParams {
  query: string;
  types?: string[];
  status?: string[];
  parent_id?: string;
  sort?: 'relevant' | 'recent';
  limit?: number;
  include_content?: boolean;
  include_scores?: boolean;
}

export interface SearchResultItem {
  id: string;
  title: string;
  type: string;
  status?: string;
  parent_id?: string;
  path?: string;
  snippet?: string;
  matched_fields?: string[];
  score?: number;
  content?: string;
}

export interface SearchResult {
  results: SearchResultItem[];
  total: number;
  query: string;
  search_mode: string;
}

// ── Wakeup (ADR-0092.1 Phase 2) ──

/**
 * Params for ``wakeup``. All optional — the default call shape is
 * ``wakeup(service, {})`` and the core builds a ~600-token briefing.
 *
 * ``readIdentity`` is injected (not read inside core) to keep core free of
 * filesystem I/O — same discipline as the other core functions (ADR 0090).
 * The MCP/CLI transport wraps a real file read; tests pass a stub.
 */
export interface WakeupParams {
  /**
   * Restrict the briefing to a single subtree — a Folder, Milestone, or Epic
   * entity ID. Every active task, epic, completion, and activity entry is
   * filtered to descendants (transitively) of this entity. The scope entity
   * itself is not included in the result sections.
   *
   * **Typing decision:** ``scope`` is declared as ``string`` to match the
   * whole codebase's ID-field convention (``parent_id``, ``epic_id``,
   * all MCP tool args — every ID is a plain string, validated at boundaries
   * via ``isValidEntityId`` / ``parseEntityId`` from ``@backlog-mcp/shared``).
   * Introducing a branded ``EntityId`` type for one field would fight the
   * rest of the system; it would also be a weaker guarantee than what
   * we actually do — at the core boundary we validate two things that a
   * brand can't express:
   *   1. The ID is well-formed (parses via ``parseEntityId``)
   *   2. The referenced type is a **container** (folder/milestone/epic),
   *      not a leaf (task/artifact/cron)
   * Both checks happen at the start of ``wakeup``; invalid scopes throw
   * ``ValidationError`` with a message that names the offending ID.
   *
   * **What counts as a "container":** any substrate whose definition has
   * ``structure.isContainer === true`` — currently ``folder``, ``milestone``,
   * ``epic``. Leaf substrates (``task``, ``artifact``, ``cron``) are rejected.
   *
   * **Recommended usage:** Folders are the intended "project" abstraction.
   * A top-level Folder (``parent_id === undefined``) acts as a project;
   * nested folders act as sub-areas. Use ``scope: "FLDR-0001"`` for
   * project-scoped wake-up, ``scope: "EPIC-0005"`` to narrow to an epic.
   * Omit ``scope`` to get everything across all projects.
   */
  scope?: string;
  /** Max recent completions in the "recent" section. Default: 5. */
  maxCompletions?: number;
  /** Max recent activity entries (from the operation log). Default: 5. */
  maxActivity?: number;
  /**
   * Max knowledge items (semantic/procedural memories) in the L2.5 knowledge
   * section (ADR-0092.5 R-6). Default: 5. Set 0 to omit the section.
   */
  maxKnowledge?: number;
  /**
   * Max requirement constraint stubs (ADR 0113.1 R-2). Default: 5. Set 0 to
   * omit the section. Truncation is reported via metadata.constraints_omitted.
   */
  maxConstraints?: number;
  /**
   * Synchronous vision-doc loader (NORTH-STAR.md at the docs root) — same
   * injection discipline as readIdentity. Core surfaces a pointer stub only
   * (path + title), never the body; hydrate via resources (ADR 0113 C.2).
   */
  readVision?: () => string | undefined;
  /** Evidence snippet max chars on completion summaries. Default: 160. */
  evidenceSnippetChars?: number;
  /**
   * Synchronous identity loader. Return ``undefined`` for "no identity
   * configured" — core will omit the L0 section. Omit to skip entirely.
   */
  readIdentity?: () => string | undefined;
  /**
   * Active-registry parent capability lookup. Declarative substrates count as
   * unfiled work only when their runtime schema accepts ``parent_id``.
   */
  acceptsParent?: (type: string) => boolean;
  /**
   * Recent operation reader — returns write-log entries newest-first.
   * Injected because the operation log is outside ``IBacklogService`` and
   * core must not import the concrete logger (keeps core transport-free).
   * Omit to skip the activity section entirely.
   */
  readOperations?: (options: { limit?: number }) => Array<{
    ts: string;
    tool: string;
    params: Record<string, unknown>;
    resourceId?: string;
    actor: { type: string; name: string };
  }>;
  /**
   * Mint read-side memory metadata through the selected home's store.
   * Project runtimes inject their local usage overlay; omitted callers use
   * a frontmatter-backed store over the supplied service.
   */
  mintMemoryEntry?: (memory: Memory) => MemoryEntry;
}

export interface WakeupEntitySummary {
  id: string;
  title: string;
  status: Status | string;
  type: string;
  parent_id?: string;
  updated_at?: string;
}

export interface WakeupCompletion extends WakeupEntitySummary {
  evidence_snippet?: string;
}

export interface WakeupActivity {
  ts: string;
  tool: string;
  entity_id?: string;
  actor: string;
}

/**
 * One line of the wakeup knowledge section (ADR-0092.5 R-6, after
 * MemPalace's L1 "essential story": bounded lines, one source pointer each).
 */
export interface WakeupKnowledgeItem {
  id: string;
  layer: string;          // 'semantic' | 'procedural'
  title: string;          // digest line, char-bounded
  kind?: string;          // memory kind, when set
  source_ref?: string;    // first entity_ref — the evidence pointer
  /** Age in whole days: occurred_at ?? created_at (ADR 0115 R-4 — same grammar as recall stubs). */
  age_days: number;
  /** Durable usage count. 0 = never earned a recall. */
  uses: number;
}

/** Projection-shaped stub for a registry-declared wakeup section. */
export interface WakeupSectionStub {
  id: string;
  title: string;
  [field: string]: unknown;
}

export interface WakeupResult {
  identity?: string;
  /** Echoes the scope param so callers can confirm what was included. */
  scope?: string;
  now: {
    active_tasks: WakeupEntitySummary[];
    current_epics: WakeupEntitySummary[];
  };
  /** L2.5 — what the agent KNOWS here (semantic/procedural memories). */
  knowledge: WakeupKnowledgeItem[];
  /**
   * Project constraints (ADR 0113.1 R-2) — live requirements as stubs,
   * worst-first (violated > at_risk > unchecked > satisfied). Empty for
   * projects with no requirements; truncation reported via
   * metadata.constraints_omitted, never implied complete.
   */
  constraints: ConstraintStub[];
  /**
   * Registry-declared disclosure sections (ADR 0113 C.2), keyed by the
   * substrate's declared wakeup section name (e.g. `decisions` from the
   * packaged ADR definition). Projection-shaped stubs; hydrate with get.
   * The `constraints` section is NOT here — the Requirement declaration is
   * satisfied by the specialized constraint fold above (0113.1 ordering law).
   */
  sections: Record<string, WakeupSectionStub[]>;
  /**
   * Pointer to the project vision doc (NORTH-STAR.md) when present — path +
   * title only, never the body (ADR 0113 C.2; the Cold-Open Test's fifth
   * orientation). Hydrate via resources.
   */
  vision?: { path: string; title: string };
  recent: {
    completions: WakeupCompletion[];
    activity: WakeupActivity[];
  };
  metadata: {
    generated_at: string;
    identity_present: boolean;
    active_task_count: number;
    epic_count: number;
    knowledge_count: number;
    /** Live constraints beyond the maxConstraints bound (0 = complete). */
    constraints_omitted: number;
    /** Per-section omitted counts for registry-declared sections (0 = complete). */
    sections_omitted: Record<string, number>;
    completion_count: number;
    activity_count: number;
    /** Home-wide parentless work count; memories and containers are exempt. */
    unfiled_count: number;
  };
}

// ── Recall (ADR-0092.2 Phase 3) ──

/**
 * Params for ``recall`` — query the episodic memory corpus.
 *
 * Separate from ``search`` which queries the live backlog. Recall is scoped
 * to the memory composer registered on the WriteContext; if none is wired
 * the tool returns an empty result set rather than failing.
 */
export interface RecallParams {
  /** Free-text query (keyword or phrase). */
  query: string;
  /**
   * Optional scope filter — usually a parent_id (e.g. ``FLDR-0001``).
   * Matches memories written with that entity as their ``context``.
   */
  context?: string;
  /** Filter by memory tags (any-match). */
  tags?: string[];
  /** Restrict to specific memory layers. Defaults to all persisted layers. */
  layers?: MemoryLayer[];
  /** Max results. Default: 10. */
  limit?: number;
  /**
   * Return full memory bodies (ADR-0092.5 R-5). Default false: recall
   * returns STUBS (id + digest line) — the agent expands interesting ones
   * via ``backlog_get(MEMO-id)``, which is the observable usage signal
   * Phase E's echo tracking consumes.
   */
  full?: boolean;
  /**
   * Approximate token budget for the result set (ADR-0092.5 R-5, after
   * Hindsight's budget-packing). Items are greedily packed until the budget
   * is exhausted (chars/4 heuristic). Unset = no budget, ``limit`` governs.
   */
  token_budget?: number;
}

/**
 * A recall stub — provenance-bearing by design (ADR 0115 R-1): every stub
 * carries cheap authority signals (age, usage, lineage) so a consumer can
 * weigh trust WITHOUT hydrating. "A stale artifact can be worse than no
 * memory because it arrives with undeserved authority."
 */
export interface RecallItem {
  id: string;
  /** The first-class human label (0092.3: title and body are both first-class). */
  title: string;
  /** One-line digest (first line of content, ≤160 chars). Always present. */
  digest: string;
  /** Full memory body — only when ``full: true`` was requested. */
  content?: string;
  layer: MemoryLayer;
  source: string;
  context?: string;
  tags?: string[];
  score: number;
  /** Age in whole days on the knowledge's own timeline: occurred_at ?? created_at. */
  age_days: number;
  /** Durable usage count (ADR 0092.9). 0 = never earned a recall — that too is signal. */
  uses: number;
  /** Days since last strong usage event. Present only when uses > 0. */
  idle_days?: number;
  /** MEMO- id this memory corrected. Present ⇒ this stub is a v2; its predecessor is expired. */
  supersedes?: string;
  /** True ⇒ consolidator inference (cites sources via entity_refs), not primary capture. */
  derived?: boolean;
  entity_id?: string;   // from metadata.entity_id — convenience pointer back to the canonical entity
  /** Temporal kind (current/historical/plan/preference/timeless); falls back to capture kind (completion/artifact). */
  kind?: string;
}

export interface RecallResult {
  items: RecallItem[];
  total: number;
  query: string;
  /** True when token_budget truncated the result set. */
  truncated?: boolean;
}

// ── Remember / Forget (ADR-0092.3 Phase C, ADR-0092.5 R-1/R-2/R-7) ──

export interface RememberParams {
  /** The memory body (markdown). */
  content: string;
  /**
   * Memory title — REQUIRED, like a task's title. Title and body are both
   * first-class: the title is the human-readable label/digest, the content is
   * the fact. (Implicit episodic auto-capture reuses the source entity's own
   * title instead — that path does not use RememberParams.)
   */
  title: string;
  /** Memory layer. Default: 'semantic' — remember is the knowledge verb. */
  layer?: 'episodic' | 'semantic' | 'procedural';
  /** Scope container (e.g. FLDR-0001) — becomes parent_id / recall context. */
  context?: string;
  /** Freeform labels for filterable recall. */
  tags?: string[];
  /** Pointers to source entities this knowledge derives from. */
  entity_refs?: string[];
  /** Memory kind (R-3). 'timeless' exempts from decay. */
  kind?: 'current' | 'historical' | 'plan' | 'preference' | 'timeless';
  /** Evolving-fact key (R-2) — closes previous holders of the same key. */
  state_key?: string;
  /** When the remembered event occurred (R-4), ISO date/datetime. */
  occurred_at?: string;
  /** Expiry, ISO date/datetime. Must be after occurred_at if both set. */
  valid_until?: string;
  /** MEMO- id this memory replaces (R-1) — predecessor is soft-expired. */
  supersedes?: string;
  /**
   * Inference marker (ADR 0092.7 D1). Derived memories MUST cite sources:
   * `derived: true` without non-empty entity_refs is a ValidationError (R-8).
   */
  derived?: boolean;
  /** Actor name recorded as the memory source. */
  source?: string;
}

export interface RememberResult {
  id: string;
  layer: MemoryLayer;
  created_at: string;
  /** Echoed when the new memory superseded a predecessor. */
  supersedes?: string;
  /** Echoed when a state_key was set (predecessors with the key were closed). */
  state_key?: string;
  /**
   * Present only when the advisory collision scan completed. An empty array
   * means the durable write was scanned-clean; absence makes no such claim.
   */
  collision_candidates?: CollisionCandidate[];
}

export interface ForgetParams {
  /** Specific memory ids to forget (soft-expire). */
  ids?: string[];
  /** Forget all memories scoped to this context (parent_id). */
  context?: string;
  /** Forget all memories in a layer. */
  layer?: 'episodic' | 'semantic' | 'procedural';
  /** Forget memories created before this ISO date/datetime. */
  older_than?: string;
  /** GC: hard-delete memories that are ALREADY expired. */
  expired?: boolean;
}

export interface ForgetResult {
  forgotten: number;
}

// ── Consolidation candidates (ADR-0092.7 Phase D) ──

export interface ConsolidationParams {
  /** Minimum bundle size to be ripe. Default: 3. */
  min_count?: number;
  /** Minimum age (days) of a bundle's OLDEST member to be ripe. Default: 7. */
  min_age_days?: number;
  /** Recall-demand threshold for the age-OR-demand gate (ADR 0092.12). Default: 3. */
  min_demand?: number;
  /** Restrict to one context (parent_id). */
  context?: string;
  /** Max bundles returned (ripe first). Default: 10. */
  limit?: number;
  /** Max digest lines included per bundle. Default: 10. */
  max_digests?: number;
}

/**
 * One consolidation candidate — a deterministic cluster of live, non-derived
 * episodic memories sharing a bucket key (context, else first entity_ref).
 * Computed on demand, never stored (ADR 0097: the store doesn't act).
 */
export interface ConsolidationBundle {
  /** Bucket key: "context:FLDR-0001" | "entity:TASK-0042" | "unscoped". */
  key: string;
  context?: string;
  /** Member MEMO- ids, oldest first. */
  member_ids: string[];
  /** One digest line per member (bounded by max_digests). */
  digests: string[];
  /** Union of the members' entity_refs — the evidence the bundle points at. */
  entity_refs: string[];
  count: number;
  /** Recall events (last 30d) that returned a member (ADR 0092.12). */
  demand: number;
  oldest_created_at: string;
  newest_created_at: string;
  /** count ≥ min_count AND (oldest age ≥ min_age_days OR demand ≥ min_demand). */
  ripe: boolean;
}

export interface ConsolidationCandidatesResult {
  bundles: ConsolidationBundle[];
  /** Live, non-derived episodic memories considered. */
  total_episodic: number;
  ripe_count: number;
  params: { min_count: number; min_age_days: number; min_demand: number; limit: number };
  /** Semantic review pairs for members of the returned ripe bundles only. */
  collision_candidates: CollisionCandidatePair[];
}

// ── Contradiction detection (ADR-0092.13, implementing ADR-0092.5 R-9) ──

/** One live holder of a contradicted state_key, with adjudication context. */
export interface ContradictionMember {
  id: string;
  title: string;
  created_at: string;
  /** Present only if the memory carries an expiry (a live one is future-dated). */
  valid_until?: string;
  /** Evidence pointers — the human adjudicates with sources, not just ids. */
  entity_refs: string[];
  /** Actor that wrote the memory, when recorded. */
  source?: string;
}

/** ≥2 live memories sharing one state_key — the R-2 invariant breached. */
export interface ContradictionGroup {
  state_key: string;
  /** Members newest-first — the most recent belief leads. */
  members: ContradictionMember[];
  count: number;
  /** Newest member's created_at — drives most-recent-first group ordering. */
  newest_created_at: string;
}

export interface ContradictionsResult {
  /** Contradiction sets, most-recent first. Empty = no conflicts. */
  groups: ContradictionGroup[];
  /** Live memories carrying a state_key that were considered. */
  total_live_keyed: number;
  /** groups.length — the number of conflicted keys. */
  contradiction_count: number;
}

// ── Semantic collision candidates (ADR 0120) ──

/** Pure, bounded signals behind a collision review priority. */
export interface CollisionCandidateSignals {
  /** Reciprocal 1-based neighbor rank. */
  neighbor_rank: number;
  /** Jaccard overlap of normalized title/body tokens. */
  lexical_overlap: number;
  /** Same-context/shared-anchor/unscoped scope signal. */
  scope: number;
  /** Current/current pairs carry the strongest adjudication pressure. */
  epistemic_shape: number;
}

/** Scored pair before the write-time threshold is applied. */
export interface ScoredCollisionPair {
  pair_id: string;
  pair_priority: number;
  signals: CollisionCandidateSignals;
}

/** The other-memory stub returned for one focal memory. */
export interface CollisionCandidate {
  id: string;
  title: string;
  digest: string;
  pair_priority: number;
  signals: CollisionCandidateSignals;
}

/** Bounded member evidence for the full-home review queue. */
export interface CollisionCandidateMember {
  id: string;
  title: string;
  digest: string;
  kind?: string;
  context?: string;
  entity_refs: string[];
  tags: string[];
}

/** One canonical unordered pair, emitted once in deterministic order. */
export interface CollisionCandidatePair {
  pair_id: string;
  pair_priority: number;
  signals: CollisionCandidateSignals;
  members: [CollisionCandidateMember, CollisionCandidateMember];
}

export interface CollisionCandidatesResult {
  pairs: CollisionCandidatePair[];
  total_live_memories: number;
  focal_count: number;
  candidate_count: number;
}

// ── Edit (body operations) ──
// EditOperation is the shared loose boundary form (@backlog-mcp/shared).

export interface EditParams {
  id: string;
  operation: EditOperation;
}

export interface EditResult {
  success: boolean;
  message?: string;
  error?: string;
}
