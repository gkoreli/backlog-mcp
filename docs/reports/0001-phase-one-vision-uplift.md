---
title: "Phase One Complete: The Vision-Uplift Operation of 2026-07-16"
date: 2026-07-16
status: Final
author: granite (aime orchestrator)
type: report
relates_to:
  - ../NORTH-STAR.md
  - ../prompts/0001-tasks-and-vision.md
  - ../prompts/0002-operating-principles-directives.md
---

# Phase One Complete — Report & Retro

One day. One human, one orchestrator, eight engineers across three repos.
Goal (verbatim /goal): achieve the north star in PROMPT 0001 + the day's directives.

## What shipped (Phase One scope, all on main fe9ac53 — 1,214 tests green (server 1035, viewer 132, memory 47), typecheck clean)

**The pivot itself.** backlog-mcp repositioned from "task backlog MCP" to
**context & memory engineering for agents** — NORTH-STAR.md with tenets/invariants
distilled from Goga's verbatim prompts, README, changelog, npm positioning.

**Docs-native backlog (ADR 0112 A–E, COMPLETE).** The repo's docs folder IS the
backlog, by default: per-home runtimes, bounded cross-home reads with deterministic
RRF fusion, one-shot fail-closed migration, `.backlog` layout per Goga's 0112.2/0112.3
rulings, loopback-contained daemon. **Goga's real ~/.backlog migrated and verified.**

**User-defined substrates (ADR 0113 A–C + C.2).** ADR/REQ/prompt as data; project
substrate registry; compiled semantic intent contracts; 16 built-in intents;
registry-declared wakeup disclosure; searchable substrate projections (server-owned,
injection-proof).

**Requirements that survive architecture work (ADR 0113.1).** The founding complaint:
wakeup now carries a worst-first constraints section; violations visible pre-hydration.

**Memory uplift (ADR 0114/0115).** One retrieval language (wakeup→recall→get);
provenance-bearing stubs (age/uses); backlog_context deleted.

**Search & RAG evidence discipline (ADR 0116 Phase 0 EXITED).** Judged 40-query CI
gate + sealed real-corpus baseline (tag baseline/0116-v1): hybrid .863 vs BM25 .843
nDCG@10; comparison law recorded. Ranking work is now measurable or unshippable.

**Intent write surface (ADR 0106.5 Phase A + D).** Semantic attribution journal;
intent registrar; generic MCP write deletion; fail-visible registration.

**The write boundary (ADR 0117, Accepted + implemented).** Native Edit is the lane;
watcher diagnoses, never mutates; write_resource is a deferred strict lane;
canonical adoption needs explicit consent; wakeup is the one always-visible tool.

**Organize at intake (container routing, live).** Deterministic ladder with
provenance; unfiled-count pressure in wakeup; memory exemption structural.

**The two executable scenarios — the north star as CI gates:**
- **Cold-Open Test: FULLY LIVE.** All 10 assertions green through the real stack;
  committed docs byte-identical after a full session (Invariant 8 executable).
- **Amnesia Test: LIVE, with ZERO new product code** — the operation-state substrate
  is a pure project declaration; C.2 carried a never-seen substrate end to end.
  "Kill an agent, restart it, one wakeup" is now a CI gate.

**Viewer (ADR 0112.4).** Home provenance badge (server truth), URL-rewrite switching,
cross-home spotlight — the viewer speaks the same law as the tools.

**Sibling repos.** nisli: P1s closed 1,457/1,457 green; core 0.54.1 / router 0.5.1 /
ssg 0.4.0 released. aime: delivery-reliability arc closed; v2 ledger-attested
provenance protocol live; ADR 0032 context-lifecycle detection/receipts/anchors/
manual actuation shipped through live incident-driven acceptance.

## Releases
backlog-mcp 0.60.0 + 0.61.0 (the flip), nisli three packages — all via CI, all green.

## Decisions parked on Goga (Phase Two inputs)
The NAME (Kvali proposal); Agent-vs-Contributor substrate naming; historical memory
data location (global store was empty pre-migration — where does old data live?);
@nisli/ui 0.4.0; D1 code quarantine; Loro exploration.

## Phase Two scope (recorded, not started)
Contradiction detection implementation (ADR 0120 design approved; Phase A committed
15a8257, parked); wakeup budget ledger + C.2 nits; implicit qrels → 0116 v2 recall
baseline → Phase 2 ranking; P-4 thread allocator seam; 0118.1 Slice A build;
ADR 0119 agent substrate implementation; wakeup(operation=) focal selection;
aime ADR 0032 static policy (observe-only first); memory health observatory and
remaining garden picks as Goga selects.

## Retro — what the operation learned about itself

**What worked.**
- **Commits-as-you-go + worktrees + frozen-SHA reviews**: survived a five-agent
  usage-limit outage, two reviewer session limits, and six compactions with zero
  lost work.
- **Two-key gates with substitutes**: basalt's substitute verdict caught two real
  Medium defects an independent no-findings review missed. Rigor is portable.
- **Rebase-first (Goga's mid-operation ruling)**: linear history, ~15 fast-forwards,
  every merge conflict resolved by its owner with revalidation. The finished-tip
  rule (verified work preempts in-flight rebases) resolved every train collision.
- **Disk anchors beat context windows**: three hand-rolled amnesia recoveries
  mid-operation became the Amnesia Test, then became product architecture. The
  operation dogfooded its own thesis live.
- **Menus not mandates**: audits and the idea garden produced ~30 recorded options;
  only Goga-approved ones were built. No audit/fix loops occurred.

**What hurt.**
- **Delivery-channel fragility**: composer wedges, a daemon-swap message loss, a
  broadcast stdin bug, and one forged-looking frame cost real orchestration time.
  Each produced a filed issue and a shipped fix (v2 attested protocol) — but the
  class of failure dominated incident count.
- **Harness limits are the real weather**: Codex weekly limits, Claude session/
  weekly limits, and auto-compaction set the operation's tempo more than any
  engineering constraint. ADR 0032's lifecycle automation is the correct response.
- **Crossing messages**: orchestrator rulings and agent reports crossed constantly;
  attested ledger refs (v2) now make ordering auditable.

**The proof-of-concept that matters**: nine agents, three repos, one day — an
architecture repositioning designed, ruled, built, reviewed, released, migrated
onto the owner's real data, and captured back into the store it built. The backlog
was the memory of the operation that built the backlog.
