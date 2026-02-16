# Research: TASK-0302 — Independent Retrievers + Linear Fusion

## Task Summary

Replace the fragmented scoring pipeline (Orama hybrid mode → normalizeScores → rerankWithSignals) with independent BM25 + vector retrievers fused via linear combination with MinMax normalization. Simultaneously decompose the 852-line monolith `orama-search-service.ts` into cohesive modules with clean separation of concerns.

## Current Architecture Analysis

### The Monolith: orama-search-service.ts (852 lines)

10 distinct responsibilities crammed into one file:

| Responsibility | Lines | Stateful? | Depends on Orama? |
|---|---|---|---|
| Schema & type definitions | 1-55 | No | Yes (schema format) |
| Constants (TEXT_PROPERTIES, ENUM_FACETS) | 57-85 | No | Yes (field names) |
| Where clause builder | 87-95 | No | Yes (where syntax) |
| Tokenizer (splitCamelCase, compound words) | 97-140 | No | No (implements Tokenizer interface) |
| Scoring pipeline (normalize, rerank, recency) | 142-250 | No | No (pure functions on scores) |
| Snippet generation | 252-340 | No | No (pure text functions) |
| Index lifecycle (create, load, save) | 357-540 | Yes (db, caches) | Yes |
| Search execution (_executeSearch, search) | 550-624 | Yes (reads db) | Yes |
| Document CRUD (add, update, remove) | 626-670 | Yes (mutates db) | Yes |
| Resource CRUD + searchAll + searchResources | 680-852 | Yes (mutates db) | Yes |

**Key finding**: 4 of 10 responsibilities are pure stateless functions with zero Orama dependency (tokenizer, scoring, snippets, where builder). They're trapped in the monolith for no reason.

### What Gets Deleted (TASK-0302)

- `rerankWithSignals()` — shadow scoring system (lines 185-250)
- `normalizeScores()` — max-divide normalization (lines 165-172)
- `getRecencyMultiplier()` — bucketed recency (lines 148-156)
- `mode: 'hybrid'` in `_executeSearch()` — Orama's internal fusion
- The +1.5 coordination bonus bandaid

### What Gets Added

- Two independent Orama queries (BM25 default mode + vector mode)
- `minmaxNormalize()` — per-retriever MinMax normalization
- `linearFusion()` — weighted score combination
- Post-fusion modifiers (recency, epic type) — lightweight adjustments

### Consumer Surface Area

Only one consumer: `BacklogService` in `src/storage/backlog-service.ts`.

It calls:
- `search.index(tasks)` — initial indexing
- `search.search(query, options)` — task search (used by `list()` with query)
- `search.searchAll(query, options)` — unified search (MCP `backlog_search` tool + HTTP `/search`)
- `search.searchResources(query, options)` — resource-only search
- `search.addDocument/removeDocument/updateDocument` — CRUD
- `search.indexResources(resources)` — resource indexing
- `search.addResource/removeResource/updateResource` — resource CRUD
- `search.isHybridSearchActive()` — status check

The `SearchService` interface in `types.ts` only covers task operations. Resource operations are on `OramaSearchService` directly (BacklogService imports the concrete class, not the interface).

### Orama API Modes (confirmed from docs)

- Default (no mode): BM25 fulltext search — returns unbounded scores
- `mode: 'vector'`: vector-only search — returns similarity scores [0,1]
- `mode: 'hybrid'`: Orama's internal BM25+vector fusion — what we currently use, what we're replacing

All three accept the same `where`, `limit`, `boost`, `tolerance`, `facets` parameters.

### Existing Test Coverage

- `search-golden.test.ts` — golden benchmark tests, only checks `.some()` presence, not ranking position
- 749/749 tests pass across 36 test files
- No unit tests for scoring functions (they're not exported)

## Constraints

1. **SearchService interface** — must remain compatible (BacklogService is the only consumer)
2. **Graceful degradation** — when embeddings unavailable, BM25-only must work identically
3. **Compound word tokenizer** — stays, it's working correctly
4. **Snippet generation** — stays, orthogonal to scoring
5. **ADR-0079 native filtering** — `where` clause applied to both retrievers
6. **ADR-0080 native sortBy** — "recent" mode bypasses scoring entirely (uses Orama sortBy)
7. **No test modifications** — existing tests must pass without changes

<insight>
The scoring module being separate means we can write comprehensive unit tests for the fusion function WITHOUT needing an Orama instance. "Given these BM25 scores and these vector scores, does fusion produce the right ranking?" — that's impossible today because rerankWithSignals is tangled with search execution. This is the single biggest architectural win: scoring becomes a pure, independently testable function.
</insight>
