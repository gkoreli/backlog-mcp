# Design Proposals: Orama Best Practices Alignment

## Proposal A: Minimal — Fix threshold + disable sort indexes

Only fix the two highest-impact issues with minimal code changes.

**Changes:**
1. Add `threshold: 0` to all search calls (AND mode)
2. Add `sort: { enabled: false }` to `create()` call
3. Bump INDEX_VERSION to 4

**Pros:** Smallest diff, lowest risk, fixes the biggest search quality issue
**Cons:** Leaves JS sorting hack, no facets, no DRY cleanup, doesn't set up for long-term

## Proposal B: Full Alignment — threshold + schema + sortBy + facets + DRY

Comprehensive alignment with Orama best practices. Refactor search into a single code path.

**Changes:**
1. Add `threshold: 0` to all search calls
2. Add `updated_at` to schema as `string` (for native sortBy)
3. Use Orama native `sortBy` for "recent" mode, remove JS sort
4. Add facets for enum fields, expose via SearchOptions
5. Extract common search logic into a single private `_search()` method (DRY)
6. Use `unsortableProperties` for fields we don't sort on
7. Bump INDEX_VERSION to 4

**Pros:** Clean architecture, DRY, uses Orama as intended, facets for free
**Cons:** Larger diff, more testing needed, schema change

## Proposal C: Adaptive — preflight + dynamic threshold + full alignment

Like Proposal B but with adaptive threshold using Orama's preflight feature.

**Changes:**
Everything in Proposal B, plus:
1. Run `preflight: true` first to get result count
2. If count < 5, relax threshold to 0.5 (partial OR)
3. If count >= 5, keep threshold at 0 (strict AND)

**Pros:** Best search quality — handles both broad and narrow queries
**Cons:** Two Orama calls per search (preflight + actual), added complexity, harder to reason about

## Evaluation Rubric

| Criterion (weight) | A: Minimal | B: Full | C: Adaptive |
|---|---|---|---|
| Search quality (30%) | 8 — AND mode fixes noise | 8 — same | 9 — handles edge cases |
| Code quality/DRY (25%) | 3 — leaves duplication | 9 — single code path | 9 — same as B |
| Long-term maintainability (20%) | 4 — partial fix | 9 — aligned with Orama | 7 — preflight adds complexity |
| Risk/complexity (15%) | 9 — tiny diff | 7 — medium diff | 5 — two-call pattern |
| Performance (10%) | 8 — less memory | 8 — native sort | 6 — double search calls |
| **Weighted Total** | **6.1** | **8.3** | **7.5** |

## Decision

**Proposal B: Full Alignment.** It scores highest because it fixes all identified issues, eliminates code duplication, and aligns with Orama's intended usage patterns — all without the complexity of adaptive threshold. If we later need adaptive threshold, it's easy to add on top of B's clean architecture.
