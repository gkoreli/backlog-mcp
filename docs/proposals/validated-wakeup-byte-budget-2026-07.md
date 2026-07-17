---
title: "Validated external mining: wakeup byte budgets"
date: 2026-07-16
status: Proposed — EXP-4 reproduction complete
author: chert
external_candidate: Letta memory-block limits and MemFS
---

# Wakeup byte budgets: protect the invariant, reject the allocator

## The experiment

The garden bundled two Letta-shaped ideas: hard byte-budgeted wakeup sections
and sleep-time consolidation. This reproduction exercised only the budget claim.
It used the real wakeup fold, the versioned Cold-Open and Amnesia fixtures, the
actual MCP pretty-JSON boundary, and a one-off fixed-allocation packer with an
explicit omission ledger. No production code or fixture was changed.

The external premise also changed. Current Letta blocks still expose a size
`limit` and current/limit counters
([memory-block docs](https://docs.letta.com/guides/core-concepts/memory/memory-blocks)),
but Letta Server 0.16.7 explicitly removed enforcement and raised the default
core-memory limit from 20K to 100K characters
([official releases](https://github.com/letta-ai/letta/releases)). Current
guidance is advisory hierarchy—keep blocks reasonably small and move larger
content to files/retrieval
([context hierarchy](https://docs.letta.com/guides/core-concepts/memory/context-hierarchy)).
Letta Code/MemFS continues to deepen git-backed filesystem memory
([letta-code](https://github.com/letta-ai/letta-code),
[v0.28.9](https://github.com/letta-ai/letta-code/releases/tag/v0.28.9)); the
first-party lettabot configuration documents Markdown sync, git history,
worktrees, and sleeptime's MemFS dependency
([configuration](https://github.com/letta-ai/lettabot/blob/main/docs/configuration.md)).
The garden's "hard limits force compression" statement is therefore stale.

### Unbounded measurements

Payload means UTF-8 bytes of the exact pretty JSON produced at the MCP boundary
(`JSON.stringify(result, null, 2)`), not the compact JSON/4 proxy currently used
by acceptance tests.

| Input | Pretty bytes | Compact bytes | Required facts retained |
| --- | ---: | ---: | --- |
| Real backlog-mcp corpus (143 claimed entities) | 772 | 564 | Decision + vision |
| Cold-Open fixture | 2,317 | 1,580 | All: active work, memories, constraints, decisions, vision, recent evidence |
| Amnesia fixture | 1,366 | 1,006 | Goal, next action, constraint, active task, vision |

Thirty real-corpus wakeup folds measured p50 63.668 ms, p95 69.592 ms
(61.668–74.024 ms). The executable acceptance contracts remained green: two
files, 18/18 tests, 121 ms test time (1.12 s command wall time).

The core already slices sections independently and returns a whole briefing
([types](../../packages/server/src/core/types.ts),
[wakeup](../../packages/server/src/core/wakeup.ts)); the MCP tool pretty-prints
the result ([adapter](../../packages/server/src/tools/backlog-wakeup.ts)). There
is no aggregate byte cap today.

### Hard-cap prototype

The prototype reserved vision, then packed constraints → operation → active →
epics → knowledge → recent → other declared sections. It recorded every omitted
section and ran each pack 500 times.

| Case | Cap | Emitted | What survived | p50 pack |
| --- | ---: | ---: | --- | ---: |
| Cold-Open | 3,072 B | 2,597 B | All required facts | 0.177 ms |
| Cold-Open | 2,400 B | 2,302 B | Everything except both decisions | 0.221 ms |
| Cold-Open | 1,800 B | 1,726 B | Active 2/2, constraints 2/2, vision; no knowledge/decisions/recent | 0.243 ms |
| Cold-Open | 1,200 B | 1,199 B | One constraint + vision only | 0.222 ms |
| Cold-Open | 800/512 B | Fail closed | Minimum skeleton is 914 B | 0.018 ms |
| Amnesia | 1,800 B | 1,647 B | Goal + next + constraint + active + vision | 0.051 ms |
| Amnesia | 1,200 B | 1,105 B | Constraint + vision; goal/next/active lost | 0.069 ms |
| Amnesia | 800/512 B | Fail closed | Minimum skeleton is 917 B | 0.018 ms |
| Real corpus | 1,200 B | 1,052 B | Decision + vision | 0.019 ms |

Honest omission accounting itself added roughly 280 bytes. On Cold-Open it
expanded 2,317 bytes to 2,597 before trimming—12% overhead—and made a 2,400-byte
cap delete decisions even though the unbounded payload already fit. The
allocator created the regression it was supposed to prevent.

The actual measurement gap is smaller: accepted tests estimate compact JSON
tokens, while users receive pretty UTF-8 JSON. A serialization-aware assertion
would catch composition drift without deleting orientation.

### Dogfood friction and limits

Released and repo-dist project wakeup were blocked by the docs-native migration
gate. The real fold therefore measured the current corpus through production
code rather than the released CLI journal. That corpus has no live tasks,
memories, requirements, or operation document, so the versioned fixtures carry
behavioral breadth. Only one real repo was measured; byte count is deterministic
but not tokenizer-exact. No sleep-time consolidation behavior was tested.

## Impact

Today the allocator saves zero user-visible bytes: the real payload is 772 bytes
and both north-star acceptance fixtures fit within 2,317 pretty bytes. Caps below
3 KiB destroy required facts. The useful result is an S-sized transport-byte
tripwire that prevents future composition from silently bloating wakeup while
leaving selection policy alone.

## Excitement

The allocator is homework. The demo-worthy invariant is simpler: one wakeup is
dense, every Cold-Open and Amnesia fact survives, and CI proves it at the real
wire boundary.

## Trunk or branch

The **budget invariant is TRUNK** under North-Star Tenet 2 and both executable
scenarios. A runtime aggregate allocator is **rejected/shelved** because no real
payload pressures it. Sleep-time consolidation is a separate BRANCH experiment
with a different cause, cost, and falsifier; this run gives it no authority.

## Cost and falsifiability

**Cost: S** for measuring pretty UTF-8 bytes in acceptance and adding one
all-sections pressure fixture/diagnostic. **M** for an allocator, not earned.

Revisit allocation only when a real dogfood/bolt-on briefing or accepted
all-sections fixture exceeds 3,072 pretty bytes while required facts genuinely
need to coexist. First remove redundant transport metadata or lower source stub
caps. If any proposed cap cannot preserve every Cold-Open and Amnesia fact, it
must fail closed rather than return an authoritative-looking partial briefing.

