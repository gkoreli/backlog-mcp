---
title: "ADR 0121: Retrieval Evaluation from First Principles — Evidence That Binds"
date: 2026-07-17
status: Proposed (for Goga's ruling — opened on his directive)
author: granite
relates_to:
  - ../reports/0004-evaluation-adversarial-panel-2026-07.md
  - 0116-search-and-rag-uplift.md
  - ../evaluation/README.md
  - ../evaluation/JUDGING.md
  - ../proposals/implicit-qrels-from-journal-2026-07.md
---

# ADR 0121 — Retrieval Evaluation from First Principles

## Context

Goga's directive, verbatim spine: *"we need adversarial thinking, step back and think
about what basic things we are missing… is this entire orchestra hand rolled and forced,
or truly … deterministically proven … its own ADR thread, to revisit, step back and
think from first principles instead of being tunnel focused on the already chosen
solution."*

The orchestra under review: a 24-query judged answer key (235 qrels), a frozen nDCG@10
baseline (hybrid .863 vs BM25 .843), a no-ranking-change-without-fixture-improvement
gate, and a chartered plan to grow the answer key by mining implicit relevance judgments
from usage journals. A three-lens adversarial panel (independent agents, no
cross-visibility) audited it; the full evidence is
`docs/reports/0004-evaluation-adversarial-panel-2026-07.md`. This ADR is the synthesis
and the proposed rulings.

## Findings (each substantiated in report 0004)

- **F1 — The evidentiary chain is a closed loop.** Queries drafted by fleet agents from
  one day of fleet work on this repo; graded by a fleet agent; "independently reviewed"
  by another fleet agent (2 of 235 grades changed; rationales are grade-templates);
  gated by a literal `includes('reviewed:')` substring check; the human final authority
  exercised zero times. No link was ever touched by an information need originating
  outside the system under test.
- **F2 — The instrument cannot see the product's real failures.** Every Phase Two field
  failure (nisli wakeup 0/10, aime 1.0/5, EXP-2 losing to raw files 8/10 vs 10/10 at
  1.76× tokens) was corpus membership, temporal grounding, or orientation — while
  ranking, the only instrumented lane, was the healthiest part measured. The gate taxes
  a near-ceiling surface and protects nothing that broke in the field.
- **F3 — The statistics do not carry the claimed authority.** The headline +0.02 delta
  has a bootstrap CI of [+0.006, +0.036] and clears the policy threshold by 0.0008 —
  less than half the movement caused by the two review edits alone. ADR 0116's own
  required bootstrap was never implemented. Per-class numbers at n=4 (including the
  "aboutness 0.528" currently arming the reranker lane) cannot survive an interval.
  The frozen baseline became incomparable under its own same-corpus-hash rule within
  24 hours.
- **F4 — The fixture is soft and pool-biased.** 58% of queries are (near-)verbatim
  titles/filenames/IDs of their targets; 12 of 24 sit at BM25 nDCG ≥ .98 (no headroom);
  unjudged@10 = 0 means the judged pool is exactly what the two systems retrieved,
  graded post-hoc by their builder — the fixture cannot charge either system with
  missing anything. 21% of queries target the evaluation program's own paperwork.
- **F5 — The mining path's premise is falsified and its semantics are wrong.** The
  journals record no reads (structural zero, measured); an agent hydration is
  examination, not endorsement (~21% wrong-positive rate estimated from real tallies);
  the genuine endorsement signal (`cite`) exists and is unused; the weak-negative
  stream would let the incumbent ranking grade its own challengers; time-to-value via
  mining is unbounded while the same evidence is hand-draftable in hours.
- **F6 — Real discipline survives and must be kept.** The metric implementation is
  exactly correct (independently recomputed); the reproducibility engineering
  (hashes, determinism, atomicity, raw ranked_ids in the report) is rare and enabled
  this very audit; scope honesty (v1 not-recall-evidence, synthetic-memories ban, the
  miner's fail-closed candidates cage) is real. The fixture found genuine bugs, notably
  space-form vs hyphenated ID canonicalization (nav-01).

## Decision (proposed rulings)

**R1 — The object of evaluation is the composed journey, measured in tokens.** The unit
of retrieval value is *token cost from question to correct action* across
wakeup → recall/search → get: is the document indexed at all; is it in the returned
window; does its stub let the agent choose it; how many tokens/calls to done. nDCG's
positional discount models a human reader and is demoted accordingly (R4). This is
Tenet 2 applied to evaluation.

**R2 — The structural truth suite is the deterministic instrument.** One generator
script walks the corpus at run time and emits judge-free, constructively-true
assertions: every document's title and ID as navigation queries (grade-3 by
construction); membership/coverage (every claimed document retrievable at all; wakeup's
disclosed-decision count reconciles against the corpus's actual count — the check that
would have caught the status-matching bug); filter compliance as executable law;
supersedes-ordering (the superseding document ranks at or above the superseded on their
shared-stem query); tail-reachability probes at declared token offsets. Regenerated
every run: drift is impossible; no judge exists to be circular. Honest limits are
declared limits: structural navigation partly measures the product's own exact-ID
special cases (acceptable for a tripwire, meaningless for improvement claims), and
aboutness remains irreducibly a judgment — the suite never pretends to cover it.
JUDGING.md gains a named *constructively-true* assessor tier; the runner's substring
check is replaced by tier validation. **This is the first build of the ADR and the
cheapest genuine evidence available (S).**

**R3 — End-to-end task-success gates are the acceptance metric for retrieval changes.**
The EXP-2 pattern — same repo, same questions, blind graded answers, tokens,
wall-clock, call counts — is how a retrieval-affecting change proves itself, at N≥3
per arm with rotated questions. The harness logs, for free, which stub the agent
hydrates first and whether it was the target (stub sufficiency — the actual decision
surface of progressive disclosure, currently unmeasured). No ranking change ships on
nDCG motion alone.

**R4 — The 24-query set and baseline v1 are kept, demoted to a global regression
tripwire.** Headline tripwire metrics become success@10, Recall@20, and unjudged@10
(the flat-attention reader model); nDCG stays computed as a secondary. The macro 0.02
rule survives with tripwire semantics only. **Per-class authority is retired** at n=4.
The set grows only when a candidate change actually enters (JUDGING.md pooling then
applies). The assessor fields are re-marked truthfully (`llm:` per JUDGING.md's own
rule) until a human review has actually occurred.

**R5 — The reranker trigger is declared NOT FIRED and the ranking lane is frozen.**
The only "aboutness weakness" evidence is the gate's own four-query class; no felt
aboutness failure has ever been logged from real work. ADR 0116 Phases 2A–3B remain
unentered. Re-armament requires replay-telemetry misses (R7) or a logged real-work
retrieval failure that a grep fallback also could not cover.

**R6 — The implicit-qrels lane: BUILD-LATER-ON-TRIGGER.** The miner is kept as a free,
deterministic, read-only probe; the near-term expectation retires. Conjunctive trigger:
(i) a real memory corpus lives in `~/.backlog/docs`; (ii) a monthly probe run reports
≥25 recall-hit events across ≥5 distinct days; (iii) the program needs more recall
queries than hand-drafting supplies. Before any real candidate is ever reviewed, the
priors are corrected to agent-click semantics: hydrated → 1 (examined); hydrated then
cited (same id, same session) → 2–3 (`cite` is the endorsement event and is minable
today); repeat-hydrated → 2 with a cite guard; returned-but-not-hydrated → **no graded
prior** — emitted as unjudged-pool with rank (recall ids are already stored in ranked
order).

**R7 — Telemetry ships in two tiers.** Tier 1 now, under the usage-instrument charter
(B18) and independently justified by it: a shared session id on recall/search/expand
events, and recall-miss events (`ids: []`). Tier 2 — search-demand logging (query +
returned ids) — ships only after the derived-state hygiene boundary is verified on main
(`state/` ignored in project homes; in the current wakeup repair batch), with query text
documented as sensitive, and with its purpose declared as *replay capture for R5's
re-armament*, not qrel manufacture. Capture value compounds with calendar time, which is
why Tier 2 is gated on hygiene rather than on the R6 mining triggers.

**R8 — Baseline v2 unblocks by hand, this week.** Four recall queries hand-drafted from
real recorded demand (the internal mine's sixteen navigation questions are the seedbed),
judged with bespoke rationales, and reviewed by **Goga as a human assessor of record** —
the first exercise of the final-authority role and roughly one to two hours of his time.
Beryl's baseline v2 bar is otherwise unchanged.

**R9 — Honesty repairs to the record.** The evaluation README's "independent human
review" claim is corrected to match reality until R8 executes. JUDGING.md is amended
with the constructively-true tier, the `llm:` marking enforced in the runner, and a
note that the assessor role is adjudication, not an engine. The nav-01 finding —
space-form docs-native IDs ("ADR 0116") invisible to hyphen-canonical ID intent — is
filed as a real plumbing bug with the fixture credited for finding it.

## Consequences

Dies now: per-class metric authority; scheduled growth of the judged set; the near-term
implicit-qrels expectation; nDCG as a headline; the fiction that review happened.
Built now (S each): the structural truth suite (first); Tier-1 telemetry; R8's four
human-reviewed recall queries; the README/JUDGING.md corrections. Built per cycle
(S/run): E2E acceptance runs for any retrieval-affecting change. Kept, cheap: the
frozen v1 report as durable history; the runner and its reproducibility engineering
(reused by the structural suite); the miner as a probe.

The evaluation program's center of gravity moves from ranking — measured at 0.86 while
the product lost to `cat` — to the composed journey where every field failure actually
lived. The ranking lane keeps a tripwire so regressions are noticed, and gains an
honest path back to investment (replay evidence or a logged real failure) instead of a
standing tax.

## Falsifiability

- If the structural suite runs all-green against the live index, retrievability is
  closed as a failure class and evaluation spend points wholly at composition — the
  suite itself demotes to CI hygiene.
- If between-run variance of E2E gates at N≥3 exceeds between-arm deltas, the grading
  rubric (not the product) is the noise source and R3 must be redesigned before it
  gates anything.
- If Tier-2 replay capture accumulates and shows the real query stream is dominated by
  navigational/ID-shaped queries, that decisively proves the invest-less position for
  ranking; if it shows target-not-in-window misses at a real rate, R5's freeze thaws
  with evidence in hand.
- If R8's human review materially diverges from the agent judgments it replaces
  (grade changes well beyond beryl's 0.85%), the closed-loop indictment (F1) gains
  empirical teeth and every agent-judged artifact in the repo inherits a review debt.
