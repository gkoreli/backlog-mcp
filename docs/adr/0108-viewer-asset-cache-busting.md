# 0108. Content-Hashed Viewer Assets — Cache-Busting for Zero-Stale Releases

**Date**: 2026-06-18
**Status**: Accepted — implemented (commit `c14206c`, hardened follow-up)
**Triggered by**: After publishing a viewer fix (the nisli mount-time leak, ADR 0008.1 in the framework repo), the browser kept rendering the old UI across server restarts until a hard-refresh
**Relates to**: [0104. Local-First Deployment Posture](./0104-local-first-deployment-posture.md)

> **Outcome was better than the original plan.** We set out to "hand-roll an
> esbuild step." Grounding in primary sources (esbuild docs + issue #3618) and
> the canonical community plugin revealed that reading the **metafile** to
> inject hashed names *is* esbuild's officially-documented pattern — not a
> workaround — and that the leading plugin does exactly this, just wrapped in
> `jsdom` + `lodash` we don't need. So we kept a ~20-line, zero-dependency
> `onEnd` step, stole the one idea worth taking (the exact base32 hash
> alphabet), and backed the server-side policy with a **fail-safe** classifier
> and invariant tests. See *Prior Art* and *Authoritative Sources* below.

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

> **Scope: production only — dev/watch MUST NOT hash (collision with HMR, ADR 0021).**
> Content hashing rotates the filename on every rebuild (`main-AAAA.js → main-BBBB.js`).
> The dev HMR client (nisli ADR 0021) re-evaluates the bundle by re-importing the
> page's `<script src>` with a `?t=<ts>` cache-bust — which requires a **stable
> module URL**. Hashed names make that re-import 404 (the old hash no longer
> exists on disk), breaking HMR entirely. The two strategies are fundamentally
> incompatible, and this is the universal convention: **webpack rejects
> `[contenthash]`/`[chunkhash]` + HMR outright** (errors: *"use [hash] instead"* —
> angular-cli #19394, webpack #1363); **Vite** hashes only in the production
> `build` (`rollupOptions.output.entryFileNames`), while dev serves stable URLs +
> a `?t=` query. So `build.mjs` gates the hash: `entryNames: watch ? '[name]' :
> '[name]-[hash]'` (same for `assetNames`). The `?t=` query is the dev
> cache-buster, and unhashed dev assets fall into this ADR's no-cache/revalidate
> bucket (Ruling 3 fail-safe), so nothing is served stale despite the stable name.

### Ruling 2 — `index.html` is the single revalidated entry

`index.html` keeps a stable URL (`/`, `/index.html`) and is rewritten at build
time to reference the hashed assets. It is the only file that must be fetched
fresh to discover new asset URLs. At 357 bytes, revalidating/refetching it on
every load is negligible.

### Ruling 3 — Cache policy by content-addressing, set server-side

`serveStatic({ onFound })` classifies by filename and sets `Cache-Control`:

| Asset | `Cache-Control` | Rationale |
|---|---|---|
| Hashed (`-XXXXXXXX.ext`) | `public, max-age=31536000, immutable` | content-addressed → never stale |
| Everything else (`index.html`, unknown) | `no-cache` | stable URL / unrecognized → revalidate every load |

`no-cache` ≠ "don't cache" (that is `no-store`). It means "store, but revalidate
before use." For a 357-byte HTML file the revalidation cost is irrelevant.

The classifier matches esbuild's exact hash shape — `-` + 8-char **RFC-4648
base32** (`A–Z`, `2–7`, never `0/1/8/9`) + extension at end-of-string
(`/-[A-Z2-7]{8}\.[a-z0-9]+$/`). The alphabet is taken from the canonical
plugin's `HASH_REGEX` (see *Prior Art*).

**Fail-safe invariant (the key resilience property):** only recognized hashed
names are cached immutably; *everything else falls through to `no-cache`*. So a
misclassification can only cost a re-validation (a perf cost) — it can **never**
serve a mutable, stable-URL asset as immutable (the stale-bug direction). Even
if a future esbuild changes the hash length/alphabet, hashed assets merely
degrade to `no-cache`; they don't go stale. And the only stable-URL viewer file
is `index.html`, which has no hash and thus can never match. This is locked by
invariant tests (`viewer-cache.test.ts`): equivalence (`immutable ⇔ hashed`),
fail-safe default, "`index.html` is never immutable", and a closed policy set.

### Outcome

After a release, a **normal** browser refresh fetches a fresh `index.html`
(`no-cache`), which now points at new hashed asset URLs, which the browser
fetches once. The 1 MB JS is **never re-downloaded unless it actually changed**,
and is never served stale. The original requirement — "a simple Chrome refresh
picks up the new version" — is satisfied with zero perpetual cost.

## Engineering Record (executed)

1. **`packages/viewer/build.mjs`** — set `entryNames: '[name]-[hash]'` (only
   `assetNames` was hashed before, which covers chunks/loaded files but **not**
   entry outputs — the precise reason `main.js` was unhashed). Dropped
   `index.html` from `entryPoints`; enabled `metafile: true`; added an `onEnd`
   plugin that reads `result.metafile.outputs`, resolves the `main.ts` JS entry,
   its CSS via the entry output's `cssBundle`, and the `logo.svg` entry, then
   writes `dist/index.html` from the source template with the three references
   rewritten to hashed names. `onEnd` runs on every rebuild → watch-mode safe.
   *Verified:* built `index.html` references `main-3LFQHTR2.js` /
   `main-ZBGT667E.css` / `logo-535ZNY3M.svg`, all present on disk; the server's
   `dist/viewer/index.html` carries the same hashed refs after the root build.

2. **`packages/server/src/utils/viewer-cache.ts`** (new, declarative + testable)
   — `CacheControl` (the two policies as named constants), `CONTENT_HASH_SUFFIX`
   (base32 regex), `isContentHashedAsset`, `viewerCacheControl` (fail-safe
   default), `setViewerCacheHeaders` (the `onFound` hook).

3. **`packages/server/src/node-server.ts`** —
   `serveStatic({ root: paths.viewerDist, onFound: setViewerCacheHeaders })`.

4. **`packages/server/src/__tests__/viewer-cache.test.ts`** — 6 invariants
   (equivalence, fail-safe default, `index.html` never immutable, closed policy
   set, base32 real-output coverage, hook fidelity) + 3 Hono-context integration
   assertions on served headers. **9 pass**; server typecheck clean; full server
   suite **902 pass / 2 skip**.

## Prior Art — esbuild HTML plugins (steal / adapt / reject)

We surveyed the field rather than inventing in a vacuum. The leading plugin is
[`@craftamap/esbuild-plugin-html`](https://github.com/craftamap/esbuild-plugin-html)
(itself "inspired by `jantimon/html-webpack-plugin`"). Reading its source
(`src/index.ts`) was decisive:

- **Confirms our mechanism is canonical.** Its own docs: *"This plugin works by
  analyzing the `metafile` esbuild provides… map input files to their output
  file (javascript as well as css)."* It resolves CSS via `entrypoint.cssBundle`
  — **identical** to our `onEnd` step. Our approach is the sanctioned pattern,
  not a hack.
- **Rejected: its dependency surface.** It pulls in `jsdom` (builds a full DOM
  of the template to `createElement`/append tags) and `lodash/template` (for
  `<%= %>` interpolation), plus options for inline/favicon/publicPath/
  extraScripts/`scriptLoading`. That is framework-grade machinery for a static
  12-line HTML with three references — at odds with this repo's zero-dep ethos
  (the whole `@nisli/core` is dependency-free). A string `.replace()` on a known
  template is simpler and has no attack/maintenance surface.
- **Stole: the exact hash alphabet.** Its `HASH_REGEX = (?<hash>[A-Z2-7]{8})`
  documents that esbuild's `[hash]` is 8-char RFC-4648 base32. We tightened our
  classifier from `[A-Z0-9]{8}` to `[A-Z2-7]{8}` accordingly — strictly fewer
  false positives.
- **Adapted (consciously did NOT need): general `entryNames` reverse-matching.**
  The plugin builds a regex from the user's arbitrary `entryNames`/`[dir]`
  template to find related outputs. We use one fixed flat template, so the
  metafile's `entryPoint` + `cssBundle` fields are sufficient — no template
  reverse-engineering required.
- **Why didn't esbuild ship this natively?** It deliberately won't: HTML doesn't
  fit esbuild's import-graph model (HTML references JS, not vice-versa), and
  native injection would force opinions (which tags/attrs, `type=module` vs
  `defer`, preload, SRI, CSP, multi-entry routing, inline). esbuild exposes the
  raw **metafile** seam and leaves the policy to consumers/plugins. "Bundling
  with HTML" is an open request (issue #3618), not a feature.

## Authoritative Sources

- **esbuild API — Entry names** (the documented pattern we implement):
  <https://esbuild.github.io/api/#entry-names> — *"Adding `[hash]` to your entry
  point names means esbuild will calculate a hash… you can have your web server
  tell browsers to cache these files forever… You can then use the information
  in the metafile to determine which output file path corresponds to which input
  entry point so you know what path to include in your `<script>` tag."*
- **esbuild API — Metafile** (`outputs[].entryPoint`, `outputs[].cssBundle`):
  <https://esbuild.github.io/api/#metafile> — the fields our `onEnd` reads.
- **esbuild #3618 "Bundling with HTML"** (no native HTML loader; open request):
  <https://github.com/evanw/esbuild/issues/3618>.
- **`@craftamap/esbuild-plugin-html`** (canonical community plugin; metafile +
  `cssBundle`; `HASH_REGEX = [A-Z2-7]{8}`; jsdom + lodash deps):
  <https://github.com/craftamap/esbuild-plugin-html> (`src/index.ts`).
- **MDN — `Cache-Control`** (`no-cache` = revalidate-before-use, ≠ `no-store`;
  `immutable`): <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control>.

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
- **Bias the classifier's failure mode, then it can stay simple.** A
  filename-regex classifier looks risky until you make the *default* the safe
  one: unknown ⇒ `no-cache`. Then every misclassification (wrong length, future
  hash format, a `.map` sibling) costs at most a re-validation, and the
  dangerous "mutable served immutable" outcome is structurally impossible for
  our outputs (only `index.html` has a stable URL, and it has no hash). Resilience
  came from the fail-safe direction, not from a more elaborate matcher.
- **Survey before inventing — it changes the confidence, not just the code.**
  The hand-rolled step *felt* like a workaround until the canonical plugin and
  esbuild's own docs showed the metafile-injection is the sanctioned pattern.
  The survey let us keep ~20 zero-dep lines on purpose (reject `jsdom`/`lodash`)
  and steal exactly one thing (the base32 alphabet) — an evidence-based "no" to
  a dependency, not an uninformed one.

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
- **Implemented code:**
  - `packages/viewer/build.mjs` — esbuild `entryNames` hashing + `onEnd`
    metafile-driven `index.html` emit.
  - `packages/server/src/utils/viewer-cache.ts` — `CacheControl`,
    `isContentHashedAsset`, `viewerCacheControl`, `setViewerCacheHeaders`.
  - `packages/server/src/node-server.ts` — `serveStatic({ onFound })` wiring.
  - `packages/server/src/utils/paths.ts` — `viewerDist` resolution.
- **Tests:** `packages/server/src/__tests__/viewer-cache.test.ts` — 6 invariants
  + 3 Hono-context integration assertions.
- **Prior art / authoritative sources:** see the two sections above —
  `@craftamap/esbuild-plugin-html`, esbuild Entry-names/Metafile docs, esbuild
  #3618, MDN `Cache-Control`.
- **Evidence (this session):** `curl -sI localhost:3030/main.js` showing no
  cache headers; `npm pack backlog-mcp@0.53.2` + `grep not-rendered` confirming
  the published bundle contained the fix while the browser rendered stale code.
