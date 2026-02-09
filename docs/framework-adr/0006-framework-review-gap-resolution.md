# 0006. Framework Review — Gap Resolution and Invariant Codification

**Date**: 2026-02-09
**Status**: Accepted
**Depends on**: [0001-web-component-framework](./0001-web-component-framework.md), [0002-implementation-notes](./0002-implementation-notes.md), [0003-migration-gaps-and-debt-tracker](./0003-migration-gaps-and-debt-tracker.md), [0004-framework-resilience-gaps](./0004-framework-resilience-gaps.md), [0005-props-vs-attributes-auto-resolution](./0005-props-vs-attributes-auto-resolution.md)

## Purpose

This ADR documents the comprehensive review of the framework implementation against all prior ADRs. It catalogs every gap found, records which gaps were resolved in this review, captures the remaining open gaps, and codifies the invariants that are now enforced by tests.

---

## Review Methodology

1. Read all 5 existing ADRs (0001–0005) to establish the specification
2. Read the skill definition (`.agents/skills/backlog-ui-framework/`) for the rule set
3. Read all 8 framework source modules and 7 test files
4. Cross-reference every ADR requirement against actual implementation
5. Classify gaps as: **resolved** (fixed in this review), **documented** (needs more design), or **deferred** (intentionally postponed)

---

## Gaps Found and Resolution Status

### Resolved in This Review

| # | Gap | Source | Severity | Resolution |
|---|---|---|---|---|
| 1 | `effect()` does NOT auto-dispose in component context | ADR 0002 Gap 1, ADR 0003 Gap 5 | **P0** | Added `setContextHook()` in signal.ts; component.ts wires up auto-disposal. Effects created during setup are now auto-registered as disposers on the component host. |
| 2 | `when()` is not reactive with signal conditions | ADR 0002 Gap 3, ADR 0004 Gap 9 | **HIGH** | Rewrote `when()` to return a `computed()` for signal conditions. Also added lazy callback form `when(signal, () => template)` to avoid eager evaluation of expensive branches. |
| 3 | No `onMount()` / `onCleanup()` lifecycle hooks | ADR 0004 Gap 5 | **HIGH** | New `lifecycle.ts` module with `onMount()` (runs after template mount, cleanup returned runs on disconnect) and `onCleanup()` (standalone cleanup registration). Wired into `component.ts` connectedCallback. |
| 4 | No `ref()` primitive for imperative DOM access | ADR 0003 Gap 2, ADR 0004 Gap 4 | **MEDIUM** | New `ref.ts` module with `ref<T>()`, `isRef()`, `REF_BRAND`. Template engine handles `ref="${myRef}"` attribute syntax — assigns `ref.current = element` on mount, sets to `null` on dispose. |
| 5 | Factory subscription leak in `mountTemplate()` | Undocumented | **HIGH** | `sig.subscribe()` return values in `mountTemplate()` are now registered as disposers on the `ComponentHostImpl`. Previously, subscriptions were created but never cleaned up. |

### Remaining Open Gaps (Need More Design)

| # | Gap | Source | Severity | Blocks | Notes |
|---|---|---|---|---|---|
| 6 | No `expose()` API for public methods | ADR 0003 Gap 1 | HIGH | 5 components | Requires API design decision: return `{ template, expose }` from setup, or add an `expose()` function callable during setup. Both have trade-offs. Current workaround: `(host as any).method = ...` tagged `HACK:EXPOSE`. |
| 7 | No reactive list rendering (`each()`) | ADR 0003 Gap 4, ADR 0004 Gap 2–3 | MEDIUM | task-list, activity-panel | Requires keyed reconciliation with scope lifecycle management. Static arrays work for now (same perf as pre-framework `innerHTML`). Tagged `HACK:STATIC_LIST`. |
| 8 | No error recovery / retry mechanism | ADR 0004 Gap 7 | LOW | None (error boundary exists) | Setup errors render a fallback but there's no retry path. Proposed: `retry` callback in `onError`. |
| 9 | No `provide()` scoping (subtree overrides) | ADR 0004 Gap 1 | LOW | Testing edge cases | Current DI is global-only. Two-tier lookup (component → ancestor → global) is proposed but not blocking any migration. `provide()` + `resetInjector()` in tests is sufficient. |
| 10 | No AbortController for `query()` | ADR 0002 Gap 4 | LOW | None | Stale fetches are ignored via generation guard but not cancelled. Network waste only. |

### Deferred (Intentionally)

| # | Gap | Reason |
|---|---|---|
| 11 | No `observedAttributes` → signal bridge | ADR 0003 Gap 6 — attribute-driven leaf components (svg-icon, task-badge) are SKIPPED for migration. No framework value. |
| 12 | Emitter migration during transition period | ADR 0003 Gap 3 — intentionally deferred until all consumers are migrated. Both systems coexist with `HACK:DOC_EVENT` tags. |

---

## Invariants Codified in Tests

The following invariants are now enforced by `viewer/framework/invariants.test.ts` (28 tests):

### Signal Invariants

| Invariant | Test | Module |
|---|---|---|
| Object.is() equality — NaN does not trigger infinite updates | `NaN does not trigger infinite updates` | signal.ts |
| Object.is() equality — -0 and +0 are different | `-0 and +0 are different` | signal.ts |
| Object mutation (same ref) does not trigger | `object mutation does not trigger` | signal.ts |
| Dependencies fully re-tracked on every execution | `conditional dependency switch works correctly` | signal.ts |
| Batch only flushes at outermost level | `inner batch does not flush` | signal.ts |
| Circular computed detection | `computed self-reference throws immediately` | signal.ts |

### Component Invariants

| Invariant | Test | Module |
|---|---|---|
| Effect auto-disposal on disconnect | `effects created during setup are disposed on disconnect` | signal.ts + component.ts |
| Multiple effects all auto-disposed | `multiple effects in setup are all auto-disposed` | signal.ts + component.ts |
| Effects outside context are NOT auto-disposed | `effects outside component context are NOT auto-disposed` | signal.ts |
| Setup error renders fallback, siblings unaffected | `setup error in one component does not affect siblings` | component.ts |
| Effect error logged but effect stays alive | `effect error is logged but effect stays alive` | signal.ts |
| Event handler error caught and logged | `event handler error is caught and logged` | template.ts |
| Cleanup errors are swallowed | `cleanup error does not prevent next execution` | signal.ts |
| Disposal errors don't prevent other disposers | `disposal cleanup error does not prevent other disposers` | component.ts |

### Template Invariants

| Invariant | Test | Module |
|---|---|---|
| XSS safety — text bindings use textNode.data | `user input in text binding renders as text, not HTML` | template.ts |
| XSS safety — script tags not executed | `script tags in text binding are not executed` | template.ts |
| when() reactive with signal conditions | `shows/hides content reactively when signal changes` | template.ts |
| when() lazy callback form | `supports lazy callback form for expensive branches` | template.ts |
| Auto-resolution: HTML attrs use setAttribute on framework components | `standard HTML attributes use setAttribute even on framework components` | template.ts |

### DI Invariants

| Invariant | Test | Module |
|---|---|---|
| Singleton identity: inject(A) === inject(A) | `inject() returns identical instance across all call sites` | injector.ts |
| Failed construction never cached | `failed construction is never cached — retry is possible` | injector.ts |
| Circular DI throws immediately | `DI circular dependency throws immediately` | injector.ts |

### Context Invariants

| Invariant | Test | Module |
|---|---|---|
| Context is synchronous-only | `context is gone after async boundary` | context.ts |
| Nested contexts restore correctly | `nested contexts restore correctly` | context.ts |

### Emitter Invariants

| Invariant | Test | Module |
|---|---|---|
| on() auto-disposes in component context | `subscription is cleaned up on disconnect` | emitter.ts |

### Query Invariants

| Invariant | Test | Module |
|---|---|---|
| Generation guard prevents stale overwrites | `stale response does not overwrite fresh response` | query.ts |

---

## New Modules Added

### `lifecycle.ts` — Post-mount and cleanup hooks

- `onMount(callback)` — runs after template is mounted to DOM. If callback returns a function, it runs on disconnect.
- `onCleanup(callback)` — registers standalone cleanup for disconnect.
- Both throw if called outside setup context.
- `runMountCallbacks()` — internal, called by component.ts after template mount.

### `ref.ts` — Element reference primitive

- `ref<T>()` — creates a `Ref<T>` container with `current: T | null`.
- `isRef()` — type guard for ref detection in template engine.
- `REF_BRAND` — symbol for brand checking.
- Template engine handles `ref="${myRef}"` in attribute position.

---

## Implementation Details

### Effect Auto-Disposal Mechanism

The challenge: `signal.ts` cannot import `context.ts` without creating a circular dependency (context.ts → component.ts → signal.ts). The solution: a late-bound hook.

```
signal.ts: exports setContextHook()
component.ts: imports setContextHook(), wires it up at module init
effect(): calls contextHook() to check for component context
```

When `effect()` is called during component setup:
1. `contextHook()` returns the `addDisposer` function from the active component
2. `effect()` creates its dispose function
3. The dispose function is registered as a disposer on the component host
4. On disconnect, `ComponentHostImpl.dispose()` calls all disposers, including effect dispose

### Reactive `when()` Mechanism

```typescript
when(signalCondition, template)
// Returns: computed(() => signal.value ? template : null)
```

The computed is detected by the template engine's signal handling in `replaceMarkerWithBinding()`. When the computed holds a TemplateResult:
1. Start/end markers are inserted in the DOM
2. An effect watches the computed value
3. When truthy: mount the template between markers
4. When falsy: remove nodes, dispose previous template
5. Cleanup on dispose removes all content and effects

### Factory Subscription Leak Fix

Before: `sig.subscribe()` return value was ignored in `mountTemplate()`.
After: `mountTemplate()` accepts optional `ComponentHostImpl`, registers each `unsub` as a disposer. The `connectedCallback` passes the host instance.

---

## Test Coverage Summary

| Module | Tests Before | Tests After | New Tests |
|---|---|---|---|
| signal.ts | 35 | 35 | 0 (covered by invariants.test.ts) |
| context.ts | 8 | 8 | 0 (covered by invariants.test.ts) |
| emitter.ts | 14 | 14 | 0 (covered by invariants.test.ts) |
| injector.ts | 17 | 17 | 0 (covered by invariants.test.ts) |
| component.ts | 12 | 12 | 0 (covered by invariants.test.ts) |
| template.ts | 30 | 30 | 0 (covered by invariants.test.ts) |
| query.ts | 14 | 14 | 0 (covered by invariants.test.ts) |
| lifecycle.ts | — | 8 | 8 (new module) |
| ref.ts | — | 6 | 6 (new module) |
| invariants.test.ts | — | 28 | 28 (cross-module invariants) |
| **Total** | **130** | **172** | **+42** |

---

## Migration Impact

### Unblocked by this review

- **All components**: Effect auto-disposal eliminates memory leak risk (P0 resolved)
- **task-filter-bar**: Can now use `ref()` instead of `HACK:REF` querySelector
- **task-detail**: `onMount()` replaces `setTimeout()` for deferred DOM access
- **All new components**: `onMount()` + `onCleanup()` provide clean lifecycle hooks

### Still blocked

- **task-item, task-list, task-detail, activity-panel, backlog-app**: Need `expose()` API (Gap 6)
- **task-list, activity-panel**: Need `each()` for efficient list rendering (Gap 7)

### Updated Critical Path

```
Fix expose() API → Migrate task-item → Migrate task-detail →
Migrate task-list (static) → Migrate activity-panel (static) →
Migrate backlog-app → Implement each() → Upgrade lists →
Migrate emitters → Remove HACK tags
```

---

## Decision Record

| Decision | Rationale |
|---|---|
| Late-bound hook for effect auto-disposal | Avoids circular import between signal.ts and context.ts |
| `when()` returns computed for signal conditions | Integrates with existing signal→DOM binding pipeline |
| `ref` uses attribute syntax (`ref="${myRef}"`) | Consistent with Vue/Solid patterns; no special template syntax needed |
| `onMount()` stores callbacks in WeakMap keyed by ComponentHost | No changes to ComponentHost interface; mount callbacks are one-shot |
| Factory subscription leak fix via ComponentHostImpl parameter | Minimal API change; only internal callers affected |
