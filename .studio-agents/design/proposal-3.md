# Proposal 3: Retriever Pipeline with Strategy Pattern

<name>Pluggable Retriever Pipeline</name>
<approach>Abstract retrievers behind a Retriever interface, make fusion strategy pluggable, and let the search service be a thin orchestrator that composes retrievers + fusion + modifiers via dependency injection.</approach>
<timehorizon>[LONG-TERM]</timehorizon>
<effort>[HIGH]</effort>

<differs>vs Proposal 1: Completely different — P1 keeps Orama's black box, this externalizes everything. vs Proposal 2: P2 hardcodes two Orama queries + linear fusion in the service. This abstracts retrievers behind an interface — the service doesn't know whether it's running BM25, vector, recency, or a future LLM re-ranker. Different interface contract (Retriever interface), different ownership model (retrievers are pluggable components, not hardcoded Orama calls), different module boundaries (each retriever is its own module).</differs>

## Architecture

```typescript
/** A retriever produces scored candidates for a query. */
interface Retriever {
  name: string;
  weight: number;
  retrieve(query: string, options: RetrieveOptions): Promise<ScoredHit[]>;
}

/** A fusion strategy combines results from multiple retrievers. */
interface FusionStrategy {
  fuse(retrieverResults: Map<string, NormalizedHit[]>): FusedHit[];
}

/** Post-fusion modifier adjusts scores based on domain signals. */
interface ScoreModifier {
  apply(hits: FusedHit[]): FusedHit[];
}
```

```
Query
  ├─→ BM25Retriever.retrieve()     → ScoredHit[]
  ├─→ VectorRetriever.retrieve()   → ScoredHit[]  [if available]
  ├─→ [future: RecencyRetriever]   → ScoredHit[]
  │
  └─→ FusionStrategy.fuse()        → FusedHit[]
        └─→ ScoreModifier[].apply() → Final results
```

## File Structure

```
src/search/
├── types.ts                    # Retriever, FusionStrategy, ScoreModifier interfaces
├── retrievers/
│   ├── bm25-retriever.ts       # Orama BM25 fulltext retriever
│   └── vector-retriever.ts     # Orama vector retriever
├── fusion/
│   ├── linear-fusion.ts        # MinMax + weighted linear combination
│   └── [future: rrf-fusion.ts] # RRF if we ever need it
├── modifiers/
│   └── recency-modifier.ts     # Post-fusion recency adjustment
├── orama-schema.ts             # Schema, constants
├── tokenizer.ts                # Compound word tokenizer
├── snippets.ts                 # Snippet generation
├── search-pipeline.ts          # Orchestrator: composes retrievers + fusion + modifiers
├── orama-search-service.ts     # Index lifecycle + CRUD only (~250 lines)
├── embedding-service.ts        # Unchanged
└── index.ts                    # Re-exports
```

### SearchPipeline — the orchestrator

```typescript
class SearchPipeline {
  constructor(
    private retrievers: Retriever[],
    private fusion: FusionStrategy,
    private modifiers: ScoreModifier[] = [],
  ) {}

  async search(query: string, options: SearchOptions): Promise<FusedHit[]> {
    // Run all retrievers in parallel
    const results = await Promise.all(
      this.retrievers
        .filter(r => r.isAvailable())
        .map(async r => [r.name, minmaxNormalize(await r.retrieve(query, options))])
    );
    // Fuse
    let fused = this.fusion.fuse(new Map(results));
    // Apply modifiers
    for (const mod of this.modifiers) fused = mod.apply(fused);
    return fused;
  }
}
```

OramaSearchService becomes thin — it owns the Orama db instance, exposes raw query methods for retrievers, and handles CRUD. The SearchPipeline handles all scoring logic.

## Evaluation

### Product design
Fully aligned. Same correct rankings as Proposal 2, but with a more extensible architecture. Future signals (LLM re-ranker, user preference retriever) plug in without touching existing code.

### Architecture
Maximum separation of concerns. Each retriever, fusion strategy, and modifier is independently testable and replaceable. Follows Open/Closed Principle — extend by adding new retrievers, not modifying existing ones.

### Backward compatibility
Zero breaking changes externally. BacklogService still calls the same methods. Internally, OramaSearchService delegates to SearchPipeline.

### Performance
Same as Proposal 2 — two Orama queries. The abstraction layer adds negligible overhead (function calls, Map construction).

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 2 | Full day+. Multiple interfaces, directory structure, wiring. More code than the problem requires right now. |
| Risk | 3 | Abstraction risk — we're designing interfaces for future retrievers that may never exist. YAGNI concern. |
| Testability | 5 | Each component independently testable. Mock retrievers for pipeline tests. |
| Future flexibility | 5 | Maximum extensibility. New retriever = new class implementing Retriever. New fusion = new FusionStrategy. |
| Operational complexity | 3 | More files, more directories, more indirection. A developer needs to understand the pipeline composition to debug a ranking issue. |
| Blast radius | 3 | Same as P2 — every search query affected. |

## Pros
- Maximum extensibility — plug in new retrievers without touching existing code
- Each component independently testable
- Clean separation: retrieval vs fusion vs modification
- Supports parallel retriever execution naturally
- Future-proof for LLM re-rankers, user preference signals, etc.

## Cons
- Over-engineered for current needs — we have exactly 2 retrievers and 1 fusion strategy
- More files, directories, and indirection than the problem requires
- YAGNI — designing for future retrievers that may never materialize
- Abstraction overhead: understanding the pipeline composition adds cognitive load
- The Retriever interface needs access to the Orama db instance, creating awkward coupling (retrievers need to be constructed with a reference to the db, or the service needs to expose raw query methods)
- Takes longer to ship, delaying the ranking fix
