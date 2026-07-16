---
title: "0116. Search & RAG Uplift — Measure the Corpus, Then Improve the Pressure Point"
date: 2026-07-16
status: Proposed
informs:
  - 0038-comprehensive-search-capability
  - 0040-search-storage-decoupling
  - 0041-hyphen-aware-tokenizer
  - 0042-hybrid-search-local-embeddings
  - 0044-search-api-relevance-scores
  - 0047-unified-search-api
  - 0049-keep-orama-over-algolia
  - 0050-search-ranking-title-bonus
  - 0051-multi-signal-search-ranking
  - 0081-independent-retrievers-linear-fusion
  - 0083-search-service-review-and-next-generation
  - 0092.9-phase-e-usage-feedback-research-and-plan
  - 0101-search-index-reconciliation
  - 0112-docs-native-project-scoped-backlog
  - 0115-memory-experience-uplift
---

# 0116. Search & RAG Uplift — Measure the Corpus, Then Improve the Pressure Point

**Status:** Proposed — research record, design rulings, and phased engineering
plan. Implementation follows review.

## Context

backlog-mcp already has a serious local retrieval system:

- Orama BM25 with fuzzy matching, native filters, facets, and custom
  hyphen/camel-case tokenization;
- local Transformers.js embeddings;
- independent lexical and vector retrieval;
- rank normalization, weighted fusion, temporal decay, coordination, and exact
  title pinning;
- unified task/epic/resource results with snippets;
- startup reconciliation for entities;
- deterministic ID and filter intent routing.

The problem is not that the system lacks fashionable retrieval components. The
problem is that it has accumulated plausible ranking decisions without a
product-corpus quality gate, while its first semantic search can block on model
download plus full-corpus embedding. Long documents are embedded as one input
through a model that truncates beyond 256 wordpieces. Search-cache writes are
non-atomic, embedding failure becomes process-lifetime degradation, and
resource reconciliation is incomplete.

This ADR follows the Development Loop:

1. research the 2026 field using primary sources;
2. ground the findings in the current code and ADR thread;
3. rule on the smallest changes that unblock the search/RAG north-star thread;
4. make every larger technique earn its way in through measurement.

## Constraints

These are non-negotiable:

1. **Local-first only.** No cloud embedding, hosted search, or hosted reranking
   service in the core path.
2. **No LLM in the server write/index path.** Markdown remains authoritative;
   derived indexes are rebuildable.
3. **Human-visible derived state.** Evaluation judgments, source provenance,
   search mode/readiness, and any future chunk boundaries remain inspectable.
4. **Project-scoped homes.** ADR 0112 owns home selection and provenance.
   Cross-home search never compares raw scores from separate indexes.
5. **No over-engineering.** Build the smallest answer at an observed pressure
   point. Research candidates are not roadmap commitments.
6. **Vision triage.** Audit findings enter this plan only when they block the
   search/RAG thread or represent correctness failures a daily user can hit.
7. **Memory ranking contracts remain law.** ADR 0092.9's bounded usage
   multiplier (reorders, never hides) and ADR 0115's golden recall contracts
   must remain green unless a later ADR explicitly renegotiates them.

---

# Part 1 — Primary-source research

## Method

Three independent research streams covered:

1. hybrid fusion, rerankers, and late interaction;
2. local embedding models and Markdown chunking;
3. retrieval evaluation and agentic-RAG boundaries.

Accepted evidence is limited to original papers, official benchmark/task
definitions, author repositories/model cards, and official library
documentation. Vendor explainers, framework blogs, leaderboard screenshots,
and unsourced performance claims are not decision evidence.

Generic benchmarks identify credible candidates; they do not select the product
architecture. MTEB spans many task families and found no embedding method that
dominates all of them. BEIR found BM25 to be a robust baseline and found
reranking/late-interaction strong on average but computationally expensive.
Therefore this corpus, its queries, and its hardware are the release authority.
([MTEB](https://arxiv.org/abs/2210.07316),
[BEIR](https://arxiv.org/abs/2104.08663))

## Finding 1 — Hybrid retrieval is sound; the fusion function is corpus-dependent

Sparse and dense retrievers capture complementary signals. The original RRF
paper showed that reciprocal-rank fusion outperformed the tested individual,
Condorcet, and CombMNZ runs by roughly 4–5% on its TREC/LETOR experiments.
([Cormack, Clarke, and Büttcher, SIGIR 2009, Tables 2–3](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf))

RRF is attractive when score scales are incomparable because it consumes only
ranks. It is not universally superior. A direct hybrid-fusion study found RRF
parameter-sensitive and found a normalized convex combination better than RRF
across its tested in-domain and zero-shot datasets; it also found the single
convex weight sample-efficient to tune.
([Bruch, Gai, and Ingber, §§5–7, Table 2, Figure 12](https://arxiv.org/abs/2210.11934))

**Implication:** there is no literature-only reason to replace the current
within-home fusion. Compare candidates on fixed retrieved pools and human
judgments. For ADR 0112 `home: all`, rank-based merging avoids comparing
uncalibrated raw scores from separate indexes; R-3 selects an RRF-style merge
as the initial policy.

## Finding 2 — The current “linear fusion” no longer preserves score magnitude

ADR 0081 selected score normalization plus a 0.7/0.3 convex combination and
rejected RRF because magnitude mattered. ADR 0083 then proved MinMax mapped a
relevant lowest scorer to zero. Current code responded with `rankNormalize()`
and then `linearFusion()`
(`packages/memory/src/search/scoring.ts:46-108`;
`packages/memory/src/search/orama-search-service.ts:325-364`).

The implementation is now a weighted fusion of **positions**, not calibrated
BM25 and cosine magnitudes. That may be the right product ranking, but ADR
0081's original evidence no longer describes it precisely.

**Implication:** benchmark three small, pure alternatives:

1. current rank-normalized 0.7/0.3 fusion;
2. RRF with the canonical `k=60` baseline;
3. a normalized raw-score convex combination that does not recreate the
   MinMax-zero failure.

No runtime fusion framework or user knob is justified.

## Finding 3 — Cross-encoders are credible rerankers, not an automatic next layer

A cross-encoder jointly reads the query and candidate text, so it can model
“aboutness” that BM25 term frequency and independent embeddings may miss. The
official `ms-marco-MiniLM-L6-v2` model card reports 22.7M parameters, TREC DL
2019 nDCG@10 of 74.30, and MS MARCO dev MRR@10 of 39.01. Its L12 sibling reports
essentially the same quality at lower throughput; the published throughput is
on a V100 GPU, not local CPU evidence.
([official model card, performance table](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2#performance))

A Transformers.js-compatible ONNX conversion maintained under the Xenova
Hugging Face account exists, including quantized weights.
([Xenova conversion](https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2))

BEIR's broader result is the useful guardrail: reranking is often strong but
costlier, and public-domain gains do not prove gains for short project
documents.
([BEIR abstract and §4](https://arxiv.org/abs/2104.08663))

**Implication:** a small cross-encoder is the first reranker to *experiment
with* if the local judgment set confirms persistent aboutness failures. It is
not part of the initial production phase. CPU latency, RSS, download bytes, and
top-k quality must be measured locally.

## Finding 4 — Late interaction is powerful and currently disproportionate

ColBERT preserves token-level representations and delays query/document
interaction, outperforming non-BERT baselines while precomputing document
representations.
([ColBERT](https://arxiv.org/abs/2004.12832))

ColBERTv2 reduced late-interaction storage by 6–10×, but it still creates a
multi-vector/token index.
([ColBERTv2](https://arxiv.org/abs/2112.01488))
PLAID then reduced query cost substantially through centroid pruning, reporting
tens to hundreds of milliseconds at collections up to 140M passages.
([PLAID](https://arxiv.org/abs/2205.09707))

Those are meaningful large-corpus engineering results. They also imply another
model, token-vector representation, compression/index format, and retrieval
engine for a corpus where Orama already produces a small candidate set.

**Implication:** late interaction is rejected for the current roadmap. Revisit
only after a measured corpus-size or quality ceiling remains after the simpler
candidate-retrieval and optional reranking experiments.

## Finding 5 — The current embedding path truncates the documents it claims to embed

The current service hard-codes `Xenova/all-MiniLM-L6-v2`, mean pooling,
normalization, fp32, and a 384-dimensional schema
(`packages/memory/src/search/embedding-service.ts:1-46`;
`packages/memory/src/search/orama-schema.ts:20-49`).

The upstream model card describes all-MiniLM-L6-v2 as a sentence/short-paragraph
encoder and states that inputs longer than 256 wordpieces are truncated.
([official model card, Intended uses](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2))
The Transformers.js conversion's fp32 ONNX is 90.4 MB; the roughly 23 MB artifact
is int8/quantized, so ADR 0042's size statement does not describe the current
`dtype: 'fp32'` runtime.
([official ONNX files](https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/main/onnx))

Current code sends `title + full content` as one embedding input for every
entity and resource
(`packages/memory/src/search/orama-search-service.ts:91-150`).
Therefore content beyond the model limit is absent from the vector, even though
it remains present in BM25.

**Implication:** truncation is proven; product harm is not. Add tail-content
queries to the evaluation fixture before introducing chunk records or a larger
model.

## Finding 6 — There is no universal “best local embedding model”

The practical first comparison is among small models that preserve the existing
384-dimensional schema:

| Candidate | Primary-source facts | Why it belongs in the experiment |
|---|---|---|
| all-MiniLM-L6-v2 | 384d, short-paragraph model, 256-wordpiece truncation; Apache-2.0. ([model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)) | Current control. |
| Snowflake Arctic Embed S | 33M parameters, 384d, author-reported MTEB retrieval 51.98; Transformers.js-tagged; requires CLS pooling and a query prefix; Apache-2.0. ([model card](https://huggingface.co/Snowflake/snowflake-arctic-embed-s)) | Same schema, retrieval-trained challenger. |
| BGE small en v1.5 | 384d, 512-token maximum sequence length, MIT; official model materials recommend a retrieval query instruction. ([model card](https://huggingface.co/BAAI/bge-small-en-v1.5)) | Same schema, independent challenger. |
| Nomic Embed Text v1.5 | long-context/MRL model; 768d default with task prefixes; Apache-2.0. ([paper](https://arxiv.org/abs/2402.01613), [model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)) | Admit only if 512-token candidates still fail tail-content queries. |

Generic MTEB differences are candidate-screening evidence, not product
acceptance. Pooling, query/document prefixes, normalization, dimensions, dtype,
and model revision are correctness metadata—not optional tuning knobs.

## Finding 7 — Chunking is a retrieval representation, not a content rewrite

Naive chunks reduce semantic over-compression but lose surrounding context.
Late chunking embeds the full token sequence before pooling chunks and reports
gains across several retrieval tasks, while also documenting cases where normal
chunking is comparable or better.
([Late Chunking, §§3–4](https://arxiv.org/abs/2409.04701))

LongEmbed exists because an advertised long context window does not by itself
prove long-context retrieval quality.
([LongEmbed](https://arxiv.org/abs/2404.12096))

**Proposed smallest deterministic policy—not a literature-established
optimum:** if tail-content recall fails, use the smallest transparent
representation first:

- do not chunk documents that fit the selected tokenizer window;
- split oversized Markdown by headings, then paragraph/token boundaries only
  when a section remains oversized;
- prepend the heading path;
- store source offsets and parent identity;
- retrieve chunks but return/collapse to the authoritative parent;
- use the winning chunk for the snippet.

No semantic splitter, generated summary, recursive tree, or overlap parameter is
justified initially. Late chunking remains a later experiment only if ordinary
deterministic chunks fail the gate.

## Finding 8 — Evaluation needs human qrels and intent-specific metrics

TREC constructs reusable test collections from pooled system outputs and
relevance judgments. Classic collections used binary judgments; recent tracks
generally use graded scales for rank-sensitive measures. Unjudged documents
must not be casually treated as known negatives.
([NIST TREC relevance judgments](https://trec.nist.gov/data/reljudge_eng.html),
[TREC 2021 overview, §3](https://trec.nist.gov/pubs/trec30/papers/Overview-2021.pdf))

Deep pools have remained reliable even for later neural retrievers when the
original collection was diverse and well judged.
([Voorhees, Soboroff, and Lin 2022](https://arxiv.org/abs/2201.11086))

LLM judges can help expand evaluation. UMBRELA reproduced relevance assessment
over TREC DL 2019–2023 and found high correlation between LLM-derived judgments
and rankings from effective multi-stage systems.
([UMBRELA](https://arxiv.org/abs/2406.06519))
ARES uses synthetic data plus a small human set and reports that about 150
human annotations were the minimum in its study; it also found GPT-4 unable to
replace human annotations entirely.
([ARES, §5 and Appendix A.6](https://arxiv.org/abs/2311.09476))
Relevance judges can be fooled by query-term stuffing and by instructions
embedded in otherwise irrelevant documents—directly relevant because project
Markdown is untrusted judge input.
([Alaofi et al., SIGIR-AP 2024](https://www.microsoft.com/en-us/research/publication/llms-can-be-fooled-into-labelling-a-document-as-relevant-best-cafe-near-me-this-paper-is-perfectly-relevant/))
LLM judges are also sensitive to broader bias and perturbation.
([Chen et al., EMNLP 2024](https://aclanthology.org/2024.emnlp-main.474/))

**Implication:** begin with a small, maintained, human-visible fixture rather
than synthetic scale:

- start Phase 0 with 20 real daily queries and grow the judged pool before each
  candidate phase;
- tag queries orthogonally as navigation, lexical, semantic, aboutness, tail,
  filtered, multi-document, cross-home, and memory-recall, with at least four
  judged queries for each primary class exercised by a candidate;
- pool top-10 results from the current systems/candidate plus manually named
  expected docs; refresh the pool before evaluating a materially new retrieval
  family;
- 0–3 relevance judgments with rationale and assessor;
- preserve `unjudged` separately from grade `0`; LLM-proposed grades remain
  provisional with model/prompt/rationale recorded;
- nDCG@10 overall, MRR@10/success@1 for navigation, Recall@20 for
  multi-document retrieval;
- MAP@20 is secondary only for grade≥2 binary views whose pools are judged
  adequately complete;
- report by query class, unjudged rate, latency, RSS, rebuild time, and index
  bytes.

Exact-ID success@1 remains 100%; no critical query may lose every grade≥2 result
from its top 10; macro or query-class nDCG/MRR may not regress by more than 0.02
absolute without explicit acceptance. Runtime comparisons record per-query
deltas and a 95% paired bootstrap interval; sign/Wilcoxon tests become
supporting evidence, not a standalone release gate. Initial
p95/RSS/bytes-per-document regressions above 20% require an
explicit quality trade-off. These are engineering policies, not literature
constants, and are frozen with the first checked-in baseline.

Memory-recall queries run through `BacklogMemoryStore.recall`, including its
3× candidate over-fetch, post-filters, and bounded usage factor—not directly
through `searchUnified`. The ADR 0115 golden suite protects behavioral
contracts; these judged queries detect relevance degradation that still
satisfies those contracts.

## Finding 9 — Agentic RAG belongs in the calling agent

IRCoT interleaves reasoning and retrieval and reported retrieval gains up to 21
points plus QA gains up to 15 points on four multi-hop datasets.
([IRCoT, ACL 2023](https://aclanthology.org/2023.acl-long.557/))
FLARE actively retrieves during generation when upcoming content is uncertain.
([FLARE](https://arxiv.org/abs/2305.06983))
Self-RAG trains a model to retrieve on demand and critique retrieved evidence
and its own generation.
([Self-RAG, ICLR 2024](https://proceedings.iclr.cc/paper_files/paper/2024/file/25f7be9694d7b32d5cc670927b8091e1-Paper-Conference.pdf))
Adaptive-RAG selects no retrieval, one retrieval, or iterative retrieval based
on predicted question complexity.
([Adaptive-RAG, NAACL 2024](https://aclanthology.org/2024.naacl-long.389/))
CRAG evaluates retrieved evidence and triggers corrective actions, but its
automatic web-search fallback conflicts with the local-core posture.
([CRAG](https://arxiv.org/abs/2401.15884))

These systems demonstrate that iterative retrieval can help multi-step
questions. They do not justify putting an LLM orchestration loop inside the
backlog server. The calling agent already owns reasoning, can see citations,
and can decide whether evidence is sufficient.

Multi-query generation/fusion remains optional: its evidence is weaker for this
small corpus, and it adds retrieval latency and duplicate/noise handling before
a measured failure asks for it.

**Implication:** the server owns one deterministic retrieval operation,
provenance, filters, limits, and status. An external agent may decompose or
iterate only when a question requires it:

1. search once;
2. if evidence is insufficient, issue at most three focused subqueries;
3. fuse repeated hits while preserving provenance;
4. stop when evidence is sufficient, a round adds no IDs, queries repeat, or a
   hard query/round cap is reached;
5. cite what was used.

No automatic web fallback, autonomous write, or hidden server conversation is
introduced.

---

# Part 2 — Grounding, rulings, and engineering plan

## Historical ruling disposition

| ADR | Disposition in 0116 |
|---|---|
| **0038 — Comprehensive search** | **Stands and extends.** Full-text, fuzzy matching, filters, local semantic retrieval, and an abstraction boundary remain right. “RAG-ready” now means deterministic retrieval + context/provenance for agents; Orama `AnswerSession` is not an architectural dependency. Old bundle, latency, and corpus-ceiling estimates are retired as unsupported; replacement budgets remain unset until Phase 0 records the baseline. |
| **0040 — Search/storage decoupling** | **Stands.** Storage remains authoritative; search is derived and configured from outside storage. ADR 0112 extends the composition from one singleton graph to one runtime per home. |
| **0041 — Hyphen-aware tokenizer** | **Principle stands; implementation extended.** Current `compoundWordTokenizer` also expands camel/Pascal case. Do not replace this proven navigational behavior with model-only retrieval. |
| **0042 — Hybrid search + local embeddings** | **Founding ruling stands; startup/model details extend or supersede.** Local embeddings, BM25 fallback, and no external API remain. Orama's black-box `mode: hybrid`, the 0.8/0.2 weights recorded in ADR 0038, the “~23 MB” fp32 implication in ADR 0042, and “lazy first search is the right pattern” are superseded. Independent retrievers remain; usable-before-semantic-ready initialization is conditional on Phase 0 proving the availability pressure. |
| **0044 — Scores attached to task objects** | **Superseded for canonical search** by the typed unified contract in ADR 0047/0073. The old `list(query)` compatibility path still attaches a score to entities; it is not the model for new work. Scores are ordering/diagnostic values, not calibrated percentages. |
| **0047 — Unified search API** | **Stands and extends.** New retrieval stages remain behind the existing core result contract. No reranker-specific tool or endpoint. |
| **0049 — Keep Orama over Algolia** | **Conclusion stands; weak premises superseded.** Local-first/offline/privacy still rule out hosted Algolia, whose official API requires hosted indexes/authenticated requests and whose indexing guide uploads records to Algolia. ([Search API](https://www.algolia.com/doc/rest-api/search), [indexing guide](https://www.algolia.com/doc/indexing/import-synchronize-data)) Orama remains an in-process Apache-2.0 engine with the primitives this product uses. ([official repository](https://github.com/oramasearch/orama)) Reconsider only after a measured correctness, scale, or operability failure—not a feature checklist. |
| **0050 — Fixed title bonus** | **Superseded** by later ranking ADRs. Preserve its user intent through ID routing and conservative exact-title pinning, not fixed global bonuses. |
| **0051 — Multi-signal additive ranking** | **Superseded** by ADR 0072 and then conclusively by ADR 0081. Arbitrary epic/title/recency bonus tables do not return. Existing substrate-aware temporal behavior remains governed by the memory ADR thread. |
| **0081 — Independent retrievers** | **Architecture stands; scoring description is amended.** Independent BM25/vector retrieval is retained. ADR 0083 replaced MinMax with `rankNormalize`, so current 0.7/0.3 “linear fusion” combines positional scores rather than preserving raw score magnitude. It is the control, not a permanent constant. |
| **0083 — Search review** | **Partly implemented; cross-encoder proposal remains conditional.** Its concrete correctness fixes mostly shipped. Its reranker idea must clear the product fixture and local runtime budgets. |
| **0101 — Reconciliation** | **Stands and extends.** Pending ops, shutdown flush, reconciliation, and the formerly proposed query-intent phase are shipped. ADR 0116 extends reconciliation to resources and supersedes `updated_at`-only change detection with authoritative content fingerprints. |
| **0112 R-9 — Multi-home search** | **Stands.** Query each home independently, merge ranks rather than raw scores, and retain home/source/substrate provenance. |

## As-built audit

### What is good and retained

- `packages/memory/src/search/` is a focused package with separate schema,
  tokenizer, scoring, snippets, and intent modules.
- BM25 and vector retrieval run independently and can degrade to lexical search.
- Exact ID routing bypasses fuzzy full-text failure modes.
- Native Orama filters avoid post-search window loss.
- Exact-title pinning protects navigational queries.
- Search is exposed through one reusable core function
  (`packages/server/src/core/search.ts`).
- Entity reconciliation treats Markdown as authority.

### Pressure points that enter the 0116 plan

| Gap | Evidence | Why it qualifies |
|---|---|---|
| No corpus-level quality gate | Diagnostics explicitly avoid assertions; golden tests use a small synthetic corpus (`search-ranking-diagnostic.test.ts:127-145`; `search-scaling-diagnostic.test.ts:57-89`; `search-golden.test.ts:31-107`). | Blocks every evidence-based search ruling. |
| First search can own model download and serial corpus embedding | Embeddings initialize lazily; entities/resources embed sequentially; `searchUnified` awaits readiness (`embedding-service.ts:14-28`; `orama-search-service.ts:221-247,780-818`; `backlog-service.ts:40-59,102-113`). | Potential daily availability pressure and a blocker to honest performance measurement; Phase 0 decides whether it enters engineering. |
| Search initialization and mutations race | `searchReady` has no shared promise; writes call async index mutations without awaiting them (`backlog-service.ts:40-59,151-176`). | Daily correctness: acknowledged writes may not be searchable yet. |
| Resource index is not reconciled | Resources are blindly indexed after entity reconciliation; deletions are not removed (`backlog-service.ts:42-58`; `orama-search-service.ts:780-818`). | Direct search correctness for project documents. |
| Resource indexing embeds raw frontmatter and ignores its title | `ResourceManager.list()` reads the complete Markdown string and derives title only from the first H1/filename, while `read()` already uses `gray-matter` (`resources/manager.ts:18-20,36-64,109-133`). | Small relevance defect in the docs-native corpus; the parser already exists. |
| Embedding failure is permanent and opaque | The first failed attempt is memoized as `false` for the search-service lifetime; the inner embedder retains its failed initialization, the reason is discarded, and no retry path exists (`embedding-service.ts:18-28`; `orama-search-service.ts:67-86`). | Operability risk that Phase 0's offline/failure run must reproduce before availability work ships. |
| Snapshot is synchronous and non-atomic | Full index/caches are JSON-stringified and written directly with `writeFileSync` (`orama-search-service.ts:155-176`). | Real finding, but recoverable derived-state loss; shelved until an incident or measured rebuild/event-loop budget admits it. |
| Long documents are one truncated vector | Whole title/content is sent through a 256-wordpiece model (`orama-search-service.ts:91-150`; upstream MiniLM model card). | Blocks semantic retrieval of long ADR/resource tails, if the fixture reproduces it. |
| ADR 0112 needs cross-home composition | R-9 requires per-home indexes plus rank fusion and provenance (`docs/adr/0112-docs-native-project-scoped-backlog.md:408-431,586-597`). | Direct dependency of the docs-native north-star thread. |

### Findings deliberately shelved

These are documented but do not enter the initial implementation:

- late-interaction/token-vector indexes;
- LLM query rewriting or server-owned iterative RAG;
- semantic/LLM chunking;
- learning-to-rank infrastructure;
- configurable fusion/model/reranker knobs;
- binary/vector cache compaction;
- general search-backend replacement;
- distribution-size optimization unrelated to a selected model experiment.

## Design rulings

### R-1 — The product corpus is the search authority

Create and check in the small human-judged fixture described above before
changing production ranking. Every model, fusion, chunking, or reranking claim
must report per-query-class quality and local runtime/footprint deltas.

Public benchmarks screen candidates. They do not choose the winner.

The existing search golden suite, ADR 0115 golden recall suite, and ADR 0092.9
usage/lineage/grace-period contracts are regression gates alongside the new
fixture. Navigational queries exercise the shipped ID routing and exact-title
pin so experiments do not re-solve behavior that already works.

### R-2 — Orama remains the embedded candidate engine

Orama continues to own the in-memory lexical/vector index and query primitives.
backlog-mcp owns the snapshot envelope/path, cache validation, reconciliation,
and the filters exposed through its search contract. No cloud engine is
evaluated for the core path. Replacing Orama requires a reproduced
product-corpus correctness, scale, or operability ceiling that cannot be fixed
at lower cost.

### R-3 — Independent retrievers stay; fusion earns changes offline

BM25 and vector retrieval remain independent. The current fusion remains the
production control until the fixture proves another pure function materially
better without navigational regressions.

For `home: all`, ADR 0112 owns the runtime and provenance contract. Each home
finishes its own retrieval/fusion first; the cross-home merger uses RRF over
within-home ranks, never raw scores. If a response limit cuts an equal-rank
tier, return the complete tier, bounded by at most one extra result per selected
home, avoiding a hidden home winner at the cutoff. Total order is fixed as:
RRF score descending, then `home_id` lexicographically, then stable local ID.

Classic RRF gains partly come from the same document appearing in multiple
ranker lists. Separate homes are often disjoint, so cross-home RRF is best
understood as a fair balanced interleave, not corroboration. Duplicate-looking
IDs remain distinct; any future content collapse retains all provenance.

### R-4 — If availability fails its gate, BM25 becomes usable before semantics

Phase 0 decides whether cold first-result and semantic-ready time are a daily
pressure point. If they fail the accepted budget, search initialization becomes
single-flight and stateful:

```text
idle → lexical_ready → semantic_building → hybrid_ready
                           ↘ degraded(reason, retryable)
```

A valid cached hybrid index may load directly. Otherwise the server builds or
loads the lexical index first and serves it, then prepares semantic vectors in
bounded background work. The side index is built from an authoritative
entity/resource snapshot; immediately before swap, it reconciles against a
fresh authoritative snapshot under the short mutation mutex, then replaces the
active index only if that reconciliation succeeds.

Status exposes mode, progress, model fingerprint, and degraded reason. A
transient failure may retry; it never leaves a rejected promise as permanent
hidden state.

Readiness belongs to the resolved home runtime, never process-global state. One
project's rebuild, download, or failure cannot block or overwrite another's.

### R-5 — Index mutations are ordered; reconciliation is the correctness boundary

Entity and resource index mutations append to one ordered promise chain once
search is active. The storage write remains authoritative, but the returned
write promise does not pretend its index mutation was accepted when it was
merely fire-and-forget. No general event/queue framework is introduced.

Startup reconciliation covers entities **and resources**, including removals
and content changes. Fingerprints compare authoritative content; `updated_at`
alone is insufficient for native Markdown edits and generic resources.

### R-6 — Snapshot hardening is admitted by incident or budget

The non-atomic snapshot finding remains documented but does not enter initial
engineering. If a truncated-cache incident or measured rebuild/event-loop
budget admits it, make the smallest change next to `persistToDisk`: temp-write
then rename, retaining the cache version and any accepted model fingerprint.
Retain JSON. Async workers, binary vectors, a cache module, and compaction
remain shelved.

### R-7 — Embedding behavior is fixed correctness metadata

The checked-in embedding behavior records:

```text
model_id · revision · dimensions · dtype · max_tokens
document_prefix · query_prefix · pooling · post_pool_transform · normalize
```

The current MiniLM fp32 behavior is the control. If semantic failures are
reproduced, compare it with exactly one same-dimension challenger: Arctic Embed
S. BGE small remains the next candidate only if that experiment is
inconclusive. A long-context model enters only after tail-content failures
survive a 512-token model.

The runtime is currently Transformers.js 3.8.1. Quantized experiments use only
a dtype verified in that model repository and runtime; dtype availability is
model-specific.
([Transformers.js dtype guide](https://huggingface.co/docs/transformers.js/guides/dtypes))

Only the accepted adapter ships. No public model selector or generic adapter
registry is added. Keep fixed metadata inline until a second accepted production
adapter creates a real shared abstraction.

### R-8 — Chunk only when tail-content recall proves the need

Whole-parent indexing remains the default for documents within the accepted
model's window. If tail-content Recall@20 fails the frozen gate, add
deterministic heading/paragraph chunks as rebuildable derived state. This is
the smallest product-specific policy, not a literature-established optimum.

Chunk identity includes parent ID, ordinal, heading path, and source offsets.
BM25 continues to search the parent. Vector chunk hits collapse to the parent,
and the winning chunk supplies the snippet. Markdown is never rewritten.

Late chunking, overlaps, summaries, and semantic splitters are deferred until a
specific boundary failure justifies them.

### R-9 — Reranking is conditional and bounded

If the fixture proves daily aboutness failures after candidate retrieval is
sound, benchmark the quantized MiniLM L6 cross-encoder over top 10 and top 20.
The candidate text is `title + bounded best retrieved snippet/passage`, never
the unbounded whole parent. Preserve ID short-circuits and apply exact-title
pinning after reranking. If accepted, reranking is lazy, local, read-only, and
falls back to the fused order.

Do not ship a reranker whose gain is merely a public benchmark claim, whose
local p95/RSS cost is unmeasured, or whose gains average away a critical query
class regression.

### R-10 — Agentic RAG is an external read loop

The server supplies deterministic retrieval, provenance, bounded results, and
status. Query decomposition, sufficiency judgment, iterative search, answer
synthesis, and citations remain with the calling agent.

The server performs no implicit web search and no autonomous write. An agentic
read loop may call `backlog_search` repeatedly under an explicit home and hard
round/query limits.

### R-11 — Derived retrieval state stays inspectable

The evaluation fixture and judgments are plain files. Search status reports the
active model/mode. Cross-home results expose provenance and ranks. Conditional
chunks record heading paths and offsets. Any candidate trace used during
evaluation can be rendered as BM25 rank, vector rank, fusion score, optional
reranker score, and final rank.

This observability is for evaluation/debugging; normal search responses remain
compact.

### R-12 — The stop rule is architectural

After each phase, stop unless the measured gate exposes the next pressure
point. Passing evaluation with the current model/fusion means retaining them.
Shipping heading chunks means reranking still remains unapproved. Shipping a
reranker does not authorize late interaction.

## File-level phased engineering plan

### Phase 0 — Establish the gate; no production ranking change

Add:

- `packages/memory/src/search/evaluation.ts` — the small pure metric and
  regression-policy functions, kept internal rather than exported as product
  API;
- `packages/memory/src/__tests__/evaluation.test.ts` — unit examples for
  `unjudged` versus grade `0`, MRR/nDCG/Recall/MAP, and policy decisions;
- `docs/evaluation/search-queries.jsonl` and
  `docs/evaluation/search-qrels.jsonl` — the initial 20-query human-visible
  fixture;
- `scripts/search-eval.mjs` — explicit local benchmark runner against built
  memory-package output, including fixture parsing and report generation.

Record:

- current BM25 and hybrid quality by query class;
- cold and warm first-result time;
- semantic-ready time;
- p50/p95 query latency;
- model/download bytes, peak RSS, rebuild/reconcile time, and cache bytes;
- truncation/tail-query failures;
- OS/architecture, CPU/RAM, Node/Transformers/ONNX versions, model revision and
  dtype, cached/uncached state, corpus/fixture hash, warmups, repetitions, and
  raw per-query timings.

**Exit gate:** checked-in baseline and reviewed judgments. No algorithm ships
from an unreviewed synthetic fixture.

### Phase 1A — Fix the proven correctness races

Update:

- `packages/server/src/storage/local/backlog-service.ts` — single-flight
  initialization promise, awaited ordered mutation chain, and
  `reconcileResources()` call;
- `packages/memory/src/search/orama-search-service.ts` — add
  `reconcileResources(currentResources)` with add/update/remove and content
  fingerprints, and replace entity `updated_at`-only detection with the same
  authoritative fingerprint rule;
- `packages/server/src/resources/manager.ts` — strip YAML from searchable body,
  honor frontmatter `title`, and provide canonical fields for fingerprinting;
- adjacent unit tests for concurrent first initialization, concurrent
  add/update/delete ordering, resource deletion/content change, and
  entity/resource fingerprint reconciliation.

**Exit gate:** initialization occurs once; a resolved write has an accepted
ordered index mutation; deleted or externally edited resources reconcile
correctly.

### Phase 1B — Conditional search availability and visible degradation

Enter only if Phase 0's cold first-result, semantic-ready, or offline/failure
run fails the frozen budget.

Update:

- `packages/server/src/storage/local/backlog-service.ts` — per-home lexical /
  semantic readiness orchestration;
- `packages/memory/src/search/orama-search-service.ts` — side hybrid build,
  fresh authoritative reconciliation under the mutation mutex, and swap;
- `packages/memory/src/search/embedding-service.ts` — retryable state and
  structured failure reason;
- `packages/memory/src/search/types.ts` and
  `packages/server/src/storage/backlog-service.contract.ts` — compact per-home
  readiness/progress/fingerprint contract;
- `packages/server/src/server/hono-app.ts` — thin status exposure;
- `packages/viewer/components/system-info-modal.ts` — smallest human-visible
  lexical/building/hybrid/degraded display;
- unit tests for mutation during side build, add/update/delete immediately
  before swap, one degraded home beside one ready home, retry, and BM25 results
  before semantic readiness.

**Exit gate:** measured first-result budget passes; no mutation is lost during
side build/swap; degradation is visible and retryable per home.

### Phase 2A — Compare fusion candidates offline

Add exactly three pure candidates in
`packages/memory/src/search/scoring.ts`:

1. current rank normalization + 0.7/0.3 sum;
2. RRF with `k=60`;
3. per-retriever L2-normalized raw scores + fixed 0.7/0.3 sum.

Bruch, Gai, and Ingber evaluate a MinMax-normalized convex combination. This
experiment uses L2 normalization deliberately to preserve magnitude without
recreating the repo's proven MinMax-zero floor. The deviation is recorded in
the report rather than presented as the paper's method.

No strategy interface or runtime selector. Delete losing functions after the
decision.

**Exit gate:** the frozen quality policy selects a winner without exact-ID/title
or memory-recall regression. Phase 2A exercises most classes, so its pool grows
from the 20-query floor toward roughly 32+ judged queries, including at least
four memory-recall queries through the real recall path. Otherwise retain
current fusion.

### Phase 2B — Conditional embedding challenger

Enter only if Phase 0/2A still shows semantic failures.

Update only:

- `packages/memory/src/search/embedding-service.ts` — compare current MiniLM
  fp32 against Arctic Embed S in one verified available dtype, with fixed
  ID/revision/dimensions/max tokens/prefix/pooling/normalize metadata;
- `packages/memory/src/search/orama-schema.ts` and
  `orama-search-service.ts` — validate the selected model fingerprint;
- `scripts/search-eval.mjs` — record local
  download/init/query/rebuild/RSS/index costs.

Do not extract an adapter framework. Test a quantized dtype later only if model
footprint or latency is the observed failing constraint.

**Exit gate:** the challenger clears the frozen quality policy with explicitly
accepted runtime/footprint deltas. Otherwise retain MiniLM and delete the
experiment.

### Phase 3A — Conditional long-document chunks

Enter only if Phase 0/2B shows tail-content failures:

- `packages/memory/src/search/markdown-chunks.ts`;
- `packages/memory/src/search/markdown-chunks.types.ts`;
- chunk schema/cache fields in `orama-schema.ts`;
- chunk-to-parent collapse and winning-chunk snippets in
  `orama-search-service.ts`;
- unit fixtures for heading paths, oversized sections, stable offsets,
  rebuilds, and parent-level result deduplication.

**Exit gate:** tail-query Recall@20 clears the frozen quality policy and
index/rebuild cost clears the frozen runtime policy. Otherwise delete the
experiment.

### Phase 3B — Conditional local reranking

Enter only if judged aboutness failures remain:

- `packages/memory/src/search/reranker.ts`;
- `packages/memory/src/search/reranker.types.ts`;
- top-k integration in `orama-search-service.ts`;
- tests for `title + bounded best passage`, fallback, preserved ID navigation,
  exact-title pin after reranking, deterministic ordering, and top-10 versus
  top-20 quality/latency.

Use the existing Transformers.js dependency. Do not add a second inference
stack or public configuration surface.

**Exit gate:** query-class quality gain clears the frozen regression policy and
local interactive cost is accepted. Otherwise delete the experiment.

### ADR 0112 dependency — per-home composition

ADR 0112 owns per-home runtimes, `home: all` plumbing, provenance, and the
cross-home merger. ADR 0116 contributes the retrieval rule and fixture cases:
never compare raw cross-index scores; use within-home ranks; cover size-skewed
homes, duplicate local IDs, equal-rank cutoff tiers, zero-result homes, one
degraded home, and stable provenance.

## Manual validation

After each accepted phase:

1. run the real CLI/server against a copied representative docs home;
2. record cold BM25 availability and semantic-ready time;
3. run the frozen fixture for the current phase;
4. inspect failures and score/rank traces;
5. edit/add/delete a Markdown entity and resource outside the server, restart,
   and confirm reconciliation;
6. when Phase 1B is admitted, simulate unavailable model state and confirm BM25
   plus visible degradation/retry;
7. for ADR 0112, run project/global homes together and inspect provenance and
   tie stability.

Unit tests remain memfs-based and deterministic. Model/network-dependent
measurements are explicit manual benchmark runs, not ordinary test-suite gates.

## Definition of done for each accepted engineering phase

- the relevant query/qrel pool is reviewed and frozen before candidate tuning;
- the benchmark report records reproducibility metadata and raw timings;
- focused unit suites pass in the owning package;
- server and memory typechecks/builds pass;
- existing search golden and ADR 0115 recall golden suites remain green;
- the real-process manual validation for that phase is recorded;
- any new readiness/chunk/provenance derived state is human-inspectable;
- losing experimental code and unused knobs are removed;
- an engineering-record ADR records accepted results, rejected candidates, and
  the next still-unearned phase.

## Consequences

### Positive

- Search changes become evidence-based instead of bonus/weight folklore.
- If Phase 1B is earned, BM25 remains available while semantic preparation is
  slow or broken.
- Markdown and resource edits reconcile truthfully.
- Model, chunking, and reranking choices are reversible and measured.
- ADR 0112 gets a deterministic cross-home merge with provenance.
- Agents can perform sophisticated iterative retrieval without embedding an LLM
  or hidden orchestration state in the server.

### Costs

- A small qrel fixture requires human maintenance.
- Conditional background semantic preparation needs lifecycle/state handling.
- Model comparisons take manual time on supported hardware.
- Conditional chunking or reranking, if earned, increases index/runtime cost.

### Explicit non-goals

- cloud search or embedding parity;
- a built-in answer-generation/chat session;
- a generic retrieval framework;
- user-configurable model/fusion/chunk/reranker matrices;
- automatic LLM-judged releases;
- late interaction, graph RAG, RAPTOR, or autonomous corrective browsing.

## Decision summary

Keep the architecture local and simple:

> Measure real queries. Make BM25 immediately trustworthy. Prepare semantics in
> the background only if availability measurements demand it. Change
> fusion/model/chunking/reranking only when the checked-in corpus proves the
> pressure point. Keep reasoning in the agent and provenance in the server.
