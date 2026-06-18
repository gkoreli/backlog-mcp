/**
 * Cache policy for viewer static assets, so a plain browser refresh always
 * picks up a freshly published version (no hard-refresh needed). See ADR 0108.
 *
 * Two asset classes, distinguished purely by the filename:
 * - Content-hashed (`<name>-<hash>.<ext>`, e.g. `main-3LFQHTR2.js`): the URL is
 *   content-addressed — it changes iff the bytes change — so it is cached
 *   forever (`immutable`).
 * - Unhashed, stable URL (`index.html`): its content changes across releases at
 *   the same URL, so it is served `no-cache` — "store, but revalidate before
 *   every use" (≠ `no-store`). It is the single small file ever revalidated.
 *
 * Without this, `serveStatic` sets no `Cache-Control` and browsers fall back to
 * heuristic caching, serving a stale `main.js` across server restarts.
 */

/** Minimal surface of the Hono context used to set a response header. */
interface HeaderSink {
  header: (name: string, value: string) => void;
}

/** Conventional "cache forever" horizon for immutable, content-addressed assets. */
const ONE_YEAR_SECONDS = 31_536_000;

/** The two cache policies this module assigns. Exposed for callers and tests. */
export const CacheControl = {
  /** Content-addressed → safe to cache forever; never revalidated. */
  IMMUTABLE: `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
  /** Stable URL, mutable content → revalidate on every load (no staleness window). */
  REVALIDATE: 'no-cache',
} as const;

/**
 * esbuild content-hash suffix: a `-` followed by an 8-char RFC-4648 base32 hash
 * (`A–Z`, `2–7` — never `0/1/8/9`) and the file extension at end-of-string.
 * Verified against real outputs: `main-3LFQHTR2.js`, `main-ZBGT667E.css`,
 * `chunk-5RM6L4X6.js`, `architecture-7HQA4BMR-VEV3UYQT.js`.
 */
const CONTENT_HASH_SUFFIX = /-[A-Z2-7]{8}\.[a-z0-9]+$/;

/**
 * True when a filename carries an esbuild content hash — i.e. its URL is
 * content-addressed and safe to cache immutably.
 */
export function isContentHashedAsset(path: string): boolean {
  return CONTENT_HASH_SUFFIX.test(path);
}

/**
 * Resolve the `Cache-Control` value for a viewer asset path.
 *
 * FAIL-SAFE INVARIANT: only recognized content-hashed assets are cached
 * immutably; everything else — `index.html` and any unrecognized or
 * future-format name — falls through to `REVALIDATE`. So a misclassification
 * can only cost a re-validation (a perf cost), never serve a mutable asset as
 * immutable (the stale-bug direction). The only stable-URL viewer file is
 * `index.html`, which has no hash and thus can never match.
 */
export function viewerCacheControl(path: string): string {
  return isContentHashedAsset(path) ? CacheControl.IMMUTABLE : CacheControl.REVALIDATE;
}

/** `serveStatic({ onFound })` hook — applies the cache policy to each asset. */
export function setViewerCacheHeaders(path: string, c: HeaderSink): void {
  c.header('Cache-Control', viewerCacheControl(path));
}
