# 0038. Comprehensive Search Capability

**Date**: 2026-01-31
**Status**: Accepted
**Backlog Item**: TASK-0104, TASK-0142

## Context

As the backlog grows, finding specific tasks becomes difficult. Users need to search across all task content with fuzzy matching, typo tolerance, and relevance ranking.

### Requirements

1. Full-text search across all task fields
2. Fuzzy matching (typo tolerance)
3. Relevance ranking (title matches > description matches)
4. Filter compatibility (search + status/type/epic filters)
5. Future RAG/vector search path without library swaps
6. Zero vendor lock-in via abstraction layer

### Research Findings

Evaluated 6 JS search libraries (see research artifact):
- **MiniSearch**: Good but no RAG path
- **Orama**: Full-text + vector + RAG, native TypeScript, zero deps
- **FlexSearch**: TypeScript issues, stale maintenance
- **Fuse.js**: Fuzzy-only, no indexing
- **Lunr.js**: Dated, no active development
- **DIY**: 1500+ lines, weeks of work

## Decision

**Selected**: SearchService abstraction with Orama backend

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  Consumers                       │
│  (BacklogStorage, MCP tools, HTTP routes)       │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│              SearchService Interface             │
│  index(), search(), add/remove/updateDocument() │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│            OramaSearchService                    │
│  (can swap to MiniSearch, Meilisearch, etc.)    │
└─────────────────────────────────────────────────┘
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
| Vector search (future) | ✅ Built-in |
| RAG pipeline (future) | ✅ Built-in |
| License | Apache 2.0 |

### Production Proof

- Deno Documentation: 5,856 docs indexed
- Framework plugins: Docusaurus, VitePress, Astro
- GitHub: 10.1k stars, 106 contributors

## Implementation

### Phase 1: SearchService Foundation (Complete)

```
src/search/
├── types.ts              # Interface + types
├── orama-search-service.ts  # Orama implementation
└── index.ts              # Barrel export
```

Indexed fields with boosting:
- `title` (boost: 2.0)
- `description` (boost: 1.0)
- `evidence` (boost: 1.0)
- `blocked_reason` (boost: 1.0)
- `references` (boost: 0.5)
- `epic_id` (boost: 1.0)

### Phase 2: Integration (Complete)

- Wire SearchService into BacklogStorage
- Replace simple `matchesQuery` with Orama search
- Maintain backward compatibility (empty query = no search)
- Disk persistence for search index
- Architecture decoupling (TaskStorage + SearchService composed by BacklogService)

### Phase 3: Hybrid Search with Local Embeddings (CRITICAL - Next)

**Goal**: Maximum search resilience without external API dependencies.

**Implementation**:
- Add `@orama/plugin-embeddings` for local vector generation
- Add `@xenova/transformers` (transformers.js) for local ML inference
- Default model: `all-MiniLM-L6-v2` (~23MB, good quality/size balance)
- Enable hybrid search mode: BM25 (exact/fuzzy) + Vector (semantic)
- Configure hybrid weights (e.g., text: 0.7, vector: 0.3)

**Why Hybrid**:
| Query | BM25 alone | + Vector |
|-------|------------|----------|
| "authentication" | ✅ | ✅ |
| "login" | ❌ | ✅ finds auth tasks |
| "user can't access" | ❌ | ✅ finds auth tasks |
| "blocked deployment" | partial | ✅ finds CI/CD tasks |

**Trade-offs**:
- First run: ~5s model download (cached after)
- Memory: +50-80MB for embedding model
- Index time: ~10ms/task (embedding generation)
- Search latency: ~20-30ms (still fast)

**Alternative local models for future benchmarking**:
- `bge-small-en-v1.5` - slightly better quality, same size
- `nomic-embed-text-v1` - newer, good performance
- `all-mpnet-base-v2` - higher quality, larger (~420MB)

**Backlog Item**: TASK-0146

### Phase 4: RAG / Context Hydration (Future)

- Add HydrationService abstraction
- Implement AnswerSession for conversational RAG
- Token budgeting, prompt templates

## Consequences

**Positive**:
- Fuzzy search finds tasks despite typos
- Relevance ranking surfaces best matches first
- Abstraction allows backend swap without code changes
- Clear path to RAG without library replacement

**Negative**:
- Additional dependency (@orama/orama ~2KB)
- Index must be rebuilt on startup
- Memory overhead for index (~100KB for 1k tasks)

**Trade-offs Accepted**:
- In-memory index (acceptable for <10k tasks)
- Post-search filtering (simpler than Orama's enum filters)

## References

- Research artifact: `mcp://backlog/backlog-mcp-engineer/search-research-2026-01-31/artifact.md`
- Orama docs: https://docs.orama.com/
- Orama GitHub: https://github.com/oramasearch/orama
