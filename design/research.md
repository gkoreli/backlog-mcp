# Research: CamelCase Compound Word Search (TASK-0296)

## Problem Statement

Searching "feature store" doesn't find TASK-0273, which contains "FeatureStore" (PascalCase) and `featurestore` (MFE ID) throughout its description. Only "feature store mfe transfer" finds it — as 2nd result.

## Codebase Analysis

### Current Tokenizer (`orama-search-service.ts:58-69`)

```typescript
const hyphenAwareTokenizer: Tokenizer = {
  tokenize(input: string): string[] {
    const tokens = input.toLowerCase().split(/[^a-z0-9'-]+/gi).filter(Boolean);
    // ... expands hyphens only
  },
};
```

**Critical flaw**: Lowercases BEFORE splitting, destroying camelCase boundaries.

### Token Flow — Current Behavior

| Input | Tokens Produced | Problem |
|-------|----------------|---------|
| `"FeatureStore"` (indexed) | `["featurestore"]` | Single compound token |
| `"feature store"` (query) | `["feature", "store"]` | Neither matches `"featurestore"` |
| `"keyboard-first"` (indexed) | `["keyboard-first", "keyboard", "first"]` | ✅ Hyphens work |

### Why Orama Can't Find It

1. BM25 does exact token matching (with tolerance=1 for fuzzy)
2. `"feature"` (7 chars) vs `"featurestore"` (12 chars) = edit distance 5 → exceeds tolerance
3. Document is invisible to the search engine for this query

### Snippet Generation (Secondary Issue)

`generateSnippetFromFields` uses `valueLower.includes(w)` — substring matching. "feature" IS a substring of "featurestore", so snippets would work IF Orama found the document. But it doesn't.

### Re-ranking (Not the Issue)

The `rerankWithSignals` function operates on results Orama already found. Since Orama never returns TASK-0273, re-ranking can't help.

### Index Caching

Orama index is persisted to disk (`persistToDisk`/`loadFromDisk`). Any tokenizer change requires cache invalidation — stale indexes will have old tokenization.

## Existing Patterns

The hyphen expansion pattern is the exact precedent:
- `"keyboard-first"` → `["keyboard-first", "keyboard", "first"]`
- Preserves compound + adds components

CamelCase should follow the same pattern:
- `"FeatureStore"` → `["featurestore", "feature", "store"]`

## Scope of Impact

- All PascalCase/camelCase words in task titles, descriptions, evidence, references
- Common in codebase: package names (`RhinestoneMonarchYavapaiMFE`), feature flags (`featureStore`), MFE IDs
- Affects both indexing (document tokens) and querying (query tokens) symmetrically

## Constraints

- Must not break existing search behavior (hyphen expansion, fuzzy matching, ranking)
- Must handle index cache invalidation
- Tokenizer is shared between indexing and querying — changes are symmetric

<insight>The tokenizer lowercases before splitting, destroying camelCase boundaries. CamelCase compound words like "FeatureStore" become single tokens ("featurestore") that can't match space-separated query words ("feature", "store"). The fix is to split camelCase boundaries before lowercasing, mirroring the existing hyphen-expansion pattern.</insight>
