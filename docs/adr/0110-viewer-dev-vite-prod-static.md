# 0110. Vite for Viewer Dev (HMR) — Static Bundle in Prod

**Date**: 2026-06-19
**Status**: Accepted — implemented. Viewer dev+build on Vite; `@nisli/core/vite-hmr` 0.50.0; prod parity + cache headers verified. **Dev is single-origin** via `@hono/vite-dev-server` (one process, no proxy, no tsx). See *Engineering Record*.
**Triggered by**: Live testing of the esbuild dev-HMR client (nisli ADR 0021, shipped `@nisli/core/esbuild-hmr` 0.49.0–0.49.2) surfaced a structural failure: re-importing the bundled entry to apply a change instantiates a **second copy of the entire framework runtime**, so live elements and new component setups disagree about the lifecycle/reactive context.
**Supersedes**: the dev-HMR *approach* of nisli **ADR 0021** (`@nisli/core/esbuild-hmr`) for the backlog-mcp viewer. ADR 0021's correctness analysis (re-mount lifecycle, ADR 0008.1) stays valid and is reused.
**Relates to**: [0108. Content-Hashed Viewer Assets](./0108-viewer-asset-cache-busting.md) · [0104. Local-First Deployment Posture](./0104-local-first-deployment-posture.md)

> **The journey corrected the destination.** We set out to give the esbuild
> viewer Vite-grade HMR *without* Vite (ADR 0021). Implementing it, then running
> the real loop, proved the constraint that motivated the detour ("keep a
> prod-shaped bundle in dev") is the very thing that makes correct HMR
> impossible on esbuild. The operator retired that constraint. This ADR adopts
> the tool the entire ecosystem already uses for this exact problem.

## Context

- The viewer is a Web-Components app built on `@nisli/core` (custom elements +
  signals). Dev today: `esbuild --watch` rebuilds a bundled `dist/`, Hono serves
  it; prod: `esbuild` emits content-hashed `dist/` (ADR 0108), copied into the
  server package and served by Hono.
- ADR 0021 added a dev-only HMR client as a tree-shakeable subpath
  (`@nisli/core/esbuild-hmr`): an esbuild plugin broadcasts a metafile diff over
  SSE; a browser client re-imports and re-mounts changed components. It shipped
  (0.49.0), with two follow-up fixes (0.49.1 client-injection; 0.49.2 connect
  idempotency).
- **Live use exposed a structural defect**, not a bug. See below.

### What actually broke (evidence)

- The HMR client's `defaultReimport` re-imports the page's entry
  `<script src>` (`main.js?t=<ts>`) to re-run component registrations.
- esbuild **scope-hoists / inlines** the whole module graph into that entry, so
  re-importing `main.js?t=` re-instantiates **the entire `@nisli/core`
  runtime** — a second `currentSetup`/reactive context. Build output confirms
  the framework lifecycle (`onCleanup`/`onMount` guards) lives **only in
  `main.js`** (4 occurrences, 0 in any chunk).
- Result at runtime: live elements (original instance) run their
  `connectedCallback` via the *original* context, but the *new* setup closures
  call `onCleanup`/`onMount`/`useHostEvent` resolved against the *re-imported*
  instance whose context was never entered → every component throws
  `onCleanup() called outside setup()`. A classic dual-instance split-brain.
- It also remounts **every** component on **every** edit (all registrations get
  fresh closures), the opposite of granular HMR.

### The core tension (why esbuild can't do this cleanly)

- Granular HMR needs **module-level identity preserved at runtime** — per-module
  URLs (Vite/Snowpack) or a **custom module runtime** with `hot.accept`
  boundaries (webpack/Rspack/Bun/Turbopack; the `leegeunhyeok/esbuild-hmr` PoC).
- esbuild provides **neither**, by design. Primary-source evidence:
  - **esbuild #1940** (a tooling author asking for exactly our case): *"scope
    hoisting will remove the module info in the bundle file… if esbuild could
    support disable scope hoisting in development and support a **custom module
    runtime**, it maybe possible for upper-level tools to support HMR."* Declined.
  - **esbuild #464 / #802**: built-in HMR is a non-goal.
  - GitHub reality: the **only** standalone esbuild-HMR is a **6★ PoC**
    (`leegeunhyeok/esbuild-hmr`) that hand-rolls a module runtime. Every
    production-grade granular HMR (Vite, Rspack, Turbopack, Bun, webpack) ships
    that runtime **inside the bundler**.
- ADR 0021's whole-entry re-import was the corner we cut *because* we had no
  module runtime. The cut is the defect.

### Verified fact that shaped the options

- Experiment (esbuild, 17 component entry points + `splitting:true`): the
  framework dedupes into **exactly one shared chunk** (`COUNT = 1`). So a
  per-component-entry esbuild design *could* guarantee a single framework
  instance — relevant to Option A below.

### Constraint change (operator)

- ADR 0021 Ruling 5 held a hard constraint: **dev must serve a prod-shaped
  bundle**. That constraint is what forces whole-entry re-import. The operator
  has **retired it** ("if Vite fixes this entirely, I'm down to migrate to Vite
  entirely"). Dev and prod build paths may now differ.

## Proposed Solutions

### Option A — Stay on esbuild: per-component entry points + payload-driven re-import

- Each component is its own entry; `splitting:true` puts `@nisli/core` in one
  shared chunk (verified single instance). Stable dev names (ADR 0108 scoped to
  prod) prevent hash cascade. The client re-imports only the changed module URLs
  from the SSE payload (the esm-hmr contract), not the entry.
- **Pros:** one toolchain; reuses the 0.49.x work; fixes the split-brain;
  granular (remount only the edited element).
- **Cons:** still **coarse** HMR — boundary = custom-element remount
  (element-local signal state resets); **no** state-preserving `import.meta.hot`.
  We **keep owning a custom re-import/remount runtime + SSE hub** — precisely the
  layer esbuild #1940 says belongs in a higher-level tool. We'd be maintaining a
  miniature Vite. Edge cases (non-component module edits, shared-chunk changes,
  CSS) each need bespoke handling we'd discover in production, one at a time.

### Option B — Hand-roll a module runtime on esbuild (the PoC approach)

- Wrap every module in a registry with `hot.accept`, rewrite imports/exports,
  disable scope hoisting in dev. True granular HMR.
- **Pros:** full HMR semantics on esbuild.
- **Cons:** this is **building Vite's dev core ourselves**. Large, subtle,
  unmaintained-by-anyone-but-us; the only precedent is a 6★ PoC. Rejected on
  cost/risk — squarely the "stop reinventing" signal from the operator.

### Option C — Vite for dev (HMR), Rollup static bundle for prod  ✅

- **Dev:** `vite` dev server — unbundled native ESM, framework is a stable
  module (no re-instantiation, no split-brain), granular `import.meta.hot`.
- **Prod:** `vite build` (Rollup; Rolldown in newer Vite) emits content-hashed
  static `dist/` + rewritten `index.html`, copied into the server package and
  served by Hono — same runtime posture as today.
- **Pros:** the bug class disappears (single framework instance is intrinsic to
  unbundled dev); it's the ecosystem-standard tool for *exactly* this; we delete
  custom HMR code instead of adding more; ADR 0108 maps onto Rollup output
  options; zero HMR bytes in prod (`import.meta.hot` is `undefined`/tree-shaken
  by `vite build`).
- **Cons:** dev and prod use different bundlers (must verify output parity);
  prod bundler shifts esbuild→Rollup; the `@nisli/core/esbuild-hmr` subpath is
  retired for the viewer; dev server integration with Hono needs wiring (proxy
  or middleware).

## Decision

**Adopt Option C: Vite for viewer dev, Rollup static bundle for prod.**

Rationale, evidence-led:
- The defect is **structural to bundled-entry re-import**, not a fixable bug;
  the constraint that forced it is retired.
- Granular HMR **requires a module runtime**; the maintained, ecosystem-standard
  one is Vite's. Options A/B keep that burden on us (A partially, B fully).
- Vite is **build/dev-time only** — it adds no production dependency and no
  production runtime (see "How it works"). The risk is contained to the build
  pipeline, which we verify before cutover.

## How It Works (dev-only vs prod)

**Vite never runs in production.** It is two things behind one CLI:

- `vite` (**dev server, dev-only**): serves the viewer with HMR; the HMR client
  (`@vite/client`) and all `import.meta.hot` blocks exist only here.
- `vite build` (**build step**): bundles with Rollup, content-hashes, writes
  static `dist/`, then exits. `import.meta.hot` is `undefined` and tree-shaken →
  **zero HMR bytes in prod**.

Wiring into our architecture:

- **Dev (`pnpm dev`)** — **ONE process, ONE origin** (supersedes the original
  two-process proxy design below; see *Engineering Record — single-origin
  cutover*). `@hono/vite-dev-server` mounts the backlog **Hono** app on Vite's
  dev server: Vite serves the SPA + client modules + granular HMR, and every
  request Vite does not own (API, `/events` SSE, `/mcp`, OAuth) is handled by the
  Hono app, loaded through Vite's **SSR module graph**. No proxy, no second
  process, no `tsx` — dev mirrors prod (one server serves SPA + API).
- **Prod** — no dev server. `vite build` → static hashed `dist/` → copied into
  the server package → **Hono serves it** (unchanged). `npx backlog-mcp`
  unchanged.

Dependency posture: **Vite + `@hono/vite-dev-server` + `vite-tsconfig-paths` are
root `devDependencies`** (the root config orchestrates both packages in dev).
They are never runtime deps of `backlog-mcp`, never `npx`-installed by users; the
published package ships only the static built assets.

## ADR 0108 Mapping (cache-busting survives)

- Rollup hashing: `build.rollupOptions.output.{entryFileNames,chunkFileNames,
  assetFileNames} = '[name]-[hash].js'`. Vite emits the rewritten `index.html`
  referencing hashed assets — replacing our esbuild metafile→HTML plugin.
- Server cache policy (ADR 0108 Ruling 3) is unchanged: hashed assets
  `immutable`, `index.html` `no-cache`/revalidated. **Verify** the hashed
  filenames still match the server's content-addressed classifier (base32
  `[A-Z2-7]{8}` vs Rollup's default hash alphabet) — adjust the classifier or
  Rollup's hash format if they diverge.

## Prior art — a framework HMR adapter is the norm, not a workaround

Vite supplies the HMR *plumbing* (`import.meta.hot`, the websocket, module-graph
invalidation, re-fetching the changed module) but is framework-**agnostic**: a
module that does not `import.meta.hot.accept` bubbles to a full reload. The
framework-specific "apply the new code to live instances" step is always a
dedicated integration:

- **React** — `@vitejs/plugin-react` (Fast Refresh); **Vue** — `@vitejs/plugin-vue`;
  **Svelte** — the compiler *injects* `import.meta.hot.accept(...)` per component
  module (verified in `sveltejs/svelte` source); **Solid** — `solid-refresh` /
  `defineSolidElement` (docs: *"add `if (import.meta.hot) import.meta.hot.accept();`"*).
- **Web components specifically** carry an extra constraint: `customElements.define`
  **cannot be re-called** for a tag, so you cannot "replace the module" — you must
  patch the existing class / swap behavior and re-render live instances. The
  canonical pattern is the Lit team's `@web/dev-server-hmr` (`modernweb-dev/web`):
  ```js
  import.meta.hot.accept(({ module }) => {
    MyComponent.styles = module.MyComponent.styles;
    MyComponent.template = module.MyComponent.template;
    for (const el of liveInstances) /* re-render */;
  });
  ```

Our `@nisli/core/vite-hmr` is the Nisli equivalent: `component()` guards the
one-time `define`; the plugin injects `import.meta.hot.accept` and swaps the
*setup* behind a stable registry thunk, then re-mounts live elements via the
lifecycle (ADR 0021, Ruling 2/3). Difference from Lit's property-patch: we do a
full element re-mount (element-local signal state resets; props + injected
singletons survive) — coarser but simpler and correct. Conclusion: the adapter
is the standard amount of framework glue, not a reinvention.

## nisli's remaining role

- Retire `@nisli/core/esbuild-hmr` **for the viewer** (keep the package published
  for now; mark dev-only/experimental — decide deprecation separately).
- nisli needs a **small Vite HMR adapter**: a `hot.accept` handler that re-runs a
  changed component module and re-mounts its custom element — reusing ADR 0021's
  re-mount/disposal logic (Ruling 2/3, ADR 0008.1), now driven by **Vite's**
  runtime + `import.meta.hot` instead of our SSE hub + whole-entry re-import.
  This is the genuinely reusable core; the transport/injection layers go away.

## Consequences

- **Positive:** the split-brain and whole-entry re-import disappear by
  construction; granular, state-aware HMR; less code we own; prod runtime and
  cache posture unchanged; standard, maintained toolchain.
- **Cost:** migrate `build.mjs` → Vite config; wire Vite↔Hono in dev; verify
  Rollup prod output vs ADR 0108; write the nisli Vite HMR adapter; retire the
  esbuild-hmr subpath usage.
- **Risk / verify-before-cutover:** prod output parity (hashing, chunking, CSS
  extraction, `index.html` rewrite); SSE/`/events` proxying in dev; the server's
  hashed-asset classifier vs Rollup's hash alphabet; Mermaid/diff2html dynamic
  imports still split correctly.
- **Not wasted:** the 0.49.x esbuild-HMR work produced the diagnosis that led
  here, and its re-mount correctness analysis is reused by the Vite adapter.

## Implementation (plan, sequenced)

1. **Spike (no cutover):** add `vite` as a viewer `devDependency`; minimal
   `vite.config.ts` (root = `packages/viewer`, custom-elements-friendly). Run
   `vite` dev, confirm HMR works on a component edit (no reload, no split-brain).
2. **nisli Vite HMR adapter:** implement `import.meta.hot.accept` →
   re-mount-by-tag using existing ADR 0021 re-mount logic; unit-test in nisli.
3. **Dev integration:** `pnpm dev` runs Hono + Vite (proxy `/events`,`/api`,`/mcp`
   to Hono). Validate SSE live updates through the proxy.
4. **Prod build:** `vite build` with Rollup hashing matching ADR 0108; verify
   `dist/` shape, hashed `index.html`, server cache headers, classifier match.
   Diff against current esbuild prod output for parity.
5. **Cutover:** replace `build.mjs`; update `packages/viewer` scripts and the
   asset-copy-into-server step; remove the esbuild-HMR dev wiring + SSE hub.
6. **Record:** update this ADR with executed findings; cross-link nisli ADR 0021
   as superseded-for-viewer; update ADR 0108 if Rollup hashing changed anything.
## Engineering Record (executed)

Implemented in sequenced commits (all tests green: nisli 266, viewer 100,
server 912, memory 26):

1. **Vite build+dev, esbuild retired** — `vite.config.ts` (dev proxy of backend
   routes to Hono `:3040`; prod hashed output under `assets/` + rewritten
   `index.html`; `__API_URL__` define). `index.html` → `/main.ts` source entry;
   CSS flows from JS imports; `logo.svg` → `public/`. Scripts `dev=vite`,
   `build=tsc --noEmit && vite build`. `build.mjs` (and the esbuild dev-HMR / SSE
   hub) deleted. Verified: Vite resolves NodeNext `.js` specifiers to `.ts`.
2. **`@nisli/core/vite-hmr` (0.50.0)** — dev-only Vite plugin (`apply:'serve'`)
   wraps `component()` (shared `transformSource`) and appends
   `import.meta.hot.accept(() => __drain())`; runtime re-exports the shared
   registry/remount. Extracted the transport-agnostic core to `src/hmr/{registry,
   transform}.ts`, consumed by both esbuild-hmr and vite-hmr (no duplication;
   esbuild surface unchanged via re-exports). Verified in the dev server:
   component module transformed + self-accepting; `@nisli/core` resolves to ONE
   deps chunk (single instance — no split-brain); non-component modules untouched.
3. **Server cache classifier** — `viewer-cache.ts` treats files under `assets/`
   as immutable (hash-format-agnostic), legacy esbuild base32 as secondary;
   ADR 0108 fail-safe invariants preserved.
4. **Dev proxy verified** — through Vite: `/version`,`/health`,`/tasks` → 200;
   `/events` → 200 `text/event-stream` (SSE streams).
5. **Prod serve verified** — `index.html`/`logo.svg` → `no-cache`; `/assets/*.js`
   and `*.css` → `immutable`; the index's `/assets/*` references resolve (200).

### Gotcha found by verification (would have broken prod)

`tsdown`'s `copy` glob `../viewer/dist/** → dist/viewer` **flattens**
subdirectories (its `flatten` option defaults to `true`, and a `/**` pattern is
resolved to individual files). Invisible with esbuild's flat output, but it
dropped Vite's `assets/` directory, so every `/assets/*` URL in the emitted
`index.html` 404'd in production. Fix uses tsdown's copy **natively** — a plain
directory `from` (not a glob) with `rename` so `fsCopy` (`cp` recursive) does a
structure-preserving copy to `<outDir>/viewer`:
`copy: [{ from: '../viewer/dist', rename: 'viewer' }]`. Lesson: directory-
structure assumptions in a copy step must be re-verified when the producer's
output layout changes (flat esbuild → nested Vite `assets/`).

### Operator-verifiable (not assertable headlessly)

Granular HMR was verified up to the transport (transform injected, single
framework instance, self-accept present). The final visual — a component edit
hot-swaps in place with no full page reload — is confirmed in a browser: run
`pnpm dev`, open the Vite URL (default `:5173`), edit a component.

## Engineering Record — single-origin dev cutover

The initial implementation kept the ecosystem-default **two-process proxy**
(Vite on its own port, `server.proxy` forwarding API/SSE to a `tsx`-run Hono on
`:3040`). Live use exposed its costs: a hand-maintained proxy route list, a
startup race (`ECONNREFUSED` on `/events` when Vite outraced the backend), two
ports, and a dev topology *inverted* from prod (frontend-primary vs Hono-primary).
We replaced it with the maintained prior art — **`@hono/vite-dev-server`** — so
**dev is single-origin and mirrors prod**.

**Model.** A root `vite.config.ts` (it orchestrates *both* packages, so it lives
at the monorepo root, not in the viewer) mounts the backlog Hono app on Vite via
`@hono/vite-dev-server`. Vite serves the SPA + client modules + HMR; the plugin's
`exclude` is the **inverse of the old proxy list** — defaults already cover Vite
internals (`.ts`, `.css`, `/@vite`, `?t=`, `node_modules`), and we add the SPA
shell `/` (regex `^\/(\?.*)?$` — the viewer routes via query string, so the path
is always `/`). Everything else falls through to the Hono app, loaded via Vite's
**`ssrLoadModule`**. One process, one origin (`:5173`), no proxy, no `tsx`,
no `concurrently`.

**Backend under Vite SSR — verified, not assumed.** The risk was the native
`@huggingface/transformers` (onnxruntime) embedding dep choking Vite's SSR
loader. A spike proved it boots cleanly (Vite externalizes `node_modules` for
SSR): `/version`,`/tasks` → 200, `/events` → `text/event-stream`, `/` → SPA with
`@vite/client`, and `[vite] (client) hmr update /components/task-badge.ts` on
edit.

**Gotcha (the only real blocker).** The server's `@/*` tsconfig path alias is
invisible to Vite's resolver → `Cannot find module '@/utils/paths.js'` during
SSR. Fixed with **`vite-tsconfig-paths`** pointed at the server tsconfig — the
production-grade fix (reads tsconfig `paths`, no hand-kept aliases). The alias
was also renamed `@/*` → **`@server/*`** (single `@server/* → src/*` mapping):
in a root config that loads both packages, a bare `@/` is ambiguous.

**Single source of truth.** Extracted `createNodeApp()`
(`packages/server/src/server/node-app.ts`) — the fully-wired app graph — used by
both the published `node-server.ts` (adds listener + port collision + lifecycle)
and the Vite dev entry (`packages/server/src/dev-entry.ts`, `export default
createNodeApp()`). `.env` is loaded into `process.env` in the config
(`loadEnv` + `Object.assign`) to replace `tsx --env-file` for the SSR backend.

**Removed:** `concurrently`, `tsx`, `esbuild` devDeps; the proxy route list; the
server `dev` (tsx) + viewer `dev`/`build` scripts; the dev-only "open :5173"
message in `node-server.ts` (dev no longer runs it). **Verified:** typecheck
(both) clean; full `pnpm build` ok; prod serve `index.html` `no-cache` + assets
`immutable` (resolve 200); tests memory 26 / viewer 100 / server 912.


## Authoritative Sources

- esbuild HMR non-goal / module-runtime gap: evanw/esbuild **#1940**, **#464**,
  **#802**.
- Only standalone esbuild-HMR is a PoC with a custom module runtime:
  `leegeunhyeok/esbuild-hmr`.
- Granular HMR is bundler-embedded elsewhere: Vite (`import.meta.hot`), Rspack,
  Turbopack, Bun, webpack HMR.
- Content-hash ↔ HMR incompatibility (dev stable names; prod hashes): webpack
  rejects `[contenthash]`+HMR (angular-cli #19394, webpack #1363); Vite hashes
  only in `build`. (Captured in ADR 0108.)
- Verified locally: per-component esbuild entries dedupe `@nisli/core` into one
  shared chunk (`COUNT = 1`); framework lifecycle inlined into `main.js` (0 in
  chunks) under the current single-entry build.

## Cross-References

- nisli **ADR 0021** — dev HMR via esbuild plugin (approach superseded for the
  viewer; re-mount analysis reused).
- **ADR 0108** — content-hashed assets (cache policy preserved; hashing moves to
  Rollup).
- **ADR 0104** — local-first posture (dev tooling only; prod unaffected).
