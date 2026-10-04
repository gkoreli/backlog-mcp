import { readEntityForWrite, saveEntityCommitted } from '../core/entity-mutation.js';
import { mintMemoryEntry } from '../core/memory-entry.js';
import { isMemoryLive, memoryValidity } from '../core/memory-validity.js';
/**
 * BacklogMemoryStore — the default MemoryStore, backed by the backlog itself
 * (ADR 0092.3 Part 3).
 *
 * Memories are `memory`-substrate entities (MEMO- ids). This adapter
 * implements the ADR 0092 plugin interface (`store`/`recall`/`forget`/`size`)
 * over `MemoryRepository`, which means memories inherit everything entities
 * get: markdown durability (R1), hybrid-search ranking via searchUnified
 * (R2/R3), native filtering (R4), viewer rendering, operation-log presence,
 * and SSE reactivity — instead of a parallel storage stack.
 *
 * Semantics:
 *  - `store` mints a fresh MEMO- id (the MemoryEntry's transient id is not an
 *    entity id; the original is preserved nowhere — the entity IS the memory).
 *  - `recall` rides the same fusion pipeline as backlog_search, restricted to
 *    `type: memory`, then applies layer/context/tags/expiry filters that the
 *    Orama schema doesn't model (memory corpora are small; JS filtering on
 *    the over-fetched candidate set is fine at this scale).
 *  - `forget` is SOFT by default: it sets `valid_until: now`, which excludes
 *    the memory from recall but keeps it visible (with full history) in the
 *    viewer. `{ expired: true }` hard-deletes already-expired memories — the
 *    GC path (ADR 0092.3 Phase E).
 *  - The transient 'session' layer is rejected: session memory dies with the
 *    process by design. Register an InMemoryStore for 'session' if needed.
 */

import { readEntityCorpus } from '../core/entity-corpus.js';

import { EntityType, MemorySchema, isValidEntityId, type Entity, type Memory } from '@backlog-mcp/shared';
import type { MemoryStore, MemoryEntry, MemoryLayer, RecallQuery, MemoryResult, ForgetFilter } from '@backlog-mcp/memory';
import type { MemoryRepository } from './backlog-memory-store.contract.js';
import type {
  MemoryUsageSummaryStore,
} from './memory-usage.contract.js';
import { usageFactor } from './usage-signal.js';
import { persistNewEntityCommitted } from '../core/persist-new-entity.js';
import {
  memoryUsageFieldsFromEntry,
} from './memory-entry-usage.js';

/** Layers this store persists. 'session' is intentionally absent. */
const PERSISTED_LAYERS: readonly MemoryLayer[] = ['episodic', 'semantic', 'procedural'];

export class BacklogMemoryStore implements MemoryStore {
  readonly name = 'backlog';

  /**
   * Service is provided lazily so module-level composer wiring doesn't force
   * service construction at import time (the singleton may not be configured
   * yet when the composer module loads).
   */
  constructor(
    private readonly getService: () => MemoryRepository,
    private readonly usageSummaryStore?: MemoryUsageSummaryStore,
    private readonly now: () => number = Date.now,
  ) {}

  async store(entry: MemoryEntry): Promise<MemoryEntry> {
    if (!PERSISTED_LAYERS.includes(entry.layer)) {
      throw new Error(`BacklogMemoryStore does not persist layer '${entry.layer}' — register a session store for transient memory`);
    }
    const service = this.getService();
    const now = this.now();
    const nowIso = new Date(Number.isFinite(entry.createdAt) ? entry.createdAt : now).toISOString();

    const meta = entry.metadata ?? {};
    const entityRefs = Array.isArray(meta.entity_refs)
      ? meta.entity_refs.filter((r): r is string => typeof r === 'string')
      : typeof meta.entity_id === 'string' ? [meta.entity_id] : undefined;
    const captureKind = meta.kind === 'completion' || meta.kind === 'artifact' ? meta.kind : undefined;
    const memoryKind = typeof meta.memory_kind === 'string' ? meta.memory_kind : undefined;
    const stateKey = typeof meta.state_key === 'string' ? meta.state_key : undefined;
    const supersedes = typeof meta.supersedes === 'string' ? meta.supersedes : undefined;
    const occurredAt = typeof meta.occurred_at === 'string' ? meta.occurred_at : undefined;
    const derived = meta.derived === true;
    const tags = [...new Set([
      ...(entry.tags ?? []),
      ...(captureKind ? [captureKind] : []),
    ])];

    const memory = MemorySchema.omit({ id: true }).parse({
      type: 'memory',
      title: entry.title.trim(),
      content: entry.content,
      layer: entry.layer,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.context && isValidEntityId(entry.context) ? { parent_id: entry.context } : {}),
      ...(entityRefs && entityRefs.length > 0 ? { entity_refs: entityRefs } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(entry.expiresAt !== undefined ? { valid_until: new Date(entry.expiresAt).toISOString() } : {}),
      ...(memoryKind ? { kind: memoryKind } : {}),
      ...(stateKey ? { state_key: stateKey } : {}),
      ...(supersedes ? { supersedes } : {}),
      ...(occurredAt ? { occurred_at: occurredAt } : {}),
      ...(derived ? { derived: true } : {}),
      ...(this.usageSummaryStore === undefined
        ? { usage_count: typeof meta.usageCount === 'number' ? meta.usageCount : 0 }
        : {}),
      created_at: nowIso,
      updated_at: nowIso,
    });

    const committed = supersedes || stateKey
      ? await this.correctMemory(service, memory, now)
      : await persistNewEntityCommitted(service, memory);
    const stored = this.toMemoryEntry(MemorySchema.parse(committed.value), now);
    return committed.warnings?.length ? { ...stored, writeWarnings: committed.warnings } : stored;
  }

  private correctMemory(service: MemoryRepository, memory: Omit<Memory, 'id'>, now: number) {
    if (service.correctMemory === undefined) {
      throw new Error('Memory correction requires a home-coordinated correction capability');
    }
    return service.correctMemory(memory, now);
  }

  async recall(query: RecallQuery): Promise<MemoryResult[]> {
    const service = this.getService();
    const now = this.now();
    const limit = query.limit ?? 10;
    const wantedLayers: MemoryLayer[] = (query.layers ?? [...PERSISTED_LAYERS]).filter(l => l !== 'session');
    if (wantedLayers.length === 0) return [];

    // Over-fetch so post-search filters (layer/context/tags/expiry) don't
    // starve the result set; the memory corpus is small by construction.
    const candidates = await service.searchUnified(query.query, {
      types: ['memory'],
      limit: Math.max(limit * 3, 30),
    });

    const results: MemoryResult[] = [];
    for (const hit of candidates) {
      const m = hit.item as Memory;
      if ((m as { type?: string }).type !== 'memory') continue;
      const layer = (m.layer ?? 'episodic') as MemoryLayer;
      if (!wantedLayers.includes(layer)) continue;
      if (query.context && m.parent_id !== query.context) continue;
      if (query.tags && !query.tags.some(t => m.tags?.includes(t))) continue;
      if (!isMemoryLive(m, now)) continue;

      // Bounded usage multiplier (ADR 0092.9 R-15): reorders, never hides.
      // Applied over the full filtered candidate set BEFORE truncation so
      // the multiplier has room to reorder (Mem0's widened-pool lesson).
      const entry = this.toMemoryEntry(m, now);
      results.push({
        entry,
        score: hit.score * usageFactor(usageSummaryFromEntry(entry), now),
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async forget(filter: ForgetFilter): Promise<number> {
    const service = this.getService();
    const memories = await readEntityCorpus(service, { type: EntityType.Memory });
    const now = this.now();
    const nowIso = new Date(now).toISOString();
    let count = 0;

    for (const entity of memories) {
      const preimage = await readEntityForWrite(service, entity.id);
      if (preimage === undefined || preimage.entity.type !== 'memory') continue;
      const m = preimage.entity as Memory;
      const { expiresAt } = memoryValidity(m.valid_until, now);
      const createdAt = Date.parse(m.created_at);

      // OR semantics across criteria — mirrors InMemoryStore.forget.
      const matches =
        (filter.ids?.includes(m.id)) ||
        (filter.layer && !filter.ids && (m.layer ?? 'episodic') === filter.layer) ||
        (filter.context && m.parent_id === filter.context) ||
        (filter.olderThan !== undefined && createdAt < filter.olderThan) ||
        (filter.expired && expiresAt !== undefined && expiresAt <= now);

      if (!matches) continue;

      if (filter.expired && expiresAt !== undefined && expiresAt <= now) {
        // GC path: already-expired memories are hard-deleted.
        const committed = service.deleteCommitted === undefined
          ? { value: await service.delete(m.id, { expected: preimage }) }
          : await service.deleteCommitted(m.id, { expected: preimage });
        if (committed.value) count++;
      } else if (isMemoryLive(m, now)) {
        // Soft forget: expire now. Viewer keeps the record; recall drops it.
        await saveEntityCommitted(service, { ...m, valid_until: nowIso, updated_at: nowIso } as Entity, { expected: preimage });
        count++;
      }
    }
    return count;
  }

  async size(): Promise<number> {
    const memories = await readEntityCorpus(this.getService(), { type: EntityType.Memory });
    const now = this.now();
    return memories.filter(function live(memory) { return isMemoryLive(memory as Memory, now); }).length;
  }

  /**
   * Mint one read-side memory entry.
   *
   * This is the sole merge point for usage truth. Project stores ignore
   * committed usage frontmatter even when old files still carry it; a missing
   * overlay checkpoint means zero uses. Global stores keep frontmatter.
   */
  toMemoryEntry(memory: Memory, now: number = this.now()): MemoryEntry {
    const usageSummary = this.usageSummaryStore === undefined
      ? undefined
      : this.usageSummaryStore.get(memory.id) ?? { usageCount: 0 };
    return mintMemoryEntry(memory, usageSummary, now);
  }
}

function usageSummaryFromEntry(entry: MemoryEntry): {
  created_at: string;
  usage_count: number;
  last_used_at?: string;
} {
  return {
    created_at: new Date(entry.createdAt).toISOString(),
    ...memoryUsageFieldsFromEntry(entry),
  };
}
