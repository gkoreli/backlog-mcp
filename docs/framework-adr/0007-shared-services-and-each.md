# 0007. Shared Reactive Services Replace expose() + Reactive List Rendering

**Date**: 2026-02-09
**Status**: Accepted
**Depends on**: [0001-web-component-framework](./0001-web-component-framework.md), [0003-migration-gaps-and-debt-tracker](./0003-migration-gaps-and-debt-tracker.md), [0006-framework-review-gap-resolution](./0006-framework-review-gap-resolution.md)

## Context

ADR 0006 identified two blocking gaps:

1. **Gap 6 (HIGH)**: No `expose()` API for public methods — blocks 5 components
2. **Gap 7 (MEDIUM)**: No reactive list rendering `each()` — blocks task-list, activity-panel

The proposed fix for Gap 6 was an `expose()` API similar to Vue's `defineExpose()`. This ADR rejects that approach in favor of a more resilient design.

## Decision: Shared Reactive Services Instead of expose()

### Why Not expose()

The `expose()` pattern (making methods callable on the DOM element) has fundamental problems:

1. **Tight coupling via querySelector** — Callers must know the DOM structure to find the target element. Moving a component in the tree breaks all callers.
2. **Untyped at call sites** — `(el as any).loadTask(id)` has no compile-time checking. Wrong method names, wrong argument types, missing arguments — all silent failures.
3. **Imperative, not reactive** — `expose()` encourages imperative "call this method when X happens" instead of reactive "this state changed, everything subscribed updates."
4. **No equivalent in React/Solid/Svelte** — React solved this problem decades ago by lifting state up. `useImperativeHandle` exists but is explicitly documented as an escape hatch. Solid, Svelte, and modern frameworks all use shared stores/context, not method exposure.

### The Pattern: Shared Reactive Services

Instead of exposing methods on DOM elements, extract shared application state into injectable services with signal-based properties:

```typescript
class AppState {
  // Selection
  readonly selectedTaskId = signal<string | null>(null);

  // Filters (owned by filter-bar, read by task-list)
  readonly filter = signal('active');
  readonly type = signal('all');
  readonly sort = signal(loadSavedSort());
  readonly query = signal<string | null>(null);
}
```

Components inject the service and read/write signals:

```typescript
// Producer (task-item click)
const state = inject(AppState);
state.selectedTaskId.value = taskId;

// Consumer (task-detail reacts)
const state = inject(AppState);
effect(() => {
  const id = state.selectedTaskId.value;
  if (id) loadTask(id);
});
```

### Why This Is Better

| Concern | expose() | Shared Service |
|---|---|---|
| Coupling | Structural (querySelector) | None (DI) |
| Type safety | None (as any) | Full (Signal<T>) |
| Reactivity | Imperative method calls | Automatic (signal subscription) |
| Testability | Need DOM, mount, query | Inject mock service |
| Multiple consumers | Each must querySelector | All subscribe to same signal |
| Component relocation | Breaks callers | No effect |
| Framework precedent | Vue escape hatch | React context, Solid stores, Angular services |

### Migration: What Changes

**Before** (querySelector + expose):
```
backlog-app → querySelector('task-filter-bar') → .setState()
backlog-app → querySelector('task-list') → .setState()
backlog-app → querySelector('task-detail') → .loadTask()
task-item → querySelector('task-detail') → .loadTask()
task-item → querySelector('task-list') → .setSelected()
```

**After** (shared service):
```
urlState change → AppState signals update
backlog-app subscribes → orchestrates URL ↔ AppState sync
task-filter-bar reads/writes AppState.filter/sort/type
task-item writes AppState.selectedTaskId
task-detail reacts to AppState.selectedTaskId
task-list reacts to AppState.filter/sort/type/selectedTaskId
```

### HACK Tags Resolved

| Tag | Previous Workaround | Resolution |
|---|---|---|
| `HACK:EXPOSE` | `(host as any).setState = ...` | Removed — service signals replace methods |
| `HACK:CROSS_QUERY` | `document.querySelector('task-detail')` | Removed — inject(AppState) |
| `HACK:DOC_EVENT` (partial) | `document.dispatchEvent(new CustomEvent('filter-change'))` | Replaced by AppState signal writes |

---

## Decision: each() Reactive List Rendering

### API Design

```typescript
each<T>(
  items: ReadonlySignal<T[]>,
  keyFn: (item: T, index: number) => string | number,
  templateFn: (item: ReadonlySignal<T>, index: ReadonlySignal<number>) => TemplateResult,
): TemplateResult
```

### Behavior

1. **Keyed reconciliation** — Items are tracked by key. When the array changes, only affected DOM nodes are added/removed/reordered.
2. **Per-item signals** — Each item gets a `ReadonlySignal<T>` that updates in-place when the array changes. The template reactively updates without remounting.
3. **Lifecycle management** — Each item's template has its own dispose chain. Removed items are properly cleaned up.
4. **Integration** — Returns a `TemplateResult` that works in any expression slot: `html\`<div>${each(...)}</div>\``

### Reconciliation Strategy

Simple keyed diff — O(n) for the common case:

1. Build map: `oldKey → { itemSignal, indexSignal, nodes, templateResult }`
2. On array change:
   - Walk new array, build new key list
   - For each new key: reuse existing entry (update signals) or create new
   - Remove entries whose key is gone (dispose template, remove nodes)
   - Reorder DOM nodes to match new array order
3. No longest-increasing-subsequence optimization — the task-list use case replaces the entire array on fetch, making LIS unnecessary

### Template Engine Integration

`each()` returns a value with `__templateResult: true`, so the existing `replaceMarkerWithBinding()` handles it as a nested template. The `mount()` method sets up the reactive effect internally.

---

## Consequences

### Positive

- **expose() API is permanently unnecessary** — the framework will never need it
- **Type-safe cross-component communication** — compile-time errors for wrong state access
- **Testable without DOM** — services can be tested with `inject()` + `provide()` mock pattern
- **each() unblocks task-list and activity-panel migration**
- **Precedent alignment** — matches React, Solid, Angular patterns that have proven at scale

### Negative

- **AppState is a god object risk** — must be decomposed if it grows beyond ~10 signals. Current scope (5 signals) is fine.
- **each() has no LIS optimization** — full reorder on every change. Acceptable for current list sizes (<500 items).

### Components Unblocked

| Component | Was Blocked By | Now Unblocked Via |
|---|---|---|
| task-filter-bar | HACK:EXPOSE | AppState service |
| task-item | HACK:CROSS_QUERY | AppState service |
| task-detail | expose() for loadTask | AppState.selectedTaskId signal |
| task-list | expose() + each() | AppState + each() |
| activity-panel | each() | each() (future migration) |
| backlog-app | querySelector orchestration | AppState service |

### Updated Migration Critical Path

```
[This ADR] → Implement each() + AppState service →
Update task-filter-bar (remove HACK:EXPOSE) →
Update task-item (remove HACK:CROSS_QUERY) →
Connect task-detail to AppState →
Migrate task-list (each() + AppState) →
Update backlog-app (AppState orchestration) →
[Future] Migrate activity-panel → Migrate emitters → Remove all HACK tags
```
