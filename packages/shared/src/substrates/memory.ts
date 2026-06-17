/**
 * Memory substrate — a first-class agent memory record (ADR 0092.3).
 *
 * Memories are backlog entities so they inherit everything entities get:
 * markdown durability, hybrid search, viewer rendering, operation-log
 * attribution, SSE reactivity, and D1 parity. The `BacklogMemoryStore`
 * adapter (packages/server) implements the `MemoryStore` plugin interface
 * (ADR 0092) over this substrate.
 *
 * Design notes:
 *   - `layer` is the memory taxonomy from packages/memory: episodic
 *     ("what happened"), semantic ("what is true"), procedural ("how we do
 *     things"). The transient 'session' layer is intentionally NOT a valid
 *     persisted layer — session memory dies with the process by design.
 *   - The memory body (markdown content) IS the memory content — the
 *     digest for episodic captures, the distilled note for semantic and
 *     procedural knowledge. Recall returns it in full; memories are small
 *     by construction.
 *   - `entity_refs` are pointers back to source entities (the completed
 *     task, the ADR, …). Hydrate via backlog_get — the backlog stays the
 *     source of truth (ADR 0092: pointer + digest, not a copy).
 *   - `valid_until` is temporal validity (ADR 0092 Phase 5): expired
 *     memories are excluded from recall by default. Forgetting is soft —
 *     `backlog_forget` sets `valid_until: now` rather than deleting.
 *   - `usage_count` is the echo/fizzle surface (ADR 0092 Phase 4) — durable
 *     here so the feedback loop has somewhere real to write.
 *   - `supersedes` records correction lineage: `remember({ supersedes })`
 *     expires the old memory and links the new one to it.
 *   - No `status` — memories aren't workflow items. Validity is expressed
 *     by `valid_until`, not by status (same "never overload status"
 *     principle as the cron substrate, ADR 0097).
 */
import { z } from 'zod';
import { BaseEntitySchema, type SubstrateDefinition } from './base.js';

/** Persistable memory layers. 'session' is deliberately excluded. */
export const MEMORY_LAYERS = ['episodic', 'semantic', 'procedural'] as const;
export type MemoryLayerName = (typeof MEMORY_LAYERS)[number];

/**
 * Memory kinds (ADR 0092.5 R-3, after Mem0's temporal-reasoning taxonomy).
 * Supplied by the WRITING AGENT — the server never infers them.
 *   current    — true now, may change ("we deploy via wrangler")
 *   historical — true about the past ("we used to deploy via Fly")
 *   plan       — intended future state
 *   preference — a person's/team's preference
 *   timeless   — invariant; exempt from temporal decay
 */
export const MEMORY_KINDS = ['current', 'historical', 'plan', 'preference', 'timeless'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MemorySchema = BaseEntitySchema.extend({
  type: z.literal('memory'),
  /**
   * The memory body IS the content (see design note above) — so unlike the
   * base entity (where tasks may have an empty content), a memory's content
   * is REQUIRED. Mirrors `title: min(1)`: both fields are first-class and
   * neither is derived from the other.
   */
  content: z.string().min(1),
  layer: z.enum(MEMORY_LAYERS).default('episodic'),
  /** Actor that wrote the memory (agent name, 'user', tool). */
  source: z.string().optional(),
  /** Pointers to the backlog entities this memory derives from. */
  entity_refs: z.array(z.string()).optional(),
  /** Freeform labels for filterable recall (entity type, user tags). */
  tags: z.array(z.string()).optional(),
  /** ISO timestamp after which this memory is expired. Absent = always valid. */
  valid_until: z.string().nullable().optional(),
  /** Strong-usage counter — expand + cite events only (ADR 0092.9 R-14). */
  usage_count: z.number().int().nonnegative().default(0),
  /**
   * When the memory was last strongly used (ADR 0092.9 R-13). Flushed
   * relatime-style: only on bucket boundaries or >24h staleness — the
   * JSONL usage log holds the exact event history.
   */
  last_used_at: z.string().optional(),
  /** MEMO- id this memory replaces (correction lineage). */
  supersedes: z.string().optional(),
  /**
   * Inference marker (ADR 0092.7 D1, after Hindsight's epistemic
   * separation). true = this memory is DERIVED (consolidator output) rather
   * than direct evidence. Server-enforced invariant (ADR 0092.5 R-8):
   * derived memories must cite their sources via non-empty entity_refs.
   */
  derived: z.boolean().optional(),
  /**
   * Evolving-fact key (ADR 0092.5 R-2). A new memory with an existing
   * state_key deterministically closes (expires) the previous holder —
   * conflict handling with zero LLM. e.g. "build.bundler", "db.primary".
   */
  state_key: z.string().optional(),
  /** Memory kind (ADR 0092.5 R-3). 'timeless' is exempt from decay. */
  kind: z.enum(MEMORY_KINDS).optional(),
  /**
   * When the remembered event actually occurred (ADR 0092.5 R-4) — a memory
   * ABOUT an old event must not rank as fresh. Decay uses
   * occurred_at ?? created_at.
   */
  occurred_at: z.string().optional(),
}).strict();

export type Memory = z.infer<typeof MemorySchema>;

export const MemorySubstrate = {
  type: 'memory',
  prefix: 'MEMO',
  label: 'Memory',
  schema: MemorySchema,
  structure: {
    isContainer: false,
    hasStatus: false,
    // parent_id is the memory's *scope* (the recall `context`): a project
    // folder, epic, or milestone. Scoped recall = subtree filtering.
    validParents: ['folder', 'epic', 'milestone', 'task'],
  },
  extraFields: ['layer', 'kind', 'derived', 'state_key', 'source', 'entity_refs', 'tags', 'occurred_at', 'valid_until', 'usage_count', 'last_used_at', 'supersedes'],
  hint: 'Agent memory record (ADR 0092.3). Body = the memory content. layer: episodic|semantic|procedural. Written via backlog_remember or implicit capture; read via backlog_recall. Excluded from default list/search — recall is the read surface.',
  ui: {
    gradient: 'linear-gradient(135deg, #f7b955, #a371f7)',
    opensInPane: true,
  },
} as const satisfies SubstrateDefinition<typeof MemorySchema>;
