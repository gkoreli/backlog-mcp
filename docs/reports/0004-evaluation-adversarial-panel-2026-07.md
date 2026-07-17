---
title: "Adversarial Panel: The Search/Recall Evaluation Orchestra"
date: 2026-07-17
status: Final
author: granite (orchestrator) — synthesizing three independent adversarial lenses
relates_to:
  - ../adr/0121-retrieval-evaluation-from-first-principles.md
  - ../adr/0116-search-and-rag-uplift.md
  - ../evaluation/README.md
  - ../evaluation/JUDGING.md
---

# Adversarial Panel — Evaluation Orchestra Review

Goga's directive (2026-07-17, verbatim spine): *"we need adversarial thinking, step back
and think about what basic things we are missing… truly ingenuine and deterministically
proven… this needs its own ADR thread, to revisit, step back and think from first
principles instead of being tunnel focused on the already chosen solution."*

Method: three independent adversarial agents, no cross-visibility, distinct lenses —
(A) validity attack on the existing judged set/baseline, (B) first-principles
alternatives, (C) verdict on the implicit-qrels mining path. Each grounded its claims
in the artifacts (all quotes verified; lens A independently recomputed all 48 per-query
nDCG values and matched the frozen report exactly; lens C verified every journal on the
machine byte-level). Synthesis and rulings live in ADR 0121; this report is the evidence.

**Correction to the operating record, all lenses:** the judged set is **24 queries**
(6 classes × 4), 235 qrels — not the "40" repeated in session lore.

## Lens A — validity of the existing orchestra

### Indictment, ranked

1. **The "independent human review" never happened; the gate demanding it is a substring
   check.** All 235 judgments carry `chert-initial; reviewed:beryl 2026-07-16` — both
   LLM agents; JUDGING.md's own rule that LLM-proposed judgments be marked
   `assessor: llm:<model>` and never gate until a human confirms was bypassed by fleet
   persona names. Enforcement is `assessor.includes('reviewed:')`
   (scripts/search-eval.mjs:118) — nine characters pass the gate. The review itself was
   near-null: diffing draft (3b852f3) vs reviewed (bfbe551), **2 of 235 grades changed**
   (0.85%). Rationales are grade-templates: 146 identical "Not relevant…" copies, 48
   identical "Marginally relevant…", 14 identical "Substantially relevant…" — zero bits
   beyond the grade, violating JUDGING.md's "a grade without a rationale is invalid" in
   spirit. Beryl also authored 7 of the 24 queries it reviewed. Goga's final-authority
   role was exercised zero times.
2. **The headline sits inside its own noise band; the required statistics were never
   computed.** Per-query deltas (hybrid − BM25): mean +0.0208, sd 0.0360; paired
   bootstrap 95% CI [+0.006, +0.036]. The 0.02 indifference threshold means BM25 fails
   the regression test by **0.0008 nDCG** — one grade flip anywhere reverses the
   policy verdict; beryl's two review edits alone moved the delta by 0.0018, twice the
   margin. ADR 0116 Finding 8 *requires* per-query deltas + bootstrap CI; the runner
   contains neither. Power analysis: detecting 0.02 at sd 0.036 needs n≈25; n=24.
3. **Softball composition.** 14/24 queries (58%) are (near-)verbatim titles, filenames,
   or IDs of their grade-3 target (entire lexical class = literal document titles;
   filter-02 is PROMPT 0001's subtitle word-for-word; resource-04 is JUDGING.md's H1).
   The tail class carries the target's rare lexical tokens, so BM25 answers it
   regardless of vector truncation — it measures "BM25 rescues the tail," not
   "truncation hurts." Ceiling: 12/24 queries at BM25 nDCG ≥ 0.98 (7 at 1.0); three
   queries have judged universes of 2 documents. Genuinely hard vocabulary-mismatch
   queries: ~6 of 24. 72.4% of hybrid's lead comes from the two most judgment-fragile
   classes (aboutness 34.8% + tail 37.6%).
4. **The corpus judges itself.** 5/24 queries (21%) target the evaluation program's own
   paperwork (ADR 0116 ×4, JUDGING.md ×1). All 24 provenance strings are fleet task
   assignments from ONE day of building this very system; zero queries from Goga; zero
   from logged usage (none exists). The full lifecycle — protocol, runner, queries, 235
   judgments, "review," freeze — completed in one calendar day.
5. **"Real usage" ground truth: none, structurally.** Journals record mutations only;
   search demand recorded nowhere; hydration visible only for MEMO- ids; recall misses
   append nothing. Every claim about what agents search for is unfalsifiable by design;
   baseline v2's gate demands evidence the instrumentation cannot produce.
6. **nDCG@10 is far from the construct, and Phase Two proved it.** EXP-2: tool 8/10 vs
   raw files 10/10 at 1.76× tokens — every lost point was corpus membership or temporal
   grounding, not ranking. Nisli: wakeup 0/10 while search ranked the right doc #1 in
   0.68s. Aime: the ordering failure that hurt was wakeup disclosure sort — a ranking
   surface with no fixture and no gate. The gate protects the variable field data says
   doesn't bind.
7. **Pool bias total, disguised as completeness.** unjudged@10 = 0.000 means the judged
   pool is exactly what the two systems retrieved, graded post-hoc by their builder
   after seeing the rankings. Recall@20 = 1.000 is near-tautological; the fixture can
   never charge either system with missing a document neither surfaced.
8. **The frozen baseline was incomparable within 24 hours.** Corpus hash covers 165
   docs; one day later main has 202, 42 files under docs/ changed. By the README's own
   same-corpus-hash rule the frozen artifact stopped being a comparison anchor
   immediately; every candidate must rerun both arms anyway.
9. **Minor but telling.** Exactly 4 queries × exactly 6 classes (floor-compliance
   uniformity); three ADR-0116-named classes (semantic, multi-document, cross-home)
   have zero queries — including cross-home, the justification of the R-3 RRF design.
   nav-01 exposes a real plumbing bug: ID-intent canonicalization produces hyphenated
   IDs while the docs-native substrate (85% of corpus) uses space-form "ADR 0116" —
   the standing "Exact-ID success@1 = 100%" gate is silently scoped to an ID family
   that is now a corpus minority.

### What genuinely survives

The metric code is textbook-correct (independently recomputed, exact match). The
reproducibility engineering is excellent and rare — hashes, determinism checks, atomic
writes, the report excluded from corpus discovery, hard-fail instead of silent BM25
fallback, and raw ranked_ids shipped in the report (the ammunition for this very audit —
real epistemic virtue). Scope honesty is real (v1 declares itself not-recall-evidence;
synthetic memories banned; the miner's zero published, not fudged). The near-null review
was not rigged (both edits shrank hybrid's lead). "Hybrid ≥ BM25 on this instrument" is
statistically real (CI excludes zero) — a valid measurement of a construct of doubtful
validity. LLM judges for LLM-serving retrieval survives as a construct-alignment design
argument — not as an excuse for violating the written protocol. The fixture found real
bugs (nav-01 ID-format; the truncation two-zone design).

Pattern: **the physics is sound; the sociology is hollow.** Everything a machine can
check was done to a high standard; everything requiring an independent mind was
simulated by the same closed loop of agents and stamped with the vocabulary of
independence.

### The single deepest flaw

*The orchestra measures whether a search engine built by the fleet can find documents
the fleet wrote, using queries the fleet invented the same day, graded by the fleet,
reviewed by the fleet, and gated by a substring check — no link in the evidentiary chain
was ever touched by an information need originating outside the system under test. The
baseline certifies the loop's internal coherence, not the product's retrieval quality.*

## Lens B — first principles and alternatives

**The consumer of retrieval is an LLM reading a stub window, not a human scanning a
results page.** nDCG's positional discount encodes human attention (~3× weight rank 1 vs
rank 9); agent attention across 10 stubs in one tool response is near-flat. In-window vs
out-of-window is everything; then stub sufficiency. The right object is **token cost
from question to correct action** across the composed journey (wakeup → recall/search →
get): (a) is the doc indexed at all, (b) in the window, (c) does its stub let the agent
choose it, (d) tokens/calls to done. Tenet 2 already says this; the evaluation program
never inherited it.

**Four missing basics:** (1) corpus MEMBERSHIP is the dominant field-failure class with
zero instrumentation — a coverage suite would have caught four of the five worst field
findings; (2) per-class metrics on n=4 are anecdote wearing decimals — "aboutness
0.528" is arming the cross-encoder lane on evidence that cannot survive a bootstrap
interval; (3) STUB SUFFICIENCY is unmeasured yet is the actual decision surface of
progressive disclosure; (4) a hand-frozen fixture on a daily-growing corpus decays by
construction — a suite derived from the corpus at run time cannot drift.

**Five families evaluated** (mechanism/proof/cost/kill-evidence in full in the lens
record): structurally-true qrels (S; title/ID navigation ~170+ auto-queries, membership,
filter compliance, supersedes-ordering, tail probes; degenerates to tokenizer-testing if
query text comes from the target's own words; aboutness stays irreducibly a judgment);
end-to-end task-success gates (S/run; found every real failure this quarter; measures
the composition); human-in-the-loop minimal (real only as a 15-min/week trickle
adjudicator, not an engine); counterfactual replay (S telemetry then ~free; the only
legitimate future re-armer of ranking phases; the miner's zero was evidence the capture
was never built, not against the family); invest-less (right about the ranking lane —
freeze at v1, tripwire-only, cross-encoder trigger not fired; wrong about evaluation
overall — spend follows the failure to composition).

**Cheapest next step producing genuine evidence:** the structural-suite generator, run
once against the current index — hours, no judge, ~7× the hand-built coverage, a
complete enumeration of every unreachable/title-invisible/status-dropped document. An
all-green result is also genuine evidence: it closes retrievability and points all
further spend at wakeup composition.

## Lens C — the implicit-qrels mining path

**Verdict: BUILD-LATER-ON-TRIGGER.** Steelman honored (real demand is the only
non-synthetic signal at volume; the candidates-never-gold cage is genuinely fail-closed;
the miner costs nothing to keep). Attacks that land: (1) **agent-click semantics** —
hydration is examination, not endorsement; from the 0003 mine's real tallies, ~21% of
hydration windows would mint grade-2 priors on wrong documents; the true endorsement
event (`cite`) already exists in the tracker and the miner ignores it in linkage;
(2) **feedback loop** — ~8-9 position-confounded grade-0 weak negatives per 1-2
positives per chain (~80% of the stream) exactly on the documents a better ranker would
promote, and the grade-0 prior induces the unjudged/0 conflation JUDGING.md forbids;
position-bias correction is infeasible at single-user volume; (3) **volume reality** —
observed recall-hit rate is zero/day (no memory corpus; no read telemetry);
time-to-baseline-v2 via mining is unbounded, vs ~1-2 hours hand-drafting four recall
queries from the 0003 mine's 16 real recorded questions; (4) **telemetry hazard** —
`.backlog/.gitignore` does not cover `state/`, so search-demand logging would make every
read a git-visible write (BUG-0005 class at per-query frequency) and put query text one
`git add -A` from shared history; (5) **review-gate reality** — mining automates the
cheap step and leaves Goga's judgment untouched.

Trigger (conjunctive): real memory corpus in `~/.backlog/docs` AND a monthly read-only
probe run of the miner reports ≥25 recall-hit events across ≥5 distinct days AND the
program needs more recall queries than hand-drafting supplies. Revised priors before any
real candidate review: hydrated → 1 (examined); hydrated-then-cited (same id, same
session) → 2-3 (the purchase event, minable with zero new telemetry); repeat-hydrated →
2 with cite guard; returned-not-hydrated → no graded prior, emit as unjudged-pool with
rank (recall ids are already appended in ranked order — rank is minable today).

## Where the lenses independently converge

1. Ranking is the healthiest measured lane; every field failure was
   orientation/membership/temporal. The instrument points at the wrong target.
2. The "deterministically proven" family (structural qrels + membership assertions) is
   the cheapest genuine evidence and cannot drift.
3. The 24-query set survives only as a demoted global tripwire; per-class authority at
   n=4 dies.
4. Baseline v2's four recall queries: hand-draft from real recorded demand, HUMAN
   review by Goga. Hours, not weeks.
5. The miner stays as a passive probe; the mining expectation retires until triggers
   fire.
6. Session ids + recall-miss events are worth shipping on their own (B18)
   justification; search-demand logging is contested (B: capture compounds with time;
   C: feeds the well-fed surface, carries the hygiene hazard) — reconciled in ADR 0121.
