# Decision: TASK-0302

## Pre-Decision Questions

### Which proposal would I REGRET not doing in 6 months?

Proposal 2. In 6 months, if we're still on Proposal 1 (raw Orama scores), we'll have hit another ranking bug and be back to building a re-ranking layer — except now without the module structure to do it cleanly. If we went with Proposal 3, we'd have over-engineered interfaces for retrievers that never materialized, and the abstraction would be friction for every change.

### Argue FOR the most ambitious proposal (P3)

If it works: every future scoring signal is a plug-in. LLM re-ranker? New retriever class. User preference weighting? New modifier. A/B testing fusion strategies? Swap the FusionStrategy implementation. The pipeline is infinitely composable. For a product where search quality is the backbone of agentic engineering, this level of extensibility could compound.

### What's the REAL cost of playing it safe (P1)?

P1 doesn't actually solve the "feature store" problem. Orama's internal hybrid mode with field boosts still produces wrong rankings — we tested this. So P1 isn't "safe," it's "incomplete." We'd ship a deletion, discover rankings are still broken, and then build the fusion system anyway — but now under pressure and without the clean module structure.

## Self-Critique

### P1 Critique
- Doesn't solve the stated problem. The "feature store" ranking issue is in Orama's BM25 + field boost interaction, not just in our re-ranking layer. Deleting re-ranking removes double-boosting but doesn't fix the underlying OR-mode + title-boost dominance.
- "Trust Orama" is a bet on a black box we've already proven produces wrong results.

### P2 Critique
- The module decomposition is mechanical but adds 4 new files. Is that justified? Yes — each file has a clear single responsibility, and the scoring module being separate is the key architectural win (testability).
- MinMax has edge cases: single result (max=min, division by zero), all same score. These are solvable with guards but need explicit handling.
- The weights (0.7/0.3) are starting values. Without a golden test suite, we're still hand-tuning. But the architecture makes tuning possible — today it's not.

### P3 Critique
- YAGNI. We have 2 retrievers. We'll probably have 2 retrievers for the next year. The Retriever interface adds indirection for no current benefit.
- The awkward coupling: retrievers need the Orama db instance. Either they get it via constructor injection (tight coupling to Orama) or the service exposes raw query methods (leaky abstraction). Neither is clean.
- More code, more files, more directories, longer to ship. The ranking fix is urgent — agents are getting wrong context TODAY.

## Rubric Comparison

| Anchor | P1 | P2 | P3 |
|--------|----|----|-----|
| Time-to-ship | 5 | 3 | 2 |
| Risk | 3 | 4 | 3 |
| Testability | 2 | **5** | 5 |
| Future flexibility | 2 | **5** | 5 |
| Operational complexity | 5 | 4 | 3 |
| Blast radius | 3 | 3 | 3 |
| **Total** | **20** | **24** | **21** |

P2 wins on total score. P3 ties P2 on testability and flexibility but loses on time-to-ship and operational complexity. P1 is fast but doesn't solve the problem.

## Decision

<selected>2</selected>
<selectedname>Linear Fusion with Clean Modules</selectedname>

<rationale>
P2 is the sweet spot between "fix it now" and "over-engineer it." It solves both stated problems (broken scoring + monolith) with the minimum architecture needed. The scoring module is pure and testable — the single biggest win. The module decomposition is mechanical and low-risk. The fusion function is ~15 lines of well-understood math. And critically, P2's architecture is forward-compatible with P3 — if we ever need pluggable retrievers, we can extract the two hardcoded Orama queries into Retriever classes without changing the scoring module or the module structure. P2 doesn't close the door on P3; it just doesn't pay the abstraction cost upfront.
</rationale>

<assumptions>
1. Orama's default mode (BM25) and vector mode produce meaningful scores that respond correctly to MinMax normalization
2. Two Orama queries per search have negligible performance impact (<10ms total for hundreds of documents)
3. Linear fusion with MinMax is sufficient for our ranking needs — we don't need RRF's rank-based approach
4. The golden test suite (to be built) will catch ranking regressions before they reach users
5. Post-fusion modifiers (recency, epic type) are small enough to be simple functions, not full retrievers
</assumptions>

<tradeoffs>
1. Two Orama queries per search instead of one — negligible perf cost but more code in the search path
2. 4 new files — more files to navigate, but each is small and focused
3. Weights (0.7/0.3) need tuning — starting values, not proven optimal. But the architecture makes tuning possible.
4. MinMax edge cases need explicit handling (single result, all same score)
5. Not as extensible as P3's pluggable pipeline — but extensible enough for foreseeable needs
</tradeoffs>
