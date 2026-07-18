# Per-Home Recall Baseline — Run Summary

Queries: 4 (global: 2, project: 2) — qrels: 12 — commit `1706e1d106bc`.

## Declared limits

- This mode reuses the real CLI recall runtime — createCliRuntime (packages/server/src/cli/runner.ts) -> createLocalRuntime -> the core recall() — the same path packages/server/src/cli/commands/recall.ts uses for `backlog recall --home <home>`, not the synthetic single-project reindex the search/hybrid benchmark in this same script builds. Scores measure the live production configuration (30-day half-life decay, real usage-multiplier reordering, real home content), not a frozen deterministic fixture.
- Because it queries live homes, two runs are not guaranteed byte-identical: elapsed days change temporal decay, and any change to a home's memory corpus or usage history changes ranking. This report is a dated baseline snapshot (see provenance.git_commit), not a byte-stable regenerable artifact like scripts/structural-suite.mjs.
- The runner never calls MemoryUsageTracker.recordRecall for scored queries, so it does not append to memory-usage.jsonl or retrieval-telemetry.jsonl — repeated benchmark runs must not pollute the production usage/demand signals that drive consolidation and the usage multiplier. A real `backlog recall` invocation does append them; this is the one deliberate divergence from full CLI parity.
- nDCG@k, precision@k, and recall@k all use k = the query's own options.limit (default 10), the same limit the recall call actually used — not a fixed benchmark cutoff.
- precision@k divides by the fixed cutoff k, not by the number of results actually returned, so a home whose real corpus holds fewer than k eligible memories is not artificially rewarded (packages/memory/src/search/evaluation.ts precisionAt).
- A qrel document absent from the ranked results is scored as a miss (zero contribution to nDCG and recall), never rejected — docs/evaluation/R8-JUDGING-2026-07-18.md Q4 records exactly this case (MEMO-0006).
- Assessor tiers follow docs/evaluation/JUDGING.md; provenance.gate_eligibility reflects whether every judgment carries at least a human assessor of record.

## Homes

| home | memory_count | hybrid_active | root |
|---|---|---|---|
| global | 14 | true | /Users/goga/.backlog |
| project | 10 | true | /Users/goga/Documents/goga/backlog-mcp |

## Per-query scores

| query_id | home | k | nDCG@k | precision@k | recall@k | unjudged@k |
|---|---|---|---|---|---|---|
| recall-01 | global | 10 | 0.9926 | 0.2000 | 1.0000 | 0.6250 |
| recall-02 | project | 10 | 1.0000 | 0.1000 | 1.0000 | 0.8000 |
| recall-03 | global | 10 | 0.6309 | 0.1000 | 1.0000 | 0.7000 |
| recall-04 | project | 10 | 0.8743 | 0.2000 | 1.0000 | 0.5556 |

## By home

| home | queries | nDCG@k | precision@k | recall@k | unjudged@k |
|---|---|---|---|---|---|
| global | 2 | 0.8118 | 0.1500 | 1.0000 | 0.6625 |
| project | 2 | 0.9371 | 0.1500 | 1.0000 | 0.6778 |

## Overall

queries: 4, nDCG@k 0.8745, precision@k 0.1500, recall@k 1.0000, unjudged@k 0.6701.

Gate eligibility: eligible — every judgment carries at least a human assessor of record.
