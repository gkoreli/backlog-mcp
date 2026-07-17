---
title: "Judgment-Queue Inventory Probe — the Scatter Baseline"
date: 2026-07-17
status: Final
author: granite-subagent (probe), granite (editor)
relates_to:
  - ../proposals/attention-viewer-2026-07.md
  - ../prompts/0007-attention-driven-viewer.md
  - ../prompts/0005-judgment-uplift-tenet.md
---

# Judgment-Queue Inventory — 2026-07-17

The Tenet 11 branch's first measurement: everything currently waiting, explicitly
or silently, for a human judgment call. Read-only sweep across doc statuses,
NORTH-STAR, grep passes, CLI on both homes, the 48h git window, and the
evaluation store.

## Headline

**~74 raw waiting line-items ≈ 35 distinct human judgments, scattered across
14 document surfaces + 3 CLI commands × 2 homes — about 20 lookups to see
everything once.** No two surfaces agree on what is still open (the owner's
briefing says 9 with 3 already resolved; NORTH-STAR lists 0114 as open while
the code shows it shipped). No single surface shows more than a fraction.

## DECIDE (~35 after dedup)

- **25 ADRs at status Proposed** — of which **~8 are status-drift, not
  decisions**: the work shipped and the ledger was never updated (0106.5 shipped
  2026-07-16; the 0112 family shipped in 0.60/0.61 onto Goga's real data; 0113
  partially live via docs/substrates/reference.json; 0114 executed —
  `backlog_context` is gone from src; 0115 shipped; wakeup-first-impression
  implemented AND measured in 0.64.0, still Proposed). **Any DECIDE surface
  derived from statuses inherits this lie until reconciled.**
- **10 zombie ADRs** (149–175d, pre-uplift era: 0009, 0018, 0021, 0036, 0037,
  0083, 0084 + odd-states 0097.1, 0013.7, 0101-P4) — report 0003 already
  classified them; one sweep shrinks the queue by a third.
- **Live structural rulings genuinely open**: 0107 history/truth (vs 0112
  leaning; NORTH-STAR's last structural open row), 0120 phase-two GO,
  0118.1 Slice A (charter landed same day — in flight).
- **17 proposals Proposed** (all born in the last 48h) + 2 explicit menus
  (moat map; vision-gaps "rule on GAP 1 and GAP 5") + the idea garden.
- **Named judgment lists in 5 places**: owner's briefing (6 of 9 still open),
  phase-one parked list (6), absorption thesis (4), lattice (4), the mine's
  21 build-shaped menu.

## REVIEW (nearly empty — one hot item)

Contradictions: 0 in both homes. Consolidation: 0 ripe. Quarantines: 0.
Candidate qrels: 0 records (structural — journals record mutations only).
qrels v1: 235/235 reviewed-marked. **The single live, irreducibly-human item:
R8 — four hand-drafted recall queries awaiting the final-authority human tier,
time-committed "this week," buried inside an Accepted ADR's body where no
surface shows it. It blocks baseline v2 and the entire ranking lane.**

## READ (the 48h docs storm)

89 docs files added, 92 touched since 2026-07-15 evening: 17 ADRs, 26
proposals, 15 reports, 14 references + 1 substrate decl, 8 evaluation files,
7 prompts, NORTH-STAR. Git authorship is useless for attribution (fleet
commits-as-Goga); content attribution: 7 prompts = Goga verbatim, ~80 files
agent-authored. **Plausibly unread by the owner: ~75 files**, including the
owner's briefing written specifically for him.

## HEALTH

Requirement compliance structurally empty (no requirement substrate declared in
this repo; constraints=0 both homes). Known issues in changelog: BUG-0003
status-not-searchable; bare-path `get`. **BUG frontmatter drift**: BUG-0001/2/4/5
still say Open though 0006 + changelog record 4/5 fixed. `identity: absent`
everywhere (0119-A in flight). The engine cannot answer this probe's own
question: `list --status parked` returns nothing while ADR 0118's status
literally says PARKED (friction F6 — fixed in the defect batch in flight).
aime rerun FAIL carries a latent judgment: accept the zero-setup boundary as
final, or charter declared-conventions.

## Top 7 for a single attention page, worst-first

1. **R8: human-review 4 recall queries** (~1–2h) — only live irreducibly-human
   review item; blocks the ranking lane; invisible where it lives.
2. **Memory-flywheel / GAP 1 ruling** — the declared trunk; every un-ruled day
   compounds read-side over an empty write side. [Ruled ACCEPTED with PROMPT
   0006 law same day — retained here as the probe measured it.]
3. **Executed-but-Proposed status drift (~8 ADRs + 1 proposal)** — cheapest big
   fix; the attention page's DECIDE feed is wrong until done.
4. **One-word bundle**: 0117 Phase A GO · 0119 Slice A authorize [since
   authorized, in flight] · @nisli/ui ship — highest blocked-work per
   decision-cost.
5. **History/truth ruling (0107 vs 0112)** — last structural open; gates
   Phase 5.
6. **The NAME** — oldest pure-taste call; five surfaces point at it; now also
   gates positioning rollout.
7. **Zombie-ADR sweep** — classifications already exist in report 0003; one
   pass makes the DECIDE count honest.

Footnote: the absorption thesis's call #3 (authorize this probe) is
self-answered by this document's existence.

---

## Reconciliation applied (2026-07-17)

The status-ledger reconciliation (branch `docs/status-reconciliation`) executed
the mechanical dispositions this probe identified. Nothing requiring a real
judgment was flipped.

- **12 executed-but-Proposed documents flipped with ship evidence** — ADRs
  0092.3, 0106, 0106.5, 0112, 0112.1, 0112.2, 0112.3, 0112.4, 0113, 0114,
  0115, plus the wakeup-first-impression proposal (0.64.0; rerun reports
  0006/0007/0008 cited inline, including the honest aime 3.0/5 shortfall).
- **3 recorded dispositions applied from report 0003** — 0036 marked
  Superseded (D10), 0013.7's hosting Open Tension marked resolved by ADR 0104
  (D14), 0101 Phase 4 recorded shipped via ADR 0092.4 (0003 appendix).
- **5 BUG ledgers reconciled** — BUG-0001/0002/0004/0005 → Fixed (0.64.0, rerun
  citations); BUG-0003 stays Open with an in-flight note (defect batch).
- **4 NORTH-STAR Open-decisions rows marked resolved** (context tools 0114;
  storage layout; ADR modeling; docs home). The NAME row and the history/truth
  row remain open, untouched.
- **7 zombies annotated, not disposed** — 0009, 0018, 0021, 0037, 0083, 0084,
  0097.1 now carry `attention: awaiting zombie-sweep ruling (report 0009 #7)`.
  Their report-0003 citations are partial (phase-only, quarantine-posture, or
  GARDEN), so disposition stays a human ruling. In particular 0083's rumored
  0116/0121 supersession did not verify: ADR 0116's own reconciliation table
  says "Partly implemented; cross-encoder proposal remains conditional," and
  ADR 0121 never mentions it.
- **Left untouched as genuinely open** — R8 (the four recall queries); the
  NAME; history/truth (0107 vs 0112); 0120 phase-two GO; 0118.1 Slice A (in
  flight); @nisli/ui 0.4.0; historical memory data location; the fresh
  proposal cohort, the two explicit menus, and the idea garden; and ADR 0113.1
  (shipped in 0.61.0 per CHANGELOG, but its status is review-gated — "beryl
  reviews before build" — so it is left for that ruling rather than flipped).
