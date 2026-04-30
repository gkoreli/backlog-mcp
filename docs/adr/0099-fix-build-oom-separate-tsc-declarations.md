# 0099. Fix Build OOM — Separate tsc Declarations from tsdown Bundling

**Date**: 2026-04-30
**Status**: Accepted
**Triggered by**: Cloudflare Workers CI/CD build failing with `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory` during `pnpm run build`. The 2GB heap limit in Cloudflare's build environment was exceeded by the server package's tsdown build.

## Context

The server package uses tsdown (rolldown-based bundler) to produce ESM output for 76+ entry points in `unbundle` mode. The tsdown config included `dts: { eager: true }` to generate `.d.ts` declaration files alongside the `.mjs` bundles.

The build pipeline was:

```
tsc --noEmit          → type-check only (no output)
tsdown                → bundle JS + generate .d.ts (via rolldown-plugin-dts)
```

This worked locally (machines with 8-16GB RAM) but consistently OOMed on Cloudflare Workers CI/CD, which has a 2GB heap limit.

### Why `eager: true` existed

Added in commit `3472a22` to fix cross-package type resolution. Without `eager`, rolldown-plugin-dts couldn't resolve types from `@backlog-mcp/shared` (inlined via `noExternal`). The `eager` option tells the plugin to load the entire TypeScript project upfront so cross-file type resolution works.

### The memory profile

| Configuration | Peak Memory | Time | dts Output | Works? |
|---|---|---|---|---|
| `dts: { eager: true }` | **3.5 GB** | 16s | ✅ 82 `.d.mts` files | ❌ OOMs on CF |
| `dts: true` (no eager) | 631 MB | error | ❌ fails to resolve shared | ❌ |
| `dts: false` | 158 MB | 200ms | ❌ none | ✅ but no types |

The `eager` option was the sole cause of the 3.5GB spike. It forces rolldown-plugin-dts to instantiate a full TypeScript program with all 76 entry points loaded simultaneously — the same work `tsc` does, but wrapped in rolldown's plugin infrastructure with additional overhead.

## Options Considered

### Option A: Enable `isolatedDeclarations` in tsconfig (rejected)

`isolatedDeclarations: true` switches rolldown-plugin-dts from tsc to **oxc-transform** for dts generation — per-file, no program context needed, dramatically faster and lighter.

**Why it failed**: `noExternal: ['@backlog-mcp/shared']` causes tsdown to process shared package source files directly. The shared package's Zod schemas (`z.object(...)`, `z.enum(...)`, `.extend().strict()`) produce complex inferred types that are fundamentally incompatible with `isolatedDeclarations`. TypeScript's `isolatedDeclarations` requires explicit type annotations on all exports — Zod's generic inference chains can't satisfy this without invasive `as any` casts throughout the shared package.

Attempted: added `isolatedDeclarations: true` to server tsconfig, fixed all 29 errors in server source files (adding explicit return types and variable annotations). But the 18 errors in shared's Zod schemas were unfixable without destroying type safety.

**Dead end**: The shared package's Zod-first design is architecturally correct. Rewriting schemas to satisfy `isolatedDeclarations` would mean abandoning Zod's type inference — the primary reason for using Zod.

### Option B: Pin Node.js version to 24 for larger heap (rejected)

Cloudflare's v3 build image ignores `engines` in package.json. Node version is controlled via `.nvmrc` or `NODE_VERSION` env var.

**Why rejected**: This treats the symptom (not enough RAM) rather than the disease (build uses 3.5GB for a tiny package). Node 24's default heap is still 4GB — one more dependency away from hitting it again.

### Option C: Upgrade tsdown/rolldown to latest (attempted, insufficient)

Updated tsdown `0.20.1` → `0.21.10`, rolldown `rc.1` → `rc.17`, rolldown-plugin-dts `0.21.7` → `0.23.2`.

**Result**: Build still used 3.5GB with `eager: true`. The memory issue is architectural (loading full TS program), not a bug in older versions. The upgrade was kept for other reasons (deprecated option migration, bug fixes) but didn't solve the OOM.

**Side effect**: tsdown 0.21 made `skipNodeModulesBundle` + `noExternal` mutually exclusive, requiring migration to `deps.alwaysBundle`.

### Option D: Disable dts in tsdown, use tsc for declarations (accepted) ✅

Split responsibilities:
- **tsc**: type-check + emit `.d.ts` declarations (what it's designed for)
- **tsdown**: bundle JS only (what it's designed for)

The previous build was paying for tsc **twice**: once explicitly (`tsc --noEmit`) for type-checking, and again implicitly inside rolldown-plugin-dts's `eager` mode which spawns its own tsc instance.

## Decision

Separate declaration generation from JS bundling:

```
tsdown (dts: false)   → bundle .mjs files (158 MB peak)
tsc (emitDeclarationOnly) → emit .d.ts files (501 MB peak)
```

Build script: `"build": "tsdown && tsc"` (tsdown first because it has `clean: true` which wipes `dist/`; tsc writes into the cleaned directory after).

### Changes

1. **`tsdown.config.ts`**: `dts: false`, migrated `skipNodeModulesBundle`/`noExternal` → `deps.alwaysBundle` (tsdown 0.21 API)
2. **`tsconfig.json`** (server): added `emitDeclarationOnly: true`, `outDir: "dist"`
3. **`package.json`** (server): build script `tsdown && tsc`, exports point to `.d.ts` instead of `.d.mts`

### Why `.d.ts` instead of `.d.mts`

tsdown's dts plugin generated `.d.mts` to match the `.mjs` output extension. tsc generates `.d.ts` from `.ts` source files. The `.d.mts` extension is only needed for mixed CJS/ESM packages to disambiguate module types. This package is ESM-only (`"type": "module"`), so `.d.ts` works correctly.

## Result

| Metric | Before | After | Change |
|---|---|---|---|
| Peak memory | 3.5 GB | 511 MB | **-86%** |
| Build time | ~17s | ~7s | **-59%** |
| dts output | 82 `.d.mts` | 82 `.d.ts` | equivalent |
| JS output | 100 `.mjs` | 100 `.mjs` | identical |
| Tests | 729 pass | 729 pass | no regression |

The build now fits comfortably within Cloudflare's 2GB heap limit with ~1.5GB headroom.

## Consequences

- **Positive**: Build is 7x lighter on memory, faster, and each tool does exactly one job.
- **Positive**: No more duplicate tsc invocations (was running tsc for `--noEmit` check AND inside rolldown-plugin-dts).
- **Positive**: tsdown upgraded to 0.21 with modern `deps` API.
- **Neutral**: Declaration files are `.d.ts` instead of `.d.mts`. Functionally equivalent for ESM-only packages.
- **Negative**: tsc's `emitDeclarationOnly` doesn't bundle declarations — each source file gets its own `.d.ts`. For this package (one public export in `index.ts`), this is fine. If we ever need a single bundled `.d.ts`, we'd need a separate tool like `dts-bundle-generator`.
- **Watch**: If `isolatedDeclarations` support improves in Zod or oxc, revisiting `dts: true` with oxc-transform would eliminate the tsc step entirely (~158MB total).
