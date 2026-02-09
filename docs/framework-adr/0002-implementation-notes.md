# 0002. Web Component Framework — Implementation Notes

**Date**: 2026-02-09
**Phase**: 1 (Core Primitives)
**Status**: Complete — 124 tests passing across 7 modules
**Companion ADR**: [0001-web-component-framework.md](./0001-web-component-framework.md)

---

## Purpose

This is the mandatory reference for anyone modifying or extending the framework. It contains the hard invariants of each module — the rules that, if violated, will introduce silent bugs.

---

## Module Invariants

### signal.ts — The Reactive Core

Everything depends on this module being correct. A bug here silently breaks every component.

**1. Dependency tracking is context-driven, not explicit.**
`activeObserver` is a module-level variable. A signal read registers as a dependency ONLY if `activeObserver !== null`. This global is swapped in computed's `update()` (line ~213) and effect's `runEffect()` (line ~316). Reading a signal in plain JavaScript code does NOT track it. This is not a bug — it's the design. The implication: if you add a new reactive primitive (like a future `watch()`), you MUST set `activeObserver` before calling user code and restore it after.

**2. Equality check is `Object.is()`, not `===`.**
Signal writes (line ~136) and computed value comparisons (line ~218) use `Object.is()`. This handles `NaN === NaN` correctly (Object.is returns true, preventing infinite loops). Changing this to `===` would cause `signal(NaN)` to notify on every write because `NaN !== NaN`.

**3. Computed is both a source AND an observer.**
`ComputedImpl` has an `_node` (with `observers`, like a signal — it's a source) and also acts as a `ReactiveNode` (with `sources` and `notify()` — it's an observer). This dual nature is what makes the diamond dependency (`A→B, A→C, B+C→D`) work correctly. D reads B and C; B and C read A. When A changes, dirty flags push up to D, but D only recomputes once when its value is pulled. If you refactor `ComputedImpl`, you must preserve BOTH interfaces.

**4. Dependencies are fully re-tracked on every execution.**
Before computed re-evaluates or effect re-runs, ALL previous source subscriptions are removed (lines ~206-210, ~309-313). Dependencies are discovered fresh on each run. This is what makes conditional dependencies work: `flag.value ? a.value : b.value` tracks `a` or `b` depending on `flag`, and switching `flag` correctly drops the unused signal. If you skip the "unsubscribe from previous sources" step, stale dependencies will trigger spurious updates.

**5. Batch only flushes at the outermost level.**
`batchDepth` counts nesting. `flushPendingEffects()` only runs when `batchDepth` drops to 0. Nested `batch()` calls must NOT trigger a flush. Without this, `batch(() => { a.value = 1; batch(() => { b.value = 2; }); c.value = 3; })` would flush after `b.value = 2`, defeating the purpose.

**6. Effect errors are logged, not thrown, and the effect stays alive.**
Line ~324: if an effect throws, `console.error` and continue. The effect is NOT disposed. This is deliberate — a temporary failure (network timeout, missing element) shouldn't permanently kill the effect. It will re-run on the next signal change and may succeed.

**7. Cleanup errors are always swallowed.**
Lines ~305, ~387: cleanup function errors are caught and ignored. Cleanup failure must not prevent the effect from running again or from being disposed.

**8. `flushPendingEffects()` copies the set before iterating.**
Line ~80: `[...pendingEffects]`. During effect execution, `notify()` may add NEW effects to the set. Iterating the live set would miss them or cause infinite loops. The copy means: effects scheduled during this flush cycle run in the NEXT flush. This is why cascading effects need two `flushEffects()` calls in tests.

**9. Circular computed detection uses a `computing` flag.**
Line ~187: if a computed tries to read its own value during computation, it throws "Circular dependency detected." Without this, it would recurse until stack overflow.

### context.ts — The Synchronous Boundary

**1. Context is STRICTLY synchronous. It does NOT survive microtasks.**
`runWithContext()` sets `currentComponent`, runs `fn()`, restores previous value. After `fn()` returns, the context is gone — even if `fn()` scheduled a microtask. This means: `inject()`, `effect()`, and `emitter.on()` called inside `await` expressions or `.then()` callbacks will throw "called outside setup()." This is intentional. All setup-time registration must happen synchronously.

**2. Context must be restored on error.**
The try/finally on lines ~41-47 ensures `currentComponent` is restored even if `fn()` throws. If this guarantee breaks, subsequent component setups would see the wrong context.

**3. Nested contexts work correctly.**
Inner `runWithContext()` temporarily replaces the outer context. When the inner function returns, the outer context is restored. This happens during component trees where parent setup creates child components.

### emitter.ts — Typed Pub/Sub

**1. `emit()` iterates a copy of the subscriber set.**
Line ~43: `[...set]`. A subscriber may unsubscribe itself during its callback (or subscribe new listeners). Without the copy, the iteration would skip or double-fire listeners.

**2. Subscriber errors don't propagate — other subscribers still fire.**
Lines ~44-49: each listener is wrapped in try/catch. One broken subscriber cannot prevent others from executing. Errors are logged with `console.error`.

**3. `on()` auto-registers a disposer when inside component context.**
Lines ~74-76: if `hasContext()` is true, the unsubscribe function is registered via `getCurrentComponent().addDisposer()`. This is what makes "subscriptions automatically clean up on disconnect" work. Outside context (in services, tests), no auto-disposal — the caller gets the unsubscribe function and must manage it.

**4. `toSignal()` creates a subscription that outlives the call site.**
The `on()` call inside `toSignal()` creates a persistent subscription. If called inside component context, it auto-disposes on disconnect (because `on()` handles that). If called outside context, the subscription is permanent. This is intentional but easy to forget.

### injector.ts — Dependency Injection

**1. Singleton identity is a hard contract: `inject(A) === inject(A)` always.**
Once an instance is cached, all subsequent `inject()` calls return the exact same object. Services depend on this for shared state. Breaking it means two parts of the app get different instances with diverging state.

**2. Failed construction is NEVER cached.**
Lines ~76-103: if `new Class()` or the factory throws, the error propagates and no instance is stored. The next `inject()` call tries again. If you accidentally cache a half-constructed instance, all future consumers get a broken service with no way to recover.

**3. `provide()` immediately clears the cache for that token.**
Line ~118-119: `singletonCache.delete(token)`. This is what makes test overrides work — `provide(A, mockFactory); inject(A)` returns the mock, not the previously cached real instance. If `provide()` doesn't clear the cache, overrides are silently ignored.

**4. Circular dependency detection uses an `instantiating` set.**
Lines ~68-74: before calling `new Class()`, add the token to `instantiating`. If a constructor calls `inject()` for a token already in the set, throw immediately. Without this: `A` needs `B`, `B` needs `A` → stack overflow.

**5. `createToken()` without a factory AND without `provide()` throws.**
Lines ~88-97: injection tokens that are not classes have no default constructor. If nobody called `provide()` and no default factory was given, `inject()` throws with a clear "No provider found" error.

### component.ts — Lifecycle and Props

**1. Setup runs once per DOM CONNECTION, not once per element lifetime.**
`connectedCallback` runs setup. `disconnectedCallback` sets `_mounted = false` and disposes everything. Re-adding the element to the DOM runs setup AGAIN from scratch. All internal state, effects, and subscriptions are recreated. This is intentional and matches Lit's behavior. During list reconciliation (future), elements that are moved in the DOM will re-initialize. This may be revisited (see Proposal 4 below).

**2. Props use Proxy with lazy signal creation.**
The props object is a `Proxy`. First access to `props.title` creates a `Signal<undefined>`. Setting `el._setProp('title', value)` creates-or-updates the backing signal. Direct property assignment on the element (`el.title = 'new'`) does NOT go through the Proxy — you MUST use `_setProp()`. The factory function handles this; only manual element manipulation has this gotcha.

**3. Setup errors render a fallback, not a crash.**
Lines ~158-185: if `setup()` throws, the error is caught, logged, and a fallback `<div style="color:red">` is rendered. Sibling components are completely unaffected. The component stays "mounted" (so `disconnectedCallback` can still clean up). The error does NOT propagate to the parent.

**4. `disconnectedCallback` MUST call `result.dispose()` AND `host.dispose()`.**
Lines ~190-195: template disposal cleans up DOM bindings/effects. Host disposal cleans up registered disposers (emitter subscriptions, etc.). Missing either one causes memory leaks.

### template.ts — DOM Binding Engine

**1. Expression slots use HTML comment markers (`<!--bk-N-->`).**
Each `${}` in the tagged template becomes `<!--bk-0-->`, `<!--bk-1-->`, etc. in the generated HTML. During DOM walk, these comments are found and replaced with bound text nodes, elements, or nothing. The `bk-` prefix is the collision boundary — attribute values containing `<!--bk-N-->` would break. This is acceptable because this pattern never appears in normal HTML.

**2. Signal detection determines binding type.**
In text positions, `isSignal(value)` determines whether to create a static text node or a reactive binding via `effect()`. In attribute positions, signals get effects; non-signals get one-time `setAttribute()`. This is the "implicit signals in templates" feature from the ADR — `${title}` just works because the engine detects the signal and subscribes.

**3. `class:name` uses `classList.toggle()`, not attribute manipulation.**
Lines ~381-388: `el.classList.toggle(className, !!value)`. This preserves other classes on the element. Using `setAttribute('class', ...)` would overwrite the static `class="..."` attribute.

**4. `@event` handlers are wrapped in try/catch.**
Lines ~443-449: handler errors are logged but don't crash the component or prevent other handlers. This is critical for error containment — a broken click handler must not take down the entire UI.

**5. Event modifiers are applied as wrapping layers.**
Lines ~402-440: `.stop` wraps the handler to call `e.stopPropagation()`. `.prevent` wraps to call `e.preventDefault()`. `.once` wraps to auto-unsubscribe. Keyboard modifiers (`.enter`, `.escape`) filter by `e.key`. Order matters: stop/prevent wrap first, then once, then keyboard. If you add new modifiers, you must decide where they go in this chain.

**6. null, undefined, and false render as nothing.**
Lines ~326-328: the marker comment is removed with no replacement. This makes `${condition && html\`...\`}` work as expected — falsy values produce zero DOM nodes.

**7. Array rendering is static (no reconciliation yet).**
Lines ~310-325: arrays are rendered once between start/end comment markers. Items are mounted sequentially. There is no keyed reconciliation — updating the array requires disposing and re-rendering. This is the biggest gap for the task-list migration (see Proposal 2).

**8. `dispose()` must clear both disposers and bindings arrays.**
Lines ~144-154: calling dispose twice must not throw or double-clean. The arrays are cleared after iteration.

### query.ts — Async Data Loading

**1. `fetchGeneration` is the race condition guard.**
Every call to `doFetch()` captures a `generation` from `++fetchGeneration`. Before writing to `data`, `error`, or `loading` signals, the code checks `generation === fetchGeneration && !disposed`. If another fetch started in the meantime, the older one silently drops its result. This is the ONLY thing preventing stale response overwrites.

**2. Every async call inside `effect()` MUST have `.catch(() => {})`.**
Lines ~264, ~277: `doFetch().catch(() => {})`. `effect()` is synchronous — it can't await the promise. If the promise rejects and nobody awaits it, Node/browsers log an unhandled rejection warning. The `.catch(() => {})` prevents this. The actual error handling happens inside `doFetch()` via try/catch around the await.

**3. In-flight promises must also have `.catch(() => {})`.**
Lines ~95-102, ~231: `promise.catch(() => {})` before `client.setInFlight(serialized, promise)`. The stored promise may be awaited by a dedup path (lines ~208-226), which has its own try/catch. But the stored promise itself needs a catch handler to prevent the unhandled rejection when `.finally()` runs on a rejected promise.

**4. `enabled()` is both a guard AND a tracked dependency.**
Lines ~191-192, ~262: `enabled()` is called inside the effect, which means signals read inside `enabled()` are tracked. When those signals change, the effect re-runs and re-evaluates whether to fetch. This is subtle: `enabled` isn't just a gate — it's reactive.

**5. `disposed` flag prevents writes after component unmount.**
Lines ~186, ~189, ~236, ~246, ~261: every async operation checks `!disposed` before writing to signals. Without this, a query that resolves after the component is removed from the DOM would write to detached signals — not a crash, but a memory leak.

**6. Cache invalidation uses element-wise prefix matching, not string prefix.**
Lines ~111-125: `invalidate(['tasks'])` matches `['tasks']`, `['tasks', '1']`, `['tasks', '1', 'x']`. It does NOT use string prefix matching (which would fail because `JSON.stringify(['tasks'])` = `'["tasks"]'` which is not a prefix of `'["tasks","1"]'`). It deserializes each key and checks element-by-element.

**7. `QueryClient` is a global singleton via `inject()`.**
Lines ~176-182: inside component context, `inject(QueryClient)` gets the shared cache. Outside context (tests, standalone), a local `QueryClient` is created. This means queries in tests don't share cache with production queries. Use `provide(QueryClient, () => new QueryClient())` in tests if you need a controlled cache.

---

## Cross-Module Dependencies

These are the places where one module's correctness depends on another module's internals.

| Dependent | Depends on | Why |
|---|---|---|
| emitter.ts `on()` | context.ts `hasContext()` | Auto-disposal registration |
| component.ts `connectedCallback` | context.ts `runWithContext()` | Enables inject/effect/on inside setup |
| component.ts `mountTemplate()` | template.ts `TemplateResult.mount()` | Renders the component's DOM |
| template.ts text bindings | signal.ts `effect()` | Reactive DOM updates |
| template.ts `isSignal()` check | signal.ts `SIGNAL_BRAND` | Detects signals in expression slots |
| query.ts `doFetch()` | signal.ts `effect()` | Auto-refetch when dependencies change |
| query.ts cache sharing | injector.ts `inject(QueryClient)` | Global singleton cache |
| query.ts disposal | context.ts `getCurrentComponent()` | Registers cleanup on disconnect |

**The critical path**: signal.ts → context.ts → component.ts → template.ts. A bug in signal.ts propagates through every layer. A bug in context.ts breaks DI and auto-disposal. A bug in template.ts is contained to rendering.

---

## Gotchas: Things That Look Like They Should Work But Don't

These are the "why doesn't this work?" questions that will come up.

### 1. Object mutation doesn't trigger updates
```typescript
const data = signal({ x: 1 });
data.value.x = 2; // NOTHING HAPPENS — same reference, Object.is returns true
data.value = { ...data.value, x: 2 }; // THIS works — new reference
```
Signals track by reference, not by deep equality. This is the same as React's `useState` and Vue's `ref()` for objects.

### 2. Reading signals outside reactive context doesn't track
```typescript
const x = count.value + 1; // Pure JS — no tracking
effect(() => { x; }); // x is a number, not a signal — no reactivity
effect(() => { count.value; }); // THIS tracks — count read inside effect
```

### 3. `inject()` inside async code throws
```typescript
component('my-el', async (props) => { // DON'T DO THIS
  const api = inject(BacklogAPI); // throws: "called outside setup"
});

component('my-el', (props) => { // DO THIS
  const api = inject(BacklogAPI); // works — synchronous in setup
  effect(() => { api.fetch(); }); // api captured in closure, works anywhere
});
```
The setup function MUST be synchronous. Capture services synchronously, use them asynchronously.

### 4. `when()` with signal condition doesn't react to changes
```typescript
// STATIC — evaluates show.value ONCE at render time
const result = when(show, html`<span>visible</span>`);

// REACTIVE — use computed() for reactive conditional rendering
const content = computed(() =>
  show.value ? html`<span>visible</span>` : null
);
```
`when()` is a convenience for static conditions. For reactive conditions, use `computed()` in a template slot.

### 5. Direct element property assignment doesn't update props
```typescript
const el = document.createElement('my-component');
el.title = 'new'; // DOES NOT update the prop signal
(el as any)._setProp('title', 'new'); // THIS updates the signal
```
The factory function handles this automatically. This only matters for manual DOM manipulation.

### 6. Cascading effects need multiple flushes in tests
```typescript
effect(() => { derived.value = source.value * 10; }); // effect A
effect(() => { results.push(derived.value); });         // effect B

source.value = 2;
flushEffects(); // runs A → derived = 20 → schedules B
flushEffects(); // runs B → reads derived = 20
```
Each flush cycle only runs effects that were pending at the START of that cycle. Effects scheduled DURING a cycle run in the next one.

---

## Error Boundaries Summary

| Location | What happens on error | Why |
|---|---|---|
| `effect()` callback | Logged, effect stays alive | Temporary failures shouldn't be permanent |
| Effect cleanup function | Swallowed silently | Cleanup failure must not block next execution |
| `emit()` subscriber | Logged, other subscribers still fire | One broken listener can't kill the bus |
| `@event` handler | Logged, component stays mounted | Broken handler can't crash the UI |
| `component()` setup | Caught, fallback rendered, siblings unaffected | Error containment at component boundary |
| `inject()` constructor | Propagated, NOT cached | Caller must handle; retry possible |
| Computed circular | Thrown immediately | Must fail fast, not infinite loop |
| DI circular | Thrown immediately | Must fail fast, not stack overflow |
| Disposer errors | Swallowed silently | Disposal must always complete |

---

## Open Gaps (Action Needed)

### Gap 1: effect() Does Not Auto-Dispose in Component Context (HIGH)

`emitter.on()` auto-registers a disposer when `hasContext()` is true. `effect()` does not. This means component effects leak after disconnect unless the developer manually captures and disposes them. Fix: ~5 lines in `effect()`.

### Gap 2: No Reactive List Reconciliation (HIGH)

Arrays are rendered statically. Changing an array signal requires full re-render of the list. This blocks the task-list migration — the primary motivation for the framework. Fix: ~80-120 lines for insert/remove reconciliation with key matching.

### Gap 3: `when()` is Not Reactive (MEDIUM)

`when(signalCondition, template)` evaluates the signal once. It does not re-evaluate when the signal changes. Developers must use `computed()` for reactive conditionals. This may be surprising. Fix: make `when()` return a reactive binding that responds to signal changes.

### Gap 4: No AbortController for query() (LOW)

Stale fetches are ignored but not cancelled. The network request completes, consuming bandwidth. Fix: opt-in AbortController via options.

### Gap 5: No TypeScript CI Gate for viewer/ (MEDIUM)

Framework code has type annotations but `pnpm typecheck` only checks `src/`. Fix: add `typecheck:viewer` script.

---

## Estimation Accuracy

| File | ADR Estimate | Actual | Overshoot | Root cause |
|---|---|---|---|---|
| signal.ts | ~120 | ~280 | +133% | Dual source/observer nature, observer management |
| context.ts | ~20 | ~50 | +150% | ComponentHost interface, hasContext() |
| emitter.ts | ~30 | ~75 | +150% | Re-entrancy safety, toSignal() bridge |
| injector.ts | ~60 | ~100 | +67% | Circular detection, error clearing |
| component.ts | ~120 | ~155 | +29% | Close — Proxy simpler than expected |
| template.ts | ~270 | ~310 | +15% | Close — marker approach clean |
| query.ts | ~50 | ~185 | +270% | Async boundary complexity massively underestimated |

**Total: ADR ~680, actual ~1,220 (+80%).** The overshoot is error handling and type safety that makes the code production-grade. The core logic density matches estimates. Future estimates should apply a 2x multiplier for anything involving async/reactive boundaries.

---

## Test Cases That Caught Real Bugs

| Test | Bug caught | Module |
|---|---|---|
| Diamond dependency (A→B, A→C, B+C→D) | D recomputed twice | signal.ts |
| Cascading effects | Single flush insufficient | signal.ts |
| Cache invalidation prefix matching | JSON string prefix ≠ array prefix | query.ts |
| Unhandled promise rejections | 3 separate leak paths in query lifecycle | query.ts |
| Subscriber self-unsubscribe during emit | Iterator invalidation | emitter.ts |
