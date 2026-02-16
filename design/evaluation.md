# Evaluation: CamelCase Compound Word Search

## Rubric

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Correctness | 30% | Solves the problem for all camelCase patterns |
| Simplicity | 25% | Minimal code change, easy to understand |
| Symmetry | 20% | Works for both index and query directions |
| Risk | 15% | Likelihood of breaking existing behavior |
| Performance | 10% | Impact on search speed and index size |

## Scoring (1-5, 5 = best)

| Criterion | Weight | A: Tokenizer | B: Query Expansion | C: Index Pre-process |
|-----------|--------|:---:|:---:|:---:|
| Correctness | 30% | 5 | 3 | 4 |
| Simplicity | 25% | 5 | 2 | 3 |
| Symmetry | 20% | 5 | 2 | 3 |
| Risk | 15% | 4 | 3 | 3 |
| Performance | 10% | 4 | 2 | 3 |
| **Weighted** | | **4.75** | **2.45** | **3.30** |

## Rationale

**Proposal A wins decisively** because:

1. **Correctness (5/5)**: Handles ALL camelCase patterns at the tokenization layer. Both "FeatureStore" in documents and "FeatureStore" in queries get split identically. The compound token is preserved for exact matches.

2. **Simplicity (5/5)**: ~15 lines of code change in one function. Follows the exact same pattern as existing hyphen expansion. No new query logic, no text pre-processing, no merging.

3. **Symmetry (5/5)**: Same tokenizer processes both documents and queries. "FeatureStore" in a document produces ["featurestore", "feature", "store"]. "feature store" in a query produces ["feature", "store"]. Tokens match naturally.

4. **Risk (4/5)**: Additive-only change — adds tokens, never removes. Existing tests should pass. Only risk is cache invalidation (minor).

5. **Performance (4/5)**: Slightly more tokens per document, but negligible for BM25. No extra queries needed.

**Proposal B is weakest** because it's fundamentally asymmetric — can't split "featurestore" (no case info in query) and requires multiple Orama queries with complex merging.

**Proposal C is middle ground** but unnecessarily complex — manipulating document text before indexing is fragile and still requires cache invalidation.

## Decision

**Proceed with Proposal A: Tokenizer-Level CamelCase Expansion.**
