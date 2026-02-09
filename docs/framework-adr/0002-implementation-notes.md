# Web Component Framework — Implementation Notes

**Date**: 2026-02-09
**Phase**: 1 (Core Primitives)
**Status**: Complete — 124 tests passing across 7 modules
**Companion ADR**: [0001-web-component-framework.md](./0001-web-component-framework.md)

---

## Overview

This document captures implementation insights, deviations from the ADR, and adjacent high-impact issues discovered during the Phase 1 implementation of the web component framework (`viewer/framework/`).

### What Was Implemented

| Phase | Module | Tests | Description |
|---|---|---|---|
| 1 | `signal.ts` | 35 | signal(), computed(), effect(), batch() — push-pull hybrid reactivity |
| 2 | `context.ts` | 8 | runWithContext(), getCurrentComponent() — setup context for pure-function DI |
| 3 | `emitter.ts` | 14 | Emitter\<T\> — typed pub/sub replacing document.dispatchEvent |
| 4 | `injector.ts` | 17 | inject(), provide() — class-as-token auto-singleton DI |
| 5 | `component.ts` | 12 | component() — lifecycle, typed props via Proxy, error boundaries |
| 6 | `template.ts` | 24 | html tagged template — text/attr/class/event bindings, when(), nesting |
| 7 | `query.ts` | 14 | query(), QueryClient — async data loading with cache and race handling |

---

## Actual Line Counts vs. ADR Estimates

| File | ADR Estimate | Actual | Delta | Notes |
|---|---|---|---|---|
| `signal.ts` | ~120 | ~280 | +133% | Push-pull hybrid required careful observer management. ComputedImpl carries dual source/observer nature. |
| `context.ts` | ~20 | ~50 | +150% | Added `hasContext()` utility + ComponentHost interface + JSDoc. |
| `emitter.ts` | ~30 | ~75 | +150% | Re-entrancy safety (iterate copy) and `toSignal()` bridge added lines. |
| `injector.ts` | ~60 | ~100 | +67% | Circular dependency detection + constructor failure handling + createToken(). |
| `component.ts` | ~120 | ~155 | +29% | Close to estimate. Proxy + Map for props is clean. |
| `template.ts` | ~270 | ~310 | +15% | Close to estimate. Comment-marker approach works well. |
| `query.ts` | ~50 | ~185 | +270% | **Biggest underestimate.** Race conditions, promise rejection handling, retries, cache invalidation. |
| `index.ts` | ~10 | ~65 | N/A | Barrel with type re-exports. |

**Total: ADR estimated ~680 lines, actual ~1,220 lines.** The 80% overshoot is concentrated in `query.ts` (+135) and `signal.ts` (+160). The additional lines are error handling, type safety, and documentation that make the code production-grade rather than prototype-grade.

---

## Key Implementation Insights

### 1. Effect-Driven Async Is an Inherently Complex Boundary

The ADR describes `query()` as "~50 lines built on signals." In practice, the synchronous `effect()` / async `doFetch()` boundary creates three distinct problems:

**Unhandled promise rejections**: `effect()` is synchronous. Calling an async function inside it produces a fire-and-forget promise. If the fetcher rejects, the rejection is unhandled. **Solution**: explicit `.catch(() => {})` on every async call site inside effects.

**In-flight dedup + rejection**: When `QueryClient.setInFlight()` stores a fetcher promise and that promise rejects, any `.finally()` chain triggers an unhandled rejection. **Solution**: `promise.catch(() => {})` before storing, and using a `handled` copy for cleanup.

**Generation tracking for staleness**: When a dependency changes mid-flight, the old fetch must be "invalidated" without actually aborting the network request (no AbortController yet). **Solution**: `fetchGeneration` counter — each fetch checks it's still current before writing signals.

**Takeaway**: Any reactive framework that integrates async operations needs a carefully designed boundary layer. This is where most real-world bugs will occur.

### 2. Computed Values Have Dual Nature (Source + Observer)

`ComputedImpl` must simultaneously be:
- A **source** — other computeds/effects read it (like a signal with observers)
- An **observer** — it reads from signals/other computeds (like an effect with sources)

This dual nature creates the `ReactiveNode` interface bridging. The diamond dependency test (`A → B, A → C, B+C → D`) confirmed correctness — D recomputes exactly once when A changes, validating the push-dirty/pull-fresh design.

### 3. Template Markers Use HTML Comments, Not Template Holes

The ADR describes expression "holes" in `<template>` elements. The actual implementation uses comment markers (`<!--bk-0-->`) because:
1. HTML attributes can't contain arbitrary JS objects — need index-based association
2. Comment nodes are cleanly replaceable with text/element nodes during mount
3. For attribute positions, the marker appears in the attribute value and is pattern-matched

**Known limitation**: Attribute values containing the marker pattern `<!--bk-N-->` would break. Acceptable because the `bk-` prefix won't appear in normal HTML.

### 4. Cascading Effects Need Multiple Flushes

When effect A writes to a signal that effect B depends on, a single `flushEffects()` only runs effect A. Effect B gets scheduled but needs another flush. This prevents infinite loops but means tests for cascading effects need:

```typescript
flushEffects(); // runs effect A → writes signal → schedules effect B
flushEffects(); // runs effect B → reads updated signal
```

This is correct behavior but was not documented in the ADR.

### 5. Effect Auto-Disposal Gap (ACTION NEEDED)

**The current `effect()` does NOT auto-register disposers in component context.** If a component author writes `effect(() => { ... })` inside setup, the effect continues running after disconnect unless manually disposed.

This violates the ADR's promise: "all subscriptions, effects, and event bindings are disposed automatically." Emitter subscriptions (via `on()`) DO auto-dispose because emitter.ts checks `hasContext()`. The same pattern should be applied to `effect()`.

**Fix** (~5 lines):
```typescript
// In effect():
const dispose = () => { /* existing disposal */ };
if (hasContext()) {
  getCurrentComponent().addDisposer(dispose);
}
return dispose;
```

### 6. Proxy Props Are Simpler Than Expected

The ADR describes Proxy-based prop discovery as a complex mechanism. In practice: a `Map<string, Signal>` with a Proxy `get` trap that creates signals on first access and a `setProperty` method that updates them. Elegantly simple — no schema, no attribute observation, just intercept-and-create.

---

## Adjacent High-Impact Issues & Proposals

These issues were identified during implementation but are NOT in the current ADR. Each has significant architectural impact.

### Proposal 1: Effect Auto-Disposal in Component Context

**Impact: HIGH — prevents memory leaks in every component**
**Effort: ~5 lines**
**Risk: Low**

See Insight #5 above. Effects created outside component context (services, tests) are unaffected. Only component-setup effects gain auto-cleanup — which is the desired behavior.

### Proposal 2: Reactive List Primitive (.map() + key Reconciliation)

**Impact: HIGH — unblocks task list migration**
**Effort: ~80-120 lines**
**Risk: Medium**

The current `template.ts` handles arrays by mounting all items statically. There is NO keyed reconciliation — when the array changes, all items are destroyed and recreated. The ADR describes `.map()` + `key` as a core feature, but v1 only handles static arrays.

Without this, the task list would rebuild the entire DOM on every filter/sort/SSE event — exactly the problem the framework was designed to solve.

A reactive list primitive would:
1. Accept a `Signal<T[]>` and a mapping function
2. Track items by key
3. On change: insert new, remove deleted, reorder moved (v1: no move detection, clear+recreate for reorders)
4. Existing items receive signal updates through bindings

### Proposal 3: AbortController Integration for query()

**Impact: MEDIUM — prevents wasted network requests**
**Effort: ~20 lines**
**Risk: Low (opt-in)**

`query()` handles staleness by ignoring stale responses, but the network request still completes. AbortController would cancel stale fetches. **Complication**: changes fetcher signature. Should be opt-in via options.

### Proposal 4: Component Re-Mounting Strategy

**Impact: MEDIUM — affects lifecycle during list reorder**
**Effort: ~30 lines**
**Risk: Medium**

Currently, removing and re-adding a component to the DOM re-runs `setup()` completely. During list reorder (which detaches and reattaches elements), this means all internal state is lost and data is re-fetched.

Options:
1. **Re-initialize** (current): Simple, predictable. Matches Lit.
2. **Preserve-on-reconnect**: Cache setup result, only re-attach bindings. Preserves state across moves.

**Recommend deferring** until list reconciliation is implemented and impact can be measured.

### Proposal 5: TypeScript Strict Mode for viewer/

**Impact: MEDIUM — catches bugs at compile time**
**Effort: ~1 line (add script)**
**Risk: Low**

The viewer code has never been type-checked in CI. `pnpm typecheck` only checks `src/`. Framework code has type annotations but no gate.

**Fix**: Add `"typecheck:viewer": "tsc --noEmit -p viewer/tsconfig.json"` to package.json scripts and include it in the build pipeline.

### Proposal 6: Shared Test Utilities

**Impact: LOW-MEDIUM — reduces test duplication**
**Effort: ~30 lines**

Recurring patterns across 7 test files:
- `createMockHost()` — context.test.ts, emitter.test.ts
- `uniqueTag()` — component.test.ts
- `mount()` — template.test.ts
- `deferred()` — query.test.ts

Extract to `viewer/framework/test-helpers.ts`.

---

## Event Listener Leaks in Current Components (Migration Priority)

The ADR's Problem 6 ("rarely unsubscribe") was confirmed during implementation review:

| Component | Issue | Severity |
|---|---|---|
| `task-list.ts` | 5+ document.addEventListener, NO disconnectedCallback | High — runs on every filter |
| `task-item.ts` | Click handlers in attachListeners(), destroyed by innerHTML but never explicitly removed | High — created/destroyed per item |
| `main.ts` | 8 document.addEventListener, never removed | Acceptable — app root singleton |
| `task-detail.ts` | setTimeout for click handlers, no cleanup | Medium |
| `spotlight-search.ts` | Keyboard listeners, no cleanup | Medium |

### Recommended Migration Order (Revised from ADR)

The ADR's Phase 8-9 (migrate task-item then task-list) is correct but should be expanded:

1. **task-item** — highest churn, most event leaks, leaf component, validates factory composition
2. **task-badge** — simplest leaf, validates the simplest component() usage
3. **task-filter-bar** — emits events, validates Emitter pattern
4. **task-list** — validates list rendering, query(), SSE integration, and is the primary performance target
5. **task-detail** — complex, validates computed views and query()
6. **spotlight-search** — complex, validates keyboard event modifiers and query()
7. Remaining components in any order

Rationale: Start from leaves (no children to coordinate), validate each framework feature in isolation, then tackle containers that exercise composition and data loading.

---

## Testing Architecture Decisions

### happy-dom as DOM Environment

Added `happy-dom` (vs. jsdom) as dev dependency. Per-file opt-in via `// @vitest-environment happy-dom` comment — only Phases 5-7 need DOM. Phases 1-4 are pure logic with zero DOM dependency, keeping them fast (~10ms each).

### Test Organization

Tests are colocated with implementation files (`signal.ts` + `signal.test.ts` in same directory). This follows the ADR's principle of self-contained files and makes it obvious which test covers which module.

### Critical Test Cases That Caught Real Bugs

1. **Diamond dependency** (signal.test.ts) — Caught initial over-notification where D computed twice
2. **Cascading effects** (signal.test.ts) — Revealed the multi-flush requirement
3. **Cache invalidation** (query.test.ts) — Caught key prefix matching bug (JSON serialization boundary mismatch)
4. **Unhandled rejections** (query.test.ts) — Caught 3 separate promise rejection leak paths
