/**
 * Cache policy for viewer static assets, so a plain browser refresh always
 * picks up a freshly published version (no hard-refresh needed).
 *
 * - Content-hashed assets (esbuild `[name]-[hash].ext`, e.g. `chunk-5RM6L4X6.js`)
 *   are immutable: their URL changes whenever their bytes change, so they are
 *   safe to cache forever.
 * - Unhashed entry assets keep a STABLE url while their content changes across
 *   releases (`index.html`, `main.js`, `main.css`, `logo.svg`). They are served
 *   `no-cache` — "you may store it, but revalidate before every use" — so a
 *   normal reload re-fetches the new bundle the moment a new version ships.
 *   (`no-cache` ≠ "don't cache"; that's `no-store`. There is no staleness
 *   window — the browser checks the server on every load.)
 *
 * Without this, `serveStatic` sets no `Cache-Control` and browsers fall back to
 * heuristic caching, serving a stale `main.js` across server restarts.
 */

/** Minimal surface of the Hono context used to set a response header. */
interface HeaderSink {
  header: (name: string, value: string) => void;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

/**
 * True when a filename carries an esbuild content hash (`-XXXXXXXX.ext`),
 * meaning the URL is content-addressed and safe to cache forever.
 */
export function isContentHashedAsset(path: string): boolean {
  return /-[A-Z0-9]{8}\.[a-z0-9]+$/i.test(path);
}

/** Resolve the `Cache-Control` value for a viewer asset path. */
export function viewerCacheControl(path: string): string {
  return isContentHashedAsset(path) ? IMMUTABLE : REVALIDATE;
}

/** `serveStatic({ onFound })` hook — applies the cache policy to each asset. */
export function setViewerCacheHeaders(path: string, c: HeaderSink): void {
  c.header('Cache-Control', viewerCacheControl(path));
}
