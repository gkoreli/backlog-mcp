# Container Routing at Intake — Proposal (July 2026)

**Status**: Proposal — design exploration for Goga's retention idea
(task 23), proposal-grade only, no implementation. Anchors: NORTH-STAR
Pillar 4's organize-at-intake note (a30ae93), PROMPT 0002 #11.

## The problem, split in two

"Organize at intake, not after" already has half an answer. Pillar 4's
per-substrate folders solve the **which-folder** question by substrate
identity: an ADR is born into `docs/adr`, a requirement into
`docs/requirements` — routing decided before the artifact exists.

The unsolved half is **which container**: which epic does this task belong
to, which thread does this sub-ADR continue, which context does this
memory attach to. Today that dimension is optional at create time and
almost never fixed later — the exact after-the-fact pile Pillar 4 calls
slow and complicated. Retention fails not because artifacts are lost but
because they are *unattached*: recall scoping, consolidation bucketing,
wakeup scoping, and compliance relations all key off parentage that was
never set.

## Proposed rulings

### P-1 — Explicit always wins; routing only fills absence

If the caller passes `parent` / `context` / a thread, that is the answer.
Routing is a default-filling mechanism, never an override. Nothing about
this proposal adds server judgment over explicit agent intent.

### P-2 — A deterministic routing ladder, with provenance

When the container dimension is absent at create time, the server fills it
by an ordered, deterministic fold — no LLM, no fuzzy matching, no stored
routing state:

1. **Substrate intake default** — the substrate's declaration names its
   routing rule (ADR threads continue their parent ADR; artifacts require
   an explicit parent already; crons default to scope root).
2. **Reference-derived** — if the new entity carries references /
   `entity_refs`, route to the container of the first referenced entity.
   This is literally consolidation's bucketing fold (0092.7: context →
   first entity_ref → unscoped) applied at write time instead of read
   time — same semantics, earlier moment.
3. **Session-sticky container** — the last container an agent's write
   touched in this scope within a bounded window, derived on demand by a
   pure fold over the operation journal (store-doesn't-act: no mode state,
   no session table). Rationale: work arrives in bursts; the fifth task of
   a burst belongs where the previous four went.
4. **Scope root, visibly unfiled** — the honest fallback (P-3).

Whichever rung fired is recorded as routing provenance in the create
result and the journal entry (`routed_by: reference | session | default`),
so misrouting is diagnosable and correctable with one parent update —
never silent.

### P-3 — Unfiled is a visible count, not a place things go to die

The retention lever with the most force: `wakeup` reports the scope's
unfiled count ("7 entities unattached") the way it reports active work.
Unfiled is a **computed view** (a filter over parentless work-substrate
entities), not a real container — no inbox entity to maintain, nothing to
migrate. The pressure loop closes: intake routing makes attachment cheap;
the wakeup count makes non-attachment impossible to ignore. Memories are
exempt: scope-level (unscoped) memories are a legitimate resting state,
not a filing failure.

### P-4 — Thread numbering rides existing allocation

For docs-native threads (`NNNN.T-slug.md`), "route into the thread"
means allocating the next `T` — which is exactly ADR 0112 R-7's
optimistic atomic allocation applied to the thread counter. Opt-in and
explicit (an agent says "continue 0116"), never inferred from content:
thread membership is a semantic claim only the author can make (P-1
spirit). What the server automates is the mechanical numbering, not the
membership decision.

### P-5 — The routing duty is disclosed at the tool boundary

The strongest router is still the calling agent at create time. The intent
tools' discovery descriptions (0106.5's 16 verbs) should say so —
"pass `parent`; unparented work surfaces as unfiled at wakeup" — putting
the duty in the agent's face at selection time, per progressive
disclosure. Server heuristics (P-2) are the net under the trapeze, not the
act.

## What this is deliberately not

- **No auto-refiling of existing piles.** Curating ~1,000 legacy entities
  is a one-time agent-driven pass (a fine idea-garden pick), not server
  behavior.
- **No semantic routing in the server.** "This task is about search, so it
  belongs to the search epic" is agent judgment; the server ladder uses
  only structural signals (references, journal recency, declarations).
- **No new substrate, tool, or container type.** The unfiled tray is a
  view; routing provenance is a response/journal field.

## Cross-thread fits

- **0112 (quartz)**: folders, thread grammar, atomic allocation — P-4
  consumes R-7; per-home scoping bounds the session-sticky fold.
- **0113 (basalt)**: substrate declarations gain an optional intake-default
  descriptor — compiler-validated, deterministic (P-2.1).
- **0106.5 (chert)**: create intents carry optional parent today; the
  executor is where the ladder would live; journal gains `routed_by`.
- **0092.7 (memory)**: the reference-derived rung is the consolidation
  bucketing fold, reused — one organizing principle at both write and
  read time.
- **0113.1 (onyx)**: unfiled count sits beside the constraints section in
  wakeup — both are "orientation-time pressure" surfaces.

## Open questions for Goga

1. Session-sticky window: how long is a "burst" (last N minutes vs last N
   operations)? Recommend last 10 write operations or 30 minutes,
   whichever is smaller — but this is taste.
2. Should reference-derived routing outrank session-sticky (as proposed),
   or the reverse? References are stronger evidence but rarer.
3. Is the unfiled wakeup count enough pressure, or does Goga want a
   `backlog doctor`-style weekly digest of unattached entities too?

## Effort

S/M as scoped: the ladder is a small pure function in the create path,
provenance is a response field, the unfiled count is one list filter in
wakeup, and P-4/P-2.1 land inside seams 0112/0113 already build. Nothing
here justifies a new subsystem.
