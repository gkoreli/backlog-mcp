# 0110. Vite for Viewer Dev (HMR) — Static Bundle in Prod

**Date**: 2026-06-19
**Status**: Proposed — design-first
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

Dependency posture: **Vite is a `devDependency` of `packages/viewer` only.** It
is never a runtime dep of `backlog-mcp`, never `npx`-installed by users. The
published package ships only the static built assets, exactly as today.

Wiring into our architecture:

- **Dev (`pnpm dev`)** — two processes, like today's `concurrently`:
  - backlog **Hono** server: `/mcp`, API, `/events` (SSE);
  - **Vite dev server**: serves the viewer with HMR, `server.proxy` forwards
    API/SSE to Hono. (Middleware mode — Vite mounted inside Hono on one port —
    is the alternative; default to the proxy for simplicity.)
- **Prod** — no dev server. `vite build` → static hashed `dist/` → copied into
  the server package → **Hono serves it** (unchanged). `npx backlog-mcp`
  unchanged.

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
