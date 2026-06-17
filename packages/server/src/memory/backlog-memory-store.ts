/**
 * BacklogMemoryStore — the default MemoryStore, backed by the backlog itself
 * (ADR 0092.3 Part 3).
 *
 * Memories are `memory`-substrate entities (MEMO- ids). This adapter
 * implements the ADR 0092 plugin interface (`store`/`recall`/`forget`/`size`)
 * over `IBacklogService`, which means memories inherit everything entities
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

import { EntityType, MemorySchema, nextEntityId, isValidEntityId, type Entity, type Memory } from '@backlog-mcp/shared';
import type { MemoryStore, MemoryEntry, MemoryLayer, RecallQuery, MemoryResult, ForgetFilter } from '@backlog-mcp/memory';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { usageFactor } from './usage-signal.js';

/** Layers this store persists. 'session' is intentionally absent. */
const PERSISTED_LAYERS: readonly MemoryLayer[] = ['episodic', 'semantic', 'procedural'];

export class BacklogMemoryStore implements MemoryStore {
  readonly name = 'backlog';

  /**
   * Service is provided lazily so module-level composer wiring doesn't force
   * service construction at import time (the singleton may not be configured
   * yet when the composer module loads).
   */
  constructor(private readonly getService: () => IBacklogService) {}

  async store(entry: MemoryEntry): Promise<MemoryEntry> {
    if (!PERSISTED_LAYERS.includes(entry.layer)) {
      throw new Error(`BacklogMemoryStore does not persist layer '${entry.layer}' — register a session store for transient memory`);
    }
    const service = this.getService();
    const nowIso = new Date(entry.createdAt || Date.now()).toISOString();
    const id = nextEntityId(await service.getMaxId(EntityType.Memory), EntityType.Memory);

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

    const memory = MemorySchema.parse({
      id,
      type: 'memory',
      title: entry.title.trim(),
      description: entry.content,
      layer: entry.layer,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.context && isValidEntityId(entry.context) ? { parent_id: entry.context } : {}),
      ...(entityRefs && entityRefs.length > 0 ? { entity_refs: entityRefs } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(entry.expiresAt ? { valid_until: new Date(entry.expiresAt).toISOString() } : {}),
      ...(memoryKind ? { kind: memoryKind } : {}),
      ...(stateKey ? { state_key: stateKey } : {}),
      ...(supersedes ? { supersedes } : {}),
      ...(occurredAt ? { occurred_at: occurredAt } : {}),
      ...(derived ? { derived: true } : {}),
      usage_count: typeof meta.usageCount === 'number' ? meta.usageCount : 0,
      created_at: nowIso,
      updated_at: nowIso,
    });

    // ADR-0092.5 R-1/R-2 closing semantics — ADD-only, never destructive:
    //  - supersedes: soft-expire the named predecessor (lineage on the new record).
    //  - state_key: soft-expire every other live holder of the same key.
    if (supersedes) {
      await this.expireMemory(supersedes, nowIso);
    }
    if (stateKey) {
      const all = await service.list({ type: EntityType.Memory });
      for (const m of all) {
        const prev = m as Memory;
        if (prev.id === id || prev.state_key !== stateKey) continue;
        if (prev.valid_until && Date.parse(prev.valid_until) <= Date.now()) continue;
        await service.save({ ...prev, valid_until: nowIso, updated_at: nowIso } as Entity);
      }
    }

    await service.add(memory as Entity);
    return this.toMemoryEntry(memory as Memory);
  }

  /** Soft-expire a memory by id (no-op if missing, not a memory, or already expired). */
  private async expireMemory(id: string, nowIso: string): Promise<void> {
    const service = this.getService();
    const existing = await service.get(id);
    if (!existing || (existing.type as string) !== 'memory') return;
    const m = existing as Memory;
    if (m.valid_until && Date.parse(m.valid_until) <= Date.now()) return;
    await service.save({ ...m, valid_until: nowIso, updated_at: nowIso } as Entity);
  }

  async recall(query: RecallQuery): Promise<MemoryResult[]> {
    const service = this.getService();
    const limit = query.limit ?? 10;
    const wantedLayers: MemoryLayer[] = (query.layers ?? [...PERSISTED_LAYERS]).filter(l => l !== 'session');
    if (wantedLayers.length === 0) return [];

    // Over-fetch so post-search filters (layer/context/tags/expiry) don't
    // starve the result set; the memory corpus is small by construction.
    const candidates = await service.searchUnified(query.query, {
      types: ['memory'],
      limit: Math.max(limit * 3, 30),
    });

    const now = Date.now();
    const results: MemoryResult[] = [];
    for (const hit of candidates) {
      const m = hit.item as Memory;
      if ((m as { type?: string }).type !== 'memory') continue;
      const layer = (m.layer ?? 'episodic') as MemoryLayer;
      if (!wantedLayers.includes(layer)) continue;
      if (query.context && m.parent_id !== query.context) continue;
      if (query.tags && !query.tags.some(t => m.tags?.includes(t))) continue;
      if (m.valid_until && Date.parse(m.valid_until) <= now) continue;

      // Bounded usage multiplier (ADR 0092.9 R-15): reorders, never hides.
      // Applied over the full filtered candidate set BEFORE truncation so
      // the multiplier has room to reorder (Mem0's widened-pool lesson).
      results.push({ entry: this.toMemoryEntry(m), score: hit.score * usageFactor(m, now) });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async forget(filter: ForgetFilter): Promise<number> {
    const service = this.getService();
    const memories = await service.list({ type: EntityType.Memory });
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    let count = 0;

    for (const entity of memories) {
      const m = entity as Memory;
      const expiresAt = m.valid_until ? Date.parse(m.valid_until) : undefined;
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
        if (await service.delete(m.id)) count++;
      } else if (!expiresAt || expiresAt > now) {
        // Soft forget: expire now. Viewer keeps the record; recall drops it.
        await service.save({ ...m, valid_until: nowIso, updated_at: nowIso } as Entity);
        count++;
      }
    }
    return count;
  }

  async size(): Promise<number> {
    const memories = await this.getService().list({ type: EntityType.Memory });
    const now = Date.now();
    return memories.filter(m => {
      const vu = (m as Memory).valid_until;
      return !vu || Date.parse(vu) > now;
    }).length;
  }

  private toMemoryEntry(m: Memory): MemoryEntry {
    return {
      id: m.id,
      title: m.title,
      content: m.description,
      layer: (m.layer ?? 'episodic') as MemoryLayer,
      source: m.source ?? 'unknown',
      ...(m.parent_id ? { context: m.parent_id } : {}),
      ...(m.tags ? { tags: [...m.tags] } : {}),
      createdAt: Date.parse(m.created_at) || 0,
      ...(m.valid_until ? { expiresAt: Date.parse(m.valid_until) } : {}),
      metadata: {
        ...(m.entity_refs?.[0] ? { entity_id: m.entity_refs[0] } : {}),
        ...(m.entity_refs ? { entity_refs: [...m.entity_refs] } : {}),
        ...(m.supersedes ? { supersedes: m.supersedes } : {}),
        ...(m.state_key ? { state_key: m.state_key } : {}),
        ...(m.kind ? { memory_kind: m.kind } : {}),
        ...(m.occurred_at ? { occurred_at: m.occurred_at } : {}),
        ...(m.derived === true ? { derived: true } : {}),
        usageCount: m.usage_count ?? 0,
        ...(m.tags?.includes('completion') ? { kind: 'completion' } : m.tags?.includes('artifact') ? { kind: 'artifact' } : {}),
      },
    };
  }
}
