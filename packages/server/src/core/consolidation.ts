/**
 * Consolidation candidates — Phase D of the agentic memory initiative
 * (ADR 0092.7, implementing ADR 0092.5 R-10).
 *
 * The server's half of consolidation: a deterministic, read-only computation
 * that clusters live, non-derived episodic memories into candidate bundles
 * for an EXTERNAL consolidator agent to distill. The other half — judgment,
 * narrative synthesis — happens in the agent via backlog_remember
 * (derived: true) + backlog_forget. No LLM here, no stored state: bundles
 * are recomputed on demand (ADR 0097: the store doesn't act).
 *
 * Bucketing (D2): key precedence is the memory's context (parent_id), else
 * its first entity_ref, else "unscoped". Ripeness: count ≥ min_count AND the
 * oldest member is at least min_age_days old — young bundles may still be
 * accumulating their story.
 */

import type { Entity, Memory } from '@backlog-mcp/shared';
import { EntityType } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import {
  ValidationError,
  type ConsolidationParams,
  type ConsolidationBundle,
  type ConsolidationCandidatesResult,
} from './types.js';

const DEFAULT_MIN_COUNT = 3;
const DEFAULT_MIN_AGE_DAYS = 7;
const DEFAULT_MIN_DEMAND = 3;
const DEFAULT_DEMAND_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_DIGESTS = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Injected IO (ADR 0090 pattern) — Node reads the usage JSONL; Worker omits. */
export interface ConsolidationDeps {
  /** Raw lines of memory-usage.jsonl (ADR 0092.9 R-16). Absent → demand 0. */
  readUsageLines?: () => string[];
}

/**
 * Fold recall-demand events from usage-JSONL lines (ADR 0092.12).
 * Returns recall-event count per MEMO- id within the window. Pure;
 * malformed lines are skipped — the log is best-effort by design.
 */
export function demandCounts(
  lines: string[],
  opts: { windowDays?: number; now?: number } = {},
): Map<string, number> {
  const now = opts.now ?? Date.now();
  const windowMs = (opts.windowDays ?? DEFAULT_DEMAND_WINDOW_DAYS) * MS_PER_DAY;
  const counts = new Map<string, number>();
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as { ts?: string; type?: string; ids?: unknown };
      if (event.type !== 'recall' || !Array.isArray(event.ids)) continue;
      const ts = event.ts ? Date.parse(event.ts) : NaN;
      if (Number.isNaN(ts) || now - ts > windowMs) continue;
      for (const id of event.ids) {
        if (typeof id === 'string') counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    } catch { /* skip malformed lines */ }
  }
  return counts;
}

/** A memory that qualifies as consolidation input. */
function isConsolidatableEpisodic(m: Memory, now: number): boolean {
  if ((m.layer ?? 'episodic') !== 'episodic') return false;
  if (m.derived === true) return false;                               // inference is not re-consolidated
  if (m.valid_until && Date.parse(m.valid_until) <= now) return false; // retired/expired
  return true;
}

/** Bucket key precedence: context → first entity_ref → unscoped (D2). */
function bucketKeyOf(m: Memory): string {
  if (m.parent_id) return `context:${m.parent_id}`;
  if (m.entity_refs?.[0]) return `entity:${m.entity_refs[0]}`;
  return 'unscoped';
}

/**
 * Pure bucketing + ripeness over a pre-filtered episodic set.
 * Exported for unit tests; transports should call consolidationCandidates.
 */
export function bucketEpisodics(
  episodics: Memory[],
  opts: {
    minCount: number; minAgeDays: number; maxDigests: number; now?: number;
    /** Recall-demand per MEMO- id (ADR 0092.12). Absent → demand 0. */
    demand?: Map<string, number>;
    /** Demand threshold for the age-OR-demand ripeness gate. */
    minDemand?: number;
  },
): ConsolidationBundle[] {
  const now = opts.now ?? Date.now();
  const buckets = new Map<string, Memory[]>();
  for (const m of episodics) {
    const key = bucketKeyOf(m);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(m);
    else buckets.set(key, [m]);
  }

  const bundles: ConsolidationBundle[] = [];
  for (const [key, members] of buckets) {
    members.sort((a, b) => a.created_at.localeCompare(b.created_at));  // oldest first
    const first = members[0];
    const last = members[members.length - 1];
    if (!first || !last) continue;

    const oldestAgeDays = (now - Date.parse(first.created_at)) / MS_PER_DAY;
    const refs = new Set<string>();
    for (const m of members) for (const r of m.entity_refs ?? []) refs.add(r);

    // Demand (ADR 0092.12): recall events that returned ≥1 member. Summing
    // per-member counts would double-count one recall touching 3 members,
    // but the JSONL fold is per-event-per-id, so the max member count is
    // the closest deterministic event-level proxy without re-reading lines.
    const demand = opts.demand
      ? Math.max(0, ...members.map(m => opts.demand?.get(m.id) ?? 0))
      : 0;

    // Ripe = enough members AND (aged OR in demand) — being asked about IS
    // the maturity signal (Hindsight: frequent recall themes are the
    // strongest mental-model candidates; ADR 0092.5 §4b).
    const ripe = members.length >= opts.minCount &&
      (oldestAgeDays >= opts.minAgeDays || demand >= (opts.minDemand ?? DEFAULT_MIN_DEMAND));

    const context = first.parent_id;
    bundles.push({
      key,
      ...(context ? { context } : {}),
      member_ids: members.map(m => m.id),
      digests: members.slice(0, opts.maxDigests).map(m => m.title),
      entity_refs: [...refs],
      count: members.length,
      demand,
      oldest_created_at: first.created_at,
      newest_created_at: last.created_at,
      ripe,
    });
  }

  // Ripe first, then demand (the strongest signal), then size, then key.
  bundles.sort((a, b) => {
    if (a.ripe !== b.ripe) return a.ripe ? -1 : 1;
    if (a.demand !== b.demand) return b.demand - a.demand;
    if (a.count !== b.count) return b.count - a.count;
    return a.key.localeCompare(b.key);
  });
  return bundles;
}

/**
 * Compute consolidation candidate bundles from the live memory corpus.
 * Read-only; safe to call from any transport.
 */
export async function consolidationCandidates(
  service: IBacklogService,
  params: ConsolidationParams = {},
  deps: ConsolidationDeps = {},
): Promise<ConsolidationCandidatesResult> {
  const minCount = params.min_count ?? DEFAULT_MIN_COUNT;
  const minAgeDays = params.min_age_days ?? DEFAULT_MIN_AGE_DAYS;
  const minDemand = params.min_demand ?? DEFAULT_MIN_DEMAND;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const maxDigests = params.max_digests ?? DEFAULT_MAX_DIGESTS;

  if (minCount < 1) throw new ValidationError('min_count must be ≥ 1');
  if (minAgeDays < 0) throw new ValidationError('min_age_days must be ≥ 0');

  const now = Date.now();
  const demand = demandCounts(deps.readUsageLines?.() ?? [], { now });
  const all = await service.list({ type: EntityType.Memory });
  const episodics = all
    .map(e => e as Entity as Memory)
    .filter(m => isConsolidatableEpisodic(m, now))
    .filter(m => params.context === undefined || m.parent_id === params.context);

  const bundles = bucketEpisodics(episodics, { minCount, minAgeDays, maxDigests, now, demand, minDemand });

  return {
    bundles: bundles.slice(0, limit),
    total_episodic: episodics.length,
    ripe_count: bundles.filter(b => b.ripe).length,
    params: { min_count: minCount, min_age_days: minAgeDays, min_demand: minDemand, limit },
  };
}
