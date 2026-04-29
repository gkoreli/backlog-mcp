# 0094. Transport-Agnostic Operation Logging

**Date**: 2026-04-29
**Status**: Accepted
**Supersedes**: ADR-0054 (MCP middleware approach)

## Context

backlog-mcp persists a **mutation journal** — an append-only log of every
state change. Consumers include the viewer's activity panel, SSE push, the
`/operations` and `/operations/count/:taskId` endpoints, context hydration,
and future audit / replay tooling.

ADR-0054 introduced this log. Entries were recorded by an MCP middleware that
wrapped `server.registerTool` callbacks (`operations/middleware.ts`). That
design predated the CLI and had three emergent defects:

1. **CLI writes never logged.** ADR-0090 introduced a CLI that calls core
   write functions directly; the MCP callback wrapper never fired, so CLI
   activity was invisible in the journal and to the viewer.
2. **Attribution was ambient.** `operations/logger.ts` computed `Actor` at
   module load from `process.env`. Any later-spawned subprocess with
   different `BACKLOG_ACTOR_NAME` couldn't distinguish itself, and the
   scheduler case (a cron tick creating tasks on behalf of `CRON-0042`)
   had nowhere to put its context.
3. **Write paths could drift invisibly.** A new callsite (a new CLI flag,
   a scheduler, an internal programmatic caller) logged or didn't based on
   which import path it chose. There was no type-level guarantee.

## Vision

The operation log is the **canonical write journal**: the single record
of how state arrived at its current shape. Not activity, not debug output,
not metrics — **mutations, and nothing but mutations**. Every successful
write produces exactly one entry with actor attribution; every failed or
no-op call produces zero.

This is a design commitment, not a library choice. Once committed, several
invariants fall out:

1. **Complete.** No write path is exempt. If a function can change
   state, it participates in the log.
2. **Attributed.** Every entry names its actor. Attribution travels with
   the call (parameter), not with the process (ambient).
3. **Contextual.** Entries preserve enough params to reconstruct the
   change (`old_str`/`new_str`, the before-status, the cron fields).
   A "TASK-0001 was updated" entry is insufficient.
4. **Single-writer.** Exactly one place builds entries. New transports
   adapt to that place; they do not duplicate it.
5. **Logged-once.** A mutation produces one entry, never two.

## Problem Space

The previous design sat logging at the **transport** layer (MCP's
`registerTool` wrapper). Transports are plural and growing — MCP, CLI,
Worker, future scheduler, future HTTP API, future programmatic embedders.
"Log at every transport" is a discipline enforced by developer memory. It
has failed once already (CLI).

The question is structural: **where in the codebase is there a single
point every write passes through, where logging can be an invariant rather
than a policy?**

### Evidence

| Path | Logs today? | How |
|------|-------------|-----|
| MCP → `registerTool` callback → core | ✅ | `operations/middleware.ts` wraps callback |
| CLI → `commands/*.ts` → core | ❌ | No logging anywhere in the path |
| Cloudflare Worker → `registerTool` wrap → core | ✅ | Same middleware pattern with `D1OperationLog` |
| Future scheduler → core | ❌ | No current answer; would need to remember to log |
| Internal caller (e.g. bulk import script) → core | ❌ | Same |

Read the table as: **"logging status is a property of which layer wrapped the call," not a property of the write itself.** That is the root defect.

## Proposals

### A. Core write functions *are* the boundary (selected)

Logging is performed inside core write functions (`createItem`, `updateItem`,
`deleteItem`, `editItem`) as part of their work. After the successful
service mutation, the function calls a small pure helper `recordMutation(ctx,
tool, params, result)` that builds the entry and appends it.

Core functions accept a required `WriteContext` parameter carrying
`{ actor, operationLog, eventBus? }`. Callers (MCP handler, CLI command,
worker entry) construct the context for their transport and pass it in.

- **Pro**: Structurally impossible to mutate without logging — TypeScript
  forces every call site to supply the context; skipping logging requires
  editing the core function itself
- **Pro**: Attribution is per-call — actor flows through the call stack,
  not from ambient env state
- **Pro**: No module-level singletons or pluggable slots — everything is
  function arguments
- **Pro**: Transport adapters become thin — just parse, build ctx, call
  core, format the result
- **Pro**: Works identically in local (JSONL + eventBus) and cloud
  (D1 + no eventBus); context shape is the same, only the implementations
  of `IOperationLog` / `EventBus` differ
- **Pro**: No-op suppression (future) has an obvious home — core has both
  the before and after
- **Con**: All four core write functions gain a third parameter
- **Con**: Every existing test of a core write must pass a ctx (mitigated
  by a tiny `testCtx()` factory)

### B. Pluggable slot in core module state (rejected — earlier draft of this ADR)

`core/operation-log.ts` exports `setOperationLog(fn)` and `logOperation(...)`.
Bootstrap calls `setOperationLog` once; core functions call `logOperation`
unconditionally.

- **Pro**: Minimal signature changes
- **Con**: Attribution still ambient (slot reads a singleton actor)
- **Con**: Slot is a global — tests must mock module state
- **Con**: "Did this write log?" depends on bootstrap order, not on the
  write's own type signature
- **Con**: Scheduler case (per-call actor) still has no answer
- **Con**: During refactor iteration we discovered that `withLog` wrappers
  only fire when callers import from `core/index.ts` — callers using
  `core/create.js` directly skip logging silently. This is the structural
  defect Option A was designed to eliminate.

### C. Service decorator (rejected)

Wrap `IBacklogService` at construction time with a logging decorator.
Every `save`/`add`/`delete` passes through.

- **Pro**: Very clean separation
- **Con**: Service sees `save(entity)` but has lost the operation shape
  (no `old_str`/`new_str`, no "did this update change status from open to
  blocked"). The viewer's activity panel needs those params to render.
  Reconstructing them from before/after entity diff is possible but
  expensive and fragile.
- **Con**: Tool name (`backlog_update` vs `write_resource`) is transport
  metadata the service never sees.

### D. Event-based (rejected)

Core emits events; a logger subscribes; log-append is async.

- **Pro**: Full decoupling
- **Con**: Async append breaks the "write + journal are one operation"
  invariant. "Did this write get logged?" becomes a distributed-systems
  question under ordering failures.
- **Con**: Event bus already exists for SSE push; reusing it for logging
  conflates ephemeral notification with durable record.

### E. Leave transport middleware; add a second middleware for CLI (rejected)

Add a CLI-layer wrapper that mirrors the MCP middleware.

- **Pro**: Smallest diff
- **Con**: Doubles down on the original defect — two wrappers to keep
  synchronized, a third required for scheduler, a fourth for any new
  transport. Convention continues to be the enforcement mechanism.

## Decision

**Proposal A.** Core write functions are the boundary. The write and the
journal entry are the same operation. Attribution is a parameter.

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Transport adapters (thin)                                        │
│                                                                  │
│  MCP handler         CLI command          Worker handler         │
│  ─────────────       ─────────────        ─────────────          │
│  buildWriteContext() cliWriteContext()    (inline ctx build)     │
│     from ToolDeps       from env          actor={agent,claude}   │
│     actor/log/bus       operationLogger   D1OperationLog         │
│                         no eventBus       no eventBus            │
│                                                                  │
└─────────────────────────────┬────────────────────────────────────┘
                              │ (service, params, ctx)
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Core (packages/server/src/core/)                                 │
│                                                                  │
│  createItem / updateItem / deleteItem / editItem                 │
│    ├─ validate params (substrate schemas — ADR 0098)             │
│    ├─ service.add / .save / .delete                              │
│    ├─ build result                                               │
│    └─ recordMutation(ctx, tool, params, result)   ◄── INVARIANT  │
│         ├─ build OperationEntry                                  │
│         ├─ ctx.operationLog.append(entry)                        │
│         └─ ctx.eventBus?.emit(...) if present                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### WriteContext shape

```typescript
// core/types.ts
export interface WriteContext {
  actor: Actor;                           // who is making this change
  operationLog: IOperationLog;            // where entries are appended
  eventBus?: { emit: (event: any) => void }; // live push (local only)
}
```

**`actor`**: `{ type: 'user' | 'agent', name, delegatedBy?, taskContext? }`.
Required. Forces every callsite to name its principal. Node reads from env
once per request (`envActor()`). Worker currently uses a fixed
`{agent, claude}` identity; OAuth-derived attribution is future work.
Scheduler (future ARTF-0189) builds `{ type: 'system', name: 'scheduler:CRON-XXXX' }`
per tick.

**`operationLog`**: the append-only journal. Same interface (`IOperationLog`)
in Node (JSONL-backed `OperationLogger`) and Worker (D1-backed
`D1OperationLog`). The concrete instance is wired by bootstrap and passed
through.

**`eventBus`**: optional. Node has a real `EventBus` for SSE push. Worker
is stateless — no subscribers, so `undefined`. `recordMutation` uses
optional chaining; no guards needed in core.

### `recordMutation` — the one-line invariant

```typescript
// core/operation-log.ts — pure function, no module state
export function recordMutation(
  ctx: WriteContext,
  tool: ToolName,
  params: Record<string, unknown>,
  result: unknown,
): void {
  const ts = new Date().toISOString();
  const entry: OperationEntry = {
    ts, tool, params, result,
    resourceId: extractResourceId(tool, params, result),
    actor: ctx.actor,
  };
  ctx.operationLog.append(entry);
  ctx.eventBus?.emit({
    type: TOOL_EVENT_MAP[tool],
    id: entry.resourceId ?? '',
    tool, actor: ctx.actor.name, ts,
  });
}
```

### "Mutations, not activity" — explicit rules

The log contains state transitions, nothing else. Ruled explicitly so
future contributors don't have to guess:

| Case | Logged? | Rule |
|---|---|---|
| `createItem` success | ✅ | The creation is the mutation |
| `updateItem` success | ✅ | Params carry what changed; entry is the record |
| `deleteItem` when entity existed | ✅ | `deleted === true` gates the append |
| `deleteItem` when entity didn't exist | ❌ | No state changed — log would mislead |
| `editItem` success | ✅ | Body changed, diff renderable |
| `editItem` pattern-not-found failure | ❌ | Returns `{success: false}`; no save happened |
| Any core call that throws (validation, NotFoundError) | ❌ | Early exit before `recordMutation` |
| `listItems` / `getItems` / `searchItems` | ❌ | Reads, not mutations |
| No-op update (fields identical to before) | **future** | Out of scope for this ADR; the core boundary is the right place to add it later because it has both before and after |
| Cascading writes (future) | one entry per mutation | Each `service.save` call produces one entry; correlation via future `cause_id` field |
| Scheduler-triggered creates (future) | one entry | The create is logged; the tick itself is activity |

### What gets deleted

- `packages/server/src/operations/middleware.ts` — `withOperationLogging`
  MCP wrapper. Entirely replaced by core-level recording.
- `AppDeps.wrapMcpServer` field and the `wrapMcpServer(server)` call in
  `hono-app.ts` — no more callback wrapping.
- Module-load `actor` singleton in `operations/logger.ts` — replaced by
  `envActor()` factory called per-request.

### What gets added

- `core/types.ts`: `WriteContext` interface; re-exports `Actor` and
  `IOperationLog` from operations/types.
- `core/operation-log.ts`: pure `recordMutation` helper (no module state,
  no slot, no singleton).
- Third argument (`ctx: WriteContext`) on each core write function.
- `tools/build-write-context.ts`: `buildWriteContext(deps)` — fails loud if
  tool deps are missing actor/operationLog.
- `cli/runner.ts`: `cliWriteContext()` — packs `envActor()` and the
  singleton `operationLogger`; no event bus.

## Cross-Reference Evidence Table

| Claim | Source File | Evidence |
|-------|------------|---------|
| Core write functions all go through `service.add`/`.save`/`.delete` | `packages/server/src/core/{create,update,delete,edit}.ts` | `await service.add(task)` / `await service.save(validated)` / `await service.delete(params.id)` |
| Core accepts `WriteContext` as a required parameter | `packages/server/src/core/create.ts:31-35` | `export async function createItem(service, params, ctx: WriteContext)` |
| `recordMutation` is a pure function (no module state) | `packages/server/src/core/operation-log.ts:28-60` | Module has zero top-level `let`/`const` other than the `TOOL_EVENT_MAP` constant and the `recordMutation` export |
| Actor is captured per-invocation, not at module load | `packages/server/src/operations/logger.ts:11-18` | `export function envActor(): Actor { return { ... process.env.BACKLOG_ACTOR_TYPE ... } }` |
| MCP handlers build ctx from `ToolDeps` | `packages/server/src/tools/backlog-create.ts:38`, `backlog-update.ts:34`, `backlog-delete.ts:19`, `backlog-write-resource.ts:30` | `buildWriteContext(deps)` passed as third arg |
| CLI commands build ctx from env + singleton | `packages/server/src/cli/commands/{create,update,delete,edit}.ts` | `cliWriteContext()` passed as third arg |
| Node bootstrap wires pieces into ToolDeps | `packages/server/src/node-server.ts:26-35` | `createApp(service, { actor: envActor(), operationLog: operationLogger, eventBus, ... })` |
| Worker bootstrap wires pieces into ToolDeps | `packages/server/src/worker-entry.ts:31-43` | `createApp(service, { actor: {type:'agent', name:'claude'}, operationLog: new D1OperationLog(...) })` |
| `hono-app.ts` passes ctx pieces through to `registerTools` | `packages/server/src/server/hono-app.ts` (`/mcp` route) | `const toolDeps: ToolDeps = { ...deps, actor, operationLog, eventBus }; registerTools(server, service, toolDeps);` |
| Failed writes (edit pattern-not-found) do not log | `packages/server/src/core/edit.ts:22-29` | Only the success branch calls `recordMutation`; catch branch returns `{success: false}` |
| Idempotent delete only logs real deletions | `packages/server/src/core/delete.ts:19-22` | `if (deleted) recordMutation(...)` |
| Discriminated-union event-type map covers all write tools | `packages/server/src/core/operation-log.ts:22-27` | `TOOL_EVENT_MAP: Record<ToolName, string>` — TypeScript exhaustiveness-checks this |
| `WRITE_TOOLS` constant is the single source of truth for "what is a mutation" | `packages/server/src/operations/types.ts:32` | `export const WRITE_TOOLS: ToolName[] = ['backlog_create', 'backlog_update', 'backlog_delete', 'write_resource']` |
| D1 worker uses non-blocking append | `packages/server/src/operations/d1-operation-log.ts:57-75` | `this.ctx.waitUntil(this.db.prepare(...).run())` |
| Viewer reads the journal via `/operations` endpoint | `packages/server/src/server/hono-app.ts` (`/operations` route) | `deps.operationLog.query({...})` + task/epic enrichment |
| Activity panel handles both old (`uri`) and new (`id`) `write_resource` shapes | `packages/server/src/operations/resource-id.ts` (extractResourceId + extractTargetFilename) | Both functions check `params.id` first, fall back to `params.uri` |

## Consequences

### Positive

- **Every transport logs identically**, today and future. MCP, CLI, Worker
  all produce the same entry shape with the same attribution rules. A
  future scheduler, HTTP API, or embedder just constructs its own
  `WriteContext` and calls core — no logging wire-up.
- **CLI writes now appear in the viewer's activity panel** and in
  `/operations` queries. The regression is fixed structurally, not by
  another wrapper.
- **Attribution is honest**. A scheduler tick can say
  `{type: 'system', name: 'scheduler:CRON-0042', delegatedBy: 'EPIC-0043'}`
  without any env manipulation. A test can assert on a specific actor
  without module mocks.
- **Tests are cleaner**. `testCtx()` is a three-line factory returning a
  no-op log; assertions on logging behavior use a capture-log mock passed
  directly into ctx — no `vi.mock` of module state.
- **The rule "mutations, not activity" has a home.** The four functions
  that are mutations are the four functions that log. Activity (reads,
  lookups, context builds) has no parallel wrapper to tempt future
  contributors to "just also log this too."

### Negative

- **Every core write now takes three parameters** instead of two. Call
  sites grow; test fixtures grow. The factory helpers (`testCtx()`,
  `buildWriteContext()`, `cliWriteContext()`) keep the growth shallow.
- **TypeScript enforces the invariant**, which means forgetting ctx is a
  compile error rather than a runtime bug. This is a one-time migration
  cost, not an ongoing tax.
- **Worker actor is still a fixed identity** (`{agent, claude}`) until
  OAuth session-derived attribution lands. This is a known gap, not a
  regression from the previous design (which had the same).

### Out of scope for this ADR

- **No-op suppression** — mentioned in the mutation-vs-activity rules; not
  implemented here because the user-facing value is small and the
  before/after diff logic is non-trivial. The boundary is now in the right
  place to add it later.
- **Cascading-write correlation** (a `cause_id` field linking related
  entries) — irrelevant until we have cascading writes to correlate.
- **Worker OAuth attribution** — gated on broader OAuth session work,
  tracked separately.
- **Log compaction / pruning** — the log grows ~90MB/year at aggressive
  write rates; storage cost is not a near-term concern.

## Implementation Notes

### Verification

- `pnpm --filter backlog-mcp exec tsc --noEmit` — zero errors
- `pnpm --filter @backlog-mcp/viewer exec tsc --noEmit` — zero errors
- `pnpm test` — 633 server tests + 96 viewer tests pass
- `pnpm build` — clean build across all packages

### Files changed

Added:
- `packages/server/src/core/operation-log.ts` (pure `recordMutation`)
- `packages/server/src/tools/build-write-context.ts`

Modified:
- `packages/server/src/core/types.ts` (WriteContext)
- `packages/server/src/core/{create,update,delete,edit}.ts` (ctx param + recordMutation)
- `packages/server/src/core/index.ts` (re-export new types; still a pure barrel)
- `packages/server/src/tools/index.ts` (ToolDeps extended)
- `packages/server/src/tools/backlog-{create,update,delete,write-resource}.ts` (buildWriteContext)
- `packages/server/src/cli/runner.ts` (cliWriteContext helper)
- `packages/server/src/cli/commands/{create,update,delete,edit}.ts` (cliWriteContext passed through)
- `packages/server/src/server/hono-app.ts` (drop wrapMcpServer; forward ctx pieces)
- `packages/server/src/node-server.ts` (drop withOperationLogging import; pass pieces)
- `packages/server/src/worker-entry.ts` (same)
- `packages/server/src/operations/logger.ts` (`envActor()` factory)
- `packages/server/src/operations/index.ts` (drop `withOperationLogging` export)
- `packages/server/src/__tests__/core-invariants.test.ts` (+`testCtx()`, 51 call-site updates)
- `packages/server/src/__tests__/edit-error-resilience.test.ts` (+`testCtx()`, 4 call-site updates)
- `packages/server/src/__tests__/viewer-routes.test.ts` (mock shape)

Deleted:
- `packages/server/src/operations/middleware.ts`

### Refs

ADR-0054 (superseded — middleware approach), ADR-0090 (CLI extraction
that exposed the CLI-write-logging gap), ADR-0097 (storage-engine
positioning — the log is first-class state), ADR-0098 (substrate
architecture — core validation boundary, same boundary now hosts logging).
