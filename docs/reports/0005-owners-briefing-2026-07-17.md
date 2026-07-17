---
title: "Owner's Briefing — Where the Product Stands and What Needs Your Judgment"
date: 2026-07-17
status: Final
author: granite (architect)
relates_to:
  - ../NORTH-STAR.md
  - 0001-phase-one-vision-uplift.md
  - ../adr/0121-retrieval-evaluation-from-first-principles.md
---

# Owner's Briefing — 2026-07-17 evening

Written for Goga, in plain language, to make judgment calls easy. Fifteen-minute read.
Everything here is on main and released or releasable; citations are one click away in
the viewer.

## Where we are, in one paragraph

Phase One (yesterday) turned backlog-mcp into what the vision says it is: a docs-native
memory engine where a repo's own `docs/` folder is the backlog, document types are data,
and the two founding scenarios — a stranger orienting cold, an amnesiac agent resuming —
run as CI gates. Phase Two (today) is the honesty phase: we measured the product against
reality and fixed what reality rejected. Three independent trials said the first
impression failed on real repos; that is now rebuilt and merged (reruns pending). An
adversarial audit said our evaluation evidence was a closed loop of agents grading
agents; ADR 0121 proposes the replacement. The deepest true thing today surfaced:
**the read machinery is excellent and the memory store is empty.** That gap is the next
trunk move (see the memory-flywheel proposal).

## Scoreboard against the north star

**Proven, with evidence:**
- Zero-setup bolt-on works mechanically: point the tool at any repo, search and recall
  perform (sub-second, correct) once an agent knows what to ask.
- Substrates-as-data is real three times over: operation-state (Amnesia test),
  reference/prior-art (yesterday), each a pure JSON declaration, zero product code.
- Cold-Open 10/10 and Amnesia 8/8 run as CI gates; committed docs stay byte-identical
  through full sessions.
- The release train is linear and boring in the good way: 0.57 → 0.63, all CI-tagged.

**Disproven, then repaired (reruns will confirm):**
- Wakeup's first impression of an existing corpus — 0/10, 1.0/5, and losing to `cat`
  across three trials. Rebuilt today: orientation map, git-backed recency, honest
  omission, byte-exact budget gate, plus the status-matching bug that hid 45 of 46
  decisions in our own repo.
- The evaluation orchestra — statistically and sociologically hollow (ADR 0121, report
  0004). Proposed replacement: deterministic structural suite + end-to-end task gates.

**Unknown — the honest frontier:**
- Does memory *accumulate* in real work? Nobody has ever organically called `remember`;
  the global store was empty at migration; zero recall-usage events exist anywhere.
  The core sentence of the vision is currently unexercised.
- Does the tool earn its tokens against raw files after today's fixes? (The rerun
  answers this; it lost 8/10-vs-10/10 before.)
- Multi-repo daily use by its actual owner — you. The product has never been used in
  anger by a human for a week.

## Your decision queue, with my recommendations

| # | Decision | My recommendation | Your cost |
|---|---|---|---|
| 1 | API credits for the agent lane | Top up / check plan — blocks acceptance reruns and further builds | minutes |
| 2 | ADR 0121 (evaluation reset) | Accept as written; every ruling has kill-evidence | 15-min read |
| 3 | R8: human-review 4 recall queries | Do it once; it's the first real exercise of your final-authority role and unblocks the ranking lane's evidence honestly | 1–2 h |
| 4 | Release 0.64.0 | Hold until reruns pass so the notes state measured results | none |
| 5 | ADR 0117 phases A/B ("explicit GO" is literally the recorded trigger) | GO for Phase A (diagnostics disclosure); defer B | one word |
| 6 | ADR 0119 agent substrate (design-only, awaiting authorization) | Authorize Slice A only (the substrate + fixtures; it fixes `identity: absent` in every briefing) | one word |
| 7 | The NAME (Kvali leads) | Yours alone; no recommendation offered | taste |
| 8 | Historical memory data — the global store was empty. Does old data exist elsewhere, or does your memory genuinely start now? | Answer settles the flywheel proposal's cold-start question | one answer |
| 9 | @nisli/ui 0.4.0 | Ship it; it's staged and green | one word |

Everything else runs without you: rerun harness when credits return, structural suite
build (0121 R2) after your ruling, Tier-1 telemetry, viewer polish.

## What worries me, as the architect

1. **The empty-store problem.** We built a beautiful reading room for a library with no
   books. Every read surface (wakeup, recall, get, provenance, budgets) is measured and
   gated; the write side (why would an agent ever remember?) has no gravity at all.
   This is the subject of my flywheel proposal — I consider it the trunk.
2. **Evidence hygiene needs a human in the loop somewhere.** ADR 0121's audit
   generalizes: any gate where agents author, judge, and review will drift toward
   internal coherence. The cure isn't more review theater — it's structural truth where
   possible and your 1–2 h at the few points where judgment is irreducible.
3. **Harness weather is our tempo.** Two credit/limit outages in two days set the
   schedule more than any engineering constraint. Commits-as-you-go has saved us three
   times; it stays law.
4. **Fleet-shaped blind spots.** Every query, judgment, and trial so far was authored
   by agents building the product. The single highest-value data source we do not have
   is *you using the tool for a week on real work*.

## Reading list, by time available

- 5 min: this document + the wakeup before/after in the changelog (Unreleased).
- 20 min: ADR 0121 (the evaluation reset) — decision #2.
- 45 min: the vision-gaps audit + the memory-flywheel proposal (both new today) —
  they are the "what's next" conversation.
