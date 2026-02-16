# Decision: CamelCase Compound Word Tokenization

## Status: Accepted

## Context

The search tokenizer lowercases input before splitting on non-alphanumeric characters, destroying camelCase/PascalCase word boundaries. "FeatureStore" becomes a single token "featurestore" that can't match query tokens "feature" and "store".

## Decision

Extend the existing tokenizer to split camelCase/PascalCase words into component tokens, preserving the compound word. This mirrors the existing hyphen-expansion pattern.

## Implementation

1. Add `splitCamelCase(word)` helper that splits on case boundaries
2. Restructure tokenizer: split on non-alphanumeric BEFORE lowercasing (to preserve case info)
3. For each token, expand camelCase parts (like hyphens are expanded)
4. Rename tokenizer to `compoundWordTokenizer`
5. Add index version to force cache rebuild

## Token Expansion

```
"FeatureStore"     → ["featurestore", "feature", "store"]
"keyboard-first"   → ["keyboard-first", "keyboard", "first"]  (unchanged)
"getHTTPResponse"  → ["gethttpresponse", "get", "http", "response"]
"feature store"    → ["feature", "store"]  (unchanged)
```

## Consequences

- All camelCase compound words become searchable by component words
- Existing hyphen expansion behavior unchanged
- Index cache must be invalidated (version bump)
- Slightly more tokens per document (negligible performance impact)
- All existing tests should pass (additive change)
