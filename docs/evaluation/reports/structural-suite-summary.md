# Structural Truth Suite — Run Summary

Corpus: 229 documents (166 entities, 63 resources, 0 quarantined) — sha256 `7c190d02dda3…`, commit `e695c6b7dc3d`.

## Declared limits

- Structural navigation partly measures the product's own exact-ID and title-boost special cases. This suite is a tripwire for retrievability regressions; a green navigation class is NOT improvement evidence for ranking (ADR 0121 R2).
- Aboutness is out of scope by design. No assertion here grades topical relevance; that remains irreducibly a judgment under docs/evaluation/JUDGING.md.
- Query text is drawn from each target's own words (titles, IDs, tail tokens), so the suite tests reachability under the tokenizer contract, not vocabulary-mismatch retrieval (report 0004, lens B kill-evidence).
- Tail probes measure lexical (BM25-side) reachability of content beyond the embedding windows. A pass does not show the vector lane sees that content — by construction it cannot (tokens past 512 are absent from the vector).
- Temporal decay is disabled (no halfLifeDays), matching scripts/search-eval.mjs, so runs are deterministic. The production runtime applies a 30-day half-life at query time.
- The suite's own output files are excluded from the measured corpus (the search-eval excluded_output_path rule) so a checked-in report cannot feed itself back as corpus input. The production index does include checked-in reports.
- Wakeup reconciliation compares disclosed counts (stubs + omitted) against an independent eligible count. The briefing exposes only top-N stubs, so a count match with exactly compensating membership errors is not detectable from the public surface.
- The Requirement "constraints" wakeup section rides a specialized fold (live-constraint band ordering, not includeStatuses) and is not reconciled here; only generic declared wakeup sections are.
- Memory entities are excluded from generic search by product design (ADR 0092.3). A corpus containing memories needs recall-path probes this suite does not emit; their presence is reported and those documents are skipped.

## Composition (mode-independent)

- PASS wakeup-reconciliation [decisions]: disclosed 34 vs eligible 34

## Mode: bm25

| class | total | passed | failed |
|---|---|---|---|
| filter-compliance | 15 | 15 | 0 |
| membership-title | 229 | 229 | 0 |
| navigation-id | 332 | 332 | 0 |
| navigation-title | 229 | 229 | 0 |
| supersedes-reference-resolves | 1 | 1 | 0 |
| tail-reachability | 426 | 412 | 14 |

### Failures (14)

- tail-reachability: ADR 0049 (query: `algolia's e-commerce categorization dress`) — not in window
- tail-reachability: ADR 0074 (query: `task-0040 formulation re-doing constellation`) — not in window
- tail-reachability: ADR 0098 (query: `taskschema epicschema backlog- re-declaring`) — not in window
- tail-reachability: REF-0002 (query: `score-free training tune explainable`) — not in window
- tail-reachability: REF-0006 (query: `excessive handed unvetted pillar`) — rank 11
- tail-reachability: REF-0007 (query: `layered spec's crud-with-a-type-discriminator crisp`) — not in window
- tail-reachability: REF-0007 (query: `substrate-declared executor speak earn`) — not in window
- tail-reachability: REF-0009 (query: `'protect allocator' server-resident llm-in-the-loop`) — not in window
- tail-reachability: REF-0010 (query: `vector-db not' 'write-time reconciliation'`) — not in window
- tail-reachability: REF-0010 (query: `plugin's injecting voluntary intent-gated`) — not in window
- tail-reachability: REF-0012 (query: `misfits mixed-type informs becoming`) — not in window
- tail-reachability: REF-0013 (query: `'steal lafs' search-relevance chase`) — not in window
- tail-reachability: mcp://backlog/docs/adr/0106.4-DELEGATION-BRIEF.md (query: `tonull input-schema re-list throwaways`) — not in window
- tail-reachability: mcp://backlog/docs/proposals/vision-gaps-audit-2026-07.md (query: `current-decisions doctrinal re-proven possessive`) — not in window

Skipped probes: 1 (enumerated in the JSON report).

## Mode: hybrid

| class | total | passed | failed |
|---|---|---|---|
| filter-compliance | 15 | 15 | 0 |
| membership-title | 229 | 229 | 0 |
| navigation-id | 332 | 332 | 0 |
| navigation-title | 229 | 229 | 0 |
| supersedes-reference-resolves | 1 | 1 | 0 |
| tail-reachability | 426 | 415 | 11 |

### Failures (11)

- tail-reachability: ADR 0098 (query: `taskschema epicschema backlog- re-declaring`) — rank 12
- tail-reachability: REF-0002 (query: `score-free training tune explainable`) — not in window
- tail-reachability: REF-0006 (query: `excessive handed unvetted pillar`) — rank 11
- tail-reachability: REF-0007 (query: `layered spec's crud-with-a-type-discriminator crisp`) — not in window
- tail-reachability: REF-0007 (query: `substrate-declared executor speak earn`) — not in window
- tail-reachability: REF-0010 (query: `vector-db not' 'write-time reconciliation'`) — not in window
- tail-reachability: REF-0010 (query: `plugin's injecting voluntary intent-gated`) — not in window
- tail-reachability: REF-0012 (query: `misfits mixed-type informs becoming`) — not in window
- tail-reachability: REF-0013 (query: `'steal lafs' search-relevance chase`) — rank 15
- tail-reachability: mcp://backlog/docs/adr/0106.4-DELEGATION-BRIEF.md (query: `tonull input-schema re-list throwaways`) — rank 12
- tail-reachability: mcp://backlog/docs/proposals/vision-gaps-audit-2026-07.md (query: `current-decisions doctrinal re-proven possessive`) — rank 15

Skipped probes: 1 (enumerated in the JSON report).

## Totals

Assertions: 2465, passed: 2440, failed: 25.
