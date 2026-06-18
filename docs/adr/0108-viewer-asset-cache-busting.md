# 0108. Content-Hashed Viewer Assets — Cache-Busting for Zero-Stale Releases

**Date**: 2026-06-18
**Status**: Proposed — design-first; implementation pending sign-off
**Triggered by**: After publishing a viewer fix (the nisli mount-time leak, ADR 0008.1 in the framework repo), the browser kept rendering the old UI across server restarts until a hard-refresh
**Relates to**: [0104. Local-First Deployment Posture](./0104-local-first-deployment-posture.md)

## Problem Statement

A correct, published fix did not reach users on a normal page reload. The
framework bug (activity-panel scroll reset) was fixed, `@nisli/core@0.48.2`
released, the viewer rebuilt, `backlog-mcp@0.53.2` published via CI, and the
server restarted to `0.53.2`. The UI still showed the old, broken behavior.
Only a hard-refresh (Cmd+Shift+R) revealed the fix.

Every link in the deploy chain was correct **except asset cache invalidation**:

- The published `0.53.2` tarball provably contained the fix
  (`dist/viewer/main.js`, 957 267 bytes, includes the `not-rendered` marker).
- The running server provably served that fixed file
  (`curl localhost:3030/main.js | grep -c not-rendered` → `1`).
- Yet the browser rendered stale code.

The gap is purely client-side caching, caused by two compounding facts:

1. **Stable, unhashed entry URLs.** The build emits `main.js`, `main.css`,
   `logo.svg`, and `index.html` (references `./main.js`, `./main.css`,
   `./logo.svg`). The URL `/main.js` never changes across releases — only its
   bytes do.
2. **No cache directives on static assets.** Observed live:

   ```
   $ curl -sI http://localhost:3030/main.js
   HTTP/1.1 200 OK
   content-type: text/javascript; charset=utf-8
   content-length: 957267
   # no cache-control, no etag, no last-modified
   ```

   `@hono/node-server`'s `serveStatic` sets no `Cache-Control`, `ETag`, or
   `Last-Modified`. With no directives and no validator, browsers apply
   **heuristic caching** — they may reuse a previously-200'd response for a
   stable URL without revalidating. So `/main.js` is served from disk cache
   across restarts.

**Net:** a stable URL + a mutable body + no validators = the browser cannot
tell the bytes changed, and isn't told to check. The fix ships but isn't seen.

## Why the Obvious Quick Fixes Are Not the Right Fix

- **`no-cache` on everything (incl. `main.js`).** Correct (forces
  revalidation; with no validator the browser must refetch in full), and it
  *would* make a plain refresh work. But it re-downloads ~1 MB on **every**
  load — intrusive and not production-friendly. It treats the entry bundle as
  perpetually-unverifiable rather than content-addressed.
- **`no-cache` + `ETag` middleware.** Removes the *network* re-download (304
  when unchanged), but the server must read and hash the full 1 MB body on
  **every request** to compute the ETag. That just relocates the cost to
  per-request hashing — which production systems avoid by hashing once, at
  build time. (That *is* content hashing — Option A below.)

Both keep the entry at a stable URL and pay a recurring cost to compensate. The
root cause is the stable-URL-for-mutable-bytes design itself.

## Decision

**Content-hash the viewer's build outputs and serve them as immutable, with a
small revalidated HTML entry.** This is the industry-standard cache-busting
strategy (Vite, webpack, Next, Parcel all do it).

### Ruling 1 — Hash all build-emitted assets

esbuild emits `main-<hash>.js`, `main-<hash>.css`, `logo-<hash>.svg`, and the
already-hashed `chunk-<hash>.js`. A content hash in the filename makes the URL
**content-addressed**: identical bytes ⇒ identical URL; changed bytes ⇒ new
URL. The browser fetches a changed asset exactly once (new URL), then caches it
forever.

### Ruling 2 — `index.html` is the single revalidated entry

`index.html` keeps a stable URL (`/`, `/index.html`) and is rewritten at build
time to reference the hashed assets. It is the only file that must be fetched
fresh to discover new asset URLs. At 357 bytes, revalidating/refetching it on
every load is negligible.

### Ruling 3 — Cache policy by content-addressing, set server-side

`serveStatic({ onFound })` classifies by filename and sets `Cache-Control`:

| Asset | `Cache-Control` | Rationale |
|---|---|---|
| Hashed (`*-XXXXXXXX.ext`) | `public, max-age=31536000, immutable` | content-addressed → never stale |
| Unhashed (`index.html`) | `no-cache` | stable URL, mutable content → revalidate every load |

`no-cache` ≠ "don't cache" (that is `no-store`). It means "store, but revalidate
before use." For a 357-byte HTML file the revalidation cost is irrelevant.

### Outcome

After a release, a **normal** browser refresh fetches a fresh `index.html`
(`no-cache`), which now points at new hashed asset URLs, which the browser
fetches once. The 1 MB JS is **never re-downloaded unless it actually changed**,
and is never served stale. The original requirement — "a simple Chrome refresh
picks up the new version" — is satisfied with zero perpetual cost.

## Engineering Plan (file-level)

1. **`packages/viewer/build.mjs`**
   - Set `entryNames: '[name]-[hash]'` (currently only `assetNames` is hashed,
     which covers loaded files/chunks but **not** entry outputs — the precise
     reason `main.js` is unhashed today).
   - Drop `index.html` from `entryPoints` (it can no longer be a verbatim copy
     since it must reference hashed names).
   - Enable `metafile: true`; add an esbuild plugin with `onEnd` that reads
     `result.metafile.outputs`, resolves the emitted basenames for the `main.ts`
     JS entry, its CSS sibling, and `logo.svg`, then writes `dist/index.html`
     from the source template with `./main.js`/`./main.css`/`./logo.svg`
     rewritten to the hashed names. `onEnd` runs on every rebuild, so watch mode
     stays correct.

2. **`packages/server/src/utils/viewer-cache.ts`** (new, testable)
   - `isContentHashedAsset(path)` — `/-[A-Z0-9]{8}\.[a-z0-9]+$/i`.
   - `viewerCacheControl(path)` → `immutable` vs `no-cache`.
   - `setViewerCacheHeaders(path, c)` — the `onFound` hook.

3. **`packages/server/src/node-server.ts`**
   - `serveStatic({ root: paths.viewerDist, onFound: setViewerCacheHeaders })`.

4. **Tests** — unit-test the classifier (hashed ⇒ immutable, `index.html` ⇒
   `no-cache`, `main-ABC12345.js` ⇒ immutable, bare `main.js` ⇒ `no-cache`); an
   integration assertion through `createApp` that a served hashed asset carries
   `immutable` and `index.html` carries `no-cache`.

## Insights

- **A stable URL for mutable bytes is the actual bug — caching is downstream.**
  Adding headers is necessary but secondary; the durable fix makes the URL
  change when the content changes, so correctness no longer depends on
  revalidation behaving.
- **`entryNames` vs `assetNames` is the specific trap.** esbuild hashes
  *loaded assets* under `assetNames` (so `chunk-*` were already hashed) but
  leaves *entry* outputs under `entryNames` (default `[name]`). The viewer set
  `assetNames: '[name]-[hash]'` and looked "hash-aware," yet its entry `main.js`
  was unhashed — exactly the file that goes stale.
- **Immutability eliminates a cost class, it doesn't add one.** Hashing means
  the 1 MB bundle is fetched once per actual change; `no-cache`/ETag schemes pay
  on every load (network or CPU). The cheapest correct option is the one that
  only ever touches a 357-byte file.
- **The deploy chain looked perfect, so the bug hid at the edge.** Server
  version, CI build, published tarball, and served bytes were all verified
  correct; the failure lived entirely in the browser cache. When "everything is
  right but the user sees old," suspect the cache layer and diff *served bytes
  vs rendered bytes*, not the artifact.
- **Validators don't fix staleness on their own.** `no-cache` without a
  validator forces a full refetch; with a validator it gives 304s — but neither
  removes the recurring per-load work. Only content-addressing does.

## Consequences

- **Positive:** zero-stale releases on a normal refresh; immutable long-lived
  caching of the heavy assets; no per-request hashing; standard, well-understood
  pattern; the cache classifier is small and unit-tested.
- **Cost:** `build.mjs` gains a metafile-driven HTML emit step (more than a
  verbatim copy). Watch mode must regenerate `index.html` on each rebuild
  (handled in `onEnd`).
- **Scope:** local/Node deployment (the primary mode, ADR 0104). The
  Cloudflare/D1 satellite serves assets via its own mechanism and is out of
  scope here; if it later serves the viewer, the same hashing applies and only
  the header-setting integration differs.
- **Backward compatibility:** none required — output filenames are internal to
  the bundle; `index.html` is regenerated to match. No API or data change.

## Cross-References

- **Framework ADR 0008.1** (nisli repo) — the mount-time dependency-leak fix
  whose release surfaced this caching gap; the bug that made "I shipped it but
  users see old UI" visible.
- **ADR 0104 — Local-First Deployment Posture** — establishes Node/local as the
  primary mode this ADR targets.
- **Code:** `packages/viewer/build.mjs` (esbuild config),
  `packages/server/src/node-server.ts` (`serveStatic` wiring),
  `packages/server/src/utils/paths.ts` (`viewerDist` resolution).
- **Evidence (this session):** `curl -sI localhost:3030/main.js` showing no
  cache headers; `npm pack backlog-mcp@0.53.2` + `grep not-rendered` confirming
  the published bundle contained the fix while the browser rendered stale code.
