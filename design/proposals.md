# Proposals: CamelCase Compound Word Search

## Proposal A: Tokenizer-Level CamelCase Expansion

**Approach**: Extend the existing `hyphenAwareTokenizer` to split camelCase/PascalCase words into components, preserving the compound token. Split happens BEFORE lowercasing to detect case boundaries.

**Changes**:
- `orama-search-service.ts`: Modify tokenizer to add camelCase splitting
- Add `splitCamelCase()` helper function
- Rename tokenizer to `compoundWordTokenizer` (it now handles more than hyphens)

**Token expansion example**:
```
"FeatureStore" → ["featurestore", "feature", "store"]
"getHTTPResponse" → ["gethttpresponse", "get", "http", "response"]
"keyboard-first" → ["keyboard-first", "keyboard", "first"]  (unchanged)
```

**Pros**:
- Symmetric: same tokenizer for indexing and querying
- Follows existing pattern (hyphen expansion)
- Minimal code change (~15 lines)
- Works for all camelCase patterns automatically
- No index schema changes

**Cons**:
- Increases token count per document (more index entries)
- Requires index cache invalidation
- Aggressive splitting on acronyms (e.g., "OAuth2" → ["oauth2", "o", "auth2"])

**Risk**: Low. Additive change — only adds tokens, never removes them.

---

## Proposal B: Query-Time Expansion (Pre-processing)

**Approach**: Instead of changing the tokenizer, pre-process the search query to generate additional query variants. When user searches "feature store", also search for "featurestore" (concatenated). When user searches "featurestore", also search for "feature store" (camelCase-split).

**Changes**:
- `orama-search-service.ts`: Add query expansion in `search()`, `searchAll()`, `searchResources()`
- Run multiple Orama queries and merge/deduplicate results

**Query expansion example**:
```
"feature store" → also try "featurestore"
"featurestore" → also try "feature store" (but can't detect boundaries without case info)
```

**Pros**:
- No index changes needed
- No cache invalidation
- Targeted — only affects queries, not index size

**Cons**:
- Asymmetric: query expansion without index expansion means only one direction works
- Can't split "featurestore" (lowercase, no case boundaries) back into components
- Multiple Orama queries per search = performance cost
- Complex merging/deduplication logic
- Doesn't solve the general case — only works for space-separated → concatenated

**Risk**: Medium. Asymmetric approach creates edge cases.

---

## Proposal C: Index-Time Text Pre-processing

**Approach**: Before indexing, pre-process document text to insert spaces at camelCase boundaries. "FeatureStore migration" becomes "FeatureStore Feature Store migration" in the indexed text. Tokenizer stays unchanged.

**Changes**:
- `orama-search-service.ts`: Modify `taskToDoc()` and `resourceToDoc()` to expand camelCase in title/description fields before indexing
- Add `expandCamelCase(text)` helper that inserts space-separated versions alongside originals

**Pre-processing example**:
```
title: "Create YavapaiMFE ownership transfer"
→ indexed as: "Create YavapaiMFE Yavapai MFE ownership transfer"
```

**Pros**:
- Tokenizer unchanged (less risk)
- Only affects index, not queries
- Can be selective about which fields to expand

**Cons**:
- Asymmetric: index has expanded text, queries don't
- Searching "YavapaiMFE" as a query won't get split, but the index has both forms so it still works
- Bloats indexed text (duplicated content)
- Doesn't help when user types a camelCase query that needs splitting
- More complex — need to handle text expansion carefully to not break markdown/formatting
- Requires index cache invalidation (same as A)

**Risk**: Medium. Text manipulation before indexing is fragile.
