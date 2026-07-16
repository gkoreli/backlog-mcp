# Uplift Idea Garden — July 2026

A menu, not a roadmap. Each entry is a pitch Goga can pick, park, or kill —
nothing here is a commitment, and picking one means opening an ADR, not
inheriting a design. Ideas were mined from two lanes: the 139-ADR corpus
(deferred follow-ups, rejected-with-conditions options, shelved findings)
and the external landscape. External entries were verified 2026-07-16 by
three primary-source scout passes (agent-memory products, docs-native/MCP
ecosystem, local retrieval tech); the former ◇ freshness marks are
resolved — see the landscape notes for what changed.

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
recall in ~38 ms with stub-only injection. **2026-07-16 field update**:
0118's every-turn premise is now dated — the field converged on
*intent-gated, search-first* recall during 2026 (Mem0 injects a
session-start decision rubric and lets the agent decide when to search;
claude-mem pivoted to a search-first stub index; MemPalace injects at
session start only). That convergence *validates* our voluntary-recall
design rather than differentiating against it. The mechanics still stand;
the cheapest first step is now the **decision rubric line in wakeup** (S):
a tiny paragraph telling the agent *when* to recall, not *what*. The
`/recall` HTTP route + hook recipes remain the fuller pick, stubs-only,
client-owned. *Source: ADR 0118; cross-ref 0117 hooks research; Mem0 /
claude-mem / MemPalace docs verified. Alignment: makes the four verbs
infrastructural — the strongest reading of "your backlog is your agent's
memory".*

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
only if the judged fixture proves persistent aboutness failures — lazy,
local, fallback-safe over top-10/20. **2026-07-16 update**: the candidate
moved — 0083's ms-marco-MiniLM-L6 is obsolete; the Ettin CrossEncoder
family (17M/32M/68M ModernBERT, 8k context, SOTA-at-size) is the modern
bench, and Transformers.js v4's ~4× encoder speedup funds the latency
budget. *Source: 0083 §next-gen; 0116 R-9; Ettin model cards.*

**Deterministic heading-path chunking** · M — Long ADRs currently embed as
one truncated vector (256 wordpieces); the fix is heading/paragraph chunks
as derived cache, collapse-to-parent, winning chunk supplies the snippet.
Conditional on the tail gate failing (0116 R-8; audit F15). **New evidence
(2026-07-16)**: prepending the heading breadcrumb (`Doc > H1 > H2`) into
chunk *text* is now evidence-backed, and one comparative eval found the
free deterministic version outperforms Anthropic-style LLM contextual
summaries on heading-rich corpora — our exact shape; external support for
R-8's no-LLM stance. *Alignment: "expand like a filesystem" applied to
document interiors.*

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

**Inclusion-mode frontmatter for disclosure** · S/M — Steal Kiro steering's
`inclusion: always | fileMatch | manual` key: per-doc disclosure policy in
frontmatter, so a doc tagged `fileMatch: "packages/server/**"` surfaces in
wakeup/recall only when the agent works there. The cleanest published
conditional-loading mechanic in the field, and it's a file convention, not
infrastructure. Pairs with AGENTS.md's proven nearest-wins precedence.
*Source: Kiro steering docs; agents.md (verified 2026-07-16). Alignment:
progressive disclosure gains a location axis.*

**Edit-time constraint verdicts** · M — The compliance lane is essentially
unshipped at scale (only Mneme, 17★, does it: deterministic field-weighted
constraint retrieval + a PreToolUse hook that surfaces or blocks a
violating edit before it lands). 0113.1's constraint stubs are ahead of
the market; this entry is the end-to-end completion — verdicts delivered
mid-task while the agent still has context, not at review. Client-side
hook, deterministic retrieval, human authority preserved. *Source: Mneme
(reference implementation); 0113.1. Alignment: requirements that protect
the vision during work, at the moment of the keystroke.*

**Requirement deltas as write grammar** · M — Steal OpenSpec's change
model: requirement edits expressed as ADDED/MODIFIED/REMOVED deltas that
fold into the canonical substrate doc on completion, with an archive that
stays queryable. Gives `remember`/`forget` a principled diff input for the
Requirement substrate and matches supersede semantics. *Source: OpenSpec
(61k★, verified). Alignment: docs-native lifecycle without a second tool.*

**Write-time memory reconciliation** · M — Steal Mem0's core op, minus the
server LLM: on `remember`, the *calling agent* is shown near-duplicate
candidates and chooses ADD / UPDATE (supersede) / NOOP before writing.
Kills duplicate drift at the source instead of via consolidation cleanup.
Deterministic server (similarity candidates via the existing index),
judgment in the agent. *Source: Mem0 architecture (verified). Alignment:
one source of truth per fact, enforced at intake — rhymes with the routing
proposal.*

**Byte-budgeted wakeup + sleep-time consolidation** · M — Two confirmed
patterns that complete our flywheel: Letta's budgeted always-loaded blocks
(hard per-section size limits; over-budget forces compression) and
OpenAI's Dreaming V3 (async cross-session synthesis pass). Ours would be:
enforce section budgets in wakeup structurally, and offer an end-of-session
"dream" skill for the external consolidator — rewrite, merge, retire.
Claude Code's own 200-line/25KB memory-index cap validates the budget
posture. *Source: Letta memory blocks; OpenAI Dreaming V3 (verified).*

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
no gate. **Verified candidates (2026-07-16)**: Transformers.js v4 alone
buys ~4× encoder speed at near-zero risk (S, do first); EmbeddingGemma-300m
q4 + MRL-256 is the modern MiniLM successor (official ONNX); potion-
retrieval-32M static embeddings (~87% of mpnet quality at 100–400× CPU
speed) make a compelling cheap control arm — and would make full-corpus
re-embeds effectively free. 0116 R-7 names Arctic-embed-s as the one
challenger; re-evaluate against this newer field when Phase 2B opens.

**Snapshot hardening + vector compaction** · S — Atomic temp+rename write
(audit F12; 0116 R-6 shelved-until-incident) plus measuring whether JSON
float arrays deserve a binary sidecar. Explicitly incident/budget-gated —
listed so the incident, if it comes, has a ready pick.

**Epistemic claim typing** · M — Steal Hindsight's four-network insight as
a frontmatter enum: a memory is a *fact*, an *experience*, or a
*belief-with-confidence* — and recall reports which kind it returns.
Beliefs are revisable by contradicting evidence; facts are not. The
highest-leverage schema idea in the 2026 survey, and no markdown-native
tool has it. Composes with `kind` and the contradiction detector rather
than replacing them. *Source: Hindsight (91.4% LongMemEval; verified).
Alignment: trust signals become epistemically honest.*

**Tense-aware consolidation** · S/M — Steal Dreaming V3's most legible
trick deterministically: a consolidation pass that flags future-tense or
dated claims whose date has passed ("deploying in July" after July) as
supersede candidates for the external agent. Pure date logic in the
server, judgment in the consolidator. *Source: OpenAI Dreaming V3
(verified); rides 0092.7 consolidation.*

## Design-pattern

**Control-vs-recorded-baseline evaluation split as public methodology** ·
S — JUDGING.md's builder≠judge protocol, graded qrels with rationale, and
the mocked-control vs real-model-baseline distinction is genuinely good
practice most agent products lack. Write it up (blog/README section) as a
credibility asset for the positioning push. Two cheap hardening steps from
the 2026 field: cross-validate our TS metrics once against the canonical
`trec_eval` binary on the same qrels (certifies the harness), and adopt
the UMBRELA judge prompt verbatim (versioned like code, frontier model
only, ~10% human spot-check) for LLM-assisted judging — offline only.
*Source: docs/evaluation/JUDGING.md; 0116 Finding 8; UMBRELA + successors.*

**Stub-grammar conventions registry** · S — age_days / uses / idle_days /
checked_days_ago now span two substrates; record the grammar in the 0113
R7 disclosure descriptor so substrate #3 doesn't invent a fourth suffix.
*Source: beryl's 0113.1 review note. Alignment: one trust language across
every surface.*

**Wakeup as a briefing product** · M — The ~600-token briefing is the
product's front door; treat its composition (identity, now, knowledge,
constraints, recent) as a designed document with section budgets and
precedence rules (constraints > knowledge, per the 0113.1 ruling) rather
than accreted folds. A short design ADR, then incremental. (Verified
context: Letta's budgeted blocks and Claude Code's 200-line/25KB memory
index cap both validate hard section budgets; see the byte-budgeted
wakeup entry.)

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

**Engine-agnostic retrieval seam + named contingencies** · M — **Verified
2026-07-16: Orama JS is effectively in maintenance mode** (v3.1.18 frozen
since late 2024, no v4; company energy moved to OramaCore, a Rust
server+LLM product — the wrong shape for us). Not a reproduced ceiling, so
0116 R-2 stands, but it upgrades this entry from spike to posture: keep
the fusion/eval layer engine-agnostic so a swap is a fixture-gated
experiment, not a rewrite. Named contingencies if a ceiling reproduces:
LanceDB JS (production, embedded, native hybrid BM25+vector, versioned
on-disk format) or sqlite-vec / libSQL-vector (single-file index; brute
force is plenty at our corpus size).

**Late-chunking spike** · M — Jina's pool-after-full-doc-embedding trick
(≈30-line pooling change) needs a long-context token-level model — MiniLM's
window is too short, EmbeddingGemma's 2k works — so it only becomes
pickable after a model succession. The deterministic contextual-retrieval
variant (heading breadcrumbs in chunk text) graduated to evidence-backed —
see the chunking entry. *(Verified 2026-07-16.)*

**llms.txt + AGENTS.md stub emission** · S — Emit a root `llms.txt` table
of contents and folder-level AGENTS.md stubs from the backlog index,
pointing into docs/. AGENTS.md is now a Linux-Foundation-stewarded de
facto standard (60k+ repos, 20-30 tools, nearest-wins precedence) — this
makes every non-MCP agent able to navigate the corpus for free. *Source:
agents.md; OpenWiki pattern (verified). Alignment: interop without a
second contract.*

---

## External landscape notes (verified 2026-07-16, primary sources)

What the three scout passes confirmed, refuted, or newly surfaced:

- **The field converged on OUR recall posture.** The "everyone injects
  memory every turn" claim is stale: Mem0's official plugin now injects a
  session-start decision rubric and lets the agent decide when to search;
  claude-mem pivoted to search-first progressive disclosure (~50-100-token
  ID index → detail on demand); MemPalace injects at session start only.
  Intent-gated, search-first recall — i.e., what we already ship — is the
  2026 consensus. Positioning material.
- **Letta pivoted toward our substrate**: "MemFS" is a git-backed markdown
  memory filesystem (frontmatter, always-loaded `system/`, on-demand rest,
  dream subagents writing lessons on compaction triggers). The strongest
  external confirmation of the docs-native bet yet. Budgeted core blocks
  confirmed as designed.
- **Zep/Graphiti bi-temporal model confirmed** (four timestamps per edge;
  contradicted edges expired, never deleted). Steal the valid-time vs
  recorded-time distinction and the invalidate-don't-delete framing —
  our supersede/valid_until already implements the bones; the historian-
  mode entry above completes it.
- **basic-memory confirmed as closest cousin** (v0.22, active, now chasing
  cloud sync). Steal candidates: typed inline observation lines
  (`- [category] fact #tag`) and `memory://` URL addressing. The moat to
  state loudly: lifecycle verbs (wakeup/forget), substrates, contradiction
  detection, judged evaluation — curated claims vs conversation exhaust.
- **The compliance lane is empty at scale.** Only Mneme (17★) ships
  requirement-compliance surfacing to agents; spec-kit's `/analyze` checks
  artifact consistency at plan time only. 0113.1 is ahead of the market —
  the edit-time verdicts entry above is the completion.
- **SDD is mature and memory-less.** spec-kit (122k★), OpenSpec (61k★),
  Kiro, Tessl all treat repo-resident markdown specs as agent ground truth
  — and none carry memory across changes. That gap is precisely this
  product. Steal-worthy singles: spec-kit's constitution file (a
  non-negotiables doc at maximum wakeup precedence — a Requirement-
  substrate framing, S), Tessl's spec back-propagation (post-implementation
  "what did this teach us" memory step, S as protocol text).
- **AGENTS.md won standardization** — 60k+ repos, 20-30+ native tools,
  Linux Foundation stewardship, nearest-file-wins precedence. Stable
  interop target (see llms.txt entry); its nearest-wins rule also
  validates the inclusion-frontmatter entry's location axis.
- **claude-mem (72k★) failed a security audit** (unauthenticated localhost
  API exposed all stored observations) — a live argument for the
  no-daemon, files-only posture. Its trajectory→observation capture
  (memory from what the agent *did* via PostToolUse) remains the steal.
- **The PKM incumbents are vacating markdown ground** just as agents need
  it: Logseq 2.0 moved to SQLite+RTC, Dendron is officially dead, Foam
  quiet. The "markdown files agents and humans co-own" niche is opening,
  not closing.
- **Anthropic's API memory tool** (client-executes, model-requests file
  ops; read-only mounts for untrusted contexts) validates our exact trust
  split — we are the interoperable, multi-agent version. **OpenAI Dreaming
  V3** (async cross-conversation synthesis) is opaque-cloud consolidation
  — "your Dreaming, but you can read the dream" is the line.
- **MemPalace's verbatim-first storage** (exact quotes preserved beneath
  summaries) and **Cline's activeContext.md convention** (one mutable
  current-state doc distinct from durable memory) are small, cheap
  patterns worth folding into the memory protocol docs. (Both S.)

## How to pick

Open an ADR that cites the garden entry; the entry's sources are its
research trailhead. Fixture-gated entries (marked) cannot ship ranking
changes without the recorded baseline — that gate is domain law (R3), not
process preference.
