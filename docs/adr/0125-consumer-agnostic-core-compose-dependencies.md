---
title: "0125 — The Consumer-Agnostic Core: Compose Dependencies, Never Reinvent Them"
date: 2026-07-18
status: "Accepted (goga, 2026-07-18 — NORTH-STAR Invariant 10)"
author: granite (architect)
relates_to:
  - ../NORTH-STAR.md
  - ../references/REF-0016-orama-text-analysis-pipeline-bm25.md
  - ../evaluation/R8-JUDGING-2026-07-18.md
  - 0097-agentic-storage-engine.md
  - 0106-semantic-intent-tools.md
---

# 0125 — The Consumer-Agnostic Core

## Context — two silent bugs, one shape

R8 human recall grading (2026-07-18) surfaced poor precision. Diagnosis found
two defects that shared a shape — both invisible because neither threw:

1. **Cold-write embeddings gap.** `OramaSearchService.embeddingsReady` is a
   per-process lazy flag, flipped true only after the first vector *search*.
   The write path (`addDocument`) guarded on it, so a fresh CLI process that
   wrote a memory *before* searching stored it with no vector; the long-lived
   MCP server warmed the flag and was unaffected. **Identical core code produced
   different correctness depending on the consumer's process lifetime** —
   CLI-written memories were silently BM25-only.

2. **Bypassed language pipeline.** Our `compoundWordTokenizer` exposed a
   `.tokenize` method; Orama's `create()` uses any such object verbatim and
   never calls `createTokenizer()` (REF-0016), so stop-word removal and stemming
   were **never active in any index**. We then hand-rolled a stop-word list in
   app code to compensate — reinventing, badly, what the library already ships.

Both passed "one core, many consumers" at the wiring level (CLI and MCP both
call `core/remember.ts`) yet broke its *spirit*.

## Decision — NORTH-STAR Invariant 10

**(a) The core is consumer-agnostic.** No correctness may depend on process
lifetime, warm-vs-cold state, or which surface called. A cold CLI process and
the warm server must produce identical results from identical core code. An
optimization (lazy init) may never harden into a silent precondition.

**(b) Compose dependencies; never reinvent them.** Where the core builds on a
library (search engine, tokenizer, stemmer, embedder), it composes that
library's real pipeline rather than hand-rolling a parallel one in app code.
Bypassing a dependency's language analysis and re-implementing it is the same
violation as (a), aimed at a library instead of a consumer.

## Enforcement — the cold-start contract test

The guard is a **cold-start contract test**: construct the core fresh (no prior
warm-up), exercise the write path, and assert the result is identical to the
warm path. Shipped for the embeddings bug (`orama-invariants.test.ts` —
"cold-process embeddings parity"). Any lifecycle-coupled or dependency-bypass
regression must be caught by a test that drives the core from cold, never from
an already-warm long-lived process.

## Consequences

- The Orama tokenizer now composes the library's English stemmer + official
  `@orama/stopwords` list (REF-0016); the hand-rolled coordination stop-word
  list is deleted; recall precision measured up against the human qrels.
- The five embedding write sites ensure the embedder before writing.
- This invariant is *why* the retrieval engine can be swapped freely
  (Invariant 9): a consumer-agnostic, library-composing core has a clean seam,
  so the pending Orama-vs-alternatives evaluation is a bounded, measurable swap
  rather than a rewrite.

## Non-goals

Not a rule against optimization or caching — only against optimizations that
silently change correctness. Not a rule against custom logic — only against
re-implementing what a dependency already does correctly (a genuine gap the
library cannot fill is still ours to build).
