/**
 * Recall — query the episodic memory corpus (ADR 0092.2 §D8).
 *
 * Thin delegator to `MemoryComposer.recall`. Keeps the core API shape
 * consistent with `search` so transport adapters have one mental model:
 * take params, call core, format for output.
 *
 * Composer is optional per ADR 0092.2 §D3 — if none is wired (e.g. on
 * the Worker), recall returns an empty result set rather than failing.
 * "No memory" isn't an error; it's just empty memory.
 */

import type { MemoryComposer, MemoryEntry } from '@backlog-mcp/memory';
import { ValidationError, type RecallParams, type RecallResult, type RecallItem } from './types.js';

// ADR-0092.3: recall defaults to all persisted layers — an agent asking
// "how do we deploy?" wants the procedural answer, not just episodes.
const DEFAULT_LAYERS = ['episodic', 'semantic', 'procedural'] as const;

export interface RecallDeps {
  /**
   * Episodic memory composer. Transport adapters pass in the one from
   * their WriteContext (Node bootstrap) or omit it (Worker).
   */
  memoryComposer?: MemoryComposer;
}

export async function recall(params: RecallParams, deps: RecallDeps): Promise<RecallResult> {
  const query = (params.query ?? '').trim();
  if (!query) {
    throw new ValidationError('query is required');
  }

  if (!deps.memoryComposer) {
    return { items: [], total: 0, query };
  }

  const recallQuery = {
    query,
    layers: params.layers ?? [...DEFAULT_LAYERS],
    ...(params.context !== undefined ? { context: params.context } : {}),
    ...(params.tags !== undefined ? { tags: params.tags } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
  };

  const results = await deps.memoryComposer.recall(recallQuery);

  const full = params.full === true;
  const now = Date.now();
  const items: RecallItem[] = results.map(r => toRecallItem(r.entry, r.score, full, now));

  // Token-budget packing (ADR-0092.5 R-5, after Hindsight): greedily include
  // items until the budget is exhausted. chars/4 is the standard heuristic.
  if (params.token_budget !== undefined && params.token_budget > 0) {
    const packed: RecallItem[] = [];
    let used = 0;
    for (const item of items) {
      const cost = Math.ceil(JSON.stringify(item).length / 4);
      if (packed.length > 0 && used + cost > params.token_budget) break;
      packed.push(item);
      used += cost;
      if (used >= params.token_budget) break;
    }
    return { items: packed, total: packed.length, query, ...(packed.length < items.length ? { truncated: true } : {}) };
  }

  return { items, total: items.length, query };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Build a provenance-bearing recall stub (ADR 0115 R-1).
 *
 * Every stub carries the cheap authority signals the substrate already
 * stores — age on the knowledge's own timeline (occurred_at ?? created_at),
 * usage (uses / idle_days, ADR 0092.9), and lineage (supersedes / derived) —
 * so a consumer can weigh trust without hydrating.
 */
function toRecallItem(entry: MemoryEntry, score: number, full: boolean, now: number): RecallItem {
  const meta = entry.metadata ?? {};
  const occurredAt = typeof meta.occurred_at === 'string' ? Date.parse(meta.occurred_at) : NaN;
  const anchor = Number.isNaN(occurredAt) ? entry.createdAt : occurredAt;
  const uses = typeof meta.usageCount === 'number' ? meta.usageCount : 0;

  const item: RecallItem = {
    id: entry.id,
    // Stores mint titles (substrate requires one), but transient stores may
    // not — fall back to the digest rather than surfacing "undefined".
    title: entry.title ?? digestOf(entry.content),
    digest: digestOf(entry.content),
    layer: entry.layer,
    source: entry.source,
    score,
    age_days: Math.max(0, Math.floor((now - anchor) / MS_PER_DAY)),
    uses,
  };
  if (full) item.content = entry.content;
  if (entry.context !== undefined) item.context = entry.context;
  if (entry.tags !== undefined) item.tags = entry.tags;
  if (uses > 0 && typeof meta.last_used_at === 'string') {
    const lastUsed = Date.parse(meta.last_used_at);
    if (!Number.isNaN(lastUsed)) {
      item.idle_days = Math.max(0, Math.floor((now - lastUsed) / MS_PER_DAY));
    }
  }
  if (typeof meta.supersedes === 'string') item.supersedes = meta.supersedes;
  if (meta.derived === true) item.derived = true;
  if (typeof meta.entity_id === 'string') item.entity_id = meta.entity_id;
  // Temporal kind (current/historical/plan/preference/timeless) is the
  // trust-relevant one; capture kind (completion/artifact) is the fallback
  // for implicit captures that carry no temporal kind.
  if (typeof meta.memory_kind === 'string') item.kind = meta.memory_kind;
  else if (typeof meta.kind === 'string') item.kind = meta.kind;
  return item;
}

/** One-line digest: first non-empty line, ≤160 chars. */
function digestOf(content: string): string {
  const firstLine = content.split('\n').find(l => l.trim()) ?? '';
  const line = firstLine.trim().replace(/^#+\s*/, '');
  return line.length > 160 ? line.slice(0, 159) + '…' : line;
}
