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
 *   - The memory body (markdown description) IS the memory content — the
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

export const MemorySchema = BaseEntitySchema.extend({
  type: z.literal('memory'),
  layer: z.enum(MEMORY_LAYERS).default('episodic'),
  /** Actor that wrote the memory (agent name, 'user', tool). */
  source: z.string().optional(),
  /** Pointers to the backlog entities this memory derives from. */
  entity_refs: z.array(z.string()).optional(),
  /** Freeform labels for filterable recall (entity type, user tags). */
  tags: z.array(z.string()).optional(),
  /** ISO timestamp after which this memory is expired. Absent = always valid. */
  valid_until: z.string().nullable().optional(),
  /** Echo/fizzle usage counter (ADR 0092 Phase 4). */
  usage_count: z.number().int().nonnegative().default(0),
  /** MEMO- id this memory replaces (correction lineage). */
  supersedes: z.string().optional(),
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
  extraFields: ['layer', 'source', 'entity_refs', 'tags', 'valid_until', 'usage_count', 'supersedes'],
  hint: 'Agent memory record (ADR 0092.3). Body = the memory content. layer: episodic|semantic|procedural. Written via backlog_remember or implicit capture; read via backlog_recall. Excluded from default list/search — recall is the read surface.',
  ui: {
    gradient: 'linear-gradient(135deg, #f7b955, #a371f7)',
    opensInPane: true,
  },
} as const satisfies SubstrateDefinition<typeof MemorySchema>;
