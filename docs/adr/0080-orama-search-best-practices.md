# ADR-0080: Orama Search Best Practices Alignment

**Status**: Accepted  
**Date**: 2026-02-16  
**Supersedes**: None (extends ADR-0079)  
**Related**: ADR-0079 (native filtering), ADR-0072 (re-ranking pipeline), ADR-0073 (server-side snippets)

## Context

An audit of our Orama integration against the [official Orama docs](https://github.com/oramasearch/docs/tree/main/content/docs/orama-js/search) revealed gaps where we work around Orama instead of using it properly.

### Problem 1: threshold not set → noisy OR-mode results

Orama's `threshold` parameter ([threshold.mdx](https://github.com/oramasearch/docs/blob/main/content/docs/orama-js/search/threshold.mdx)):

> "By default, Orama sets the threshold to `1`. This means that all the results will be returned."
> "Setting the threshold to `0`: only the document containing the keywords will be returned."

- `threshold: 1` (default) = return ALL results matching ANY term (OR mode)
- `threshold: 0` = return ONLY results matching ALL terms (AND mode)

We never set `threshold`, so a query like "blocked deployment" returns every document matching "blocked" OR "deployment". Our re-ranking pipeline (ADR-0072) masks this by pushing relevant results up, but the underlying result set is bloated.

### Problem 2: Manual JS sorting instead of native `sortBy`

Orama provides native sorting ([sorting.mdx](https://github.com/oramasearch/docs/blob/main/content/docs/orama-js/search/sorting.mdx)):

```javascript
search(db, { term: "query", sortBy: { property: "updated_at", order: "DESC" } });
```

Our `searchAll` "recent" mode does manual JS post-processing:
```javascript
hits.sort((a, b) => bDate.localeCompare(aDate));
```
This exists because `updated_at` isn't in our schema.

### Problem 3: Wasted memory on unused sort indexes

Orama docs ([sorting.mdx](https://github.com/oramasearch/docs/blob/main/content/docs/orama-js/search/sorting.mdx)):

> "By default, Orama allows the sort on all properties defined in the schema. This creates an in-memory sort index for each property."

We never use `sortBy`, so every property has a sort index we never touch. Orama offers `unsortableProperties` to exclude specific fields.

### Problem 4: No facets for enum fields

Orama provides native facets ([facets.mdx](https://github.com/oramasearch/docs/blob/main/content/docs/orama-js/search/facets.mdx)):

> Enum facets require zero config — just `facets: { status: {} }`.

We don't use facets. The web viewer computes status/type counts separately.

### Problem 5: DRY violation — three search methods with identical structure

`search()`, `searchResources()`, and `searchAll()` each duplicate ~70 lines of identical logic: guard checks, hybrid detection, Orama search param construction, hit mapping, re-ranking, slicing.

## Decision

### Change 1: threshold — keep default, document why

Testing confirmed that `threshold: 0` with `tolerance: 1` produces unexpected ranking behavior in Orama v3.1.18 — the interaction between fuzzy matching and threshold is not well-defined. The default `threshold: 1` with our re-ranking pipeline (ADR-0072) produces correct results across all 749 tests. We keep the default and rely on re-ranking for relevance quality.

### Change 2: Add `updated_at` to schema, use native `sortBy`

Add `updated_at: 'string'` to the schema. Use Orama's native `sortBy: { property: 'updated_at', order: 'DESC' }` for "recent" mode. Remove manual JS sorting.

### Change 3: Memory optimization with `unsortableProperties`

Mark all properties except `updated_at` as unsortable to avoid creating unused sort indexes.

### Change 4: Add facets support

Pass `facets: { status: {}, type: {}, epic_id: {} }` to search calls. Expose facet results through `SearchOptions` and return types so consumers (web viewer, MCP tools) can use them.

### Change 5: Extract common search logic (DRY)

Consolidate the three search methods into a single private `_executeSearch()` that handles: guard checks, hybrid detection, Orama param construction, and the raw Orama `search()` call. Public methods become thin wrappers that configure options and map results.

### Change 6: Bump INDEX_VERSION to 4

Force rebuild of cached indexes to pick up the new `updated_at` field.

## Consequences

- Search results unchanged for "relevant" mode — re-ranking pipeline (ADR-0072) continues to handle relevance
- threshold left at default (1) — testing showed threshold=0 + tolerance=1 produces unexpected ranking in Orama v3.1.18
- "Recent" sort uses Orama's optimized sort index instead of JS post-processing
- Memory usage reduced by eliminating unused sort indexes
- Facet counts available for free on every search call
- Three search methods reduced to thin wrappers over shared logic
- `INDEX_VERSION` 3→4 forces one-time cache rebuild
- `taskToDoc` must now include `updated_at` field
- Re-ranking pipeline (ADR-0072) continues unchanged — it operates on the (now tighter) result set
