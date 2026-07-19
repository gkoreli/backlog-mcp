---
title: "0126 — Retrieval Substrate: Stay on Orama-Done-Right; sqlite-vec as the Designed Fallback"
date: 2026-07-18
status: "Proposed (granite recommends; awaiting goga's ruling — he set the condition 'either Orama works properly or we explore alternatives')"
author: granite (architect)
relates_to:
  - ../NORTH-STAR.md
  - ../references/REF-0016-orama-text-analysis-pipeline-bm25.md
  - 0125-consumer-agnostic-core-compose-dependencies.md
  - ../evaluation/R8-JUDGING-2026-07-18.md
---

# 0126 — Retrieval Substrate

## Context — Goga's conditional

After a week of retrieval pain, Goga: *"either Orama works properly or we are
going to explore other alternatives … there are DBs that might do better."* Two
authoritative, adversarially-verified research passes (competitor stacks;
in-process alternatives) plus the just-landed Orama fix now let this be decided
on evidence.

## What the evidence says

**The "they use DBs, we use Orama" framing is largely a category error.** Mem0
defaults to *embedded* Qdrant (local file, no server); MemPalace to *embedded*
Chroma + local SQLite — the same in-process/local posture as us. Their
DB-server tiers are for multi-tenant production, not capability. Orama itself
does full-text + vector + hybrid in-process. The genuinely DB-bound tools
(Graphiti, Zep) need a **graph** engine for temporal-KG reasoning — a real
capability gap, but a *graph* one, orthogonal to vector search (see Non-goals).
**Letta is the tell:** its flagship threw out pgvector for git-backed flat files
in TypeScript — a direct competitor converging on our posture.

**Orama now works properly** (this is the load-bearing new fact). The week's
bugs were mostly *our* misuse — we bypassed Orama's tokenizer (stop-words +
stemming never active) and had a lifecycle bug (cold-write embeddings). Both are
fixed (ADR 0125; REF-0016): stemming + official stop-words restored, embeddings
guaranteed on cold writes, **recall nDCG 0.8745 → 0.8905 on the human qrels, no
regressions.** Orama's one true structural weakness — an in-memory index that
fully serializes/restores — was *patched* (the embeddings bug is gone) but not
eliminated.

**The best alternative, if we move, is SQLite (FTS5 + `sqlite-vec`)** — not
Chroma/Qdrant (servers) and not DuckDB (its `vss` HNSW is memory-resident,
experimentally-persisted, "not for production" — it *reproduces* the very
in-memory bug class we'd be fleeing). FTS5 is 10-year-mature, incremental
on-disk. But the move carries real, verified costs:

| | Orama-done-right | SQLite (FTS5 + sqlite-vec) |
|---|---|---|
| Persistence | in-memory serialize/restore (patched) | **incremental on-disk (bug class gone)** |
| Hybrid query | native single call | **we own the FTS5↔vector fusion ourselves** (no official combined example) |
| Dependency | **pure JS, zero native dep** | native addon + loadable extension; platform binaries |
| Portability | **browser / edge / Deno / Bun** | Node-native only (WASM unverified) |
| Maturity | churny (v2/v3 breaking) but stable | FTS5 rock-solid; **`sqlite-vec` pre-v1.0, solo maintainer, release hiatus** |
| Stop-words | official `@orama/stopwords` | none built-in (BYO) |

(LanceDB is the runner-up — best persistence, native hybrid, adopter "Cognee" —
but has a **confirmed missing Intel-Mac build**, a real ship-blocker.)

**Under the hood (verified against v3.1.18 source, `trees/vector.ts`):** Orama's
vector search is a plain `Map<id, [magnitude, Float32Array]>` and a brute-force
cosine `for`-loop (`findSimilarVectors`) — **no ANN index (no HNSW/IVF)**, and
`toJSON()` serializes every raw vector into one JSON array (the ~512 MB
V8-string ceiling and the in-memory-rebuild root). This is fine at our scale
(hundreds–thousands of 512-dim vectors = microseconds) and it *equalizes* the
`sqlite-vec` comparison: `sqlite-vec` is **also** brute-force (pre-1.0, no ANN) —
just in C and on-disk, a better-engineered *same* algorithm, not a smarter one.
Real ANN lives only in LanceDB (IVF/columnar) and DuckDB (HNSW). So Orama's
vector layer is ~30 lines we could own ourselves; its real value is the
hybrid-fusion plumbing + BM25/radix full-text + API — which is where the
substrate question actually lives.

## Decision (recommended)

**Stay on Orama-done-right. Do not migrate now.** Rationale, straight from our
own tenets:

- Goga's condition was "either Orama works properly." As of today's fix, **it
  does** — measured, not asserted. The felt pressure that justified exploring
  alternatives was the *bugs*, and the bugs are fixed.
- A migration now would be building for a *theory* (the in-memory model is
  ugly) rather than a *felt* problem (Tenet 9) — and it trades a fixed bug for
  new, verified costs: a native dependency (erodes zero-setup/pure-JS), a
  self-owned hybrid-fusion layer, lost browser/edge portability, and
  `sqlite-vec`'s own pre-1.0 instability.
- Invariant 9 + ADR 0125 mean we lose nothing by waiting: the index is a
  derived, disposable layer behind a consumer-agnostic seam, so the swap stays
  a **bounded, measurable migration** available the day evidence demands it.

**`sqlite-vec` is the designated fallback**, pre-scoped here so the switch is
execution, not research, when a tripwire fires.

## Tripwires that flip this to "switch"

1. Orama-done-right still measures **below bar on the qrels** after real use
   (the graded-precision metric, once built, is the judge).
2. The **in-memory model bites again** despite the fix (another
   serialize/restore or scale-ceiling incident).
3. Orama's **maintenance lapses** (abandonment, or breaking churn we can't
   absorb) — the research flagged real churn and a smaller project.
4. **Scale / ANN pressure** — a home grows past ~tens of thousands of vectors
   and the brute-force scan (Orama *and* `sqlite-vec` both do this) gets slow, or
   we need approximate nearest-neighbor. The target then is a real ANN engine
   (**LanceDB**, HNSW/IVF) — *not* `sqlite-vec` — a distinct, higher bar than the
   persistence tripwires (1–3).

## Non-goals

- **Graph / temporal-KG** (Graphiti/Zep territory) is a *separate* question from
  the vector substrate — if we ever want relationship/temporal reasoning, no
  in-process vector lib closes it, and that decision is its own ADR.
- Not a defense of Orama's in-memory model — only a ruling that patching it beat
  replacing it *today*, on evidence.
