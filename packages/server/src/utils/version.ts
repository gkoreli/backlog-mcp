/**
 * Semantic-version comparison utilities.
 *
 * Lives in `utils/` (not `cli/`) because both the CLI bridge's upgrade check
 * (`ensureServer`) and the server's port-collision resolver depend on it — a
 * shared comparator must not force a `server → cli` layering dependency.
 */

/**
 * Returns true when `a` is strictly older than `b`.
 *
 * Tolerant of non-numeric/odd segments (treated as 0) so a malformed version
 * never triggers a spurious downgrade. Pre-release tags are ignored (compared
 * on the numeric core only) — sufficient for our x.y.z scheme.
 */
export function isOlderVersion(a: string, b: string): boolean {
  const parse = (v: string): number[] =>
    (v.split('-')[0] ?? '').split('.').map(n => Number.parseInt(n, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai !== bi) return ai < bi;
  }
  return false; // equal
}

/**
 * Decode the `/version` response body into a bare version string.
 *
 * The endpoint is served via Hono `c.json(version)`, so the body is a
 * JSON-encoded string (`"0.53.3"`, *with* quotes). Feeding the quoted form
 * straight into {@link isOlderVersion} mis-parses the major segment (`"1` →
 * NaN → 0), which at a major-version boundary would make a newer incumbent
 * look older and trigger a wrong takeover. Parse the JSON; tolerate plain
 * text or stray quotes as a fallback.
 */
export function parseVersionResponse(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'string' ? parsed : String(parsed);
  } catch {
    return trimmed.replace(/^"+|"+$/g, '');
  }
}
