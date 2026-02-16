# 0081. Independent Retrievers with Linear Fusion Scoring

**Date**: 2026-02-16
**Status**: Accepted
**Backlog Item**: TASK-0302
**Supersedes**: ADR-0051 (multi-signal search ranking), ADR-0072 (normalize-then-multiply scoring)

## Context

The search scoring pipeline has three competing systems with no shared information:

1. **Orama hybrid mode** (`mode: 'hybrid'`) — internal BM25 + vector fusion with `hybridWeights: { text: 0.8, vector: 0.2 }`. A black box we can't inspect or tune.
2. **`normalizeScores()`** — divides all scores by the maximum, mapping to [0,1]. Destroys score magnitude information.
3. **`rerankWithSignals()`** — a shadow scoring system that re-derives title matching, applies multiplicative boosts, and adds a coordination bonus. Duplicates and conflicts with Orama's native BM25 field boosts.

Each fix (ADR-0051, ADR-0072, TASK-0296 compound words, +1.5 coordination bonus) added another layer without addressing the fundamental split. The concrete failure: searching "feature store" ranks TASK-0273 (literally about FeatureStore) at 18th because a single-term title match with 5x boost outscores a two-term description match after normalization and re-ranking.

Additionally, `orama-search-service.ts` grew to 852 lines with 10 distinct responsibilities — pure stateless functions (tokenizer, snippets, scoring) trapped alongside stateful Orama lifecycle management.

## Decision

### 1. Replace hybrid mode with independent retrievers + linear fusion

Run two separate Orama queries instead of one hybrid query:

- **BM25 retriever**: `search(db, { term: query, ... })` — Orama default mode (fulltext)
- **Vector retriever**: `search(db, { mode: 'vector', vector: { value, property: 'embeddings' }, ... })` — Orama vector mode

Fuse scores using linear combination with MinMax normalization per-retriever:

```
minmax(score) = (score - min) / (max - min)    // per-retriever, scales to [0,1]
final_score = W_TEXT * minmax(bm25) + W_VECTOR * minmax(vector)
```

Starting weights: `W_TEXT = 0.7`, `W_VECTOR = 0.3`. Tunable via golden test suite.

**Why linear fusion over RRF**: Elasticsearch built RRF first (8.9+), used it for 2 years, then built linear fusion because RRF discards score magnitude — a document with BM25 score 100 and one with score 1.5 get near-identical rank contributions. Score magnitude matters for our use case (title match vs description match). We skip straight to Elasticsearch's conclusion.

**Why not keep hybrid mode**: Orama's internal fusion is a black box. We can't inspect why it ranked something, can't tune BM25 vs vector weights independently, and can't add domain signals without creating another shadow scoring system.

### 2. Decompose the monolith into focused modules

```
src/search/
├── types.ts                  # Existing: SearchService interface, result types
├── orama-schema.ts           # NEW: OramaDoc types, schema, constants, buildWhereClause
├── tokenizer.ts              # NEW: splitCamelCase, compoundWordTokenizer
├── snippets.ts               # NEW: generateTaskSnippet, generateResourceSnippet
├── scoring.ts                # NEW: minmaxNormalize, linearFusion, postFusionModifiers
├── embedding-service.ts      # Existing: unchanged
├── orama-search-service.ts   # SLIMMED: index lifecycle + CRUD + search execution
└── index.ts                  # Existing: updated re-exports
```

Key principle: pure stateless functions (tokenizer, snippets, scoring) are extracted into their own modules. The scoring module is independently unit-testable without an Orama instance.

### 3. Delete the shadow scoring system

Removed entirely:
- `rerankWithSignals()` — shadow scoring
- `normalizeScores()` — replaced by per-retriever MinMax in `scoring.ts`
- `getRecencyMultiplier()` — replaced by post-fusion modifier in `scoring.ts`
- `mode: 'hybrid'` — replaced by two independent queries
- The +1.5 coordination bonus bandaid

### 4. Post-fusion modifiers replace multiplicative re-ranking

Lightweight additive adjustments on the fused [0,1] score:
- Recency: small bonus for recently updated items
- Epic type: small bonus when relevant

These are score nudges, not a parallel scoring system. They modify a coherent fused score, not a normalized-then-re-derived score.

### 5. Graceful degradation

When embeddings are unavailable, the vector retriever returns empty results. Linear fusion with empty vector hits degenerates to `minmax(bm25)` — pure BM25 ranking. No special-casing needed.

## Consequences

### Positive
- **Correct rankings**: BM25 and vector contribute independently. No double-boosting. A two-term description match can outrank a one-term title match.
- **Debuggable**: Inspect BM25 score, vector score, and fusion math separately for any query.
- **Testable**: Scoring module is pure functions — unit testable without Orama. "Given these BM25 scores and vector scores, does fusion produce rank X?"
- **Extensible**: Adding a retriever = adding a query. Adding a modifier = adding a function. Neither touches the fusion logic.
- **Industry-standard**: Same architecture as Elasticsearch, Azure AI Search, OpenSearch.

### Negative
- Two Orama queries per search instead of one. For hundreds of documents, overhead is <10ms. Acceptable.
- 4 new files. Each is small (40-90 lines) and focused. Net reduction in cognitive load despite more files.
- MinMax edge cases need explicit handling: single result (max=min), all same score. Solved with guards.
- Weights (0.7/0.3) are starting values, not proven optimal. The architecture makes tuning possible via golden tests.

### Neutral
- ADR-0051 and ADR-0072 are superseded. Their scoring approaches are deleted.
- ADR-0073 (snippets), ADR-0079 (native filtering), ADR-0080 (best practices) are unaffected.

## Alternatives Considered

### A. Delete re-ranking, trust Orama hybrid scores (Proposal 1)
Rejected. Doesn't solve the "feature store" problem — Orama's internal hybrid mode with field boosts still produces wrong rankings due to OR-mode + 5x title boost dominance. We'd be trusting a black box we've already proven produces wrong results.

### B. Pluggable retriever pipeline with interfaces (Proposal 3)
Rejected for now. Over-engineered for 2 retrievers and 1 fusion strategy. The Retriever interface adds indirection for no current benefit, and retrievers needing the Orama db instance creates awkward coupling. Proposal 2's architecture is forward-compatible — if we ever need pluggable retrievers, we can extract the hardcoded queries into Retriever classes without changing the scoring module.

## References

- [Elasticsearch linear retriever blog (2025)](https://www.elastic.co/search-labs/blog/linear-retriever-hybrid-search) — evolution beyond RRF
- [Original RRF paper (Cormack et al., 2009)](https://dl.acm.org/doi/10.1145/1571941.1572114)
- [Azure AI Search hybrid overview](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview)
- TASK-0298: threshold=0 + tolerance=1 breaks ranking (Orama v3 undocumented behavior)
- TASK-0296: compound word tokenizer fix (FeatureStore found but ranked wrong)
