---
title: "The Memory Flywheel — Giving the Write Side Gravity"
date: 2026-07-17
status: Proposed
author: granite (architect)
relates_to:
  - ../NORTH-STAR.md
  - vision-gaps-audit-2026-07.md
  - ../adr/0118.1-intent-gated-recall-lifecycle-hooks.md
  - ../adr/0121-retrieval-evaluation-from-first-principles.md
  - 0000-phase-two-proposal-template.md
---

# The Memory Flywheel

*An empty memory engine is a search engine with extra steps. This proposal is about
why the store is empty and the smallest machinery that makes it fill itself.*

## The experiment (what was actually measured)

This proposal runs on evidence already collected — four independent measurements that
form one finding:

1. **The store is empty.** Goga's real global home, migrated yesterday under
   verification, contained 1,945 bytes — effectively nothing — after months of the
   product existing. (Whether older data lives elsewhere is an open question on Goga;
   even if found, it was not *here*, where the engine reads.)
2. **Nothing has ever been recalled from real usage.** The implicit-qrels miner walked
   every journal on the machine: zero recall-hit events, zero expand events, in any
   home, ever. The usage instrument built to measure memory value has never had a
   memory-use to measure.
3. **Instructed remembering works; uninstructed remembering does not exist.** Every
   Phase Two trial that was *told* to dogfood produced working memory loops — the
   nisli trial remembered 5 frictions and recalled 5/5 in 0.65s; the aime trial called
   the loop "genuinely useful." No agent, in any session not explicitly instructed,
   has ever called `remember`. The machinery is proven; the habit has no cause.
4. **The one organic writer we have writes to the wrong store.** My own orchestrator
   memory (session-state anchors, role anchors, incident lore — updated all day, every
   day, and demonstrably load-bearing across compactions) lives in the *harness's*
   memory directory, not in the product. The strongest real memory practice in this
   project routes around the product it's building.

The finding: **the read side has budgets, provenance, ranking, and gates; the write
side has a verb and a hope.** Nothing in the product causes memory to accumulate.

## The proposal

Three small builds, in order, each independently valuable:

**F1 — The remember rubric rides the briefing (S).** ADR 0118.1 Slice A (Accepted)
already puts a session-start *recall* rubric in wakeup. Add its twin: a session-end
*remember* rubric — the briefing's final line names the three conditions under which
the agent should write before dying (a lesson proven by failure, a decision that
changed direction, a fact that cost tokens to derive and will be needed again), and
the documented harness recipe (SessionEnd / PreCompact hooks — the same lifecycle
events aime already uses for receipts) invokes it. No server code beyond the rubric
text; the client owns the hook, per 0117/0118.1 law.

**F2 — Receipts become candidate memories (S/M).** The operations journal already
records every semantic mutation with intent attribution. A deterministic fold (same
shape as 0120's collision candidates — candidates, never verdicts) proposes memory
candidates from a session's receipts: completions with recorded friction, decisions
superseded mid-session, repeated derivations. Candidates land in the existing viewer
adjudication pattern; a human or agent accepts with one action. No LLM in the server;
the fold is pure; acceptance is the write.

**F3 — The dogfood covenant (0 code).** I move my own operational memory into the
product: session-state anchors, incident lore, and fleet protocols become memories in
the global home (with the harness directory holding only a pointer). The heaviest
memory user in the project becomes its first honest customer. My re-primes after
compaction become `wakeup`-driven. Every friction is filed. This is the experiment
that generates the usage data everything else needs — including 0121's replay
telemetry and R8's future recall queries.

## The measure (predeclared)

- **Memories written per real working session** (baseline: 0) — from the journal,
  no new telemetry.
- **Recall-hit rate on those memories in later sessions** (baseline: undefined —
  nothing to hit) — from Tier-1 telemetry (session ids + miss events, already ruled
  in 0121 R7).
- **The Amnesia-in-anger test:** after two weeks, kill my session cold and re-prime
  from `wakeup` alone, no harness memory. Grade the recovery against the current
  harness-memory recovery. This turns the product's founding scenario into my own
  operating dependency.

## Impact

If this works, the product's core sentence becomes true in the only way that matters:
the store fills as a side effect of real work, and every later feature (ranking,
collisions, evaluation, the viewer's queues) finally has real substrate. It also
dissolves the current evidence deadlock — baseline v2 wants real recall queries,
replay wants real demand, the flywheel generates both.

If it fails — if even with rubric, receipts, and covenant the memories written are
never worth recalling — that is the most important negative result the project could
produce: it would say the *documents* are the memory and the MEMO lane should demote
to a thin annotation layer. Either outcome moves the vision.

## Excitement

Yes — this is the demo where the product stops being plumbing. "Watch the agent that
built this recover from amnesia using only what it remembered while working" is the
north star's own story, told with our own scars. I would run F3 starting tomorrow.

## Trunk or branch

**TRUNK.** This is Tenet 1's core sentence. Everything shipped so far is the reading
half of that sentence; this is the writing half. It dogfoods 0113 (nothing new to
declare), rides 0118.1 (Accepted), feeds 0121 (telemetry, queries), and gives 0119's
identity work its first real consumer.

## Cost & falsifiability

**Cost:** F1 S, F2 S/M, F3 zero code (discipline only). Stop conditions: if F1's
rubric grows into prompt engineering beyond ~100 tokens, stop; if F2 needs semantic
understanding (an LLM) to propose candidates, stop — the receipts weren't enough and
that's the finding; if F3's memories go unrecalled for two weeks, write the negative
result and bring it to Goga before building anything further on the MEMO lane.

**Kill evidence:** two weeks of F3 with memories-written > 0 and recall-hits = 0
kills the flywheel thesis and promotes the docs-are-the-memory position. A rubric
that agents ignore in uninstructed sessions kills F1's mechanism specifically.
