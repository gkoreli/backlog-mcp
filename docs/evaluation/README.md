# ADR 0116 recorded search baseline

`scripts/search-eval.mjs` records the real BM25-only and MiniLM fp32 hybrid
behavior of the production Orama search service. It loads the selected
docs-native project through the production substrate registry, indexes the
same registry-projected entities and non-entity resources as the local
runtime, uses the real `BacklogMemoryStore.recall` path for recall queries, and
writes one atomic JSON report. It does not use the deterministic test fixture
or mocked embeddings.

The input judgments must already have independent human review. The runner
rejects a query or qrel whose `assessor` does not contain `reviewed:`.

## Commands

Node 24 is required.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm search:eval -- \
  --project-root /absolute/path/to/project \
  --queries /absolute/path/queries.jsonl \
  --qrels /absolute/path/qrels.jsonl \
  --output /absolute/path/reports/minilm-fp32-baseline.json
```

Optional controls:

```bash
pnpm search:eval -- \
  --project-root /absolute/path/to/project \
  --queries queries.jsonl \
  --qrels qrels.jsonl \
  --output report.json \
  --baseline-version 1 \
  --warmups 2 \
  --repetitions 5
```

Defaults are one full-query-set warmup and three measured repetitions. Use
`--warmups 0` to skip that query-set warmup; this is not a claim that process,
model, or operating-system caches are cold. Run
`node scripts/search-eval.mjs --help` or `pnpm search:eval -- --help` for the
CLI summary.

The first hybrid run may download `Xenova/all-MiniLM-L6-v2`. If the model
cannot initialize, the runner fails instead of recording the service's BM25
fallback as hybrid evidence.

## Product corpus

`--project-root` resolves one production project home. The runner fails on
substrate diagnostics, claims Markdown through the active registry, projects
each entity with its declared search fields, and includes generic resources
without double-indexing claimed entity files. The report freezes a
deterministic content hash plus entity/resource counts and per-substrate
counts; no duplicate corpus copy is checked in.

This boundary was corrected after ADR 0113 Phase C expanded the product corpus
to packaged ADR, requirement, and prompt substrates. A baseline that accepts
only the old closed `EntitySchema` is invalid because it omits those documents.

## Query JSONL

Each line has this schema:

```text
{
  id: string,
  class: string,
  surface: "search" | "recall",
  query: string,
  options?: SearchOptions | RecallOptions,
  assessor: string containing "reviewed:",
  rationale: non-empty string,
  provenance: non-empty string[]
}
```

Search options are strict by shape. Substrate type and status values remain
open strings because the active project registry, not the benchmark runner,
owns those vocabularies:

```text
{
  types?: string[],
  status?: string[],
  parent_id?: string,
  limit?: positive integer
}
```

Recall options are strict:

```text
{
  layers?: ("episodic" | "semantic" | "procedural")[],
  context?: string,
  tags?: string[],
  limit?: positive integer
}
```

Example:

```json
{"id":"search-01","class":"aboutness","surface":"search","query":"embedding startup retry","assessor":"alice-initial; reviewed:bob 2026-07-16","rationale":"Daily query for the retry task.","provenance":["TASK-0001"]}
{"id":"recall-01","class":"memory-recall","surface":"recall","query":"what governs fusion changes","options":{"layers":["semantic"],"limit":20},"assessor":"alice-initial; reviewed:bob 2026-07-16","rationale":"Exercises the real recall path and usage multiplier.","provenance":["MEMO-0001"]}
```

Query IDs must be unique.

## Qrel JSONL

Every relevance judgment is a separate line:

```text
{
  query_id: string,
  document_id: string,
  grade: 0 | 1 | 2 | 3,
  assessor: string containing "reviewed:",
  rationale: non-empty string
}
```

Example:

```json
{"query_id":"search-01","document_id":"TASK-0001","grade":3,"assessor":"alice-initial; reviewed:bob 2026-07-16","rationale":"The task directly owns embedding retry behavior."}
{"query_id":"recall-01","document_id":"MEMO-0001","grade":3,"assessor":"alice-initial; reviewed:bob 2026-07-16","rationale":"The live semantic memory states the governing fusion law."}
```

The runner rejects duplicate `(query_id, document_id)` pairs, unknown queries,
unknown corpus documents, missing per-qrel rationale or assessor, and any
builder-only assessor without an independent `reviewed:` entry. Every query
must have at least one qrel.

## Report

The report records the Git commit and runner hash, corpus/query/qrel hashes and
counts, explicit evaluated surfaces and limitations, environment and package
versions,
fixed MiniLM correctness metadata, BM25 and hybrid index duration/cache bytes,
separate lexical-ready and semantic-ready timings, whether the model came from
the existing Transformers.js cache or was downloaded during the run (including
downloaded bytes), hashes for the required cached model files,
service-build-to-first-result and first-result-after-ready probes, whether
query warmups were skipped, phase-boundary RSS samples, raw
ranked IDs and timings for every query,
repeat-determinism checks, first measured query latency, warm p50/p95 latency,
and overall/per-class nDCG@10, MRR@10, success@1, Recall@20, and unjudged@10.

MiniLM's enforced runtime boundary is 512 tokens, while its model card reports
a 256-token trained window. Tail fixtures should eventually place markers in
both zones: tokens 257–512 expose potentially degraded embeddings, while
content after token 512 is absent from the vector entirely.

Reports are durable evidence. The output parent directory is created when
needed, and the report is written to a temporary sibling before an atomic
rename. Do not check in a report until its corpus, queries, and qrels are the
reviewed product-corpus baseline authorized by ADR 0116.

Baseline v1 is deliberately search-only because the post-Phase-C project
corpus contains no real memories. It must state that recall evidence is absent.
Candidate search comparisons may proceed, but no shared-fusion winner or other
recall-affecting ranking change may ship until baseline v2 adds at least four
reviewed memory-recall queries against Goga's real global memory corpus after
Phase E migration places it under `~/.backlog/docs`. Synthetic memories may
never be used to manufacture that evidence.

The runner enforces this boundary: v1 rejects recall queries, while v2 and
later require at least four reviewed recall queries and at least one real
memory entity in the selected corpus.

Baseline v1's known failures make the next pressure points explicit. In BM25,
`nav-01` finds its target only at rank 9 (`success@1 = 0`, reciprocal rank
`0.111`); `about-03` is the genuinely absent target. Aboutness is the weakest
class at nDCG@10 `0.551` for BM25 and `0.605` for hybrid, while tail retrieval
scores `0.800` and `0.846` respectively. These are measured failures to test,
not authority to change ranking without the judged gate.
