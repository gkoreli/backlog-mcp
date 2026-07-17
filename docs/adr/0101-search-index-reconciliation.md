# 0101. Search: Reconciliation + ID Lookup + Architectural Findings

**Date**: 2026-05-24
**Status**: Accepted (Phases 1–4 shipped — the Phase 4 query-intent parser shipped via ADR 0092.4, which records ID-shaped queries short-circuiting through it; report 0003 appendix). Status reconciled 2026-07-17.
**Triggered by**: User unable to find TASK-0596 ("Research: Fredrika Unified Diff Viewer") via `backlog_search("diff viewer")` or `backlog_search("task 596")`.

## Problems Found

### Problem 1: 165/915 entities missing from the search index

The JSON cache (`.cache/search-index.json`) was trusted absolutely on startup — never reconciled against actual task files on disk. Three failure modes:

| # | Failure mode | Mechanism |
|---|---|---|
| 1 | Pre-search creation gap | Tasks created before first search call never enter the index |
| 2 | Lost persistence | 1s debounced save lost on shutdown; errors swallowed silently |
| 3 | External mutations | Edits to `tasks/` files outside the server are invisible |

**Fix: shipped.** Startup reconciliation (Phase 1), pending-ops queue (Phase 2), flush on shutdown (Phase 3).

### Problem 2: "task 596" → TASK-0596 doesn't work

This is NOT a scoring problem. The token `"596"` literally returns **zero hits** from Orama's radix tree even with `tolerance: 1`. Empirically proven:

```
search(db, { term: '596', properties: ['id'], tolerance: 1 }) → 0 hits
search(db, { term: '0596', properties: ['id'], tolerance: 0 }) → 0 hits
```

**Root cause:** Orama's radix tree Levenshtein walk has a known bug class ([issue #38](https://github.com/oramasearch/orama/issues/38)) where leading-character insertions fail to match against trie siblings with dense clustering. Our backlog has exactly this pattern (TASK-0596, TASK-0597, TASK-0598...).

**No full-text engine handles this natively.** Tested against Orama, verified Meilisearch docs (3-char tokens get zero typo tolerance), verified Tantivy (exact token match after tokenization). "596" ≠ "0596" is a normalization problem, not a search problem.

**Fix: query intent parser (Phase 4, proposed).** Detect ID-shaped queries before BM25, resolve directly via cache lookup. Falls through to fulltext if ID not found.

### Problem 3: Orama's `tolerance: 1` floods numeric queries with false positives

With 900+ documents, searching "596" with tolerance:1 matches "56", "59", "96", "196", "296" (all within edit-distance 1 of various index tokens). The actual target gets buried. This is tolerance working as designed — it's just useless for short numeric tokens at scale.

**Not fixed.** Acceptable because Phase 4 (intent parser) bypasses Orama entirely for ID queries.

## Architectural findings

### Orama is a document-retrieval engine used for list-filtering

BM25 answers "which documents are about this topic" — designed for long documents with term frequency relevance. Our use case is mostly "find the specific item I'm thinking of" — short titles, exact IDs, navigational queries.

ADR 0083 documented this mismatch in detail (Feb 2026). The custom scoring layers we built (1574 lines across tokenizer, scoring, fusion, coordination bonus, temporal decay) are all compensating for this architectural mismatch.

### Fuzzy subsequence matching solves the navigation case perfectly

VS Code, fzf, and uFuzzy use character-by-character subsequence matching. "task 596" matches "TASK-0596" because each term's characters appear in sequence. No tokenization, no index, no tolerance configuration. Proven empirically:

- `"task 596"` → matches only TASK-0596 (zero false positives)
- `"diff viewer"` → matches "Research: Fredrika Unified Diff Viewer"
- `"596"` → matches TASK-0596 (subsequence of "0596")

### Future direction (not implemented)

If the scoring complexity becomes untenable, the architecture could evolve to:
- Fuzzy subsequence matching on `id + title` for navigation
- Embeddings on full content for semantic recall
- Delete the BM25/fusion/scoring stack entirely

This would remove ~1000 lines of code. Not pursued now because Orama works adequately for content search once the corpus is correct.

## Implementation (shipped)

### Phase 1: Reconciliation on startup ✅

`OramaSearchService.reconcile(currentTasks)` — incremental diff after cache load. Adds missing, removes stale, updates modified. Logs stats.

### Phase 2: Pending-ops queue ✅

`BacklogService.pendingOps` — queues add/update/delete when `searchReady === false`. Drained after reconcile.

### Phase 3: Harden persistence ✅

- `flush()` on SIGTERM/SIGINT
- `console.warn` on persist errors (was silent catch)

### Phase 4: Query intent parser (proposed)

Pre-search layer that classifies queries before hitting BM25:

- `"task 596"` → type: `id_lookup`, resolve to TASK-0596, direct cache hit
- `"blocked tasks"` → type: `filtered`, apply status filter without BM25
- `"diff viewer"` → type: `fulltext`, run existing pipeline

Implementation: `packages/memory/src/search/query-intent.ts` (written, in working tree, not yet committed).

## References

- ADR 0083: Search service review & next-generation search (Feb 2026)
- Orama source: `oramasearch/orama`, `trees/radix.ts:240–303`
- Orama issue #38: tolerance Levenshtein bug class
- Orama issue #797: tolerance + short word interaction
- Meilisearch docs: 1-4 char tokens get zero typo tolerance (confirmed our finding is universal)
- Tantivy basic example: same tokenization mismatch applies
- uFuzzy benchmarks: 162K items in 5ms, 7.5KB, zero config
