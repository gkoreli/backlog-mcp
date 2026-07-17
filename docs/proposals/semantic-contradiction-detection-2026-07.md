# Semantic Contradiction Detection — Proposal (July 2026)

**Status**: Validated build — implemented under ADR 0120; Phase Two dogfood
evidence is recorded below. Governing law: R1 store-boundary, R2 fusion scopes,
R3 fixture gate, no LLM in the server write path, store-doesn't-act, markdown
is truth.

## What exists and what's missing

`backlog_contradictions` today is **structural**: two live memories sharing
a `state_key` (0092.13). It catches nothing unless the writer already knew
the fact was keyed. The real event — a new memory that semantically
contradicts an old one nobody keyed — is invisible until a human trips
over it. No competitor shows the human its agent's contradictions at all;
detecting the *unkeyed* ones doubles the differentiator.

## The honest boundary: candidates, not verdicts

"Contradicts" is a semantic judgment; the server is deterministic. So the
server never says *contradiction* — it says **collision candidate**: a
pair of live memories whose similarity, scope, and epistemic shape make
disagreement *worth adjudicating*. Judgment stays with the writing agent,
the consolidator, and the human — exactly where 0092.13 put resolution.

## Proposed rulings

### P-1 — The candidate fold is deterministic and computed on read

A pure function over signals already inside the store boundary:

1. **Similarity** — the new/focal memory's top-K semantic+lexical
   neighbors among *live* memories, via the existing hybrid index
   (embeddings already stored; no new index, no sidecar).
2. **Scope** — same home; same `context` or overlapping `entity_refs`/tags
   ranks higher (the 0092.7 bucketing signals, reused again).
3. **Epistemic shape** — pairs where both are `kind: current` (or, once
   the garden's epistemic typing lands, both belief-like) rank higher;
   `timeless`+`timeless` ranks lower; expired/superseded never appear.

Threshold + K are named constants. No polarity/NLI model, no LLM: the fold
proposes, never concludes. Output shape mirrors consolidation candidates —
recomputed on demand, never stored (store-doesn't-act).

### P-2 — Write-time is the primary detection point; consolidation is the sweep

- **Write-time (primary)**: `remember` responses gain
  `collision_candidates: [{id, title, digest, score, signals}]` — the
  Mem0 reconciliation moment with the LLM kept client-side: the writing
  agent, holding both texts, decides *supersede / state_key both / keep
  both / dismiss*. The index is warm and the candidate set is one memory
  against its neighbors — the cheap moment.
- **Consolidation-time (sweep)**: the same fold runs over ripe buckets so
  legacy pairs written before this feature (or past a distracted agent)
  reach the consolidator. One fold, two triggers — no second algorithm.

### P-3 — Adjudication artifacts live in markdown, like everything else

Resolution uses the existing verbs (supersede, `state_key`, forget).
Dismissal — "these genuinely coexist" — is a frontmatter mark on either
memory: `distinct_from: [MEMO-xxxx]`. The fold excludes marked pairs. No
dismissal table, no hidden state; a human can `cat` the file and see the
adjudication. Marks are written only by agents/humans via `remember`-side
updates — the detector itself has **no write path** (0092.13 R-9 stands).

### P-4 — Viewer surface: the memory you can SEE disagreeing with itself

- Memory detail pane: a **collision candidates** chip beside the existing
  `contradicts` chip — candidate pairs with scores and one-line digests.
- A review-queue view: all live candidate pairs in the scope, worst-first
  (highest score, both-current first) — computed per render. Adjudicating
  from the viewer just deep-links the normal verbs.
- Wakeup does NOT gain a section: candidates are curation pressure, not
  orientation. They reach wakeup only if a future falsifiability round
  proves the queue is ignored (see below) — and then as a count, not stubs.

### P-5 — The ranking wall (R3)

Candidates change **nothing** about recall or search ordering. No
corroboration boost, no contradiction penalty, no freshness nudge ships
from this thread. Any future ranking interaction (e.g. the garden's
corroboration boost) requires the judged fixture to first gain a
**contradiction-pair query class** with graded qrels — and clears the 0.02
policy like any ranking change. Detection and ranking stay separate
capabilities with separate gates.

## What this is deliberately not

- No NLI/polarity model in the server; no LLM anywhere in the write path.
- No stored candidate state, no dismissal database — frontmatter marks only.
- No auto-resolution: the detector proposes, humans and agents dispose.
- No new tool: candidates ride `remember` responses,
  `backlog_contradictions` (a `candidates: true` param), and the viewer.

## Fixture obligations (before any Phase 2 of this)

The evaluation fixture gains 4+ judged collision cases: a true semantic
contradiction (unkeyed), a paraphrase pair (same fact, no conflict — must
rank LOW or be dismissed cleanly), a timeless-vs-current pair, and a
cross-context near-miss (same words, different scopes — must NOT
candidate). Precision on these is the go/no-go for enabling write-time
surfacing by default.

## Falsifiability

- **Noise kills it**: if adjudication outcomes show dismissal rate above
  ~60% over a real month of use, the threshold rises or write-time
  surfacing demotes to consolidation-only. Measured from `distinct_from`
  marks vs supersede events — the adjudication artifacts are the metric.
- **Silence kills the surface**: if candidates surface at write time but
  are never adjudicated (no supersede/state_key/dismiss within N days),
  the write-time response is the wrong surface — move the pressure to the
  viewer queue and a wakeup *count*, per P-4's escalation.
- **Cost kills the fold**: if the candidate fold exceeds ~50ms p95 at
  recall-scale corpora, cap K harder or restrict to same-context pairs.

## Effort

S/M as scoped: the fold is a pure function beside `contradictions.ts`
reusing the live index; `remember` response enrichment through the
existing store boundary; one viewer chip + one computed view; frontmatter
mark + fold exclusion. The fixture cases ride the existing harness.

## Phase Two dogfood friction ledger

The build used released `backlog-mcp@0.62.0` as its memory surface. These are
observations from the real workflow, not synthetic acceptance cases.

| ID | Observed friction | Evidence and disposition |
|---|---|---|
| `F-01` | Project wakeup/recall could not start while this repository still carried the legacy `.backlog-mcp/` control directory. | The released tool failed closed and required the explicit docs-native project migration. This is expected migration pressure, but it prevented project-scoped dogfood until the repository itself adopted the shipped layout; global-home wakeup/recall remained usable. |
| `F-02` | `backlog remember --tags <tag...>` greedily consumed trailing positional content when the variadic flag preceded the memory body. | The first remember attempt failed; placing content before `--tags` succeeded. This is a data-loss-shaped CLI footgun, not user error. File as a bug; the smallest likely fix is command grammar that cannot make a variadic option absorb required content. |
| `F-03` | The authorized project migration dry-run rejected the repository's tracked `.backlog-mcp/.gitignore`. | Main's one-shot reports `unsupported-source`: it only accepts `cache/`, `state/`, `config.json`, and `config.local.json`, while the operating directive expected the recommended `.gitignore` to move too. Dry-run made no changes. Execution remains stopped pending an explicit fix or bounded manual-relocation ruling. |
