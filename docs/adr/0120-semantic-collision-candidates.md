---
title: "0120. Semantic Collision Candidates — Deterministic Adjudication Pressure"
date: 2026-07-16
status: Proposed
continues:
  - 0092.13-contradiction-detection.md
relates_to:
  - 0092.5-agentic-memory-landscape-2026.md
  - 0092.7-phase-d-consolidation-engineering-plan.md
  - 0112.1-per-home-retrieval-composition.md
  - 0116-search-and-rag-uplift.md
---

# 0120. Semantic Collision Candidates — Deterministic Adjudication Pressure

**Status**: Proposed — Goga authorized implementation on 2026-07-16; this
checkpoint fixes the boundary before code.

## Decision in one sentence

Use each home's existing hybrid search only to generate nearby live memories,
then apply one deterministic, read-only pair fold that surfaces **collision
candidates, never contradiction verdicts**, at remember-time, consolidation
time, and in a viewer queue; people and agents adjudicate through existing
verbs, with durable `distinct_from` marks in Markdown.

## Why this is the next pressure point

[ADR 0092.13](./0092.13-contradiction-detection.md) shipped structural
contradiction detection: two live memories carrying the same `state_key` are a
breach of the one-holder invariant. It is precise and useful, but it only works
after the writer already knows the evolving fact's key.

The common failure is unkeyed. One session remembers “the deploy target is
Cloudflare”; a later session remembers “production runs on a local VPS.” Both
remain live because neither writer connected them. Recall can now return either
fact without showing that the other exists. That is the gap this decision
closes.

The server cannot honestly decide that two natural-language statements
contradict. It has no NLI model, no LLM in the write path, and no authority to
revise a belief. It can, however, detect that two same-home memories are close
enough in topic, scope, and temporal shape to deserve a decision. The product
term for that weaker and honest claim is **collision candidate**.

This continues ADR 0092.13; it does not broaden that ADR's structural result.
`contradiction` remains the vocabulary for the deterministic `state_key`
invariant breach. Every semantic surface says `collision candidate`.

## Ground truth in current code

- `packages/server/src/core/contradictions.ts` owns the existing pure
  `state_key` fold and its read-only service edge.
- `packages/server/src/core/remember.ts` commits a memory through the injected
  `MemoryComposer` and returns a bounded receipt. This is the first moment at
  which the writing agent can compare the durable fact with its neighbors.
- `packages/server/src/core/consolidation.ts` already identifies ripe episodic
  bundles for an external adjudicating agent. It is the natural legacy sweep.
- `IBacklogService.searchUnified()` and the per-home `OramaSearchService`
  already expose live memory neighbors when explicitly filtered to the memory
  substrate. A second index would duplicate truth.
- `MemorySchema` is strict. A Markdown-visible adjudication field must be added
  to the schema and substrate `extraFields`, not smuggled through an overlay.
- `backlog_update({fields})` already performs schema-validated generic field
  changes. A new dismissal tool would add vocabulary without capability.
- `/memory/contradictions`, `backlog_contradictions`, and the CLI command already
  form one structural read surface. The semantic mode extends those adapters;
  it does not create a new tool.
- The ADR 0116 relevance fixture is a 40-query within-home search/recall
  control. It measures a different capability and must remain unchanged.

## Rulings

### R1. Search generates neighbors; a pure fold prioritizes pairs

For one focal live memory, the service edge first lists the same home's memory
corpus and classifies each document as eligible or ineligible for that focal
pair. It then performs one existing hybrid search using the focal
`title + content`, explicitly filtered to memories. The public neighbor set is
bounded to `COLLISION_NEIGHBOR_LIMIT = 8` after filtering.

Post-search filters must not let expired, dismissed, focal, or hard-excluded
hits consume those eight slots. The requested search limit is therefore:

```text
min(total_memory_count, COLLISION_NEIGHBOR_LIMIT + ineligible_count)
```

where `ineligible_count` is computed from the listed corpus for that focal
memory and includes the focal document itself. This is the smallest
liveness-capable seam over today's index: it guarantees that an ineligible hit
cannot starve an eligible neighbor without adding validity fields, a second
index, or an unbounded guess such as `K * 3`. Search may return fewer than K
matches when the corpus has fewer relevant hits; that is an honest empty tail.

Search scores are query-relative. They include current BM25/vector fusion,
query intent, and ranking modifiers; a score produced for focal A cannot be
compared honestly with one produced for focal B. Therefore:

- raw search scores are never included in a collision-candidate DTO;
- raw scores never enter pair priority;
- only the neighbor's ordinal rank enters the fold; and
- queue deduplication canonicalizes the unordered pair before sorting.

The fold uses bounded signals that are meaningful for a pair regardless of
which member was focal:

| Signal | Range | Definition |
|---|---:|---|
| `neighbor_rank` | 0–1 | Reciprocal 1-based rank, `1 / rank`, using the better observed direction when a full sweep sees both. |
| `lexical_overlap` | 0–1 | Jaccard overlap of normalized, unique alphanumeric tokens from title + body. |
| `scope` | 0–1 | `1` same non-empty context; `0.8` at least one exact, case-sensitive shared entity ref or tag; `0.35` both without context/refs/tags; `0.2` otherwise. |
| `epistemic_shape` | 0–1 | `1` current/current; `0.5` exactly one current; `0` neither current. Missing kind is treated as current, matching ordinary live-fact semantics. |

The initial named weights are a hypothesis to take to the judged fixture, not
measured truth:

```text
pair_priority =
  0.45 * neighbor_rank +
  0.30 * lexical_overlap +
  0.15 * scope +
  0.10 * epistemic_shape
```

All constants, including `COLLISION_PRIORITY_THRESHOLD`, are frozen only after
the judged collision fixture passes the selection protocol in R8. The formula,
K, threshold, and token normalization are named constants beside the pure
fold; there is no runtime config surface. Later changes require new judged
evidence.

This number is a deterministic **review priority**, not a probability of
contradiction and not a semantic-similarity score.

### R2. Same-home and live-only are structural constraints

The runtime passed to the detector is already one canonical home. The fold
never enumerates homes and `home: all` is not accepted for this surface. A
same `state_key` or similar phrase in two different projects is not a conflict;
cross-home contradiction detection remains deferred by ADR 0112.1 R-4.

Non-live memories are excluded using the existing `valid_until` rule; a
successor's `supersedes` field does not itself make that successor non-live.
All persisted live layers — episodic, semantic, and procedural — may
participate.

Two memories carrying different explicit contexts are hard-excluded when they
also share no `entity_refs` and no tags. This blocks the required cross-context
near-miss even when its wording is almost identical. Otherwise scope affects
priority rather than acting as a hidden verdict.

### R3. One read-only core serves two detection triggers and one read surface

The implementation has one pair evaluator and one service edge:

```text
findCollisionCandidates(focal memories, live corpus, search) -> candidates
```

It has no composer, storage, update, or operation-log dependency.

- **Remember-time primary trigger**: after the durable memory write succeeds,
  the remembered memory is the sole focal item. Detection is advisory. The
  receipt carries `collision_candidates: []` when a scan completed and found
  no candidates, a non-empty array when review is warranted, and omits the
  field when the scan was unavailable or failed.
- **Consolidation sweep**: focal items are the members of ripe episodic bundles
  already selected by `consolidationCandidates`; neighbors may be any live
  persisted layer. The same fold finds legacy candidates without a second
  algorithm.
- **Viewer/all-candidate read**: every live memory may be focal. Canonical pair
  IDs deduplicate the two search directions.

The remember tri-state is part of the tool description because ambiguity here
would destroy trust:

```text
[]       = scan completed; no candidate crossed the threshold
[... ]   = scan completed; these pairs deserve adjudication
absent   = advisory scan did not run or failed; no cleanliness claim
```

A successful durable write never becomes an error because its advisory scan
failed. The new memory need not already be present in the index: its durable
entity supplies the focal text while the existing index generates neighbors.
This decision does not change index mutation ordering.

### R4. Candidates have one deterministic identity and total order

The unordered pair key is the two memory IDs sorted bytewise and joined with a
delimiter that cannot occur in an entity ID. A pair is emitted once.

Every list uses the same total order:

1. `pair_priority` descending;
2. canonical first memory ID bytewise ascending;
3. canonical second memory ID bytewise ascending.

Focal reads (remember and memory detail) return the other-memory shape promised
by the proposal:

```ts
interface CollisionCandidate {
  id: string;
  title: string;
  digest: string;
  pair_priority: number;
  signals: CollisionCandidateSignals;
}
```

Full-home reads return a canonical pair with `pair_id`, the same priority and
signals, and two bounded member stubs (`id`, `title`, one-line digest, kind,
context, entity refs, tags). Digests collapse whitespace and truncate to 160
characters. Neither shape exposes raw local search scores. The queue is
server-authoritative; the viewer preserves its order.

### R5. Adjudication is human-readable Markdown, and the detector cannot act

`MemorySchema` gains:

```yaml
distinct_from:
  - MEMO-0042
```

The field is a strict array of memory IDs and is listed in the builtin memory
substrate's `extraFields`, so the artifact is visible in the authoritative
Markdown file. A mark on either member excludes the pair. This is the product
difference: a human can inspect the memory and see why two nearby facts are
allowed to coexist.

Agents and humans write or remove the mark through the existing generic update
verb:

```text
backlog_update({ id, fields: { distinct_from: [otherId] } })
```

The other existing resolutions remain `supersedes`, `state_key`, and
`backlog_forget`. The detector only reads. It never writes a dismissal,
expires a memory, selects a winner, or logs an adjudication on the user's
behalf.

### R6. Structural contradictions remain backward-compatible

`backlog_contradictions()` with no semantic flag returns the existing
`ContradictionsResult` unchanged. With `candidates: true`, it returns the
same-home semantic collision-candidate result instead. The MCP description and
CLI help keep the terms distinct and explain the remember tri-state.

The HTTP endpoint accepts the same explicit mode for the viewer. Memory detail
responses add the candidates for that focal memory; the all-candidate endpoint
supplies the review queue. No new MCP tool and no new HTTP write route ship.

### R7. The viewer supplies pressure, not authority

The memory detail pane gains a `collision candidates` chip linking to the
other memory stubs. A dedicated split-pane queue loads the per-home candidate
endpoint and renders the server's worst-first order. It never combines homes
and never re-sorts scores in the client.

The queue deep-links both memories and explains the existing resolution verbs.
It does not perform a hidden mutation and does not introduce a viewer-only
adjudication database.

Wakeup gains **no section and no count** in this build. Candidates are curation
pressure, not orientation. A wakeup count is permitted only by the future
falsifiability path in R10, after evidence shows the chosen surfaces are silent.

### R8. A separate judged collision fixture guards detection

Before remember-time surfacing is enabled, a new fixture and gate cover at
least these four cases by name:

1. **true unkeyed contradiction** — candidates and clears the threshold;
2. **paraphrase pair** — ranks below true conflict or is removed by an explicit
   `distinct_from` adjudication;
3. **timeless-vs-current** — scores below current/current write-time pressure;
4. **cross-context near-miss** — does not candidate.

The first fixture is exactly these eight pairs. Titles are the quoted phrases;
the bodies restate them as one sentence without adding keywords. `FLDR-0101`
and `FLDR-0102` are distinct fixture context IDs. No implementation may swap the
phrasing merely to make the weights pass.

| Fixture ID | Left | Right | Scope/kind/adjudication | Judgment |
|---|---|---|---|---|
| `unkeyed-deploy-target` | “Production deploys to Cloudflare Workers” | “Production deploys to a local VPS” | same `FLDR-0101`; current/current | `candidate` |
| `unkeyed-package-manager` | “This repository uses pnpm for dependency installation” | “This repository uses npm for dependency installation” | same `FLDR-0101`; current/current | `candidate` |
| `paraphrase-design-tokens` | “Tsa design tokens style the viewer” | “The viewer is styled with Tsa design tokens” | same `FLDR-0101`; current/current; left `distinct_from` right | `exclude` after dismissal |
| `paraphrase-local-first` | “Local-first is backlog's primary posture” | “Backlog primarily runs local-first” | both unscoped; current/current; right `distinct_from` left | `exclude` after dismissal |
| `timeless-current-hash` | “SHA-256 digests are deterministic integrity fingerprints” | “Current integrity checks use SHA-256 hashes” | same `FLDR-0101`; timeless/current | `lower_priority`; below write-time threshold |
| `timeless-current-identity` | “Entity identifiers use uppercase ASCII prefixes” | “Current documents name IDs with uppercase ASCII type prefixes” | same `FLDR-0101`; timeless/current | `lower_priority`; below write-time threshold |
| `cross-context-package-manager` | “This repository uses pnpm for dependency installation” | same phrase | `FLDR-0101`/`FLDR-0102`; current/current; no shared ref/tag | `exclude` |
| `cross-context-deploy-target` | “Production deploys to Cloudflare Workers” | same phrase | `FLDR-0101`/`FLDR-0102`; current/current; no shared ref/tag | `exclude` |

The fixture file stores those inputs, the injected 1-based neighbor ranks, and
the judgments. Ranks are `1` for each listed pair so this gate evaluates pair
signals rather than whatever embedding model happens to be installed. A
separate service-edge unit test proves that production search order becomes
the injected rank and that raw scores are discarded.

K and the weights above are accepted only if they satisfy all of these
objectives without tuning:

1. every `candidate` clears the threshold;
2. every `exclude` is removed by its declared scope/dismissal gate;
3. every `lower_priority` case stays below the threshold and below each
   required candidate;
4. either-side dismissal removes the pair; and
5. the lowest required candidate scores strictly above the highest
   `lower_priority` case.

When that separation exists, the frozen threshold is the midpoint between
those two scores. With the named inputs and initial formula, the expected
scores are `0.8125`, `0.925`, `0.731818`, and `0.725`, so the frozen threshold
is `0.772159`. The gate calculates rather than copies these values. If the
calculated values differ, the design stops: do not replace examples, tune
against eight pairs, or enable write-time surfacing. Preserve the failing
fixture evidence and revise the signals in a new ADR checkpoint first.

This is fixture calibration, not statistical model training. The gate reports
the pair-level precision over the fixture, the frozen threshold and constants,
deterministic order, dismissal symmetry, and stable pair identity. It exercises the
production pure fold and the real candidate-generation boundary with
deterministic search dependencies. Write-time surfacing remains off until the
constants and expected output are committed together.

This fixture is separate from ADR 0116's 40-query relevance control. That
fixture, its expected scores, and all ranking implementation files remain
byte-unchanged. The existing search is a generator; this ADR is not permission
to tune it.

### R9. The ranking wall is absolute

Collision priority does not boost, penalize, annotate, filter, or reorder
recall/search results. No corroboration multiplier, contradiction penalty, or
freshness adjustment ships here.

A future ranking interaction requires the ADR 0116 judged fixture to gain a
dedicated contradiction-pair query class with graded relevance judgments and
to clear the existing ranking-change policy. Until then, collision code does
not import into recall/search ranking modules and ranking code does not import
the collision score.

### R10. Kill-switches are measured from durable evidence

The feature stays falsifiable:

- If more than roughly 60% of adjudicated candidates become `distinct_from`
  rather than supersede/state-key resolutions over a real month, raise the
  threshold or demote write-time surfacing to sweep-only. Measurement source:
  a monthly read-only JSON candidate snapshot, followed by disposition from
  the authoritative Markdown (`distinct_from`, `supersedes`, `state_key`, and
  `valid_until`). The denominator is snapshot pairs with one of those later
  adjudication artifacts; untouched pairs are not silently counted as either
  outcome.
- If surfaced candidates are rarely adjudicated, write-time output is the
  wrong pressure point. Measurement source: two operator-captured, timestamped
  JSON snapshots from `backlog contradictions --candidates --json`; canonical
  pair IDs that remain present and unadjudicated across the interval are the
  silence cohort. The server does not persist observations merely to measure
  itself. Move pressure to the viewer; only then consider a bounded wakeup
  count.
- If the fold exceeds roughly 50 ms p95 at recall-scale corpora, cap K before
  adding caches or a new index. “Recall-scale” means a replayable 1,000-live-
  memory corpus, matching the global-pile pressure that motivated per-home
  storage. Measurement source: 100 repeated service-edge calls in an opt-in
  diagnostic after one warm-up pass, not permanent per-call telemetry.

No dashboard, configuration knobs, compaction process, or performance
framework ships to measure hypothetical pressure. The artifacts already
created by use are the primary evidence.

## Engineering plan

### Phase A — Pure fold and judged fixture

- Add satellite candidate types beside a new transport-free core module.
- Implement token normalization, scope exclusion, signal calculation,
  canonical pair identity, total ordering, and `distinct_from` symmetry.
- Add the separate four-case judged fixture and gate.
- Prove the ADR 0116 40-query fixture and ranking files are unchanged.

### Phase B — Schema, triggers, and read transports

- Add strict `distinct_from` Markdown support to the memory substrate.
- Compose the same-home candidate service from the runtime's existing search.
- Enrich remember receipts with the documented advisory tri-state.
- Extend consolidation results with candidates for ripe focal members.
- Add `candidates: true` to MCP, CLI, and HTTP adapters while preserving the
  structural default result.
- Unit-test all production behavior with injected dependencies and memfs only.

### Phase C — Viewer pressure surfaces

- Add the detail chip and candidate links through the existing metadata pane.
- Add one per-home, server-authoritative worst-first split-pane queue.
- Preserve current home selection and SSE invalidation; no cross-home cache.
- Use Tsa tokens and `@nisli/core` query/signal/emitter patterns.

## Non-goals

- no NLI model, LLM, polarity classifier, new embedding model, or sidecar;
- no auto-resolution and no detector write path;
- no stored candidate table or candidate overlay;
- no new MCP tool or viewer mutation API;
- no cross-home fold, all-home queue, or D1 parity work;
- no wakeup surface in this build;
- no recall/search ranking change;
- no speculative generalized similarity framework.

## Consequences

- A remember receipt can now say “these nearby live facts deserve a look”
  without pretending the server understood natural-language truth.
- Scanned-clean and unscanned writes are distinguishable.
- Dismissals survive restarts, Git, and direct human inspection because they
  live in the memory Markdown.
- Full-home candidate reads cost one bounded neighbor search per focal memory.
  That is acceptable for the first local-first corpus; R10 requires measuring
  before adding machinery.
- Similar paraphrases can still surface. That is inherent in a deterministic
  collision detector without an adjudicating model; the fixture and visible
  dismissal artifact keep the failure honest.

## Acceptance

- The four named collision cases pass against the production fold.
- Repeat runs over the same corpus produce byte-identical pair order.
- Either-side `distinct_from` removes the pair and remains visible in Markdown.
- Remember distinguishes scanned-clean, candidate-present, and unscanned
  without ever rolling back or failing the durable write.
- Default structural contradiction MCP/CLI/HTTP responses remain unchanged.
- Candidate lists are same-home and live-only.
- Viewer detail and queue use the same server result and preserve its order.
- The existing 40-query relevance fixture, expected metrics, and ranking code
  are unchanged and green.
- Server and viewer typechecks and memfs unit suites are green.

## References

- [Semantic contradiction detection proposal](../proposals/semantic-contradiction-detection-2026-07.md)
- [ADR 0092.13 — Contradiction Detection](./0092.13-contradiction-detection.md)
- [ADR 0092.7 — Consolidation Engineering Plan](./0092.7-phase-d-consolidation-engineering-plan.md)
- [ADR 0112.1 — Per-home Retrieval Composition](./0112.1-per-home-retrieval-composition.md)
- [ADR 0116 — Search and RAG Uplift](./0116-search-and-rag-uplift.md)
