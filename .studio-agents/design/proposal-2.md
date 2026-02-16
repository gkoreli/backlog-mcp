# Proposal 2: Independent Retrievers + Linear Fusion + Module Decomposition

<name>Linear Fusion with Clean Modules</name>
<approach>Run BM25 and vector as independent Orama queries, fuse with MinMax + weighted linear combination in a separate scoring module, decompose the monolith into 5 focused files.</approach>
<timehorizon>[MEDIUM-TERM]</timehorizon>
<effort>[MEDIUM]</effort>

<differs>vs Proposal 1: Completely different data flow. Proposal 1 keeps Orama's internal hybrid fusion (single query, black box scores). This proposal runs TWO independent Orama queries and owns the fusion function — different module boundaries (5 files vs 1), different data flow (two result sets → merge → score vs single result set → pass through), different ownership model (we own scoring, not Orama).</differs>

## Architecture

```
Query
  ├─→ BM25 Retriever (Orama default mode, no `mode` param)
  │     → raw BM25 scores
  │     → MinMax normalize to [0,1]
  │
  ├─→ Vector Retriever (Orama `mode: 'vector'`)  [if embeddings available]
  │     → raw similarity scores
  │     → MinMax normalize to [0,1]
  │
  └─→ Linear Fusion
        score = W_TEXT * norm_bm25 + W_VECTOR * norm_vector
        → Post-fusion modifiers (recency decay, epic boost)
        → Final ranked results
```

## File Structure

```
src/search/
├── types.ts                  # EXISTING: SearchService interface, result types
├── orama-schema.ts           # NEW: OramaDoc types, schema, constants, buildWhereClause
├── tokenizer.ts              # NEW: splitCamelCase, compoundWordTokenizer
├── snippets.ts               # NEW: generateTaskSnippet, generateResourceSnippet
├── scoring.ts                # NEW: minmaxNormalize, linearFusion, postFusionModifiers
├── embedding-service.ts      # EXISTING: unchanged
├── orama-search-service.ts   # SLIMMED: index lifecycle + CRUD + search execution
└── index.ts                  # EXISTING: updated re-exports
```

### Module Responsibilities

**`orama-schema.ts` (~60 lines)**
- `OramaDoc`, `OramaDocWithEmbeddings` types
- `schema`, `schemaWithEmbeddings` constants
- `INDEX_VERSION`
- `TEXT_PROPERTIES`, `UNSORTABLE_PROPERTIES`, `ENUM_FACETS`
- `buildWhereClause()` — pure function

**`tokenizer.ts` (~40 lines)**
- `splitCamelCase()` — pure function
- `compoundWordTokenizer` — Orama Tokenizer implementation

**`snippets.ts` (~90 lines)**
- `generateTaskSnippet()`, `generateResourceSnippet()`, `generateSnippetFromFields()`
- `SNIPPET_WINDOW` constant
- All pure functions, zero Orama dependency

**`scoring.ts` (~60 lines)** — the core new module
```typescript
/** MinMax normalize scores to [0,1] per-retriever. */
export function minmaxNormalize(hits: ScoredHit[]): NormalizedHit[]

/** Linear fusion: weighted combination of normalized retriever scores. */
export function linearFusion(
  bm25Hits: NormalizedHit[],
  vectorHits: NormalizedHit[],
  weights: { text: number; vector: number }
): FusedHit[]

/** Lightweight post-fusion score adjustments. */
export function applyPostFusionModifiers(hits: FusedHit[]): FusedHit[]
```

**`orama-search-service.ts` (~400 lines)** — slimmed adapter
- Constructor, index lifecycle (create, load, save)
- Document/resource CRUD (add, update, remove)
- Embedding management (lazy init, fallback)
- Search execution: runs two Orama queries, delegates to `scoring.ts` for fusion
- `_executeBM25Search()` and `_executeVectorSearch()` replace `_executeSearch()`

## Key Design Decisions

1. **Two query methods instead of one**: `_executeBM25Search()` runs Orama in default mode (BM25 fulltext). `_executeVectorSearch()` runs Orama in `mode: 'vector'`. Each returns raw Orama results. The fusion happens after, in `scoring.ts`.

2. **MinMax per-retriever, not global**: BM25 scores are unbounded (can be 0-100+). Vector scores are [0,1]. MinMax normalizes each to [0,1] independently, preserving relative differences within each retriever.

3. **Weights start at 0.7/0.3**: Text-heavy for a backlog system where exact term matches matter more than semantic similarity. Tunable via golden tests.

4. **Post-fusion modifiers are additive, not multiplicative**: Small adjustments (+0.05 for recency, +0.03 for epic type) on a [0,1] fused score. They nudge, not override.

5. **Graceful degradation**: When embeddings unavailable, `_executeVectorSearch()` returns empty array. `linearFusion()` with empty vector hits degenerates to `minmax(bm25)` — pure BM25 ranking. No special-casing needed.

## What Gets Deleted

- `rerankWithSignals()` — entire function
- `normalizeScores()` — replaced by `minmaxNormalize()` in scoring.ts
- `getRecencyMultiplier()` — replaced by post-fusion modifier
- `mode: 'hybrid'` — replaced by two separate queries
- `hybridWeights: { text: 0.8, vector: 0.2 }` — replaced by fusion weights
- The +1.5 coordination bonus bandaid

## Evaluation

### Product design
Fully aligned with TASK-0302 vision. Agents get correct rankings. The architecture is the industry standard (Elasticsearch, Azure AI Search, OpenSearch all use independent retrievers + fusion).

### Architecture
Clean separation of concerns. Scoring is pure and testable. Each file has one responsibility. Adding a new retriever (e.g., recency) = adding a third query + updating fusion weights. Adding a new modifier = one function in scoring.ts.

### Backward compatibility
Zero breaking changes. `SearchService` interface unchanged. `BacklogService` calls the same methods. Only internal implementation changes.

### Performance
Two Orama queries instead of one. For a backlog with hundreds of tasks, each query takes <5ms. Total overhead: <10ms. Negligible. MinMax + fusion is O(n) where n = number of results — microseconds.

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 3 | Half day. Module extraction is mechanical but needs care. Fusion function is ~15 lines. |
| Risk | 4 | Low risk — using Orama's stable public API. Fusion is well-understood math. Main risk: untested edge cases in MinMax (single result, all same score). |
| Testability | 5 | Scoring module is pure functions — unit testable without Orama. Can test "given these BM25 scores and vector scores, does fusion produce rank X?" |
| Future flexibility | 5 | Adding retrievers = adding queries. Swapping fusion function (e.g., to RRF) = changing one function. Weights tunable via golden tests. |
| Operational complexity | 4 | More files to navigate, but each is small and focused. Net reduction in cognitive load. |
| Blast radius | 3 | Every search query affected. Mitigated by golden test suite + before/after comparison. |

## Pros
- Correct rankings — BM25 and vector contribute independently, no double-boosting
- Debuggable — inspect BM25 score, vector score, fusion math separately
- Testable — scoring is pure functions
- Extensible — add retrievers or modifiers without touching fusion
- Industry-standard architecture
- Monolith decomposed into focused modules

## Cons
- More files to navigate (5 new files, though each is small)
- Two Orama queries per search (negligible perf cost)
- Needs golden test suite to validate rankings (but we need this regardless)
- MinMax normalization has edge cases (single result → division by zero, all same score → all normalize to 0)
