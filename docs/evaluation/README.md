# ADR 0116 recorded search baseline

`scripts/search-eval.mjs` records the real BM25-only and MiniLM fp32 hybrid
behavior of the production Orama search service. It imports the built server
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
  --corpus /absolute/path/entities.jsonl \
  --queries /absolute/path/queries.jsonl \
  --qrels /absolute/path/qrels.jsonl \
  --output /absolute/path/reports/minilm-fp32-baseline.json
```

Optional controls:

```bash
pnpm search:eval -- \
  --corpus entities.jsonl \
  --queries queries.jsonl \
  --qrels qrels.jsonl \
  --output report.json \
  --warmups 2 \
  --repetitions 5
```

Defaults are one full-query-set warmup and three measured repetitions. Use
`--warmups 0` when the first measured query must be cold. Run
`node scripts/search-eval.mjs --help` or `pnpm search:eval -- --help` for the
CLI summary.

The first hybrid run may download `Xenova/all-MiniLM-L6-v2`. If the model
cannot initialize, the runner fails instead of recording the service's BM25
fallback as hybrid evidence.

## Corpus JSONL

One built-in `Entity` JSON object per line. The built shared `EntitySchema`
validates every record. IDs must be unique.

```json
{"id":"TASK-0001","type":"task","title":"Retry embeddings","content":"Make initialization retryable.","status":"open","created_at":"2026-07-01T00:00:00.000Z","updated_at":"2026-07-01T00:00:00.000Z"}
{"id":"MEMO-0001","type":"memory","title":"Fusion law","content":"Fusion changes require judged evidence.","layer":"semantic","source":"human","usage_count":0,"created_at":"2026-07-01T00:00:00.000Z","updated_at":"2026-07-01T00:00:00.000Z"}
```

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

Search options are strict:

```text
{
  types?: ("task" | "epic" | "folder" | "artifact" | "milestone" |
           "cron" | "memory" | "resource")[],
  status?: ("open" | "in_progress" | "blocked" | "done" | "cancelled")[],
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

The report records input hashes and counts, environment and package versions,
fixed MiniLM correctness metadata, BM25 and hybrid index duration/cache bytes,
phase-boundary RSS samples, raw ranked IDs and timings for every query,
repeat-determinism checks, first measured query latency, warm p50/p95 latency,
and overall/per-class nDCG@10, MRR@10, success@1, Recall@20, and unjudged@10.

Reports are durable evidence. The output parent directory is created when
needed, and the report is written to a temporary sibling before an atomic
rename. Do not check in a report until its corpus, queries, and qrels are the
reviewed product-corpus baseline authorized by ADR 0116.
