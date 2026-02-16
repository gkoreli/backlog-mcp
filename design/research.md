# Research: Orama Search Best Practices Alignment

## Task
TASK-0299: Align our Orama integration with official best practices — threshold, native sortBy, facets, memory optimization.

## Current Architecture

### Search Flow
```
BacklogService.list(query) → OramaSearchService.search()
BacklogService.searchUnified() → OramaSearchService.searchAll()
                                  OramaSearchService.searchResources()
```

All three search methods follow the same pattern:
1. Build `where` clause from filters (ADR-0079) ✅
2. Call Orama `search()` with `term`, `properties`, `boost`, `tolerance: 1`, `where`
3. Map hits to domain objects
4. Re-rank with `rerankWithSignals()` (ADR-0072)
5. Slice to `limit`

### Schema (current)
```typescript
{ id: 'string', title: 'string', description: 'string',
  status: 'enum', type: 'enum', epic_id: 'enum',
  evidence: 'string', blocked_reason: 'string', references: 'string', path: 'string' }
```
Missing: `updated_at` (needed for native sort).

### SearchOptions interface
```typescript
interface SearchOptions {
  filters?: SearchFilters;
  limit?: number;
  boost?: Record<string, number>;
  docTypes?: SearchableType[];
  sort?: 'relevant' | 'recent';
}
```
Missing: `threshold`, `offset`, `facets`.

## Findings from Orama Official Docs

### 1. threshold (threshold.mdx) — CRITICAL
- `threshold: 1` (DEFAULT) = return ALL results matching ANY term (OR mode)
- `threshold: 0` = return ONLY results matching ALL terms (AND mode)
- Values between 0-1 = proportional
- **We never set threshold** → running in OR mode → "blocked deployment" returns all docs with "blocked" OR "deployment"
- Orama also offers `preflight: true` for adaptive threshold (count-only query)

### 2. sortBy (sorting.mdx) — MEDIUM
- Native property-based sorting: `sortBy: { property: 'updated_at', order: 'DESC' }`
- Custom sort function: `sortBy: (a, b) => a[2].year - b[2].year`
- Memory optimization: `unsortableProperties` or `sort: { enabled: false }`
- **We do manual JS sort** for "recent" mode because `updated_at` isn't in schema

### 3. facets (facets.mdx) — MEDIUM
- Enum facets require zero config: `facets: { status: {} }`
- Returns `{ count: N, values: { 'open': 5, 'done': 12 } }`
- **We don't use facets** — web viewer computes counts separately

### 4. Memory (sorting.mdx) — LOW
- Sort indexes created for ALL schema properties by default
- We never use sortBy → wasting memory on sort indexes
- Fix: `sort: { enabled: false }` until we add native sortBy

### 5. Alternative algorithms (changing-default-search-algorithm.mdx) — INFORMATIONAL
- QPS (proximity-focused) and PT15 (position-focused) available since v3
- BM25 is fine for our use case — general-purpose task search

### 6. offset (index.mdx) — LOW
- Orama supports `offset` for pagination
- Default limit is 10 (we override to 20)
- Agents don't paginate, but HTTP API could benefit

## Code Patterns Observed

### DRY violation: Three search methods with identical structure
`search()`, `searchResources()`, and `searchAll()` all:
1. Check `!this.db` / `!query.trim()`
2. Determine `canUseHybrid`
3. Build search params (term, properties, mode, vector, limit, boost, tolerance, where)
4. Call Orama `search()`
5. Map hits to domain objects
6. Re-rank with `rerankWithSignals()`
7. Slice to limit

This is ~70 lines duplicated 3 times. The only differences are:
- `where` clause construction (type filter for resources)
- Hit mapping (task vs resource vs unified)
- Boost defaults

### rerankWithSignals complexity
The re-ranking pipeline does:
1. Normalize scores to 0-1 (divide by max)
2. Title word coverage (prefix-aware): up to 1.5x
3. Title starts-with-query: +0.3
4. Epic with title match: ×1.1
5. Recency: ×1.0-1.15

With proper threshold (AND mode), the result set will be much tighter, reducing the need for aggressive re-ranking. Recency can move to native sortBy.

<insight>The threshold gap is the root cause of multiple downstream hacks. Running in OR mode produces noisy results, which forced us to build an elaborate re-ranking pipeline to compensate. Fixing threshold to AND mode (or adaptive) will tighten the result set, making re-ranking simpler and results more predictable. This is the single highest-leverage change.</insight>
