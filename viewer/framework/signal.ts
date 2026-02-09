/**
 * signal.ts — Reactive primitives: signal(), computed(), effect()
 *
 * Push-pull hybrid model:
 * - Writes push "dirty" flags up the dependency graph
 * - Reads pull fresh values lazily (computed only recalculates when read)
 * - Multiple synchronous writes coalesce into one microtask flush
 *
 * Dependency tracking is automatic: reading a signal inside a computed
 * or effect registers it as a dependency. Dependencies are re-tracked
 * on every execution (dynamic/conditional tracking).
 */

// ── Brand symbol for signal detection in templates ──────────────────

export const SIGNAL_BRAND = Symbol.for('backlog.signal');

// ── Types ───────────────────────────────────────────────────────────

/** Readable reactive container. */
export interface ReadonlySignal<T> {
  readonly [SIGNAL_BRAND]: true;
  readonly value: T;
  /** Subscribe to value changes. Returns unsubscribe function. */
  subscribe(fn: (value: T) => void): () => void;
}

/** Read-write reactive container. */
export interface Signal<T> extends ReadonlySignal<T> {
  value: T;
}

// ── Internal tracking state ─────────────────────────────────────────

/**
 * The currently executing reactive context (computed or effect).
 * When non-null, any signal read during execution is recorded as a dependency.
 */
let activeObserver: ReactiveNode | null = null;

/**
 * Global epoch counter. Incremented on every signal write.
 * Used to determine if a computed needs recalculation: if a dependency's
 * lastChanged > this computed's lastChecked, the computed is stale.
 */
let globalEpoch = 0;

// ── Batching ────────────────────────────────────────────────────────

let batchDepth = 0;
const pendingEffects = new Set<EffectNode>();
let flushScheduled = false;

/**
 * Group multiple signal writes into a single update pass.
 * Nested batch() calls are supported — only the outermost triggers the flush.
 */
export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      flushPendingEffects();
    }
  }
}

function scheduleFlush(): void {
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flushPendingEffects);
  }
}

function flushPendingEffects(): void {
  flushScheduled = false;
  // Copy to avoid mutation during iteration
  const effects = [...pendingEffects];
  pendingEffects.clear();
  for (const effect of effects) {
    if (!effect.disposed) {
      runEffect(effect);
    }
  }
}

// ── Dependency graph node types ─────────────────────────────────────

const enum NodeState {
  Clean = 0,
  MaybeDirty = 1,  // A dependency changed, but we haven't checked yet
  Dirty = 2,        // Definitely needs recalculation
}

interface ReactiveNode {
  state: NodeState;
  /** Signals/computeds this node reads from */
  sources: Set<SignalNode<unknown> | ComputedNode<unknown>>;
  /** Called when a source changes */
  notify(): void;
}

// ── Signal (writable) ───────────────────────────────────────────────

interface SignalNode<T> {
  value: T;
  lastChanged: number;
  observers: Set<ReactiveNode>;
}

class SignalImpl<T> implements Signal<T> {
  readonly [SIGNAL_BRAND] = true as const;
  /** @internal */
  _node: SignalNode<T>;

  constructor(initialValue: T) {
    this._node = {
      value: initialValue,
      lastChanged: globalEpoch,
      observers: new Set(),
    };
  }

  get value(): T {
    // Track dependency if inside a reactive context
    if (activeObserver) {
      activeObserver.sources.add(this._node);
      this._node.observers.add(activeObserver);
    }
    return this._node.value;
  }

  set value(newValue: T) {
    if (Object.is(this._node.value, newValue)) return;
    this._node.value = newValue;
    this._node.lastChanged = ++globalEpoch;
    notifyObservers(this._node.observers);
  }

  subscribe(fn: (value: T) => void): () => void {
    // Immediately notify with current value
    fn(this._node.value);
    // Create a lightweight effect that calls fn
    const dispose = effect(() => {
      fn(this.value);
    });
    return dispose;
  }
}

function notifyObservers(observers: Set<ReactiveNode>): void {
  for (const observer of observers) {
    observer.notify();
  }
}

// ── Computed (derived, lazy, cached) ────────────────────────────────

interface ComputedNode<T> {
  value: T;
  lastChanged: number;
  observers: Set<ReactiveNode>;
}

class ComputedImpl<T> implements ReadonlySignal<T> {
  readonly [SIGNAL_BRAND] = true as const;
  /** @internal */
  _node: ComputedNode<T>;

  private compute: () => T;
  private state: NodeState = NodeState.Dirty; // Start dirty so first read computes
  private sources = new Set<SignalNode<unknown> | ComputedNode<unknown>>();
  private computing = false;

  constructor(fn: () => T) {
    this.compute = fn;
    this._node = {
      value: undefined as T,
      lastChanged: 0,
      observers: new Set(),
    };
  }

  get value(): T {
    if (this.computing) {
      throw new Error('Circular dependency detected in computed()');
    }

    // Track dependency if inside a reactive context
    if (activeObserver) {
      activeObserver.sources.add(this._node);
      this._node.observers.add(activeObserver);
    }

    // Pull: recalculate if dirty
    if (this.state !== NodeState.Clean) {
      this.update();
    }

    return this._node.value;
  }

  private update(): void {
    // Unsubscribe from previous sources (for dynamic dependency tracking)
    for (const source of this.sources) {
      source.observers.delete(this as unknown as ReactiveNode);
    }
    this.sources.clear();

    // Run compute with tracking
    const prevObserver = activeObserver;
    activeObserver = this as unknown as ReactiveNode;
    this.computing = true;
    try {
      const newValue = this.compute();
      if (!Object.is(this._node.value, newValue)) {
        this._node.value = newValue;
        this._node.lastChanged = ++globalEpoch;
        // Notify downstream observers that our value changed
        notifyObservers(this._node.observers);
      }
    } finally {
      this.computing = false;
      activeObserver = prevObserver;
    }
    this.state = NodeState.Clean;
  }

  /** @internal — called by the ReactiveNode interface when a source changes */
  notify(): void {
    if (this.state === NodeState.Clean) {
      this.state = NodeState.Dirty;
      // Propagate dirty flags to downstream observers
      // (they need to re-check if this computed's value actually changed)
      notifyObservers(this._node.observers);
    }
  }

  subscribe(fn: (value: T) => void): () => void {
    fn(this.value);
    const dispose = effect(() => {
      fn(this.value);
    });
    return dispose;
  }

  // ReactiveNode interface — used by dependency tracking
  get sources_(): Set<SignalNode<unknown> | ComputedNode<unknown>> {
    return this.sources;
  }
}

// Make ComputedImpl satisfy ReactiveNode for the dependency tracker
Object.defineProperty(ComputedImpl.prototype, 'sources', {
  enumerable: false,
});

// Bridge ComputedImpl to ReactiveNode — the observer interface.
// We cast in notify() above; here we make the computed usable as a ReactiveNode
// by defining the properties the tracker expects.
const computedAsReactiveNode = (c: ComputedImpl<unknown>): ReactiveNode => ({
  get state() { return c['state']; },
  set state(v) { c['state'] = v; },
  get sources() { return c['sources']; },
  notify: () => c.notify(),
});

// ── Effect (side-effect, auto-tracks, auto-disposes) ────────────────

interface EffectNode extends ReactiveNode {
  fn: () => void | (() => void);
  cleanup: (() => void) | null;
  disposed: boolean;
  sources: Set<SignalNode<unknown> | ComputedNode<unknown>>;
  /** List of dispose callbacks registered by the component */
  disposers: (() => void)[];
}

function createEffectNode(fn: () => void | (() => void)): EffectNode {
  return {
    state: NodeState.Dirty,
    fn,
    cleanup: null,
    disposed: false,
    sources: new Set(),
    disposers: [],
    notify() {
      if (this.disposed) return;
      this.state = NodeState.Dirty;
      pendingEffects.add(this);
      if (batchDepth === 0) {
        scheduleFlush();
      }
    },
  };
}

function runEffect(node: EffectNode): void {
  if (node.disposed) return;

  // Run cleanup from previous execution
  if (node.cleanup) {
    try { node.cleanup(); } catch (_) { /* cleanup errors are swallowed */ }
    node.cleanup = null;
  }

  // Unsubscribe from previous sources
  for (const source of node.sources) {
    source.observers.delete(node);
  }
  node.sources.clear();

  // Run effect with tracking
  const prevObserver = activeObserver;
  activeObserver = node;
  try {
    const result = node.fn();
    if (typeof result === 'function') {
      node.cleanup = result;
    }
  } catch (err) {
    // Effect errors: log but don't crash the system.
    // The effect is NOT disposed — it may succeed on next signal change.
    console.error('Effect error:', err);
  } finally {
    activeObserver = prevObserver;
  }
  node.state = NodeState.Clean;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Create a writable reactive signal.
 *
 * ```ts
 * const count = signal(0);
 * count.value;     // read (auto-tracks in reactive contexts)
 * count.value = 5; // write (notifies dependents)
 * ```
 */
export function signal<T>(initialValue: T): Signal<T> {
  return new SignalImpl(initialValue);
}

/**
 * Create a derived, lazy, cached computed signal.
 * Re-evaluates only when dependencies change AND the value is read.
 *
 * ```ts
 * const doubled = computed(() => count.value * 2);
 * doubled.value; // lazy evaluation
 * ```
 */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  return new ComputedImpl(fn);
}

/**
 * Create a side-effect that re-runs when its dependencies change.
 * Returns a dispose function to stop the effect.
 *
 * The effect function may return a cleanup callback that runs
 * before each re-execution and on disposal.
 *
 * ```ts
 * const dispose = effect(() => {
 *   console.log('count is', count.value);
 *   return () => { // cleanup
 *     console.log('cleaning up');
 *   };
 * });
 * dispose(); // stop the effect
 * ```
 */
export function effect(fn: () => void | (() => void)): () => void {
  const node = createEffectNode(fn);
  // Run immediately to establish initial dependencies
  runEffect(node);

  return () => {
    node.disposed = true;
    // Run final cleanup
    if (node.cleanup) {
      try { node.cleanup(); } catch (_) { /* swallow */ }
      node.cleanup = null;
    }
    // Unsubscribe from all sources
    for (const source of node.sources) {
      source.observers.delete(node);
    }
    node.sources.clear();
    pendingEffects.delete(node);
  };
}

/**
 * Check if a value is a signal (writable or computed).
 * Used by the template engine to detect signals in expression slots.
 */
export function isSignal(value: unknown): value is ReadonlySignal<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    SIGNAL_BRAND in (value as Record<symbol, unknown>)
  );
}

// ── Test utilities ──────────────────────────────────────────────────

/**
 * Flush all pending effects synchronously. Used in tests to avoid
 * needing to await microtasks.
 */
export function flushEffects(): void {
  flushPendingEffects();
}
