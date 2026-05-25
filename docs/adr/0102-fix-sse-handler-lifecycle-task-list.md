# 0102. Fix SSE handler lifecycle in task-list component

**Date**: 2026-02-15
**Status**: Accepted
**Backlog Item**: TASK-0293

## Context

The backlog viewer uses Server-Sent Events (SSE) for real-time updates. The `event-source-client.ts` service manages the EventSource connection and provides a callback-based API (`onChange`/`offChange`). The `task-list` component subscribes to these events to trigger data refetches via `query().refetch()`.

The viewer's reactive framework provides automatic lifecycle management for its primitives: `effect()` disposers are auto-registered with the component host, and `Emitter.on()` calls auto-dispose on disconnect. However, `backlogEvents.onChange()` is a raw callback registration on a plain class singleton that predates the framework — it bypasses auto-disposal entirely.

## Problem

The `task-list` component registers a `backlogEvents.onChange` handler during setup but never cleans it up:

```ts
backlogEvents.onChange((event) => {
    if (...) tasksQuery.refetch();
});
```

When the component is disconnected and reconnected (HMR, parent re-render), handlers accumulate on the global singleton. Each live handler calls `refetch()` on its own query instance, causing multiple simultaneous fetch cycles per SSE event and resulting in duplicate task badges in the UI.

## Decision

Wrap the `backlogEvents.onChange` registration in an `effect()` that returns a cleanup function. The effect has no signal dependencies (runs once), but the framework auto-disposes it on component disconnect, which triggers the cleanup.

```ts
effect(() => {
    const handler = (event: BacklogEvent) => {
      if (...) tasksQuery.refetch();
    };
    backlogEvents.onChange(handler);
    return () => backlogEvents.offChange(handler);
});
```

### Alternatives Considered

1. **Migrate BacklogEvents to framework Emitter** — Architecturally cleaner but over-scoped for a bug fix. Only one consumer exists.
2. **Query-level SSE invalidation** — Elegant but requires modifying the query framework, a foundational module, for a lifecycle bug.

## Consequences

- SSE handler is properly cleaned up on component disconnect
- No duplicate task badges on SSE events
- The `backlogEvents` singleton remains a raw class (not a framework Emitter) — acceptable since there's only one consumer
- Future consumers of `backlogEvents` must remember to clean up manually (or we migrate to Emitter later)
