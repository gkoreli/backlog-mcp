# 0038. Comprehensive Search Capability

**Date**: 2026-01-31
**Status**: Accepted
**Backlog Items**: TASK-0104, TASK-0141, TASK-0142, TASK-0145, TASK-0146, TASK-0147

## Context

As the backlog grows, finding specific tasks becomes difficult. Users need to search across all task content with fuzzy matching, typo tolerance, and relevance ranking.

### Requirements

1. Full-text search across all task fields
2. Fuzzy matching (typo tolerance)
3. Relevance ranking (title matches > description matches)
4. Filter compatibility (search + status/type/epic filters)
5. Future RAG/vector search path without library swaps
6. Zero vendor lock-in via abstraction layer

### Research Findings (TASK-0141)

Evaluated 6 JS search libraries (see research artifact):
- **MiniSearch**: Good but no RAG path
- **Orama**: Full-text + vector + RAG, native TypeScript, zero deps ✅ Selected
- **FlexSearch**: TypeScript issues, stale maintenance
- **Fuse.js**: Fuzzy-only, no indexing
- **Lunr.js**: Dated, no active development
- **DIY**: 1500+ lines, weeks of work

## Decision

**Selected**: SearchService abstraction with Orama backend

### Architecture (Final)

```
┌─────────────────────────────────────────────────────────┐
│                    BacklogService                        │
│  (orchestrates storage + search, exposed to MCP tools)  │
└─────────────┬─────────────────────────┬─────────────────┘
              │                         │
┌─────────────▼─────────────┐ ┌─────────▼─────────────────┐
│      TaskStorage          │ │      SearchService        │
│  (pure file I/O)          │ │  (pure search + persist)  │
│  - read/write markdown    │ │  - index/search/persist   │
│  - no search knowledge    │ │  - configured via options │
└───────────────────────────┘ └───────────────────────────┘
```

### SearchService Interface

```typescript
interface SearchService {
  index(tasks: Task[]): Promise<void>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  addDocument(task: Task): Promise<void>;
  removeDocument(id: string): Promise<void>;
  updateDocument(task: Task): Promise<void>;
}

interface SearchOptions {
  filters?: { status?: Status[]; type?: TaskType; epic_id?: string };
  limit?: number;
  boost?: Record<string, number>;
}

interface SearchResult {
  id: string;
  score: number;
  task: Task;
}
```

### Why Orama

| Requirement | Orama Capability |
|-------------|------------------|
| Fuzzy search | ✅ Built-in typo tolerance |
| Prefix search | ✅ "auth" → "authentication" |
| Field boosting | ✅ title: 2x weight |
| Relevance ranking | ✅ BM25 algorithm |
| TypeScript | ✅ Native (written in TS) |
| Zero dependencies | ✅ |
| Bundle size | ~2KB |
| Vector search | ✅ Built-in |
| RAG pipeline (future) | ✅ Built-in |
| License | Apache 2.0 |

### Production Proof

- Deno Documentation: 5,856 docs indexed
- Framework plugins: Docusaurus, VitePress, Astro
- GitHub: 10.1k stars, 106 contributors

## Implementation Summary

All phases complete. Total: 156 tests passing.

| Phase | Description | Status | Task |
|-------|-------------|--------|------|
| 1 | SearchService Foundation | ✅ Complete | TASK-0142 |
| 2 | Integration & Persistence | ✅ Complete | TASK-0142 |
| 2.5 | Architecture Decoupling | ✅ Complete | TASK-0145 |
| 3 | Hybrid Search (BM25 + Vector) | ✅ Complete | TASK-0146 |
| 3.5 | Hyphen-Aware Tokenizer | ✅ Complete | TASK-0147 |
| 4 | RAG / Context Hydration | 🔲 Future | TASK-0143 |

### Phase 1: SearchService Foundation (Complete)

**Files created:**
```
src/search/
├── types.ts              # Interface + types
├── orama-search-service.ts  # Orama implementation
└── index.ts              # Barrel export
```

**Indexed fields with boosting:**
- `title` (boost: 2.0)
- `description` (boost: 1.0)
- `evidence` (boost: 1.0)
- `blocked_reason` (boost: 1.0)
- `references` (boost: 0.5)
- `epic_id` (boost: 1.0)

### Phase 2: Integration & Persistence (Complete)

- Wired SearchService into BacklogStorage
- Replaced simple `matchesQuery` with Orama search
- Maintained backward compatibility (empty query = no search)
- Added disk persistence to `.cache/search-index.json`
- MCP tool: `backlog_list` accepts `query` parameter
- HTTP API: `/tasks` accepts `q` query parameter
- Viewer UI: search input in filter bar + spotlight search (Cmd+J)

### Phase 2.5: Architecture Decoupling (Complete) - TASK-0145

**Problem**: BacklogStorage and SearchService were tightly coupled.

**Solution**: Composition layer architecture:
- Created `TaskStorage` for pure file I/O (no search knowledge)
- Updated `SearchService` to take `{ cachePath }` config (no paths import)
- Created `BacklogService` composing both with singleton pattern

**ADR**: 0040-search-storage-decoupling.md

### Phase 3: Hybrid Search with Local Embeddings (Complete) - TASK-0146

**Goal**: Maximum search resilience without external API dependencies.

**Implementation:**
- Added `@huggingface/transformers` for local ML inference
- Created `EmbeddingService` with lazy model loading
- Default model: `Xenova/all-MiniLM-L6-v2` (~23MB, cached in `~/.cache/huggingface`)
- Enabled hybrid search mode: BM25 (exact/fuzzy) + Vector (semantic)
- Configured hybrid weights: text 0.8, vector 0.2 (prioritizes exact matches)
- Graceful fallback to BM25-only if embeddings fail

**Results:**
| Query | BM25 alone | + Vector |
|-------|------------|----------|
| "authentication" | ✅ | ✅ |
| "login" | ❌ | ✅ finds auth tasks |
| "user can't access" | ❌ | ✅ finds auth tasks |

**Trade-offs accepted:**
- First run: ~5s model download (cached after)
- Memory: +50-80MB for embedding model
- Index size: ~1.5KB per task additional

**ADR**: 0042-hybrid-search-local-embeddings.md

### Phase 3.5: Hyphen-Aware Tokenizer (Complete) - TASK-0147

**Problem**: Default Orama tokenizer kept hyphenated words as single tokens, so "first" wouldn't match "keyboard-first".

**Solution**: Custom tokenizer that expands hyphenated words while preserving originals:
- `"keyboard-first"` → `["keyboard-first", "keyboard", "first"]`

**Bonus fixes:**
- Numeric queries: `"0001"` now finds `TASK-0001`
- Short word fuzzy matching now works

**ADR**: 0041-hyphen-aware-tokenizer.md

### Phase 4: RAG / Context Hydration (Future) - TASK-0143

- `backlog_context` MCP tool for intelligent context retrieval
- HydrationService abstraction
- Graph relations (epic→task, references)
- AnswerSession for conversational RAG
- Token budgeting, prompt templates

## Consequences

**Positive:**
- Fuzzy search finds tasks despite typos
- Semantic search finds related content ("login" → "authentication")
- Relevance ranking surfaces best matches first
- Abstraction allows backend swap without code changes
- Clean architecture: TaskStorage + SearchService composed by BacklogService
- Clear path to RAG without library replacement

**Negative:**
- Additional dependencies (@orama/orama ~2KB, @huggingface/transformers ~23MB model)
- Index rebuilt on startup (fast: <100ms for 1k tasks)
- Memory overhead for embeddings (~50-80MB)

**Trade-offs Accepted:**
- In-memory index (acceptable for <10k tasks)
- Post-search filtering (simpler than Orama's enum filters)
- Local embeddings over API (offline-first, no external dependencies)

## File Structure (Final)

```
src/
├── search/
│   ├── types.ts                 # SearchService interface
│   ├── orama-search-service.ts  # Orama + hybrid search implementation
│   ├── embedding-service.ts     # Local embeddings via transformers.js
│   └── index.ts                 # Barrel export
├── storage/
│   ├── task-storage.ts          # Pure file I/O
│   ├── backlog-service.ts       # Composition layer (singleton)
│   └── schema.ts                # Task types
└── __tests__/
    ├── search.test.ts           # Unit tests
    ├── search-golden.test.ts    # Golden benchmark tests
    └── search-hybrid.test.ts    # Semantic search tests
```

## Related ADRs

- **0038** (this): Comprehensive search capability (master ADR)
- **0040**: Search storage decoupling
- **0041**: Hyphen-aware tokenizer
- **0042**: Hybrid search with local embeddings

## References

- Research artifact: `mcp://backlog/backlog-mcp-engineer/search-research-2026-01-31/artifact.md`
- Orama docs: https://docs.orama.com/
- Orama GitHub: https://github.com/oramasearch/orama
- Hugging Face Transformers.js: https://huggingface.co/docs/transformers.js
