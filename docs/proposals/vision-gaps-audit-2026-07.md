---
title: "Vision Gaps Audit — Where the North Star Is Silent"
date: 2026-07-17
status: Menu (audits are menus, not mandates)
author: granite (architect)
relates_to:
  - ../NORTH-STAR.md
  - ../reports/0005-owners-briefing-2026-07-17.md
  - memory-flywheel-2026-07.md
---

# Vision Gaps Audit — July 2026

Two days of measurement stress-tested the north star. The tenets held where they spoke.
This audit lists where they are *silent* — places evidence hit questions the vision
doesn't answer. Each gap states the evidence, why it matters, the smallest probe, and
what kind of work it is: **engineering** (we know what to build), **research** (we need
an experiment first), or **taste** (only you can rule). A gap is not a work order;
this is a menu.

## GAP 1 — Memory intake has no gravity (the write side)

**Evidence.** The global store was empty at migration. Zero recall-usage events exist
in any home. Every memory ever written was written because an instruction said "dogfood
the tool." When instructed, the loop works (the nisli trial recalled 5/5 of what it
remembered); uninstructed, nothing is ever written.
**Why it matters.** The core sentence — *your backlog is your agent's memory* — is
vacuously true of an empty store. All eight tenets govern how memory is *read*; none
says how memory comes to exist.
**Smallest probe.** The memory-flywheel proposal (separate doc, today).
**Kind.** Research → engineering. **Tenet gap: yes** — the vision needs an intake
tenet: something like "memory is captured at the moment of proof, not by ceremony."

## GAP 2 — Time is load-bearing but unnamed

**Evidence.** Today's biggest quality win was temporal: git-backed recency now orders
disclosure, and the staging replay showed timestamp-less corpora surface *oldest-first*
without it — the exact failure two trials hit. Provenance stubs carry `age_days`.
**Why it matters.** Freshness is treated as an implementation detail, but it decided
real outcomes (Erent Q3, Aime current-decisions). Staleness is the memory problem.
**Smallest probe.** None needed — evidence exists. The gap is doctrinal.
**Kind.** Taste + a paragraph. **Tenet gap: yes** — the north star should say that a
memory's authority decays unless re-proven, and that the engine must always know what
"newest" means, even on corpora that never recorded dates.

## GAP 3 — Whose memory is it? (`identity: absent`)

**Evidence.** Every wakeup briefing ever generated in this repo says
`identity: absent`. ADR 0119 designed the agent substrate; it awaits your
authorization. Meanwhile the heaviest real user is a nine-agent fleet whose members
share one store with no identity boundaries.
**Why it matters.** "Your agent's memory" — singular possessive — is ambiguous at
exactly the point our own dogfood lives: many agents, one backlog. Is memory shared by
default and owned never? Attribution exists in the journal but not in the vision.
**Smallest probe.** Authorize 0119 Slice A (substrate + fixtures, S) and see what the
first identity-aware briefing changes.
**Kind.** Engineering (designed) + taste (the ownership doctrine). **Tenet gap: yes.**

## GAP 4 — The human adjudication surface is becoming a product

**Evidence.** In two days the product grew three queues that ask a *human* to rule:
collision candidates (`distinct_from`), quarantined documents, and now ADR 0121's
review of candidate judgments. Your final-authority role in JUDGING.md has been
exercised zero times — not from unwillingness but because nothing routes to you.
**Why it matters.** The vision frames the human as author and beneficiary; evidence
says the human's scarcest contribution is *adjudication* — small, high-leverage
verdicts. No tenet governs how the product asks for judgment, budgets it, or records
it. (The viewer is the natural surface; the collision queue is the prototype.)
**Smallest probe.** Count adjudication-shaped items currently waiting silently
(collisions, quarantines, candidate qrels, parked decisions) and design one "needs a
human" view in the viewer.
**Kind.** Research → engineering; the doctrine is taste. **Tenet gap: yes** — something
like "the engine asks for human judgment rarely, precisely, and durably records the
verdict as memory."

## GAP 5 — Committed memory is shared memory, and the vision doesn't say so

**Evidence.** Docs-native means project memories live in `docs/` and travel through
git. Anyone who clones the repo inherits the memory — including memories an agent wrote
about *how you work*. The privacy note in today's telemetry ruling (query text one
`git add -A` from public) is the same class.
**Why it matters.** Single-user posture is a development stance, but the storage
design already made project memory multi-reader. Deliberate? Probably — it's the
"backlog as shared brain" story — but it is nowhere stated, and the line between
personal (`~/.backlog`) and shared (repo) memory is undocumented judgment.
**Smallest probe.** One paragraph in NORTH-STAR ruling what belongs in each home, and
a wakeup/remember default that respects it.
**Kind.** Taste, then documentation. **Tenet gap: yes.**

## GAP 6 — Memory lifecycle has a front door and no back door doctrine

**Evidence.** `forget` exists as a verb; 0115 gave memories provenance; 0120 detects
collisions. But nothing rules when a memory *should* die, be superseded, or archived —
and the reference substrate now stores prior-art claims that will silently rot as the
outside world moves (Letta pivots, models deprecate).
**Why it matters.** A memory engine that only accretes converges on being a landfill
with good search. Decay-by-disuse exists in ranking; deliberate retirement has no
story.
**Smallest probe.** Pick the ten oldest live memories/references after a month of real
use and see whether any *should* have died; design from what you find.
**Kind.** Research now, taste later. **Tenet gap: partial** — Tenet on stale authority
(GAP 2) may cover it if written broadly.

## Not gaps (checked and closed)

- *Progressive disclosure* — held under attack; the byte-budget invariant survived
  three experiments and is now wire-exact.
- *No LLM in the server* — every new capability this week (recency, orientation,
  collisions, structural evaluation) stayed deterministic. The tenet is doing its job.
- *Local-first* — no pressure encountered that D1/Workers descoping was wrong.

## If you only rule on two things

Rule on **GAP 1** (adopt the flywheel direction or redirect it) and **GAP 5** (what
memory is shared) — the first because it is the trunk, the second because every day of
docs-native usage bakes the current unstated answer deeper into git history.
