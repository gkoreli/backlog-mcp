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

import type { MemoryComposer } from '@backlog-mcp/memory';
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
  const items: RecallItem[] = results.map(r => {
    const meta = r.entry.metadata ?? {};
    const item: RecallItem = {
      id: r.entry.id,
      digest: digestOf(r.entry.content),
      layer: r.entry.layer,
      source: r.entry.source,
      created_at: new Date(r.entry.createdAt).toISOString(),
      score: r.score,
    };
    if (full) item.content = r.entry.content;
    if (r.entry.context !== undefined) item.context = r.entry.context;
    if (r.entry.tags !== undefined) item.tags = r.entry.tags;
    if (typeof meta.entity_id === 'string') item.entity_id = meta.entity_id;
    if (typeof meta.kind === 'string') item.kind = meta.kind;
    return item;
  });

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

/** One-line digest: first non-empty line, ≤160 chars. */
function digestOf(content: string): string {
  const firstLine = content.split('\n').find(l => l.trim()) ?? '';
  const line = firstLine.trim().replace(/^#+\s*/, '');
  return line.length > 160 ? line.slice(0, 159) + '…' : line;
}
