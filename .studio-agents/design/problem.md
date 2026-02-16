# Problem Articulation: TASK-0302

## What are we solving?

<core>
Two problems that compound each other:

1. **Broken scoring architecture**: Three scoring systems stacked with no shared information — Orama's internal hybrid fusion (black box), normalizeScores (destroys magnitude), rerankWithSignals (shadow scoring that duplicates and conflicts with Orama's BM25). Each "fix" adds another layer. The result: "feature store" ranks the literal FeatureStore task at 18th.

2. **Monolith file**: 852 lines with 10 responsibilities in one file. Pure stateless functions (tokenizer, snippets, scoring) are trapped alongside stateful Orama lifecycle management. Scoring logic can't be unit tested without an Orama instance. Adding a new scoring signal requires understanding the entire file.
</core>

## Why does this problem exist?

We treated Orama as a black box. When default results weren't good enough, we bolted on external re-ranking instead of understanding the engine. Each subsequent ADR (0051, 0072) patched symptoms. The file grew because every search-related concern landed in the same place — there was never a deliberate module boundary design.

## Who is affected?

- **LLM agents** — search is the backbone of agentic engineering. Bad rankings mean agents miss context, make wrong decisions, produce worse output. When `backlog_search("feature store")` returns the wrong task, the agent works with wrong context.
- **Engineers maintaining the code** — 852 lines with interleaved concerns. Understanding why a query ranks wrong requires tracing through normalize → rerank → coordination bonus → Orama internals.

## Scope and boundaries

**In scope:**
- Replace hybrid mode + normalize + rerank with independent retrievers + linear fusion
- Decompose orama-search-service.ts into cohesive modules
- Maintain all existing public API contracts (SearchService interface, BacklogService integration)

**Out of scope:**
- Tokenizer changes (compound word tokenizer works correctly)
- Snippet generation changes (orthogonal)
- Schema changes (OramaDoc structure stays)
- Test modifications (existing 749 tests must pass as-is)

## Root Causes

<dominant>
**Dominant root cause**: No separation between "how Orama retrieves candidates" and "how we score/rank them." Orama's hybrid mode does its own internal fusion (BM25 + vector with hybridWeights), then we normalize that output and apply a completely separate scoring system on top. Two fusion steps, zero coordination.
</dominant>

<alternative>
**Alternative root cause**: The monolith structure made it too easy to add "just one more function" to the file. If scoring had been a separate module from day one, the shadow scoring system would have been more visible as a design smell — you'd see a module whose entire purpose is to redo what Orama already did.
</alternative>

<whatifwrong>
**What if our understanding is wrong?** If Orama's hybrid mode actually produces good rankings and the problem is purely in our re-ranking layer, then we could just delete rerankWithSignals and use Orama hybrid scores directly. But we tested this — Orama's hybrid mode with our field boosts still ranks "Feature: Daily Discovery Game" above TASK-0273 for "feature store" because of the 5x title boost in OR mode. The problem is structural: we can't tune Orama's internal fusion because it's a black box.
</whatifwrong>

## What has been tried before?

| Attempt | ADR/Task | Result |
|---------|----------|--------|
| Title bonus re-ranking | ADR-0051 | Created the shadow scoring system |
| Normalize-then-multiply pipeline | ADR-0072 | Formalized the shadow system, didn't fix root cause |
| Compound word tokenizer | TASK-0296 | Fixed tokenization (FeatureStore found), but ranking still broken |
| threshold=0 AND mode | TASK-0298 | Orama v3 bug — threshold + tolerance interaction breaks ranking |
| +1.5 coordination bonus | TASK-0302 bandaid | Moved TASK-0273 from 18th→5th, but hand-tuned constant on mixed additive/multiplicative pipeline |

Every attempt added a layer. None addressed the fundamental split.

## Adjacent Problems

1. **Golden test suite only checks presence, not ranking** — `search-golden.test.ts` uses `.some()` to check if a result appears, not its position. This means ranking regressions are invisible. The linear fusion work should include position-aware golden tests (Precision@K or at minimum top-N assertions).

2. **SearchService interface doesn't cover resources** — BacklogService imports the concrete `OramaSearchService` class because `SearchService` only has task methods. The module decomposition is a good time to consider whether the interface should be expanded, but this is a separate concern and shouldn't block the scoring work.

---

## ADR Draft: Problem Statement

**Title**: ADR-0081: Independent Retrievers with Linear Fusion Scoring

**Status**: Proposed

**Context**: The search scoring pipeline has three competing systems: Orama's internal hybrid fusion (BM25 + vector via `mode: 'hybrid'`), score normalization (`normalizeScores`), and external re-ranking (`rerankWithSignals`). These systems have no shared information — Orama fuses internally, we normalize away the magnitude, then re-derive scoring signals from raw text. Each fix (ADR-0051, ADR-0072, TASK-0296) adds another layer. The concrete failure: searching "feature store" ranks the literal FeatureStore task at 18th because a single-term title match with 5x boost outscores a two-term description match after normalization and re-ranking.

**Problem**: We cannot produce correct rankings because we have no control over Orama's internal fusion, and our external re-ranking is a shadow scoring system that duplicates and conflicts with Orama's native BM25 relevance.

**Decision**: Replace `mode: 'hybrid'` with two independent Orama queries (BM25 default mode + vector mode), fuse scores ourselves using linear combination with MinMax normalization per-retriever. Delete the entire shadow scoring system (rerankWithSignals, normalizeScores, getRecencyMultiplier). Simultaneously decompose the 852-line monolith into cohesive modules.
