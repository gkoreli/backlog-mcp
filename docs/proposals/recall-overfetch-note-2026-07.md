# Design note — recall's 3× overfetch and JS post-filters (July 2026)

Domain-seat watch item from the ADR 0115/0116 review cycle. Verdict up
front: **leave it**, with one fixture obligation. No production change is
justified today.

## The mechanism

`BacklogMemoryStore.recall` asks the shared search pipeline for
`types: ['memory']` with `limit: max(3 × requested, 30)`, then post-filters
in JS (layer, context as exact `parent_id`, tags, expiry), applies the
bounded `usageFactor`, sorts, and truncates to the requested limit
(`packages/server/src/memory/backlog-memory-store.ts`).

## The theoretical failure

If post-filters eliminate more than ~2/3 of the fetched pool — an
expired-heavy corpus, or a narrow `layer`/`context` filter over a large
memory set — a relevant memory ranked beyond the 3× window never reaches
the filter stage and is silently missing. The multiplier cannot rescue what
retrieval never returned ("reorders, never hides" only governs what is in
the pool).

## Why it does not warrant surgery now

- No observed miss. The failure is constructed, not reported.
- ADR 0112 per-home scoping shrinks each corpus this runs against.
- Expired memories are GC-eligible (`forget --expired`), bounding the
  expired-heavy scenario over time.
- The ADR 0116 fixture's memory-recall class now measures this exact
  surface through the real recall path — the gate that would catch a real
  miss exists.

## The one obligation

Add one stress case to the ADR 0116 fixture: an expired-heavy,
layer-filtered corpus whose grade-3 target ranks beyond the 3× window
pre-filtering. Recall@20 on that query is the canary. A gate that never
exercises the failure mode cannot detect it.

## Escalation ladder, if the canary ever fails

1. Map recall's `context` to the native `epic_id` where-clause (it stores
   `parent_id`); no schema change, shrinks the pool the filters must
   survive.
2. Raise the overfetch floor/multiplier — one constant, measured.
3. Only with repeated evidence: promote `layer`/`valid_until` to native
   schema fields (INDEX_VERSION bump, enum discipline per ADR 0079/0080).

Nothing below step 3 touches ranking; none of it is authorized without a
fixture failure. Smallest answer at the pressure point.
