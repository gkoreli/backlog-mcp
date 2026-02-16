# Verification: Problem Understanding

## Dominant Causes — Complete?

Yes. The dominant cause is clear and well-evidenced: no separation between Orama's internal retrieval/fusion and our external scoring. We have a concrete reproduction (TASK-0273 at position 18) and a traced root cause chain (OR mode → 5x title boost → normalization → re-ranking amplification → zero coordination).

## Alternative Root Causes — Considered?

Two alternatives considered:

1. **Monolith structure** — made it too easy to accumulate layers. Valid contributing factor but not the root cause of bad rankings.

2. **Could we just delete rerankWithSignals and use Orama hybrid scores directly?** — Tested and rejected. Orama's hybrid mode with our field boosts still produces wrong rankings because we can't control its internal fusion or the interaction between title boost and OR mode.

One more alternative worth noting: **Could the problem be purely the 5x title boost?** If we removed `boost: { title: 5 }`, would Orama's hybrid mode produce correct rankings? Possibly for "feature store" specifically, but this would break other queries where title matches genuinely should rank higher (e.g., searching for a task by its exact title). The boost isn't wrong — the problem is that we have no way to balance it against term coverage within Orama's black box.

## "What If We're Wrong" — Articulated?

Yes. If Orama's hybrid mode is actually fine and the problem is purely our re-ranking, the fix would be simpler (just delete rerankWithSignals). But we've tested this — the problem persists without re-ranking because Orama's internal fusion is a black box we can't tune.

There's one more "what if": **What if running two separate Orama queries produces worse results than hybrid mode for some queries?** This is possible — Orama's hybrid mode may have internal optimizations we lose. Mitigation: the golden test suite will catch regressions, and we can compare before/after rankings for a broad set of queries during implementation.

<ready>YES — Problem space is well-mapped with concrete evidence, tested alternatives, and identified risks. Ready to propose solutions.</ready>
