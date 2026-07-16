# Uplift Idea Garden — July 2026

A menu, not a roadmap. Each entry is a pitch Goga can pick, park, or kill —
nothing here is a commitment, and picking one means opening an ADR, not
inheriting a design. Ideas were mined from two lanes: the 139-ADR corpus
(deferred follow-ups, rejected-with-conditions options, shelved findings)
and the external landscape (what agent-memory/context products are doing,
per the repo's own primary-source surveys in ADR 0092.5 and 0118 plus held
knowledge; entries marked ◇ would benefit from a fresh web pass before
committing).

Tags: **kind** (visionary / architectural / technical / design-pattern /
feature-request / library / tiny-tool) · **effort** (S/M/L) · **alignment**
(how it serves the north star: context & memory engineering, docs-native,
local-first, progressive disclosure).

---

## Visionary

**Proactive recall — memory as lifecycle infrastructure** · L (client M +
server S) — Recall today is a voluntary tool call competing with model
confidence; agents skip it exactly when they need it. ADR 0118 (parked,
do-not-implement) already proved the mechanics: the warm daemon answers
recall in ~38 ms, and the field (Mem0, claude-mem, MemPalace) fires recall
on every prompt with no gating — the discriminator is latency + stub-only
injection, not intelligence. The garden pick: a `/recall` HTTP route +
hook recipes, stubs-only, client-owned. *Source: ADR 0118; cross-ref 0117
hooks research. Alignment: makes the four verbs infrastructural — the
strongest possible reading of "your backlog is your agent's memory".*

**Loro as derived history substrate** · L — Time-travel for entities:
every memory correction, supersede chain, and status transition browsable
as history, with markdown projection never optional (truth stays on disk).
Parked in ADR 0107 and the north star's open decisions; Goga owns the
call. *Alignment: docs-native + "one source of truth per fact" gains a
time axis. Risk: heavy dependency for a derived nicety — needs felt
pressure.*

**Semantic contradiction detection** · M — Today's detector only folds
`state_key` collisions (deterministic, shipped, unique vs Mem0/Letta per
0092.13). The deferred half: embedding near-duplicate candidates — two
memories saying contradictory things *without* sharing a state_key,
surfaced to the human, never auto-resolved. *Source: 0092.13 deferred
list. Alignment: contradiction surfacing is already the product's claimed
differentiator; this doubles its coverage while keeping HITL.*

**Memory health observatory** · M — One viewer surface answering "how is
my agent's memory doing": contradictions roll-up (0092.13 deferred),
split-by-type usage sparklines (0092.14 deferred), decayed-but-unused
piles, stale unchecked REQ compliance (0113.1's staleness signal),
consolidation ripeness. Pieces exist; the garden pick is composing them.
*Alignment: human-visible derived state; the trust story made visible.*

**Positioning & naming execution ("Kvali" lead candidate)** · M — The
naming-and-positioning proposal shipped but the execution (README as
manifesto, tool-prefix decision, the "context & memory engineering"
category claim) is unharvested. Goga-only call on the name itself.
*Source: docs/proposals/naming-and-positioning.md; north-star open
decisions.*

## Architectural

**Session memory layer** · M — The composer deliberately leaves the
`session` layer unregistered. A short-horizon store (auto-expiring
episodics scoped to a session id) would bridge wakeup orientation and
durable layers: an agent could remember-lightly during a session and only
durable facts get promoted. *Source: 0092.x session-layer gap. Alignment:
progressive disclosure applied to memory lifetime, not just tokens.*

**Cross-encoder rerank stage** · M — The highest-magnitude relevance lever
per 0083 (+39–48% on public benchmarks), now correctly caged by 0116 R-9:
only if the judged fixture proves persistent aboutness failures, quantized
MiniLM-L6 over top-10/20, lazy, local, fallback-safe. Garden status:
pre-approved experiment awaiting its evidence. *Source: 0083 §next-gen;
0116 R-9.*

**Deterministic heading-path chunking** · M — Long ADRs currently embed as
one truncated vector (256 wordpieces); the fix is heading/paragraph chunks
as derived cache, collapse-to-parent, winning chunk supplies the snippet.
Conditional on the tail gate failing (0116 R-8; audit F15). *Alignment:
"expand like a filesystem" applied to document interiors.*

**Capacity-triggered archive GC with protected classes** · M — FSFM-shaped
policy from the 0092.5 landscape: when a scope's live-memory count crosses
a budget, archive the lowest-value (decayed, unused, superseded) while
protecting classes (timeless, procedural, high-usage). Keeps recall pools
small forever without a human sweep. *Source: 0092.5 deferred. Alignment:
local-first means the corpus must self-bound.*

**Memory verbs in the operation journal** · S — remember/forget/supersede
never hit activity history (0092.x deferred). Post-0106.5 this got cheap:
the journal now records stable mutation classes — add a `memory` class and
wakeup's recent-activity shows "corrected deploy procedure" alongside task
events. *Alignment: memory becomes as observable as work.*

**Agentic read-loop recipe as a shipped skill** · S — 0116 F9 ruled
iterative retrieval belongs in the calling agent (search once → ≤3 focused
subqueries → fuse, cite, stop). Nobody has written the reusable agent
skill/prompt that encodes it. Cheap, differentiating documentation.
*Source: 0116 Finding 9 implication.*

## Technical

**Corroboration boost** · S/M — When independent live memories agree,
nudge rank ±10% bounded (Hindsight-shaped, 0092.9 deferred). Now
fixture-gated by R3 law; the usage JSONL supplies the evidence base.
*Blocked-on: recorded baseline existing first.*

**Subtree-scoped recall context** · S — `context: FLDR-0001` matches only
exact parent today; descendants are invisible (0092.3 Phase C note).
Docs-native homes make container hierarchies more common, raising this
idea's temperature. *Alignment: scoping should follow the filesystem
metaphor agents already know.*

**Historian mode: `include_expired` recall** · S — Lineage archaeology:
"what did we believe about deploys in May?" Expired and superseded
memories are already retained (GC archives, never deletes) — this is just
a read param + provenance labeling. *Source: 0092.x deferred.*

**True event-level bundle demand** · S — Consolidation ripeness uses
max-of-member-counts as a demand proxy (0092.12). Counting bundle-level
recall events makes ripeness honest for scattered-but-related episodics.

**Native context filter in recall** · S — Step 1 of the overfetch
escalation ladder (docs/proposals/recall-overfetch-note-2026-07.md):
map recall's `context` onto the native `epic_id` where-clause. Authorized
only if the fixture canary (recall-02) is to be fixed — the it.fails test
flips when someone does this.

**Embedding footprint program** · M — fp32 MiniLM is 90 MB and mandatory
at install (audit F22); quantized dtypes, Matryoshka truncation, and a
model fingerprint in the cache envelope (0116 R-7) could cut cold-start
and disk multiples. Fixture-gated for quality; the install-size half needs
no gate. ◇

**Snapshot hardening + vector compaction** · S — Atomic temp+rename write
(audit F12; 0116 R-6 shelved-until-incident) plus measuring whether JSON
float arrays deserve a binary sidecar. Explicitly incident/budget-gated —
listed so the incident, if it comes, has a ready pick.

## Design-pattern

**Control-vs-recorded-baseline evaluation split as public methodology** ·
S — JUDGING.md's builder≠judge protocol, graded qrels with rationale, and
the mocked-control vs real-model-baseline distinction is genuinely good
practice most agent products lack. Write it up (blog/README section) as a
credibility asset for the positioning push. *Source: docs/evaluation/
JUDGING.md; 0116 Finding 8.*

**Stub-grammar conventions registry** · S — age_days / uses / idle_days /
checked_days_ago now span two substrates; record the grammar in the 0113
R7 disclosure descriptor so substrate #3 doesn't invent a fourth suffix.
*Source: beryl's 0113.1 review note. Alignment: one trust language across
every surface.*

**Wakeup as a briefing product** · M — The ~600-token briefing is the
product's front door; treat its composition (identity, now, knowledge,
constraints, recent) as a designed document with section budgets and
precedence rules (constraints > knowledge, per the 0113.1 ruling) rather
than accreted folds. A short design ADR, then incremental. ◇ (compare
Claude Code/Cursor session-start conventions before designing.)

## Feature-request

**Usage-aware memory list views** · S — `backlog_list`-style memory table
with uses/idle/kind columns (0092.14 deferred) — the CLI/viewer answer to
"what does my agent actually rely on?"

**CLI parity for context expansion** · S — `backlog get --context
--depth` exists only via MCP (audit F10); operators debugging disclosure
need the same lens.

**Wakeup constraints section** · (already ruled) — 0113.1 R-2 approved
design; listed here only so the garden reflects it as arriving, not
pickable.

## Library / tiny-tool

**`/recall` HTTP route on the warm daemon** · S — 0118 measured 38 ms via
MCP JSON-RPC; a plain HTTP route makes hook integrations one curl with no
JSON-RPC envelope. Smallest enabling piece of the proactive-recall vision,
shippable standalone.

**`backlog doctor`** · S — One command: contradictions count, stale
compliance checks, consolidation-ripe bundles, index/cache freshness,
embedding state. The memory-health observatory's CLI seed.

**sqlite-vec / LanceDB spike** · M ◇ — If Orama ever hits a measured
ceiling (0116 R-2's reopening condition), the embedded-vector landscape
(sqlite-vec, LanceDB, usearch) is the modern bench. Not pickable until the
ceiling is reproduced — recorded so the trigger has a target.

**Late-chunking / contextual-retrieval spike** · M ◇ — Deterministic
variants of context-prepended chunk embeddings (Anthropic-style contextual
retrieval without the LLM, using heading paths + doc titles) — a
no-LLM-server-path twist worth a research note if chunking (0116 R-8) is
ever earned.

---

## External landscape notes (steal-from list)

Grounded in the repo's own surveys (0092.5 landscape, 0118 field review);
◇ = verify freshness before committing to any of these.

- **Mem0 / claude-mem / MemPalace** — all converged on hook-fired,
  every-turn recall with stub indexes; none gate on intent. Validates 0118's
  parked design; steal the stub-index-injection shape. ◇
- **Letta (MemGPT)** — self-editing memory blocks in-context; its lesson
  is the *budgeted always-present core memory* (a fixed identity/context
  block the agent itself edits) — rhymes with wakeup-as-product above. ◇
- **Zep / Graphiti** — temporal knowledge graph with edge invalidation;
  their bi-temporal model (event time vs ingestion time) matches our
  occurred_at-vs-created_at split — steal their *invalidation-on-write*
  framing for supersede UX docs. ◇
- **basic-memory** — closest posture cousin (markdown-native, local,
  MCP); differentiators to press: substrates, contradiction detection,
  usage-aware ranking, judged evaluation. Watch it. ◇
- **spec-kit / OpenSpec / ADR tooling** — spec-driven development is
  converging on "docs as the agent's ground truth"; our Requirement
  substrate + compliance relations (0113.1) is ahead — positioning
  material, not engineering. ◇

## How to pick

Open an ADR that cites the garden entry; the entry's sources are its
research trailhead. Fixture-gated entries (marked) cannot ship ranking
changes without the recorded baseline — that gate is domain law (R3), not
process preference.
