/**
 * Usage signal — the bounded recall-ranking multiplier (ADR 0092.9 R-15).
 *
 * Pure function over a memory's durable usage summary (usage_count +
 * last_used_at frontmatter). Mem0's multiplier contract, adapted:
 *
 *  - Grace period: memories younger than 14 days are NEUTRAL (1.0) — they
 *    haven't had a chance to earn usage (mem0 issue #5330's grace period).
 *  - Otherwise: factor = 0.3 + 1.2 · (min(count, 8)/8) · 2^(−daysIdle/30),
 *    clamped to [0.3, 1.5]. Saturating count (Postgres clock-sweep caps at
 *    5, Redis LFU at 8 bits — repetition has diminishing returns); idle
 *    usage decays with a 30-day half-life (MemoryBank's spacing effect in
 *    our pipeline's vocabulary).
 *  - Reorders, never hides: the floor is 0.3, not 0 — the consensus
 *    position across Mem0 (0.3×), Hindsight (±10%), Generative Agents
 *    (normalized weighted sum).
 */

export const USAGE_GRACE_DAYS = 14;
export const USAGE_FLOOR = 0.3;
export const USAGE_CEIL = 1.5;
export const USAGE_SATURATION = 8;
export const USAGE_IDLE_HALF_LIFE_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface UsageSummary {
  created_at: string;
  usage_count?: number;
  last_used_at?: string;
}

/** Compute the bounded usage multiplier for one memory. */
export function usageFactor(memory: UsageSummary, now: number = Date.now()): number {
  const created = Date.parse(memory.created_at);
  if (Number.isNaN(created) || now - created < USAGE_GRACE_DAYS * MS_PER_DAY) {
    return 1.0;  // grace: too young to judge
  }

  const count = Math.min(memory.usage_count ?? 0, USAGE_SATURATION);
  if (count === 0 || !memory.last_used_at) return USAGE_FLOOR;

  const lastUsed = Date.parse(memory.last_used_at);
  if (Number.isNaN(lastUsed)) return USAGE_FLOOR;

  const idleDays = Math.max(0, (now - lastUsed) / MS_PER_DAY);
  const recency = Math.pow(2, -idleDays / USAGE_IDLE_HALF_LIFE_DAYS);
  const factor = USAGE_FLOOR + (USAGE_CEIL - USAGE_FLOOR) * (count / USAGE_SATURATION) * recency;
  return Math.min(USAGE_CEIL, Math.max(USAGE_FLOOR, factor));
}
