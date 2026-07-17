---
title: "One Memory, One Home, Fused Reads — Dissolving the Placement Tension"
date: 2026-07-17
status: Proposed (distilling PROMPT 0008; three rulings + three experiments named)
author: granite (architect), distilling goga
relates_to:
  - ../prompts/0008-memory-placement-tension.md
  - ../adr/0112.1-per-home-retrieval-composition.md
  - ../adr/0119-agent-substrate-and-derived-correlation.md
  - memory-flywheel-2026-07.md
  - worktree-native-access-lattice-2026-07.md
---

# One Memory, One Home, Fused Reads

Goga's tension, distilled: where does recall answer from by default; where do
memories get written; what is agent-identity memory; how do we avoid both
context bombardment AND memory islands; and does any of this survive the
signal-per-token test? His own closing question — *"maybe there are ways to
sidestep or uplift in a way that these conflicts disappear?"* — is the right
one. Most of the tension dissolves under three moves, all already latent in
the shipped architecture. What remains genuinely open is named as three
experiments, not guessed at.

## The three dissolving moves

### Move 1 — Reads are always fused; provenance keeps them legible

**Recall and search answer from every home the session legitimately knows,
fused, by default.** This is not new design — ADR 0112 Phase D built exactly
this (bounded cross-home fan-out, deterministic RRF, per-stub provenance,
honest degradation) and ADR 0112.1 fixed the contract. The ruling this
proposal adds: fused-all becomes the *default* for the memory verbs, not an
option. Filters narrow (`--home`, `--author`, type, tags); restriction is
never the resting state.

This dissolves the islands fear structurally: **no read wall exists between
homes or between agents.** One agent's meaningful memory is always findable by
every other. And it answers the legibility question with the progressive
disclosure tenet applied as-is: the *default* is baked (no per-call decision
tax), the *provenance* is disclosed (every stub carries its home chip and its
author chip — `MEMO-0011 · global · by granite`). The agent never wonders
where an answer came from, and never spends a turn deciding where to ask.

The one deliberate wall stays deliberate: the user-private tier (lattice,
GAP 5) is a grant, not a default — that is its entire point.

### Move 2 — Writes follow a one-line rule; placement stops mattering

Duplication ("write locally and globally, dedup, sync") is the wrong branch —
it creates a second source of truth, violates docs-native law, and buys
nothing once Move 1 exists: **if reads always fuse, placement barely affects
findability.** What placement actually decides is git ownership — does this
memory travel with the repo to everyone who clones it, or stay in the
personal store? That is a real, meaningful, ONE-BIT decision, and it
compresses into a single rubric line (extending F1's remember rubric):

> *Would this matter in a repo you have never opened? Global. Otherwise it
> belongs to this repo.*

One write, one turn, no accounting. The remember rubric already teaches when
to write; this teaches where, in nine words, and the default when unstated is
the current home (the repo you are working in) — the conservative choice,
because project memory is reviewable in PRs and travels with the code.

### Move 3 — "Meant for both" is promotion, not duplication — and usage decides

The genuinely-torn case (a local lesson that deserves global life) is not a
write-time decision at all, and forcing the agent to forecast it is exactly
the token-waste Goga is warning about. The dissolving move: **promotion as a
usage-driven candidate**, riding machinery that already exists:

- Usage tracking already records recall hits per memory. When a
  *project-home* memory keeps being recalled from *other* homes' sessions
  (fused reads make this observable for free), that cross-home demand IS the
  evidence it outgrew its repo.
- The engine surfaces a **promotion candidate** — same shape as 0120's
  collision candidates: deterministic trigger, never auto-acted, adjudicated
  cheaply (Desk REVIEW class; one paste-ready instruction).
- Promotion is a **move with provenance** (`promoted_from:` link, original
  retired as a pointer), never a copy. One source of truth survives.

The agent forecasts nothing; the system detects; a human (or later, a
trusted-by-Tenet-11 layer) ratifies. Signal-per-token strictly improves: zero
added write turns, and the store self-organizes from real demand instead of
write-time guesses.

### Identity is provenance and a signal — never a wall

Agent memory as a *separate scoped store* defeats itself, exactly as Goga
says. The shipped 0119 answer is the right one: memories carry **attribution**
(`by granite`), and identity becomes a *filter dimension* and a *candidate
ranking signal* — never an access boundary. "My memories" is a query
(`--author AGENT-0001`), not a place. The only identity-flavored placement
rule worth having: operational self-state (a specific agent's covenant
anchors, re-prime state) naturally lands in the global home with attribution —
and is still readable by everyone, because tunnel-memory islands are the
failure mode, not the feature.

Whether identity should *boost* ranking (own-authored procedural memories
favored during recall?) is genuinely unknown — Goga's "maybe identity just
helps the qrels? or hinders?" is exactly right, and it is Experiment E2, not
a design commitment.

## What stays genuinely open — three named experiments

- **E1 — Fusion at scale.** Thousands of memories across homes: does
  fused-all recall stay precise, or does global noise pollute project
  queries? Instrument: the structural suite (membership/navigation classes
  extended to memories) + the E2E gates; the replay telemetry (0121 R7 Tier 2)
  measures it on real demand once capture lands. Kill evidence for Move 1's
  default: measured precision loss that per-home filtering recovers.
- **E2 — Identity as a ranking signal.** Does own-author boost help or hinder
  recall relevance? Needs real multi-agent memory accumulation (the flywheel)
  plus R8-lineage judged recall queries. No ranking change ships without the
  0121 gates — this is a hypothesis, not a plan.
- **E3 — Promotion thresholds.** What cross-home recall-hit pattern marks a
  promotion candidate (N hits from M distinct foreign sessions)? Needs
  Tier-1 telemetry (session ids) + flywheel data. Start with candidate-only
  surfacing at a conservative threshold; tune against adjudication outcomes.

## Prior art (verification levels per the epistemic law)

- **Letta memory blocks** (code/docs-verified in REF-0009): agent-scoped
  always-loaded blocks + shared tiers — validates identity-attributed memory
  with shared readability; their server-resident agent scoping is exactly what
  we reject (store, not actor).
- **memU tracks** (code-verified, ledger UQ1): workspace-vs-memory "tracks"
  inside one store with single-call retrieval across layers — convergent with
  fused-reads-plus-filters, no read walls.
- **beads** (code-verified, ledger UQ3): one shared store across worktrees —
  dissolves placement by abolishing locality entirely; instructive as the
  opposite pole: it loses git-travel and review-native memory, which is the
  half we keep.
- **Git itself** (the deep prior art): one commit lives in one place; sharing
  is *fetching*, not duplicating; promotion (cherry-pick) carries provenance.
  Move 3 is cherry-pick for memories.

## Rulings requested (small)

1. **R-A:** fused-all as the memory verbs' read default, provenance chips
   mandatory on stubs (Move 1). [Recommend: yes — it is 0112 D's design made
   the default.]
2. **R-B:** the nine-word placement line joins the remember rubric; no
   dual-write, ever (Move 2). [Recommend: yes.]
3. **R-C:** promotion-candidate lane chartered (Move 3) — build gated on
   Tier-1 telemetry landing, surfaced via Desk REVIEW. [Recommend: yes, after
   flywheel data exists.]

## Signal-per-token audit (Goga's closing test)

Added per write: zero turns (nine rubric words). Added per read: zero turns
(default, no decision). Added management surface: none for agents; one Desk
candidate class for the human, adjudicated in seconds. Removed: the entire
"where do I ask / where do I save / should I copy this" deliberation class.
Net: signal per token strictly increases, and the store's organization
improves from evidence rather than agent forecasting.
