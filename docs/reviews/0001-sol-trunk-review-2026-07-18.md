---
title: "Review 0001 — Independent Sol Trunk Review: identity ladder, Tier-1 telemetry, the Desk"
date: 2026-07-18
status: "Accepted (granite verified HIGH-1 structurally: module-global cachedGitRungs + boot-time injection at node-app.ts:32; fixes chartered same day)"
author: "codex gpt-5.6-sol @ high (read-only, detached; runtime label self-reported as GPT-5 Codex — requested slug not independently confirmable)"
relates_to:
  - ../adr/0119.1-implicit-identity-capture.md
  - ../adr/0121-retrieval-evaluation-from-first-principles.md
---

No CRITICAL findings. I found 2 HIGH, 6 MEDIUM, and 1 LOW defect.

## Findings

### HIGH — Request-selected worktrees inherit the detached server’s cached identity

[agent-identity.ts:21](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/storage/local/agent-identity.ts:21), [node-app.ts:23](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/server/node-app.ts:23), [hono-app.ts:174](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/server/hono-app.ts:174), [local-runtime-request-resolver.ts:56](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/server/local-runtime-request-resolver.ts:56)

Concrete failure:

1. Detached server starts from shared/main checkout with `BACKLOG_AGENT=granite` or main-checkout config.
2. An MCP/HTTP request selects `/repo/.claude/worktrees/builder` using `project_root`; that worktree has `git config --worktree backlog.agent builder`.
3. The selected runtime writes into the builder worktree, but `createNodeApp()` injects one actor and identity resolved from `process.cwd()` at server boot.
4. `createRequestToolDeps()` reuses those values for every request-selected runtime. The selected worktree’s stamp is never probed, so journal entries, memory provenance, wakeup disclosure, and telemetry actor remain `granite`.

This directly defeats R1 on the detached-server path and cross-contaminates homes. It also conflicts with the resolver’s explicit rule that the detached server’s cwd is not caller context.

Verified by reading code; the failure scenario was not executed. Existing tests prove R1 only when the cache is deliberately primed from one worktree, not through request-selected runtimes.

### HIGH — One `/api/desk` request can trigger unbounded synchronous I/O and one search per live memory

[hono-app.ts:571](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/server/hono-app.ts:571), [desk-grounding.ts:86](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/server/desk-grounding.ts:86), [desk-grounding.ts:146](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/server/desk-grounding.ts:146), [desk.ts:274](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/core/desk.ts:274), [collision-candidates.ts:321](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/core/collision-candidates.ts:321), [desk.ts:331](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/core/desk.ts:331)

The seven-item output budget does not bound composition work:

- `ResourceManager.list()` reads the full document catalog and content.
- Git recency walks the repository history on every Desk call.
- Every candidate `.jsonl` file is read completely with `readFileSync`.
- The collision scan loads every memory and performs a search sequentially for every live focal memory.
- Requirements are requested with a limit of 100,000.

Concrete failure: a project containing a multi-gigabyte candidate JSONL, or tens of thousands of memories, can block the Node event loop, exhaust memory, or make `/api/desk` take minutes. Repeated authenticated GETs amplify this into an availability problem. A candidate-file symlink is also followed without a canonical containment check, widening the files that can be forced through `readFileSync`.

Verified by reading code; resource-exhaustion impact is inferred. Tests use tiny fixtures and assert only the seven-item output.

### MEDIUM — Explicit rung 1 is unavailable on most MCP writes and normalized inconsistently

[identity-resolution.ts:104](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/core/identity-resolution.ts:104), [backlog-delete.ts:19](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/tools/backlog-delete.ts:19), [backlog-write-resource.ts:29](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/tools/backlog-write-resource.ts:29), [register-substrate-intents.ts:119](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/tools/register-substrate-intents.ts:119), [backlog-remember.ts:62](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/tools/backlog-remember.ts:62)

ADR 0119.1 and the core API declare explicit `MCP as` as rung 1, but only `backlog_remember` exposes it. Delete, generic resource edit, and dynamically declared create/transition/set-field tools use a fixed boot actor and expose no common `as` field.

Concrete failure: if ambient identity is `builder-a`, an MCP transition or delete on behalf of `builder-b` has no supported way to apply the promised rung-1 override; it journals as `builder-a`.

Normalization is also inconsistent:

- Core and CLI trim explicit identity.
- MCP remember accepts `as: " "` because it uses `z.string().min(1)` and writes the whitespace actor verbatim.
- `BACKLOG_AGENT=" "` also wins over valid checkout/user config because the environment rung checks only `!== ''`.

Verified by reading code. Existing attribution tests exercise explicit CLI writes and MCP remember, not the other MCP write surfaces or whitespace cases.

### MEDIUM — HTTP telemetry’s “session” is the entire server lifetime

[retrieval-telemetry.ts:54](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/memory/retrieval-telemetry.ts:54), [retrieval-telemetry.ts:65](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/memory/retrieval-telemetry.ts:65), [hono-app.ts:363](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/server/hono-app.ts:363), [node-server.ts:31](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/node-server.ts:31)

The UUID is module-global and minted once per process. The HTTP MCP transport is stateless and constructs a new server/transport per request, with no MCP session ID, but every request receives the same telemetry UUID until the detached server restarts.

Concrete failure: one client’s recall on Monday and another client’s expand on Friday share a session and can be falsely correlated by future replay/mining logic. `BACKLOG_SESSION` can replace the process-wide value, but cannot distinguish concurrent or sequential HTTP clients.

Verified by reading code. The test explicitly proves one process-wide ID; it does not test separation between independent HTTP client sessions.

### MEDIUM — Cross-home token packing can record a false per-home recall miss

[home-read-coordinator.ts:356](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/core/home-read-coordinator.ts:356), [home-read-coordinator.ts:476](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/core/home-read-coordinator.ts:476)

`recordRecallDemand()` derives each home’s telemetry IDs from the final fused and token-packed response, not from `execution.value.items`, which contains that home’s actual retrieval result.

Concrete failure: global and project each return a top memory, but a small `token_budget` packs only the first fused item. The other home is recorded with `ids: []` even though it retrieved a hit. That inflates the exact recall-miss evidence intended to govern R5 re-armament and promotion decisions.

Verified by reading code. Tests cover a genuinely empty home and a budget that retains one item from each home; they do not cover a hit removed entirely by token packing.

### MEDIUM — Telemetry state grows without rotation or size/count bounds

[local-runtime.ts:103](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/storage/local/local-runtime.ts:103), [local-runtime.ts:113](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/storage/local/local-runtime.ts:113), [retrieval-telemetry.ts:101](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/memory/retrieval-telemetry.ts:101)

Every search, recall, and memory expand appends indefinitely to `retrieval-telemetry.jsonl`. There is no rotation, retention, size cap, compaction, or startup GC.

Concrete failure: a long-lived server under steady search traffic eventually consumes all available disk. ENOSPC is swallowed, so the triggering retrieval still succeeds, but the full disk can then break authoritative writes and unrelated processes.

Verified by reading code. Sink-throw/ENOSPC fail-open behavior is covered; preventing telemetry from causing ENOSPC is not.

### MEDIUM — Desk ordering and recency are host-locale/timezone dependent

[desk.ts:107](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/core/desk.ts:107), [desk.ts:114](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/core/desk.ts:114), [desk-grounding.ts:63](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/server/desk-grounding.ts:63)

Two sources of nondeterminism remain:

- Offset-less datetimes are accepted and passed to `Date.parse`, which interprets them in the server’s local timezone.
- Tie-breaking uses `localeCompare()` without a fixed locale rather than the bytewise comparator already used elsewhere.

Concrete probes:

- `2026-07-10T12:30:00` at a fixed `2026-07-18T12:00:00Z` becomes age 7 under UTC but age 8 under `Asia/Tokyo`, changing whether it is inside the seven-day READ window.
- `"ä"` sorts before `"z"` under English collation and after it under Swedish collation.

Therefore identical store bytes can yield different Desk membership and ordering on different hosts. Future timestamps are additionally clamped to age zero, allowing a far-future typo to remain perpetually “fresh.”

Verified using read-only Node timezone/collation probes. Existing tests use `Z` timestamps and ASCII paths.

### MEDIUM — Reviewed candidate files cannot leave the Desk

[desk-grounding.ts:116](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/server/desk-grounding.ts:116), [desk-grounding.ts:119](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/server/desk-grounding.ts:119), [desk.ts:293](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/core/desk.ts:293)

The reader counts every record whose `record` begins with `candidate_`. It never checks `assessor`, `reviewed:`, whether the candidate was promoted into the judged set, or any explicit completion state. The fold nevertheless claims every counted record has no reviewed assessor.

Concrete failure: after a human reviews/promotes every candidate, the original candidate file still contains `candidate_query`/`candidate_qrel` records and remains on the Desk forever. Even adding reviewed assessor fields directly does not reduce the count.

Verified by reading code. Tests cover prefix counting only, including counting both query and qrel records.

### LOW — Identity tests violate the repository’s unit-only/memfs law and use a destructive shared fixture path

[identity-resolution.test.ts:4](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/__tests__/identity-resolution.test.ts:4), [identity-resolution.test.ts:39](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/__tests__/identity-resolution.test.ts:39), [identity-resolution.test.ts:84](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/__tests__/identity-resolution.test.ts:84), [identity-resolution.test.ts:102](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/__tests__/identity-resolution.test.ts:102)

The test intentionally runs real Git and uses `execSync` to create and recursively delete a fixed `/tmp/identity-ladder-fixture`.

Concrete failure: two concurrent test processes delete each other’s repository, causing nondeterministic Git/ENOENT failures. A pre-existing directory at that fixed path is also deleted. This directly violates AGENTS.md’s “unit tests only, zero real file I/O” rule.

Verified by reading the test. It did not execute during this review because the workspace was read-only.

## Subsystem verdicts

- Implicit identity ladder: precedence logic itself is correct for one cwd, and tests cover the worktree-over-env inversion. The production composition is not home-aware, so detached/request-selected worktrees can be silently misattributed. Editing Git config during a running process remains stale by explicit ADR design; restart is currently required.
- Tier-1 telemetry: sink-level fail-open is strong—clock, identity probe, missing directory, ENOSPC, and sink throws are swallowed. Query text does not enter Tier-1 events, although the pre-existing recall usage log still stores recall queries. Session scope, token-packed false misses, and retention posture are defective.
- Desk: the fold is semantically read-only and exposes navigation/copy affordances only; I found no authoritative mutation route. Its composition cost is unbounded, its tie/time behavior is not portable, and candidate review completion is not representable.

## Cross-cutting checks

- ADR 0121 R5: verified none of these subsystem commits changed search scoring, within-home fusion, cross-home RRF, recall ranking, or reranking. Telemetry hooks run after retrieval/fusion.
- Wakeup ceiling: verified [wakeup-wire.ts:68](/Users/goga/Documents/goga/backlog-mcp/packages/server/src/core/wakeup-wire.ts:68) never trims identity, focus, constraints, vision, quarantine, omission truth, or the memory protocol. Existing tests explicitly cover focus and constraints survival.

## Execution record

Model/effort: GPT-5 Codex runtime, high reasoning effort. The runtime did not expose a verifiable minor model label, so I cannot independently confirm the requested `gpt-5.6-sol` string.

Files inspected included the two assigned ADRs; the Desk proposal and relevant ADR 0120 rulings; all named identity, telemetry, Desk, server wiring, home coordinator, local runtime, collision, resource, and wakeup-wire files; and the identity, telemetry, coordinator, Desk, grounding, endpoint, attribution, and wakeup-budget tests.

Commands run:

- `git status`, `rev-parse`, `log`, `show`, and targeted `diff`
- `rg`, `wc`, `nl`, and `sed` for source/test tracing
- Read-only Node probes under UTC/Asia-Tokyo and English/Swedish collation
- Targeted Vitest command for seven relevant suites

The test command did not start: Vite attempted to create a timestamped config artifact beside `vitest.config.ts` and received `EPERM` under the required read-only workspace. No files were modified. The only worktree difference remains the pre-existing untracked `.claude/worktrees/`.

Unresolved risk: concurrent multi-process JSONL append framing was not promoted to a finding. The code uses append mode with one line per call, but there is no lock or concurrency stress test, and exact large-write atomicity is platform-dependent.