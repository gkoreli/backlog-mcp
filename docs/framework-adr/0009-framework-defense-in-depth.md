# 0009. Framework Defense-in-Depth — Observer Isolation, Loop Detection, HostAttrs, PropInput

**Date**: 2026-02-10
**Status**: Implemented
**Resolves**: ADR 0008 Gaps 1–4
**Depends on**: [0008-effect-scheduling-and-batching-gaps](./0008-effect-scheduling-and-batching-gaps.md)

## Context

ADR 0008 identified four framework gaps during the Phase 11 migration. While the
immediate application bugs were fixed, the underlying framework weaknesses remained.
This ADR implements all four as defense-in-depth measures with long-term resilience.

## Decision 1: Observer Isolation via `untrack()`

### Problem

When `connectedCallback` fires synchronously inside a parent effect (e.g., via
`replaceChildren` or `appendChild`), the child component's setup reads signals
with the parent's `activeObserver` still set. This tracks child dependencies as
parent dependencies — causing unnecessary re-runs or, with manual DOM code, loops.

### Solution

Added `untrack(fn)` to `signal.ts` — sets `activeObserver = null` for the
duration of `fn`, then restores it. `component.ts` wraps the entire
`connectedCallback` body in `untrack()`.

```typescript
// signal.ts
export function untrack(fn: () => void): void {
  const prev = activeObserver;
  activeObserver = null;
  try { fn(); }
  finally { activeObserver = prev; }
}

// component.ts — connectedCallback
untrack(() => {
  // setup, mountTemplate, runMountCallbacks
});
```

### Why `untrack()` and not save/restore

`untrack(fn)` is a common reactive primitive (Solid, Preact Signals, Angular).
It's a general-purpose tool that components can also use directly when they need
to read a signal without tracking it. Exposing it as a public API rather than
an internal-only mechanism makes the framework more composable.

### Invariants

- Signal reads inside `untrack()` are never tracked by any outer effect.
- `untrack()` restores the previous observer even if `fn` throws.
- Child components always mount in an isolated observer context.

## Decision 2: Effect Loop Detection

### Problem

An effect that writes to a signal it reads creates an infinite re-trigger loop
across microtask boundaries. Each write schedules a microtask flush, which re-runs
the effect, which writes again. The UI freezes with no error message.

### Solution

Per-effect run counter with time-window reset. Each `EffectNode` tracks:
- `runCount`: consecutive runs in the current window
- `windowStart`: timestamp of the first run in the current window

If `runCount` exceeds `MAX_EFFECT_RERUNS` (100) within `LOOP_WINDOW_MS` (2000ms),
the effect is auto-disposed with a `console.error`. The window resets when the
effect hasn't been re-triggered for longer than the window.

```typescript
const now = Date.now();
if (now - node.windowStart > LOOP_WINDOW_MS) {
  node.runCount = 0;
  node.windowStart = now;
}
node.runCount++;
if (node.runCount > MAX_EFFECT_RERUNS) {
  console.error(`Effect exceeded maximum re-run limit...`);
  node.disposed = true;
  // Unsubscribe from all sources
  return;
}
```

### Why time-window and not flush-epoch

Each self-triggered re-run creates a new microtask, so each `flushPendingEffects`
call has a different epoch. A per-flush-epoch counter would reset on every run,
never accumulating. The time window correctly catches loops across microtask
boundaries while allowing legitimate high-frequency updates (e.g., animation
frames) that are spaced over longer periods.

### Why `console.error` + dispose, not `throw`

Throwing inside `flushPendingEffects` would crash the entire flush queue,
potentially breaking unrelated effects. Disposing the problematic effect and
logging an error keeps the rest of the UI functional — defense-in-depth.

### Invariants

- Effects that write to their own dependencies are auto-disposed after 100 runs.
- Normal effects (reading A, writing B) are never affected.
- The disposed effect is fully cleaned up (sources unsubscribed, removed from pending).

## Decision 3: Factory `class` via HostAttrs

### Problem

Factory composition (`comp-factory-composition`) had no way to pass CSS classes
to the created host element. Components that needed external styling required
imperative workarounds (`HACK:FACTORY_CLASS`).

### Solution

Added `HostAttrs` interface as an optional second argument to factory functions:

```typescript
export interface HostAttrs {
  class?: PropInput<string>;
}

export type ComponentFactory<P> = (
  props: { [K in keyof P]: PropInput<P[K]> },
  hostAttrs?: HostAttrs,
) => TemplateResult;
```

The `class` attribute is applied via `classList.add/remove`, not `className`
assignment. This ensures:
- External classes don't overwrite internal `class:name` directives
- Internal `classList.toggle()` doesn't remove external classes
- Reactive class changes diff the previous/next class lists

### Why separate argument, not merged into props

Merging `class` into the props namespace creates collisions — a component might
have a legitimate `class` prop with different semantics. The second argument
clearly separates component semantics (props) from host styling (HostAttrs).
This also mirrors the HTML distinction between element attributes and component
properties.

### Invariants

- `HostAttrs.class` accepts both static strings and reactive signals.
- Class application uses classList add/remove, never className assignment.
- External classes and internal class directives coexist without interference.

## Decision 4: Static Prop Auto-Wrapping via PropInput

### Problem

Factory props required `Signal<T>` even for static values that never change,
leading to verbose `signal(staticValue)` wrapping at every call site.

### Solution

Added `PropInput<T> = T | Signal<T> | ReadonlySignal<T>` type. The factory and
template engine detect signals via `isSignal()` (SIGNAL_BRAND check) and handle
both cases:

- **Signal**: subscribe to changes, update child prop on each change
- **Plain value**: set once via `_setProp()`, no subscription needed

```typescript
// Before: verbose, signal wrapper for static value
const icon = SvgIcon({ src: signal(ringIcon) });

// After: plain value accepted, auto-wrapped internally
const icon = SvgIcon({ src: ringIcon });

// Reactive values still work
const icon = SvgIcon({ src: computed(() => url) });
```

### Why auto-wrap at mount, not at factory call

Auto-wrapping at factory call time would create orphan signals that are never
disposed. Instead, the template engine and `mountTemplate` detect the value type
at mount time. Plain values are set once via `_setProp` with no subscription.
Signals get subscriptions that are cleaned up on component disconnect.

### Invariants

- Plain values are set once, no subscription overhead.
- Signal values are subscribed and update reactively.
- The `isSignal()` check (SIGNAL_BRAND) prevents double-wrapping.

## Files Changed

| File | Change |
|------|--------|
| `viewer/framework/signal.ts` | Added `untrack()`, loop detection fields and logic |
| `viewer/framework/component.ts` | `connectedCallback` wrapped in `untrack()`, added `PropInput`, `HostAttrs`, `ensureSignal`, `applyHostClass` |
| `viewer/framework/template.ts` | Factory slot handles `hostAttrs.class` and plain-value props |
| `viewer/framework/index.ts` | Exports `untrack`, `PropInput`, `HostAttrs` |
| `viewer/framework/invariants.test.ts` | 12 new tests covering all 4 features |
| `viewer/components/task-list.ts` | Removed `HACK:FACTORY_CLASS`, uses `HostAttrs` |
| `viewer/components/task-badge.ts` | Uses `HostAttrs` for icon class |
| `docs/framework-adr/0008-*` | Updated status to Resolved, references ADR 0009 |

## Test Coverage

All features are covered by invariant tests in `invariants.test.ts`:

- **untrack**: 3 tests — isolation, restore, connectedCallback integration
- **Loop detection**: 2 tests — auto-dispose on loop, normal effects unaffected
- **HostAttrs class**: 3 tests — static, reactive, non-interference with internals
- **PropInput auto-wrap**: 3 tests — plain value, signal, mixed
- **Total**: 200 framework tests passing (11 test files)

## Remaining Work

- **HACK:EXPOSE** in svg-icon.ts and copy-button.ts: Still needed for unmigrated
  consumers (task-detail, system-info-modal) that use innerHTML. Remove when those
  components are migrated to factory composition.
- **HACK:CROSS_QUERY** in backlog-app.ts: Remove when task-detail is migrated.
- **HACK:MOUNT_APPEND** in copy-button.ts: Remove when task-detail stops using
  innerHTML to create copy-button children.
