/**
 * The Desk's shared timestamp parse point (review 0001, determinism).
 *
 * Identical store bytes must yield identical Desk membership and ordering
 * on every host. `Date.parse()` interprets offset-less datetimes
 * ("2026-07-10T12:30:00") in the host timezone, so the same document
 * would change age — and READ-window membership — between a UTC host and
 * an Asia/Tokyo host. Offset-less datetimes are therefore declared UTC
 * here, once, rather than at every call site.
 */

/** Date + time with no trailing offset (no `Z`, no `±hh:mm`). */
const OFFSETLESS_DATETIME =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/u;

/**
 * Parse an ISO-ish timestamp to epoch milliseconds, treating offset-less
 * datetimes as UTC. Returns NaN exactly where `Date.parse` would.
 */
export function parseTimestampUtc(value: string): number {
  const trimmed = value.trim();
  return Date.parse(
    OFFSETLESS_DATETIME.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed,
  );
}
