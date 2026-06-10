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
import type { Status, EntityType, Reference } from '@backlog-mcp/shared';
import type { MemoryComposer, MemoryLayer } from '@backlog-mcp/memory';
import type { ResourceContent } from '../resources/manager.js';
import type { Actor, IOperationLog } from '../operations/types.js';

export type { Actor, IOperationLog } from '../operations/types.js';
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
  status?: Status[];
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  query?: string;
  counts?: boolean;
  limit?: number;
}

export interface ListItem {
  id: string;
  title: string;
  status?: Status;
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
}

export interface GetItem {
  id: string;
  content: string | null;
  /** Present only for resource URIs — transport uses this for formatting */
  resource?: ResourceContent;
}

export interface GetResult {
  items: GetItem[];
}

// ── Create ──

export interface CreateParams {
  title: string;
  description?: string;
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  references?: Reference[];
  // Cron-only fields (validated in core/create.ts)
  schedule?: string;
  command?: string;
  enabled?: boolean;
}

export interface CreateResult {
  id: string;
}

// ── Update ──

export interface UpdateParams {
  id: string;
  title?: string;
  status?: Status;
  epic_id?: string | null;
  parent_id?: string | null;
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
  types?: Array<'task' | 'epic' | 'folder' | 'artifact' | 'milestone' | 'cron' | 'memory' | 'resource'>;
  status?: Status[];
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
  status?: Status;
  parent_id?: string;
  path?: string;
  snippet?: string;
  matched_fields?: string[];
  score?: number;
  description?: string;
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
  /** Evidence snippet max chars on completion summaries. Default: 160. */
  evidenceSnippetChars?: number;
  /**
   * Synchronous identity loader. Return ``undefined`` for "no identity
   * configured" — core will omit the L0 section. Omit to skip entirely.
   */
  readIdentity?: () => string | undefined;
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
    completion_count: number;
    activity_count: number;
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

export interface RecallItem {
  id: string;
  /** One-line digest (first line of content, ≤160 chars). Always present. */
  digest: string;
  /** Full memory body — only when ``full: true`` was requested. */
  content?: string;
  layer: MemoryLayer;
  source: string;
  context?: string;
  tags?: string[];
  created_at: string;   // ISO string (core keeps this API consistent with other result types)
  score: number;
  entity_id?: string;   // from metadata.entity_id — convenience pointer back to the canonical entity
  kind?: string;        // from metadata.kind — e.g. 'completion' | 'artifact'
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
  /** The memory body (markdown). First line becomes the title/digest. */
  content: string;
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

// ── Edit (body operations) ──

export interface EditOperation {
  type: 'str_replace' | 'insert' | 'append';
  old_str?: string;
  new_str?: string;
  insert_line?: number;
}

export interface EditParams {
  id: string;
  operation: EditOperation;
}

export interface EditResult {
  success: boolean;
  message?: string;
  error?: string;
}
