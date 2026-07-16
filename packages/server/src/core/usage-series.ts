/**
 * Usage series — Phase E observability (ADR 0092.14, implementing ADR
 * 0092.9 R-13..R-16 made visible).
 *
 * A pure fold over the usage JSONL (`memory-usage.jsonl`) into a per-day
 * count of events that TOUCHED a given memory — recall (returned it),
 * expand (opened it), cite (referenced it). The viewer renders the array
 * as a sparkline: the strong/weak usage history 0092.9 records, finally
 * legible per the north star's human-visibility half.
 *
 * Deterministic and replayable; malformed lines are skipped (the log is
 * best-effort by design). No counters, no state — the JSONL is the source.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;

interface UsageEvent {
  ts?: string;
  type?: string;
  id?: unknown;
  ids?: unknown;
}

/** Does this event reference `id` (as a scalar `id` or within `ids[]`)? */
function touches(event: UsageEvent, id: string): boolean {
  if (event.id === id) return true;
  return Array.isArray(event.ids) && event.ids.includes(id);
}

/**
 * Per-day counts of events touching `id`, oldest bucket first, newest last
 * (left→right sparkline). Length === windowDays. Bucket k counts events in
 * the 24h window [now-(windowDays-k)*day, now-(windowDays-1-k)*day).
 */
export function usageSeries(
  lines: string[],
  id: string,
  opts: { windowDays?: number; now?: number } = {},
): number[] {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = opts.now ?? Date.now();
  const buckets = new Array<number>(windowDays).fill(0);

  for (const line of lines) {
    let event: UsageEvent;
    try {
      event = JSON.parse(line) as UsageEvent;
    } catch {
      continue; // skip malformed lines
    }
    if (event.type === 'usage_summary') continue;
    if (!touches(event, id)) continue;
    const ts = event.ts ? Date.parse(event.ts) : NaN;
    if (Number.isNaN(ts)) continue;
    const dayIndex = Math.floor((now - ts) / MS_PER_DAY); // 0 = most recent day
    if (dayIndex < 0 || dayIndex >= windowDays) continue;
    buckets[windowDays - 1 - dayIndex]! += 1;
  }
  return buckets;
}

/** True when a series has any activity — lets callers omit empty sparklines. */
export function hasUsage(series: number[]): boolean {
  return series.some(n => n > 0);
}
