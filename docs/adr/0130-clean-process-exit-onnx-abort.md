---
title: "0130 — Clean Process Exit: the ONNX abort, probe-before-compose, and exit discipline"
date: 2026-09-01
status: "Accepted (goga) — implemented 2026-09-01, shipped 0.72.1"
author: goga + claude
relates_to:
  - 0124-resilient-daemon.md
  - 0127-storage-read-cache-uncached-corpus-rescan.md
  - 0129-semantic-filenames-id-plus-slug.md
  - ../NORTH-STAR.md
---

# 0130 — Clean Process Exit

## Context — `backlog serve` aborts on the way out

Restarting the daemon after the 0.71.0 release printed this:

```
Port 3030 already served by v0.71.0 (>= v0.71.0) — deferring to the running server.
libc++abi: terminating due to uncaught exception of type std::__1::system_error: mutex lock failed: Invalid argument
zsh: abort      backlog serve
```

The defer decision was right (a bridge from another session had already
spawned 0.71.0 in the second between `stop` and `serve`). The abort was not.
The same line appears in `~/.backlog/state/logs/runtime/server.log` after
"Shutting down gracefully...", and the ADR 0129 validation saw it when a CLI
command exited on a `SubstrateWriteError`. Exit code 134 every time, on a
path that should be exit 0 or a one-line error.

## Investigation — the bug is upstream, and we walk into it

Reproduced in isolation (`node` 24.19.0, macOS), one variable at a time:

| Setup | `process.exit(0)` after inference | Natural exit after inference |
|---|---|---|
| transformers 3.8.1 + nested onnxruntime-node **1.21.0** (what we ship) | **abort** | clean |
| same, `pipeline.dispose()` first | **abort** | — |
| same, `intraOpNumThreads = 1` | **abort** | — |
| transformers 3.8.1, import only, no inference | clean | clean |
| transformers 3.8.1 + onnxruntime-node **1.29.0** (forced) | clean | clean |
| transformers **4.2.0** + its pinned onnxruntime-node **1.24.3** | clean | clean |

Three facts fall out:

1. **The abort needs two things:** ONNX inference has run in this process,
   and the process then hard-exits through `process.exit()` (or Node's
   default uncaught-exception path, which is the same C `exit()`). ORT
   1.21.0 tears down its thread pool during static destruction and hits a
   destroyed mutex. Draining the event loop instead lets ORT release in
   order.
2. **It is fixed upstream.** onnxruntime-node 1.24.3 and 1.29.0 both exit
   clean. `@huggingface/transformers` 3.8.1 pins 1.21.0 as a nested
   dependency, so a workspace override cannot reach it and npx consumers
   inherit it too. Transformers 4.2.0 pins 1.24.3 and our only usage
   (`pipeline('feature-extraction', …, { dtype: 'fp32' })`, `pooling: 'mean'`,
   `normalize: true`, `output.data`) is unchanged in 4.x.
3. **We run inference before we know the port is ours.** `node-server.ts`
   awaits `createLocalNodeApp()` (which builds the runtime, reconciles the
   search index, and warms the embedder) *before* `serve()` binds. The
   EADDRINUSE handler then decides to defer and calls `process.exit(0)`. A
   deferring `serve` therefore does seconds of wasted work and exits through
   the one door that aborts.

Every `process.exit` site, and whether inference can precede it:

| Site | Inference possible before it | Disposition |
|---|---|---|
| `node-server.ts` shutdown timer (`setTimeout(exit, 500)`) | yes | drain instead, forced fallback |
| `node-server.ts` port-collision `exit` effect | yes (app already composed) | probe before compose; drain fallback |
| `node-server.ts` uncaughtException | yes | keep: state is undefined after an uncaught throw |
| `cli/runner.ts` `throwRunError` | yes (`remember` runs the collision scan) | set exit code, drain |
| `cli/commands/edit.ts` | yes | set exit code, drain |
| `cli/index.ts` `status` / `stop` | no | set exit code for uniformity |
| unhandled rejection from an async commander action (`program.parse()` drops the promise) | yes | `parseAsync` + one error boundary |
| `cli/bridge.ts` (4 sites) | no: the bridge only spawns `mcp-remote` | keep; comment cites this ADR |

## Rulings

**R1 — Upgrade the runtime.** `@huggingface/transformers` moves to `^4.2.0`
in `packages/server` and `packages/memory`, carrying onnxruntime-node 1.24.3.
This is the fix that reaches npx consumers; nothing else can, because the ORT
pin is nested.

**R2 — Exit discipline: a process that may have run inference never
hard-exits on a normal path.** It sets `process.exitCode` and lets the loop
drain. `utils/process-exit.ts` owns the one-line `requestExit(code)` so the law
has a name and `grep process.exit` shows only the sanctioned sites (R5, R6).
This makes R1 defense in depth: a future ORT regression, or a consumer with a
stale lockfile, degrades to nothing.

**R3 — Probe before compose.** The daemon decides the port collision *before*
building the app. `server/port-collision.ts` gains `resolvePortBeforeBind`,
an injected-effects orchestrator over the existing pure `decidePortCollision`:
port free → bind; incumbent older (or dev) → shut it down, wait, bind;
otherwise → log, `fatalSync`, exit 0 with nothing loaded. The existing
EADDRINUSE resolver stays as the race fallback and its `exit` effect becomes a
drain (R4). A deferring `serve` now costs one HTTP probe.

**R4 — Daemon shutdown drains, with a forced fallback.** `shutdown()` closes
the HTTP server, awaits `registry.closeAll()` (watchers unsubscribe), sets the
exit code, and returns. An unref'd 5 s timer is the fallback: if handles leak
it logs `Forced exit: event loop did not drain` via `fatalSync` and hard-exits.
The fallback is the only place the abort can still appear, and it is logged
first.

**R5 — One CLI error boundary.** `cli/index.ts` runs `program.parseAsync()`
and routes every rejection through `cli/cli-failure.ts`. Domain errors
(`NotFoundError`, `ValidationError`, `SubstrateWriteError`) print their message
only; anything else prints the stack. Both set exit code 1 and return. This
also retires the stack trace ADR 0129's validation recorded for a collision
refusal.

**R6 — The uncaught-exception handler and the bridge keep `process.exit`.**
After an uncaught throw the process state is undefined; flushing and exiting
immediately is still right. The bridge never loads the runtime. Both cite this
ADR in a comment.

**R7 — Bump is a minor.** A native-runtime major upgrade plus a user-visible
behavior fix ships as a minor. It went out as 0.72.1: the 0.72.0 bump commit
was pushed one commit ahead of its lockfile and the publish run failed on
`--frozen-lockfile`; no tag or package was produced, so 0.72.1 is the first
published build of this work.

## Engineering plan

1. `packages/server/package.json`, `packages/memory/package.json`:
   `@huggingface/transformers: ^4.2.0`; `pnpm install`.
2. `utils/process-exit.ts` — `requestExit(code)`.
3. `server/port-collision.ts` — `resolvePortBeforeBind` + `PreBindEffects`;
   tests in `__tests__/port-collision.test.ts`.
4. `node-server.ts` — probe first; drain-based `shutdown(code)`; forced
   fallback; collision `exit` effect → drain.
5. `cli/cli-failure.ts` — `reportCliFailure(error, io)`; test.
6. `cli/index.ts` — `parseAsync().catch(reportCliFailure)`; `status`/`stop`
   use `requestExit`. `cli/runner.ts` `throwRunError` → rethrow only.
   `cli/commands/edit.ts` → `requestExit(1)`.
7. `cli/bridge.ts` — comment only.
8. CHANGELOG, ADR index, version bump 0.72.1 / viewer 0.64.0.

## Validation — findings (2026-09-01)

- Unit suites: server 1398 passed, memory 49, viewer 151; typecheck clean.
- `backlog serve` against the running 0.71.0 daemon: one defer line, exit 0,
  1.2 s wall clock, no abort. Before: full runtime build, then abort 134.
- `remember` into a forced `MEMO-0001` collision: one line
  (`/id: duplicate document identities: …`), exit 1, no stack, no abort.
- Daemon on a scratch port: served a real `/search` query (inference ran),
  then `backlog stop` → "Shutting down gracefully...", exit 0, no abort, no
  forced-exit record. The drain path works without the fallback.
- `pnpm install` for transformers 4.2.0 reports "Ignored build scripts:
  onnxruntime-node" — same as 3.8.1 (macOS binaries ship in the package;
  the script only fetches CUDA extras on Linux). Embeddings verified live.
- Not in scope, observed: `backlog get <unknown-id>` prints `(no content)`
  with exit 0 rather than a not-found error. Pre-existing.
