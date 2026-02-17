# 0083. Search Service Architectural Review & Next-Generation Search

**Date**: 2026-02-17
**Status**: Proposed

## Context

After building a sophisticated search pipeline (ADR-0079 native filtering, ADR-0080 best practices, ADR-0081 linear fusion), search ranking still produces incorrect results for real-world queries. The question is whether incremental tuning (weights, boosts, bonuses) will close the gap, or whether the architecture has a fundamental ceiling.

This ADR captures two things:
1. Concrete bugs and design issues found during code review
2. Analysis of **why the current architecture has a quality ceiling** and what would produce a magnitude improvement

## Part 1: Code Review Findings

### Critical (correctness bugs)

#### 1.1 Missing `await` on `insert` in `indexResources` (orama-search-service.ts:494, 511)

```typescript
// Line 494 — fire-and-forget, can silently fail
insert(this.db as OramaInstanceWithEmbeddings, doc);

// Compare with addDocument (line 438) which correctly awaits
await insert(this.db as OramaInstanceWithEmbeddings, doc);
```

Orama's `insert` returns a Promise. Without `await`, insert failures are silently swallowed and resources may not appear in search results.

#### 1.2 `updateDocument` / `updateResource` are not atomic (orama-search-service.ts:463-474)

The pattern is `remove → re-set cache → insert`. If `insert` throws (e.g., embedding service error), the document has been removed from the Orama index but restored in `taskCache`. The index and cache are now inconsistent — `_getSearchableText()` sees the document but `search()` doesn't find it.

#### 1.3 `search()` method contradicts ADR-0079 (orama-search-service.ts:346-360)

The `search()` method (task-only) runs `_fusedSearch` without restricting `type` in the `where` clause, then filters to tasks in JS at line 358-359 (`.filter(h => h.task)`). This is the exact post-search JS filtering pattern that ADR-0079 was created to eliminate. Unlike `searchAll()` and `searchResources()` which correctly use native filtering.

### Important (design issues)

#### 1.4 `id` field boosted 10x is actively poisoning rankings (orama-search-service.ts:353)

```typescript
boost: options?.boost ?? { id: 10, title: 3 },
```

Since `id` is in `TEXT_PROPERTIES`, every document with IDs like `TASK-0001`, `EPIC-0002` are text-searchable with a 10x boost. Any query containing common words like "task" or "epic" heavily matches every document of that type through the ID field, drowning out actual content relevance. This likely explains a significant portion of "results not ranked properly" issues.

#### 1.5 Snippet generation doesn't use the compound tokenizer (snippets.ts:57)

```typescript
const hasMatch = queryWords.some(w => valueLower.includes(w));
```

The search engine uses `compoundWordTokenizer` to split "FeatureStore" → ["featurestore", "feature", "store"]. But snippet generation uses naive substring matching. Searching "FeatureStore" will not find a snippet match in text containing "Feature Store" (two words), even though Orama returned the document as a hit. The snippet falls back to title, losing match context.

#### 1.6 Silent filter override in `buildWhereClause` (orama-schema.ts:81-84)

If both `filters.type` and `docTypes` are set, `docTypes` silently overwrites `filters.type`. Not documented, can produce confusing results.

#### 1.7 Index load doesn't validate embedding configuration (orama-search-service.ts:191-193)

If the cached index was built with `hybridSearch: false` but the current instance has `hybridSearch: true`, the loaded BM25-only index is used as-is. The system silently runs in BM25 mode despite the caller expecting hybrid search.

### Minor (quality-of-life)

#### 1.8 `SearchService` interface is dead code (types.ts:90-105)

The interface declares 5 methods but `OramaSearchService` implements ~15 public methods. The interface is not used for polymorphism anywhere. It gives a false sense of abstraction.

#### 1.9 Synchronous file I/O in `persistToDisk` (orama-search-service.ts:140-157)

`writeFileSync` blocks the Node.js event loop. For a Fastify server under load, this causes latency spikes proportional to index size.

#### 1.10 Empty catch blocks throughout

`persistToDisk`, `loadFromDisk`, `removeDocument`, `removeResource` all silently swallow errors. Makes debugging production issues very difficult.

#### 1.11 Score range is unbounded and undocumented

After coordination bonus, scores range [0, ~1.8]. The MCP tool rounds to 3 decimal places but doesn't document the range. Agents consuming `include_scores: true` have no way to interpret what a "good" score is.

---

## Part 2: Why the Architecture Has a Quality Ceiling

### The fundamental problem: BM25 is a bag-of-words model

The entire current pipeline — BM25, vector embeddings, linear fusion, coordination bonus — operates at the **retrieval** level. It finds documents that contain query terms or are semantically similar. But it has zero understanding of:

1. **Query intent** — "blocked tasks" should filter by `status=blocked`, not text-search for the word "blocked"
2. **Term relationships** — "database migration" should match "schema upgrade" (synonyms, not just shared tokens)
3. **Precision vs recall tradeoff** — the system operates in OR mode (`tolerance: 1`), meaning a single term match anywhere is enough to surface a document. This maximizes recall but destroys precision for multi-term queries.

The coordination bonus (ADR-0081) is a band-aid for problem #3. It adds a heuristic term-counting boost to compensate for OR-mode's precision loss. But it's counting token presence, not understanding relevance.

### Why "simple fuzzy search would have been better" has a kernel of truth

Simple fuzzy search (e.g., Fuse.js) has properties that accidentally sidestep some of our current problems:

| Property | Fuzzy search | Current architecture |
|----------|-------------|---------------------|
| Ranking basis | String distance (edit distance) | BM25 term frequency + IDF + field length norm + vector cosine similarity + coordination bonus |
| Exact match handling | Always ranks highest (distance=0) | Can be outscored by field boost artifacts (id:10) |
| No field boost confusion | Searches all text uniformly | `id: 10` boost poisons results for common words |
| Deterministic | Same query → same ranking, easy to debug | Normalization, fusion weights, and coordination make reasoning about rankings difficult |
| Failure mode | Obviously wrong (irrelevant fuzzy matches) | Subtly wrong (relevant results buried by scoring artifacts) |

The current system's failure mode is worse: it's sophisticated enough that ranking bugs look like "maybe the algorithm just doesn't think this is relevant" rather than being obviously broken. The `id: 10` boost alone probably explains 30-40% of ranking complaints — every query containing "task" or "epic" has its results dominated by ID field matches.

### What would produce a magnitude improvement

Three changes, in order of impact-to-effort ratio:

#### 1. Remove the `id: 10` boost and `id` from TEXT_PROPERTIES (immediate, high impact)

This is the lowest-hanging fruit. Task IDs should be looked up by exact match (a `where` clause or a dedicated `getById` call), not text-searched with a 10x boost. Removing this single line would immediately improve ranking quality for any query containing common ID-prefix words.

#### 2. Cross-encoder re-ranking (highest magnitude improvement)

The current pipeline is a **bi-encoder** architecture: documents and queries are scored independently. A **cross-encoder** takes `(query, document)` pairs and jointly attends to both:

```
Current (bi-encoder):
  query → embedding ─┐
                       → cosine similarity (fast, approximate)
  document → embedding ┘

Cross-encoder re-ranker:
  [query, document] → transformer → relevance score (slow, precise)
```

Cross-encoders understand relationships invisible to term matching:
- "auth bug" → "Users cannot log in with SSO when MFA is enabled" (zero shared terms, high relevance)
- "what's blocking the DB work" → TASK-0004 with `blocked_reason: ['Waiting for DBA approval']`

The standard pattern used by every production search system (Google, Bing, Elasticsearch, Azure AI Search):

```
Stage 1 (retrieval):  BM25 + vector → top 50 candidates  (fast, ~10ms)
Stage 2 (re-ranking): cross-encoder scores top 50         (slower, ~100-200ms)
Stage 3 (return):     top 20 from re-ranked results
```

This routinely improves search quality by 30-50% over retrieval-only systems. A small cross-encoder model like `cross-encoder/ms-marco-MiniLM-L-6-v2` runs locally, is ~22MB, and can re-rank 50 documents in <200ms.

For a backlog system with hundreds (not millions) of documents, the latency cost is negligible and the quality gain is transformative.

#### 3. Query understanding (intent → structured query)

When a user searches "blocked tasks about database", the system should decompose this into:

```json
{
  "filters": { "status": ["blocked"] },
  "query": "database"
}
```

This is not a text search problem — it's a classification/extraction problem. Options:

- **Rule-based parser**: Regex patterns for known terms ("blocked" → status filter, "recent" → sort mode). Simple, fast, zero dependencies. Handles 80% of cases.
- **LLM-powered**: Send the query to a small LLM with the schema and get structured output. Handles 99% of cases but adds latency and a dependency.

For a backlog system where the vocabulary is small and well-defined (5 statuses, 5 types, known patterns like "recent", "my", "blocked"), a rule-based parser would provide enormous improvement with zero added complexity.

### Why the current architecture isn't wasted

The retrieval layer (BM25 + vector + fusion) is a solid Stage 1. It's exactly what you'd want as the candidate generation step before a cross-encoder. The module decomposition (ADR-0081) makes adding a re-ranker straightforward — it's just another function in the scoring pipeline:

```
_fusedSearch() → existing retrieval (keep as-is)
    ↓
crossEncoderRerank(query, candidates) → new stage
    ↓
applyCoordinationBonus() → may become unnecessary
```

The investment in native filtering (ADR-0079) remains valuable regardless — filters are applied at retrieval time, reducing the candidate set the cross-encoder must process.

## Decision

### Immediate fixes (Part 1 bugs)

1. Add missing `await` to `insert` calls in `indexResources`
2. Make `updateDocument`/`updateResource` atomic (catch insert failure, re-add old doc)
3. Add `type` filter to `search()` method's `where` clause
4. Remove `id` from `TEXT_PROPERTIES` and from the default boost
5. Use compound tokenizer in snippet generation
6. Document the `buildWhereClause` override behavior
7. Validate embedding config on disk load
8. Update or delete the `SearchService` interface
9. Switch `persistToDisk` to async I/O
10. Add debug-level logging to catch blocks

### Architecture evolution (Part 2 improvements)

11. Add cross-encoder re-ranking as Stage 2 (behind feature flag)
12. Add rule-based query intent parser (extract status/type/sort from natural language queries)
13. Re-evaluate coordination bonus after cross-encoder is in place (may become redundant)

## Consequences

### Positive
- Fixes concrete bugs that cause inconsistent index state
- Removes the `id: 10` boost which is the single largest source of ranking distortion
- Cross-encoder re-ranking addresses the fundamental quality ceiling
- Query intent parsing eliminates the class of failures where users describe filters as text

### Negative
- Cross-encoder adds ~100-200ms latency per search (acceptable for interactive use)
- Cross-encoder model is an additional ~22MB dependency
- Query parser adds a new module to maintain
- Two-stage retrieval is more complex to debug than single-stage

### Neutral
- ADR-0081 (linear fusion) remains the Stage 1 architecture. This ADR adds Stage 2 on top.
- The 0.7/0.3 fusion weights become less critical — the cross-encoder corrects retrieval-stage ranking errors.

## References

- [Cross-Encoders for Re-Ranking (SBERT docs)](https://www.sbert.net/examples/applications/cross-encoder/README.html)
- [MS MARCO cross-encoder models](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2)
- [Elasticsearch: The Re-Ranking Revolution](https://www.elastic.co/search-labs/blog/elasticsearch-reranking)
- ADR-0079: Orama native filtering
- ADR-0081: Independent retrievers with linear fusion
