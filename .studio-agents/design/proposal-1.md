# Proposal 1: Delete Re-ranking, Trust Orama BM25

<name>Delete Shadow Scoring</name>
<approach>Remove rerankWithSignals/normalizeScores entirely, use raw Orama BM25 scores with tuned field boosts, keep hybrid mode.</approach>
<timehorizon>[SHORT-TERM]</timehorizon>
<effort>[LOW]</effort>

<differs>This proposal keeps Orama's hybrid mode and doesn't introduce independent retrievers or fusion. It simply removes the shadow scoring system and trusts Orama's native BM25 + field boosts to produce correct rankings. The hypothesis: most of our ranking problems come from the re-ranking layer, not from Orama itself.</differs>

## What Changes

1. Delete `rerankWithSignals()`, `normalizeScores()`, `getRecencyMultiplier()`
2. In `search()`, `searchAll()`, `searchResources()` — return Orama's raw scores directly
3. Tune `boost: { title: 5, id: 10 }` values if needed (reduce title boost to 2-3)
4. Keep `mode: 'hybrid'` with current `hybridWeights: { text: 0.8, vector: 0.2 }`
5. No file decomposition — monolith stays

## What Stays

Everything except the scoring functions. ~100 lines deleted, file drops to ~750 lines.

## Evaluation

### Product design
Partially aligned. Removes the double-boosting problem but doesn't give us control over fusion. We're still at the mercy of Orama's internal hybrid mode — a black box we can't inspect or tune per-query.

### Architecture
Simpler (fewer moving parts) but doesn't address the monolith or the fundamental lack of fusion control. We'd still be unable to debug "why did this rank here?" beyond "Orama said so."

### Backward compatibility
No breaking changes. Same API surface.

### Performance
Slightly faster — removes the re-ranking pass. Negligible in practice (<1ms).

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | ~30 minutes. Delete functions, remove calls, adjust boosts. |
| Risk | 3 | Unknown: Orama's raw hybrid scores may produce different ranking problems we haven't seen yet. No golden test suite to catch regressions. |
| Testability | 2 | Scoring is inside Orama's black box — can't unit test fusion behavior. Can only integration test with full index. |
| Future flexibility | 2 | Still locked into Orama's hybrid mode. Adding new scoring signals means re-creating the shadow system we just deleted. |
| Operational complexity | 5 | Less code = less to maintain. |
| Blast radius | 3 | Every search query affected. Without position-aware golden tests, regressions are invisible. |

## Pros
- Fastest to implement
- Removes the double-boosting problem immediately
- Less code to maintain

## Cons
- Doesn't solve the "feature store" problem if Orama's internal fusion still ranks it wrong (likely — the 5x title boost in OR mode is the primary driver)
- No fusion control — can't tune BM25 vs vector weights independently
- No debuggability — can't inspect why Orama ranked something
- Monolith stays at 750 lines
- Scoring can't be unit tested
- If we need scoring signals later (recency, type boost), we'd rebuild the shadow system
