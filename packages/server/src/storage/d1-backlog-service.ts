/**
 * D1BacklogService — per-request service layer backed by D1StorageAdapter.
 *
 * This is the cloud counterpart of BacklogService (which is a filesystem singleton).
 * Unlike BacklogService, D1BacklogService is NOT a singleton — a new instance is
 * created for each incoming Worker request.
 *
 * ADR-0089 Phase 2: wire up the Cloudflare Worker MCP endpoint.
 * ADR-0089 §8: hybrid search via Workers AI + Vectorize (optional bindings).
 */

import type { Entity, Status, EntityType } from '@backlog-mcp/shared';
import { D1StorageAdapter } from './d1-adapter.js';
import type { IBacklogService } from './service-types.js';

/** Minimal structural interfaces — avoids @cloudflare/workers-types dependency. */
interface CloudflareAI {
  run(model: string, input: { text: string[] }): Promise<{ data: number[][] }>;
}
interface VectorizeMatch {
  id: string;
  score: number;
}
interface CloudflareVectorize {
  upsert(vectors: Array<{ id: string; values: number[] }>): Promise<void>;
  deleteByIds(ids: string[]): Promise<void>;
  query(vector: number[], options: { topK: number }): Promise<{ matches: VectorizeMatch[] }>;
}

/** Workers AI model used for embeddings (384-dim, identical to local MiniLM-L6-v2). */
const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';

export class D1BacklogService implements IBacklogService {
  private storage: D1StorageAdapter;
  private ai?: CloudflareAI;
  private vectorize?: CloudflareVectorize;

  constructor(db: any, ai?: any, vectorize?: any) {
    this.storage = new D1StorageAdapter(db);
    this.ai = ai;
    this.vectorize = vectorize;
  }

  async get(id: string): Promise<Entity | undefined> {
    return this.storage.get(id);
  }

  async getMarkdown(id: string): Promise<string | null> {
    return this.storage.getMarkdown(id);
  }

  async list(filter?: {
    status?: Status[];
    type?: EntityType;
    epic_id?: string;
    parent_id?: string;
    query?: string;
    limit?: number;
  }): Promise<Entity[]> {
    const { query, ...storageFilter } = filter ?? {};
    if (query) {
      return this.storage.search(query, storageFilter.limit);
    }
    return this.storage.list(storageFilter);
  }

  async add(task: Entity): Promise<void> {
    await this.storage.add(task);
    await this.upsertVector(task);
  }

  async save(task: Entity): Promise<void> {
    await this.storage.save(task);
    await this.upsertVector(task);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.storage.delete(id);
    if (deleted) await this.deleteVector(id);
    return deleted;
  }

  async counts(): Promise<{
    total_tasks: number;
    total_epics: number;
    by_status: Record<Status, number>;
    by_type: Record<string, number>;
  }> {
    return this.storage.counts();
  }

  async getMaxId(type?: EntityType): Promise<number> {
    return this.storage.getMaxId(type);
  }

  /**
   * Hybrid search: FTS5 (always) + Vectorize semantic (when AI/Vectorize bound).
   * Results are fused via linear combination of normalised scores, then resolved
   * to full Entity objects. Degrades gracefully to FTS5-only if bindings absent.
   */
  async searchUnified(
    query: string,
    options?: { types?: Array<'task' | 'epic' | 'resource'>; status?: Status[]; parent_id?: string; sort?: string; limit?: number },
  ): Promise<Array<{ item: Entity | any; score: number; type: 'task' | 'epic' | 'resource'; snippet?: any }>> {
    const limit = options?.limit ?? 20;
    const fetchN = limit * 2; // over-fetch for fusion headroom

    // ── FTS5 results ──────────────────────────────────────────────────────────
    const ftsEntities = await this.storage.search(query, fetchN);
    // Normalise FTS5 scores: rank by position (1.0 → top, descending)
    const ftsMap = new Map<string, { entity: Entity; score: number }>();
    ftsEntities.forEach((entity, i) => {
      ftsMap.set(entity.id, { entity, score: 1 - i / Math.max(ftsEntities.length, 1) });
    });

    // ── Vectorize results (optional) ──────────────────────────────────────────
    const vectorMap = new Map<string, number>();
    if (this.ai && this.vectorize) {
      try {
        const { data } = await this.ai.run(EMBEDDING_MODEL, { text: [query] });
        const queryVec = data[0];
        if (queryVec) {
          const { matches } = await this.vectorize.query(queryVec, { topK: fetchN });
          for (const m of matches) vectorMap.set(m.id, m.score);
        }
      } catch {
        // Degrade gracefully to FTS5-only; Vectorize errors don't break search
      }
    }

    // ── Score fusion ─────────────────────────────────────────────────────────
    // Equal weighting: 0.5 FTS5 + 0.5 vector. IDs in only one set get 0 for the other.
    const allIds = new Set([...ftsMap.keys(), ...vectorMap.keys()]);
    const fused: Array<{ id: string; score: number }> = [];
    for (const id of allIds) {
      const ftsScore = ftsMap.get(id)?.score ?? 0;
      const vecScore = vectorMap.get(id) ?? 0;
      fused.push({ id, score: 0.5 * ftsScore + 0.5 * vecScore });
    }
    fused.sort((a, b) => b.score - a.score);

    // ── Resolve entities and apply post-filters ───────────────────────────────
    const results: Array<{ item: Entity; score: number; type: 'task' | 'epic' | 'resource' }> = [];
    for (const { id, score } of fused) {
      if (results.length >= limit) break;
      const entity = ftsMap.get(id)?.entity ?? await this.storage.get(id);
      if (!entity) continue;
      if (options?.status && !options.status.includes(entity.status as Status)) continue;
      if (options?.parent_id && (entity.parent_id ?? entity.epic_id) !== options.parent_id) continue;
      const type = entity.type === 'epic' ? 'epic' : 'task';
      if (options?.types && !options.types.includes(type)) continue;
      results.push({ item: entity, score, type });
    }

    return results;
  }

  // ── Vector helpers ─────────────────────────────────────────────────────────

  /** Embed task text and upsert into Vectorize. No-op if bindings absent. */
  private async upsertVector(task: Entity): Promise<void> {
    if (!this.ai || !this.vectorize) return;
    try {
      const text = [task.title, task.description].filter(Boolean).join(' ');
      const { data } = await this.ai.run(EMBEDDING_MODEL, { text: [text] });
      const vector = data[0];
      if (vector) await this.vectorize.upsert([{ id: task.id, values: vector }]);
    } catch {
      // Non-fatal: write already committed to D1; vector will be stale until next save
    }
  }

  /** Remove vector from Vectorize index. No-op if binding absent. */
  private async deleteVector(id: string): Promise<void> {
    if (!this.vectorize) return;
    try {
      await this.vectorize.deleteByIds([id]);
    } catch {
      // Non-fatal
    }
  }
}
