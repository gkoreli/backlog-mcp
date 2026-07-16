---
title: "0115. Memory Experience Uplift — Provenance-Bearing Recall Stubs, Golden Recall Suite, Honest Clocks"
date: 2026-07-16
status: Proposed
---

# 0115. Memory Experience Uplift

**Date**: 2026-07-16
**Status**: Proposed
**Thread**: continues the 0092.x memory thread (0092.3 four verbs, 0092.9 usage feedback, 0092.12 demand-aware ripeness); sibling of ADR 0114 (context folded into memory-verb language)
**Driver**: Goga — *"a stale artifact can be worse than no memory because it arrives with undeserved authority."*

## TL;DR

Recall's progressive disclosure (stubs → `backlog_get`) shipped without the
half that makes stubs *trustworthy*: a stub today is id + digest + layer +
source + created_at (`core/types.ts:376-390`) — nothing about how old the
knowledge is on its own timeline, whether anyone has ever used it, or whether
it is a correction of something earlier. The consumer must either hydrate
(spending the tokens stubs exist to save) or take the stub's authority on
faith. This ADR:

1. **R-1** makes every recall stub **provenance-bearing**: `title`,
   `age_days`, `uses`, `idle_days`, `kind`, `supersedes`, `derived` — cheap
   authority signals, ~+15–20 tokens per stub, honestly accounted below.
2. **R-2** gives recall the **golden-query suite** search has had since
   ADR 0083 (`search-golden.test.ts`) and 0092.3 promised ("a contract with
   tests, not a hope") but never got.
3. **R-3** fixes the memory subsystem's **clock injection hole** — the
   demand-window regression that made `core-consolidation.test.ts` a time
   bomb (frozen fixture `NOW = 2026-06-10` vs hardcoded `Date.now()` at
   `core/consolidation.ts:174`).
4. **R-4** aligns **wakeup knowledge stubs** with the same provenance shape —
   one stub grammar across the memory surface.

## Problem — stubs with undeserved authority

The recall pipeline already *stores* every trust signal it needs:

- `usage_count` / `last_used_at` — durable usage summary, maintained
  relatime-style by `MemoryUsageTracker` (ADR 0092.9 R-13/R-14).
- `kind` (`current`/`historical`/`plan`/`preference`/`timeless`) and
  `occurred_at` — the temporal taxonomy (ADR 0092.5 R-3).
- `supersedes` — correction lineage (ADR 0092.5 R-1).
- `derived` — consolidator inference vs primary capture (ADR 0092.7).

And recall's *ranking* already consumes usage (`usageFactor`,
`memory/usage-signal.ts` — bounded multiplier, reorders never hides). But the
*surface* discards all of it:

- `BacklogMemoryStore.toMemoryEntry` (`memory/backlog-memory-store.ts:196-219`)
  forwards `supersedes`/`kind`/`occurred_at`/`derived`/`usageCount` in
  metadata but **drops `last_used_at`** entirely.
- `core/recall.ts` maps entry → `RecallItem` keeping only
  `entity_id` and `kind` from metadata; **no usage, no lineage, no
  occurred-at age — and not even `title`**, despite 0092.3 making title
  first-class ("title and body are both first-class",
  `tools/backlog-remember.ts:36`). The stub shows a digest of the body and
  hides the human-written label.

So an agent scanning stubs cannot distinguish a 3-day-old, recalled-daily
procedural memory from a 90-day-old never-used episodic one. Both arrive as
one line with a score. The ranking multiplier *nudges* ordering, but ordering
is invisible as evidence — the agent sees positions, not reasons. That is
"undeserved authority" mechanized.

## R-1 — Provenance-bearing recall stubs

`RecallItem` (`core/types.ts`) becomes:

| field | status | note |
|---|---|---|
| `id`, `digest`, `layer`, `source`, `context?`, `tags?`, `score` | kept | |
| `content?` | kept | `full: true` only |
| `entity_id?`, `kind?` | kept | |
| `title` | **new** | the first-class human label (≤100 chars as stored) |
| `age_days` | **new** | `floor((now − (occurred_at ?? created_at)) / day)` — age on the *knowledge's* timeline, not the write's (0092.5 R-3 semantics) |
| `uses` | **new** | `usage_count` — 0 is a signal ("never earned a recall"), so always present |
| `idle_days` | **new** | days since `last_used_at`; only when `uses > 0` |
| `supersedes?` | **new** | present ⇒ this stub is a correction; its predecessor is expired |
| `derived?` | **new** | present ⇒ consolidator inference, cites sources via entity_refs |
| `created_at` | **removed** | replaced by `age_days` — a full ISO timestamp is the most expensive field on the stub and the least decision-relevant form of the same fact |

No back-compat shim (single-user product, maintainer directive 2026-07-16):
`created_at` goes away in the same change.

Plumbing: `toMemoryEntry` additionally forwards `last_used_at` (the one
signal it currently drops); `core/recall.ts` derives the stub fields.
`backlog_recall`'s tool description teaches the semantics ("weigh trust
before hydrating: age_days, uses, idle_days; supersedes marks corrections").

### Token cost, honestly

Char-count estimates (1 token ≈ 4 chars, the repo's standard heuristic):

- Today's stub ≈ 220 chars ≈ **55 tokens**.
- Removed: `created_at` ISO pair ≈ −40 chars.
- Added: `title` (~40 chars avg), `age_days`/`uses` (~28), `idle_days` when
  present (~16), `supersedes`/`derived` when present (~24, rare).
- Net ≈ +70–90 chars ≈ **+18–22 tokens per stub**; a default 10-stub recall
  grows by ~200 tokens.

Worth it: one *avoided* wrong hydration (`backlog_get` of a full memory body)
saves more than 200 tokens, and one avoided act-on-stale-authority incident
saves a session. Stubs remain an order of magnitude cheaper than bodies —
progressive disclosure is preserved, not diluted.

## R-2 — Golden-query recall suite

Mirror of `search-golden.test.ts` (ADR 0083's pattern: document real
behavior; failures prompt "regression or improvement?"): a new
`__tests__/recall-golden.test.ts` with a fixed ~15-memory corpus indexed
through the real `OramaSearchService` (memory is a first-class searchable
type — `packages/memory/src/search/types.ts:16`), recalled through the real
`BacklogMemoryStore` + `MemoryComposer` + `core/recall` chain.

Contracts asserted:

1. **Topical recall** — "how do we deploy" surfaces the deployment
   procedural memory in the top results.
2. **Layer filtering** — `layers: ['procedural']` excludes episodic hits.
3. **Exclusions** — expired (`valid_until` past) and superseded-then-expired
   memories never appear; the superseding correction does, carrying
   `supersedes`.
4. **Usage reordering** — past the 14-day grace period, a used memory
   outranks an equally-relevant unused one (`usageFactor` floor 0.3 vs
   earned ~1.0+); within grace, usage is neutral.
5. **Scoping** — `context` and `tags` filters behave as documented.
6. **Stub provenance** — every stub carries `title`/`age_days`/`uses`; a
   full-bodied item appears only under `full: true`.

Fixture dates are computed **relative to the real clock at fixture-build
time** (`Date.now() − N·day`) — the exact discipline whose absence caused
R-3's time bomb. Golden corpora must never freeze one clock while production
code reads another.

## R-3 — Honest clocks in consolidation

Root cause of the `core-consolidation.test.ts` failure (confirmed
pre-existing, 2026-07-16): the test freezes `NOW = Date.parse('2026-06-10')`
for fixture timestamps, but `consolidationCandidates`
(`core/consolidation.ts:174`) hardcodes `const now = Date.now()` — even
though `demandCounts` and `bucketEpisodics` both already accept an injected
`now`. The fixture's recall events (June 8) aged out of the 30-day demand
window on ~July 8 and the assertion started failing on a calendar date, not
on a code change.

Ruling: `ConsolidationDeps` gains `now?: number` (deps = injected
environment, per the ADR 0090 IO-at-the-edge pattern); the wrapper threads it
to `demandCounts` and `bucketEpisodics`; the test injects its frozen `NOW`.
Transports keep passing nothing — production behavior unchanged.

## R-4 — Wakeup knowledge stubs speak the same grammar

`WakeupKnowledgeItem` (`core/wakeup.ts` L2.5, ADR 0092.5 R-6) currently
carries id/layer/title/kind/source_ref — the same missing-provenance shape.
It gains `age_days` and `uses` with identical derivation. One stub grammar
across wakeup and recall: an agent learns to read trust signals once.
(Wakeup stubs stay leaner than recall stubs — no idle/lineage — because the
briefing is a fixed ~600-token budget; age + uses are the two signals that
change what an agent does at orientation time.)

## Non-goals

- No new tools, no schema changes to the memory substrate — every signal
  surfaced here is already stored.
- No decay-model changes (`usageFactor` params untouched).
- No D1/Worker memory story (ADR 0104 posture; composer remains Node-wired).

## Falsifiability

- If real sessions show agents ignoring the provenance fields (no behavioral
  difference in hydration choices), the added ~200 tokens/recall is waste —
  revert to lean stubs.
- If the golden suite proves brittle to embedding/ranking evolution (fails on
  every upstream tweak without catching real regressions), loosen to
  set-membership assertions before deleting any contract.

## Engineering plan (phase = commit)

1. `docs/adr/0115-memory-experience-uplift.md` (this file).
2. R-3: `core/consolidation.ts` clock injection + `core-consolidation.test.ts`
   passes frozen now — suite goes green before anything else lands on it.
3. R-1: `memory/backlog-memory-store.ts` (forward `last_used_at`),
   `core/types.ts` (RecallItem), `core/recall.ts` (derivation),
   `tools/backlog-recall.ts` (description), unit tests.
4. R-4: `core/wakeup.ts` + `core/types.ts` (WakeupKnowledgeItem), tests.
5. R-2: `__tests__/recall-golden.test.ts`.
