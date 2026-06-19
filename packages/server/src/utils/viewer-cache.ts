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
 * Legacy esbuild content-hash suffix: a `-` followed by an 8-char RFC-4648
 * base32 hash (`A–Z`, `2–7`) and the file extension. Kept as a secondary match
 * for any esbuild-era output; the primary signal is now the Vite `assets/` dir.
 */
const CONTENT_HASH_SUFFIX = /-[A-Z2-7]{8}\.[a-z0-9]+$/;

/**
 * Vite (ADR 0110) emits EVERY content-hashed bundle asset under `assets/`
 * (`build.assetsDir`). Matching the directory is hash-format-agnostic — it does
 * not depend on Rollup's hash alphabet — and the only stable-URL files
 * (`index.html`, `public/` assets like `logo.svg`) live at the root, never
 * under `assets/`. So a file served from an `assets/` segment is content-
 * addressed and safe to cache immutably.
 */
const VITE_ASSETS_DIR = /(^|\/)assets\/[^/]+$/;

/**
 * True when a filename/path is a content-addressed asset — i.e. its URL is
 * content-addressed and safe to cache immutably. Matches Vite `assets/*` output
 * (primary) or a legacy esbuild base32 suffix (secondary).
 */
export function isContentHashedAsset(path: string): boolean {
  return VITE_ASSETS_DIR.test(path) || CONTENT_HASH_SUFFIX.test(path);
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
