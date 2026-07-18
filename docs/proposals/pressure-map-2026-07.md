---
title: "The Pressure Map — Six External Pressures Assessed Against What Actually Ships"
date: 2026-07-18
status: Proposed (assessment; three charters, four refusals, one NORTH-STAR ruling requested)
author: granite (architect)
relates_to:
  - ../prompts/0012-seven-pressures-assessment.md
  - ../adr/0122-substrate-schema-evolution.md
  - ../adr/0119-agent-substrate-and-derived-correlation.md
  - ../adr/0120-semantic-collision-candidates.md
  - ../adr/0121-retrieval-evaluation-from-first-principles.md
---

# The Pressure Map

An external assessment (PROMPT 0012; source unstated, quality high) names six
pressures beyond schema evolution (its section 3 = ADR 0122). Verdict per
section, measured against code on main at 0.68.0 — what is already law, what
is an early piece needing a charter, what is genuinely open, what we refuse.

## §4 Causality and provenance — "an epistemic ledger"

**Largely built; two named gaps.** Scorecard against their eight questions:
who wrote it (0119 attribution + implicit ladder — live); which request
(PROMPT substrate captures directives verbatim; writes cite via `--refs`);
derived from which sources (`--derived` requires `--refs` — enforced);
which prior fact superseded (`supersedes`, `state_key` closes previous
holders); which agent run (Tier-1 session ids since 0.67.0 — every write's
journal entry and every retrieval now carry session + actor).

Gap 1 — **on whose behalf**: the worktree stamp names the doer but not the
delegation chain (builder:desk-hardening acted on granite's charter on
Goga's directive — recorded only in prose). Charterable as an optional
`on_behalf_of` principal riding the same actor seam; belongs to the 0119
thread, small, data-shaped.

Gap 2 — **observed / inferred / generated**: `layer` (episodic/semantic/
procedural) + `--derived` approximate it but do not name it. Charterable as
one optional enum field on memories; write-time, author-declared, never
engine-guessed.

**Refused: stored confidence/authority scalars.** A numeric confidence is
false precision manufactured by the writing agent — agents grading agents,
the exact failure 0121 dismantled. Authority in this system IS provenance ×
human ratification (Tenet 11): an Accepted ADR outranks a memory because a
human accepted it, not because it carries 0.92.

## §5 Epistemic decay — the differentiator, and they're right

**Strongest existing area.** Once-correct-now-wrong: kinds
(current/historical/plan), `valid_until`, `forget` as soft-expiry, and
`state_key` (an evolving fact closes its predecessors). Two facts, two
contexts: container/context scoping. Plans vs decisions: status tiers are
first-class and searchable. Contradictions needing judgment: 0120 collision
candidates — detected deterministically, adjudicated by a human, never
auto-resolved. Undeserved authority from frequent recall: the rich-get-richer
risk is real and is precisely why ranking is FROZEN until human-tier qrels
exist (0121 R5/R8) — usage informs, never silently governs.

**The one genuine gap — derived memories outliving their sources.** The
first-person law minimizes derived artifacts, but `--derived --refs` memories
exist and nothing flags them when a referenced source changes or is
superseded. **Charter D1 (recommended, small):** deterministic
ref-invalidation — when a document referenced by a derived memory is
superseded, closed, or schema-`aged` (0122), the memory gains a
`stale-source` marker and surfaces in the Desk's REVIEW class. Detection is
free at write time (supersedes edges already exist); no automatic expiry —
flag, disclose, let judgment decide. This is the decay half of 0122's
"data ages gracefully."

## §6 Retrieval economics — already our contract; adopt their sentence

Everything in their pressure list has a shipped counterpart: wire ceiling
with a deterministic yield ladder and a `truncated` ledger; absent-means-
complete omission truth; honest degradation when embeddings are unavailable
(BM25 fallback); token-cost-to-correct-action as the governing metric (0121
R1) — which is exactly their "technically relevant but operationally
useless" test; 100k-doc scale is experiment E1 with kill-evidence now
concretely shaped by the Cerebras scoped-projects observation (REF-0015).

**Ruling requested (R-A of this doc):** their sentence is the best phrasing
of our product contract yet written — *"we can disclose the smallest
sufficient context without hiding material uncertainty or omission"* — and
should enter NORTH-STAR verbatim as the disclosure contract, credited to
PROMPT 0012. It is what the ceiling, the ledger, the omission lines, and the
Desk's "N more" all already implement.

## §7 Derived-state destruction — right test, and it exposes a third class

The test ("delete every derived artifact; reconstruct without losing
meaning") is nearly our current truth: the index rebuilds from files
(INDEX_VERSION discipline), `state/` is uncommitted, docs are authoritative.
But running the test honestly exposes that **two-class taxonomy is a lie**.
Telemetry and the operation journal are neither authoritative-for-reads nor
reconstructible — they are irreproducible *evidence*. And the usage overlay
feeds recall ranking, so byte-identical reconstruction after deleting it is
impossible *by design*.

**Charter D2 (recommended):** the three-class boundary made law + executable.
Classes: **authoritative** (docs — truth), **derived** (index, caches —
delete-safe, reconstructible), **evidence** (journal, telemetry, usage —
append-only, never truth for reads, loss is honest history-loss not
corruption). Then the destruction test becomes a CI gate: delete every
derived artifact → full reconstruction → structural suite passes and search
behavior is identical modulo declared evidence-derived signals (usage
recency), which the gate names explicitly. This is what keeps Orama,
embeddings, and the viewer replaceable — enforced, not asserted.

## §8 Harness and model turnover — law already; nothing to build

Transport-free core (ADR 0090 discipline), markdown as the surface, CLI for
files-and-shell-only clients, namespaced free-string principals with a
`harness` field, MCP as a port. The only harness-specific artifacts are
adapters (SKILL.md, hooks recipes) — which is what adapters are for. No
charter. The one discipline worth restating: nothing harness-shaped may ever
enter frontmatter law.

## §9 Sync without centralization — seams held, one live crack

Their five preserve-these seams, audited: operation provenance (journal +
session ids) ✓; deterministic reconciliation (single-flight init + ordered
mutation chain, 0116-1A) ✓; conflict visibility (0120 candidates + W2
divergence stubs) ✓; authoritative/derived boundary (→ D2 makes it law) ◐;
**stable document identity ✗ — the live crack.** Sequential ID allocation
collided three times TODAY across parallel worktrees (TASK-0005: two
builders both minted MEMO-0006; W2's completion memory renumbered earlier).
That is not a nuisance, it is the sync seam failing at n=2 writers on one
machine. TASK-0005 is hereby upgraded: its resolution must be chosen for
sync-survivability (allocation that stays stable under offline/branch/peer
divergence), not for single-checkout convenience — and it needs its ADR
before any quick patch. 0107 (Loro/CRDT) stays parked exactly as the
assessment suggests: the seams, not the technology, are the commitment.

## Distillation

| # | Verdict |
|---|---|
| §4 provenance | Built; charter `on_behalf_of` + epistemic-class enum (small, 0119 thread) |
| §5 decay | Built; charter D1 ref-invalidation flagging (small, Desk REVIEW) |
| §6 economics | Law; adopt the contract sentence into NORTH-STAR (ruling R-A) |
| §7 destruction | Charter D2: three-class boundary + destruction CI gate |
| §8 turnover | Law; no action |
| §9 sync | Seams held except stable identity — TASK-0005 upgraded to ADR-first, sync-aware |

**Refusals, recorded:** confidence scalars (§4); automatic contradiction
resolution or expiry (§5); building sync now (§9); any ranking change from
any of this while R5's freeze holds.

**Rulings requested:** R-A — the disclosure-contract sentence into
NORTH-STAR. R-B — GO on D1 + D2 as the next build pair after the current
tray. R-C — TASK-0005's ADR-first upgrade confirmed.

---

## Cross-validation addendum — the document's concluding sections

Written AFTER the assessment above, against the same document's conclusions
(state machines, the two golds, tunneling warnings, the pressure ledger).
The cross-validation Goga asked for: **their conclusions and my §4-§9
assessment converge independently on every major call** — the two golds they
name (epistemic infrastructure; substrates-as-data compiled into interfaces)
are exactly this document's §4/§5 verdict and the trunk we've been shipping.
What follows is only the deltas.

### Genuinely novel — five takes

1. **"Project-owned context compiler" — the framing is new gold.** We built
   the thing (a declaration already derives storage, validation, MCP tools,
   retrieval projections, diagnostics, and viewer presentation) but never
   named it. This is the sharpest architecture sentence available for the
   NAME/positioning thread, alongside the KB register (PROMPT 0010). Feeds
   the taste ruling; adopts nothing today.
2. **The substrate-promotion bar, made explicit.** "Require a distinct
   invariant, relation, lifecycle, disclosure policy, or intent before
   promoting a document to substrate." We already behave this way; it was
   never law. Adopt as one line in the 0113 thread: promotion requires a
   named distinct invariant. Cheap, prevents substrate sprawl forever.
3. **Two seams we had not named:** optional **version preconditions** on
   writes (stale-update protection — design seam only, no build) and
   **client-supplied idempotency keys** on MCP writes (retry reality —
   small addition when first observed). Both enter the ledger as
   seams-to-preserve, not builds.
4. **The pressure ledger itself as an instrument.** Adopted immediately as
   `docs/PRESSURE-LEDGER.md` — a living table (pressure / evidence / seam /
   build-now) replacing speculative roadmap thinking. Their strategic
   principle heads it: *future-proof the information model and boundaries;
   do not pre-build future execution machinery* — our
   build-later-on-trigger discipline, generalized and better said.
5. **TASK-0005 reconciled.** They say "smallest fix now"; §9 above said
   "ADR-first." Both: a compact ADR ruling the allocation approach
   (sync-survivable by construction), then the smallest fix implementing
   it, plus the renumber protocol documented operationally for the interim.
   Their nudge against process-heaviness is taken.

### Confirmed law, no action

State machines live in `workflow` and nowhere else (our declarations
already scope them exactly as their diagram draws); the store is not an
actor (ADR 0119's founding constraint, verbatim); local-first with sync
seams preserved (§9). Their "not everything is a state transition" list
matches our architecture one-for-one.

### The viewer warning — held for Goga, not adopted

They reframe read-only-viewer as "a product bet, not a law of nature," with
the deeper invariant being "all mutations pass through the same validated
intent boundary." Recorded honestly: PROMPT 0007's read-only law is Goga's
recent, explicit bet, and the Desk's copy-ready instructions are its
current answer to "convenient human control surface." No change proposed —
but the reframing is preserved here so that if adjudication volume ever
makes the Desk feel slow, the fallback invariant is already named. That
future call is taste, and it is Goga's.
