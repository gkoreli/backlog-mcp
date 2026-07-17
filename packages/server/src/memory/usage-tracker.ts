/**
 * Memory usage tracker (ADR 0092.9 R-13/R-14/R-16).
 *
 * Two-tier recording, after the relatime/lazytime precedent:
 *
 *  1. **JSONL audit log** (injected appender — node IO stays at the edge):
 *     every event is appended — recall demand lines (query + returned ids;
 *     the signal ADR 0092.7 deferred), expands, cites. Append-only,
 *     greppable, replayable: `usage_count` can be rebuilt from it.
 *  2. **Durable summary** (`usage_count`, `last_used_at`): global mode keeps
 *     frontmatter; project mode injects a local overlay. Both update only on
 *     STRONG events (expand/cite — Fine-Mem's performance credit), and flush
 *     relatime-gated: when the new count lands on a Fibonacci bucket boundary,
 *     or the stored `last_used_at` is >24h stale, or was never set. Per-read
 *     file rewrites (strictatime) are deliberately avoided; the JSONL holds
 *     exact history.
 *
 * Failures never propagate — usage tracking is a derived signal, not an
 * outcome (same posture as capture, ADR 0092.2 §D7).
 */

import type { Memory, Entity } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { MemoryUsageSummaryStore } from './memory-usage.contract.js';
import type { RetrievalTelemetry } from './retrieval-telemetry.js';

/** Fibonacci flush buckets — diminishing flush frequency as counts grow. */
const FLUSH_BUCKETS = new Set([1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]);
const STALE_FLUSH_MS = 24 * 60 * 60 * 1000;  // relatime's 24h gate
const COUNT_CAP = 255;                        // saturating storage cap

const MEMO_ID_PATTERN = /\bMEMO-\d{4,}\b/g;

/** Extract unique MEMO- ids referenced in a text (citation detection, R-14). */
export function extractMemoCitations(text: string): string[] {
  return [...new Set(text.match(MEMO_ID_PATTERN) ?? [])];
}

export interface UsageTrackerDeps {
  getService: () => IBacklogService;
  /** Append one line to the usage JSONL. Omit to disable the audit log. */
  appendLine?: (line: string) => void;
  /** Project-home summary overlay. Omit to keep global frontmatter writes. */
  summaryStore?: MemoryUsageSummaryStore;
  /**
   * Tier-1 retrieval telemetry sink (ADR 0121 R7 / B18): session-stamped
   * recall/search/expand events including recall misses. Omit to disable.
   */
  telemetry?: RetrievalTelemetry;
  now?: () => number;
}

export class MemoryUsageTracker {
  constructor(private readonly deps: UsageTrackerDeps) {}

  /** Log recall demand (R-16). Weak signal — JSONL only, no counter bump. */
  recordRecall(query: string, returnedIds: string[]): void {
    // Tier-1 telemetry fires BEFORE the empty guard (ADR 0121 R7): a
    // zero-id recall is the first-class miss event — exactly the case the
    // overlay line below has always skipped. No query text on the event.
    this.deps.telemetry?.record('recall', returnedIds);
    if (returnedIds.length === 0) return;
    this.append({ type: 'recall', query, ids: returnedIds });
  }

  /**
   * Log search demand as returned ids only (ADR 0121 R7 Tier 1). No
   * overlay line and no counter bump — query-text search-demand logging
   * is Tier 2, gated separately and deliberately not built here.
   */
  recordSearch(returnedIds: string[]): void {
    this.deps.telemetry?.record('search', returnedIds);
  }

  /** Strong signal: the agent expanded a recalled stub via backlog_get. */
  async recordExpand(id: string): Promise<void> {
    if (!id.startsWith('MEMO-')) return;
    this.deps.telemetry?.record('expand', [id]);
    this.append({ type: 'expand', id });
    await this.bump(id);
  }

  /** Strong signal: MEMO- ids cited in newly written content/refs. */
  async recordCitations(texts: Array<string | undefined>, extraIds: string[] = []): Promise<void> {
    const ids = new Set<string>(extraIds.filter(id => id.startsWith('MEMO-')));
    for (const text of texts) {
      if (!text) continue;
      for (const id of extractMemoCitations(text)) ids.add(id);
    }
    if (ids.size === 0) return;
    this.append({ type: 'cite', ids: [...ids] });
    for (const id of ids) await this.bump(id);
  }

  // ── internals ────────────────────────────────────────────────────

  private append(event: Record<string, unknown>): void {
    try {
      this.deps.appendLine?.(JSON.stringify({ ts: new Date(this.now()).toISOString(), ...event }));
    } catch { /* audit log is best-effort */ }
  }

  /**
   * Increment the durable summary, relatime-gated. Non-flushed increments
   * are intentionally lossy — the JSONL has the exact history.
   */
  private async bump(id: string): Promise<void> {
    try {
      const service = this.deps.getService();
      const entity = await service.get(id);
      if (!entity || (entity.type as string) !== 'memory') return;
      const m = entity as Memory;
      const summaryStore = this.deps.summaryStore;
      const summary = summaryStore?.get(id);

      const currentCount = summaryStore === undefined
        ? m.usage_count ?? 0
        : summary?.usageCount ?? 0;
      const lastUsedAt = summaryStore === undefined
        ? m.last_used_at
        : summary?.lastUsedAt;
      const newCount = Math.min(currentCount + 1, COUNT_CAP);
      const lastFlushed = lastUsedAt ? Date.parse(lastUsedAt) : NaN;
      const stale = Number.isNaN(lastFlushed) || this.now() - lastFlushed > STALE_FLUSH_MS;

      if (FLUSH_BUCKETS.has(newCount) || stale) {
        const nowIso = new Date(this.now()).toISOString();
        if (summaryStore !== undefined) {
          summaryStore.set(id, {
            usageCount: newCount,
            lastUsedAt: nowIso,
          });
          return;
        }
        await service.save({ ...m, usage_count: newCount, last_used_at: nowIso, updated_at: nowIso } as Entity);
      }
    } catch { /* derived signal — never propagate */ }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
