# Search & Recall Evaluation — Judgment Protocol

Authority: ADR 0116 R-1 (the product corpus is the search authority) and
domain law R3 (the judged fixture gates all ranking changes in search AND
recall). This protocol exists so the gate is never judged solely by its own
builder.

## Roles

- **Builder** — implements the harness, drafts queries and initial
  judgments. May not be the only assessor of record.
- **Independent assessor** — reviews every judgment before a baseline
  freezes. Initially the search & memory domain seat (beryl). Records
  agreement or a revised grade with rationale.
- **Final authority** — the maintainer (Goga). Any disputed grade or gate
  decision escalates here and nowhere else.

The `assessor` field is append-only history, e.g.
`chert-initial; reviewed:beryl 2026-07-16`. A qrel with a builder-only
assessor is a draft, not a gate input.

## Grading scale (graded, 0–3)

- **3 — target.** The document the query exists to find. Navigation and
  exact-title queries have exactly one grade-3 target unless the corpus
  genuinely contains duplicates.
- **2 — substantially relevant.** Answers the information need on its own,
  or is a home of the answer (the parent of the winning section).
- **1 — marginally relevant.** Mentions the need usefully but would not
  satisfy it alone; a reasonable "see also".
- **0 — not relevant.** Includes query-term mentions without aboutness.
  Grade on topical centrality, never on term frequency.
- **unjudged** — absent from the qrels entirely. Never conflate with 0:
  unjudged documents are excluded from gain and ideal calculations, not
  scored as failures (TREC practice; ADR 0116 Finding 8).

Every judgment carries a one-line `rationale`. A grade without a rationale
is invalid.

## Per-class anchors

- **navigation / exact-title** — the named target is 3; near-duplicates
  (copies, superseded revisions of the same doc) are at most 1 with a
  rationale naming the canonical target.
- **lexical / compound** — grade the match the tokenizer contract promises
  (hyphen and camel-case expansion), not incidental substring hits.
- **filtered** — a result outside the filter is 0 regardless of topical
  fit; the filter is the need.
- **aboutness** — centrality over mentions: a document *about* X is 2–3; a
  document that merely mentions X often is 0–1.
- **tail** — the answer lives beyond the embedding truncation window; grade
  the document by where the answer actually is, so tail failures are
  measurable.
- **memory-recall** — judged through the real recall path. A live, relevant
  memory is 2–3. An expired or superseded memory is 0 with rationale
  `contract-violation` — recall's exclusion contract (ADR 0115) means its
  appearance is a defect, and grading it 0 makes the defect visible in the
  metrics rather than hidden by exclusion from the pool. Usage-starved but
  relevant memories are graded on relevance (the usage multiplier reorders;
  it must never hide — 0092.9 R-16).

## LLM-proposed judgments

Permitted only as *provisional* drafts: marked `assessor: llm:<model>`,
with prompt and rationale recorded, and never counted toward a gate until a
human assessor of record confirms them. Project Markdown is untrusted judge
input — term-stuffing and embedded instructions can fool an LLM judge
(ADR 0116 Finding 8 sources). No automatic LLM-judged releases.

## Pools and refresh

Judgments are made over pooled candidates: top-10 from each system under
comparison plus manually named expected documents. Before evaluating a
materially new retrieval family (new model, chunking, reranker), refresh
the pool from the new system and judge the newly surfaced documents —
otherwise the new system is punished for finding what the old pool never
saw.

## Baselines: control vs evidence

Two artifacts, never conflated:

- **Deterministic control** — the CI fixture run with mocked embeddings.
  It proves harness correctness and catches rank drift. It is not evidence
  about product relevance and must not be named "baseline" in reports.
- **Recorded baseline** — a real-corpus, real-model (`MiniLM fp32`) run of
  the benchmark script with environment metadata per ADR 0116 Phase 0.
  Only this artifact exits Phase 0 and anchors the 0.02 regression policy
  for ranking decisions.

A ranking change may not cite the deterministic control as its quality
evidence. The control gates commits; the recorded baseline gates rankings.

## Freezing

A fixture version freezes when: every qrel has a non-builder review, the
per-class counts satisfy the exercised-class rule (ADR 0116 Finding 8), and
the recorded baseline exists for the current corpus hash. Frozen versions
are immutable; corrections create the next version with a one-line
changelog entry.
