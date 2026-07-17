---
title: "0114. Memory vs Context — Tool-Surface Disposition: Fold Context Into the Memory-Verb Language"
date: 2026-07-16
status: Accepted — implemented (shipped 0.59.0, 2026-07-16 — backlog_context removed, relational context folded into backlog_get(context) stubs; CHANGELOG 0.59.0 Removed/Added, tool gone from src); status reconciled 2026-07-17
---

# 0114. Memory vs Context — Tool-Surface Disposition

**Date**: 2026-07-16
**Status**: Accepted — implemented (shipped 0.59.0, 2026-07-16 — the backlog_context tool and its hydration pipeline are removed; relational neighborhood + reverse refs arrive as role-grouped stubs via backlog_get(context); CHANGELOG 0.59.0). Status reconciled 2026-07-17.
**Thread**: continues ADR 0106 (semantic intent-tools at the MCP boundary); disposes of the tool surface built by ADRs 0074–0078; siblings: ADR 0112 (docs-native project backlog), ADR 0113 (user-defined substrates), NORTH-STAR.md
**Question settled**: Goga: *"I used memory much much more than the context-engineering tools… Should we remove the context related tools or no? I am slightly torn — inclined to simplify and uplift, but context engineering has merit and we just need to figure out how to extract value out of it."*

## TL;DR — the ruling

**Fold, don't remove and don't uplift.** Retire `backlog_context` as a tool;
keep the hydration *capability* — graph expansion, cross-references, reverse
references — and re-express it through the ergonomics that demonstrably won:
**`backlog_get` grows a `context` option that returns the focal entity in full
plus its relational neighborhood as stubs** (id + title + status + relation
role), which the agent hydrates with further `backlog_get` calls. Time-oriented
context (`activity`, `session_summary`) is already `backlog_wakeup`'s job;
query-oriented discovery is already `backlog_search`'s job. After the fold
there is **one retrieval language** — orient (`wakeup`), ask (`recall` /
`search`), expand (`get`) — and progressive disclosure everywhere, instead of
two dialects where one hands out stubs and the other hands out a 4,000-token
pre-packed bundle.

The blur Goga feels is real and structural: five of the seven sections
`backlog_context` returns are another tool's job today. What is *uniquely* its
job — the relational neighborhood — is one `get` option, not a second retrieval
surface.

## Part 1 — Audit: the two surfaces as built

### 1.1 The context surface (ADRs 0074–0078)

One tool, `backlog_context` (`packages/server/src/tools/backlog-context.ts`),
backed by a six-stage pipeline (`packages/server/src/context/hydration-service.ts:9-22`):
focal resolution → relational expansion → cross-reference traversal (forward +
reverse) → semantic enrichment → session memory → temporal overlay → token
budgeting. The response bundles up to twelve sections: focal, parent, children,
siblings, cross_referenced, referenced_by, ancestors, descendants,
related_resources, related, activity, session_summary
(`backlog-context.ts:95-147`).

Input ergonomics (`backlog-context.ts:41-48`):

- **Requires** `task_id` or `query` — errors without one (`backlog-context.ts:51-56`).
  There is no zero-arg mode; you must already know what you want context *for*.
- Six knobs (`depth`, `max_tokens`, `include_related`, `include_activity`, …).
- Default response budget: **4,000 tokens** (`backlog-context.ts:63`), packed
  by a 12-level priority scheme with char-based token estimation
  (`packages/server/src/context/token-budget.ts:1-13`).

Footprint: ~1,960 lines of source across the pipeline + tool
(`src/context/` + `stages/` + `tools/backlog-context.ts`), plus a 2,781-line
test file (`src/__tests__/context-hydration.test.ts`). No write verb — the
context surface is read-only; nothing an agent does creates demand for it.

### 1.2 The memory surface (ADR 0092.3 and the 0092.x thread)

Six tools: `backlog_wakeup`, `backlog_recall`, `backlog_remember`,
`backlog_forget`, plus curation satellites `backlog_consolidation-candidates`
and `backlog_contradictions`. Ergonomic properties, each cited:

- **Zero-argument orientation.** `backlog_wakeup` has no required params
  (`tools/backlog-wakeup.ts:42-55`); the schema is four optional tuning knobs.
  Cost of first use: nothing.
- **Verb-shaped intent** (ADR 0106's thesis, proven first by memory —
  ADR 0106 §North Star cites `backlog_remember` as the existence proof).
- **Stubs-then-hydrate progressive disclosure.** Recall returns stubs by
  default — *"Returns STUBS (id + one-line digest) by default; expand
  interesting ones with backlog_get(MEMO-id)"* (`tools/backlog-recall.ts:38`).
  ADR 0092.3 explicitly ruled that `backlog_get` *is* the hydration step —
  no bundle tool was built for memory.
- **A write verb that creates read demand.** `backlog_remember`
  (`tools/backlog-remember.ts:33`) plus implicit capture on task completion
  mean the corpus grows during normal work; every remember is a future recall.
- **Usage-ranked self-curation.** Recall demand, expands, and citations are
  logged (`tools/backlog-recall.ts:69-71`; `memory/usage-tracker.ts`, two-tier
  JSONL + frontmatter per ADR 0092.9 R-13/R-14/R-16); useful memories rank up,
  stale ones decay.
- **Protocolized.** AGENTS.md §Memory Protocol institutionalizes the loop —
  wakeup once, recall per task, remember what's durable, correct via
  supersedes — in every session's instructions. `backlog_context` appears in
  no protocol, no AGENTS.md, no skill.

### 1.3 Overlap matrix — the anatomy of the blur

For each information need, which tools answer it today:

| Information need | Context surface | Memory surface | CRUD/search surface |
|---|---|---|---|
| "What am I working on?" | — (needs a focal id) | `wakeup` (now/active/epics) | `list` (status filter) |
| "What happened recently?" | `context.activity` + `context.session_summary` | `wakeup` (recent completions + activity) | — |
| "How do we do Y here?" | — | `recall` (procedural/semantic) | — (memories hidden from search by design, AGENTS.md §Memory Protocol) |
| "Have I hit this before?" | — | `recall` (episodic) | — |
| "Find things about topic T" | `context(query=T)` — resolves to ONE entity + neighborhood | — | `search` (ranked list) |
| "Everything about TASK-X" | `context(task_id)` — the unique value: parent/children/siblings/refs/reverse-refs | — | manual `get`+`list`+`search` chain (the 5–10 calls ADR 0074 set out to kill) |
| "Raw content of X" | — | — | `get` |
| "What references X?" | `context.referenced_by` (Phase 5 reverse index) | — | — |

Read the columns: **every context section except the relational neighborhood
is a duplicate.** `activity`/`session_summary` duplicate `wakeup`; `query`
mode duplicates `search` (worse: it silently picks the top hit —
`context/stages/focal-resolution.ts`); `related`/`related_resources` duplicate
`search` from a synthesized query. Two tools claim "what happened recently"
and give different answers from the same operation log. That is the blur:
not that agents can't tell memory from context, but that *the context bundle
is mostly other tools' answers, re-packed*.

The one row where context is genuinely alone — relational neighborhood,
including the reverse-reference index — is real value, and it's exactly the
part worth keeping.

## Part 2 — Usage evidence (stated honestly)

**Hard local data is absent on this machine, and we say so rather than
overclaim.** `~/.backlog` here contains only `.cache/` and `logs/` (server
logs, no entities, no `memory-usage.jsonl`, no operations JSONL). The
`backlog_wakeup`/`backlog_recall` calls made against the live connected
instance during this audit returned empty results. Goga's heavy real-world
usage ran against the **remote D1 instance**, whose operation log lives in D1
(`D1OperationLog`, ADR 0094) and was not queryable for this ADR. Mining it is
the follow-up that would harden or falsify this ruling (§6).

The structural evidence, however, is unambiguous — and it reveals something
the "memory won on ergonomics" framing misses:

1. **`backlog_context` does not exist in remote mode.** Its registration is
   gated on `resourceManager && operationLogger`
   (`tools/index.ts:61-63`), and the Worker entry passes neither
   (`worker-entry.ts:31-45`). The MCP tool list of the instance connected to
   this very session confirms it: 13 `backlog_*` tools, **no
   `backlog_context`**.
2. **Even if registered remotely, it would be hollow.** The hydration pipeline
   consumes optional sync methods — `service.getSync?.(id)`,
   `service.listSync ? … : []` (`tools/backlog-context.ts:68-69`) — which only
   the local `BacklogService` implements
   (`storage/backlog-service.contract.ts:40-44`). On D1 every relational
   expansion would come back empty.
3. **Memory degrades more gracefully remotely but is also Node-first**:
   without a composer, `recall` returns empty (`core/recall.ts:34-36`) and
   `remember` throws (`core/remember.ts:45-47`), while `wakeup`'s knowledge
   section still works anywhere because memories are substrate entities
   listed through the service (`core/wakeup.ts:172-179`).
4. **The instrumentation asymmetry is itself evidence of investment.** Memory
   has a demand log (`memory-usage.jsonl`, `memory/bootstrap.ts:51-73`), usage
   counters, decay, sparklines (ADR 0092.9–0092.14). Context has no usage
   instrumentation at all — we cannot even measure whether it's used without
   grepping the generic operation log.

So the honest statement is: **the race was never fair** — in the deployment
where the heavy usage happened, context wasn't on the starting line. But that
does not rescue the tool: local mode is the primary posture (ADR 0104), Goga
had context available locally throughout, and the protocol/ergonomic analysis
below explains why it loses even on a fair track.

## Part 3 — Why memory won (testing the hypotheses)

Candidate explanations, ranked by how load-bearing the evidence says they are:

1. **Protocolization (load-bearing, the strongest).** AGENTS.md §Memory
   Protocol puts wakeup/recall/remember into every session's standing
   instructions with a *discipline* (once per session, once per task topic).
   `backlog_context` is in nobody's instructions. Tools that are in the
   protocol get called; tools that rely on the agent spontaneously remembering
   they exist don't. This alone could explain most of the delta — and it is
   itself downstream of ergonomics: memory *could* be protocolized in three
   short bullets because its verbs map one-to-one onto moments in a session
   (start → wakeup; new topic → recall; learned something → remember).
   There is no equivalent moment for "get a 4k bundle about one entity."
2. **Zero input friction at the session's highest-leverage moment
   (load-bearing).** `wakeup` requires nothing; `context` requires a focal
   `task_id`/`query` — but at session start, *knowing what to focus on* is
   precisely what you don't have yet. Context's required input is wakeup's
   output. The dependency ordering guarantees wakeup wins the first call, and
   the first call anchors the session's retrieval habits.
3. **The write side creates the read demand (load-bearing).**
   `remember` + implicit capture grow a corpus that only `recall` can read
   (memories are deliberately hidden from `search`/`list`). Every write is a
   standing reason to read. Context has no write verb and no exclusive corpus
   — everything it returns is reachable through `get`/`list`/`search`, so
   skipping it costs nothing visible.
4. **Distilled knowledge vs raw structure (real, secondary).** Recall returns
   facts a past agent judged worth keeping — pre-compressed, decision-shaped.
   Context returns structure the agent must still interpret (siblings,
   ancestors, activity rows). Distillation is what context budget is *for*;
   re-derivation is what it's wasted on.
5. **Progressive disclosure vs pre-packed bundle (real, secondary).** Recall's
   stubs cost tens of tokens and let the agent choose depth; context commits
   ~4k tokens up front, budgeted by char-count heuristics
   (`token-budget.ts:4-6`) rather than by what the agent actually needs next.
   Under ADR 0106's deferred-loading world, stubs + `get` is the house style;
   the bundle is the old world's shape — it was designed (ADR 0074) to
   amortize tool-call round-trips that have since become cheap.
6. **Verb-shaped intent (real, but not sufficient alone).** `wakeup`/`recall`/
   `remember` name moments in the agent's loop; `context` names a noun. But a
   verb alone wouldn't have saved it — `backlog_orient` with the same required
   focal id and the same bundle would have lost the same way (explanations
   1–3 would still all cut against it).

**What this teaches about context engineering's unrealized value:** the
*pipeline* was never the problem — relational expansion and the reverse-ref
index answer a question nothing else answers. The *delivery shape* was the
problem: a parameter-heavy, focal-first, pre-budgeted bundle with no protocol
moment, no write side, and no presence in the deployment that mattered. Extract
the value by giving the capability the winning shape, not by keeping the losing
shape alive next to it.

## Part 4 — Options and decision

### Option A — Remove

Delete `backlog_context` + `src/context/`. Simplest; `search`/`get`/`recall`/
`wakeup` cover most needs. **Rejected** because it discards the one genuinely
unique capability (relational neighborhood + reverse references) and reverts
"everything about TASK-X" to the 5–10 manual calls ADR 0074 correctly
diagnosed — now with no discovery path for reverse refs at all, since no other
surface computes them.

### Option B — Fold (CHOSEN)

Retire the *tool*; re-express the *capability* in the memory-verb language:

- **R-1. `backlog_get` gains `context: boolean`** (default false; a
  `depth: 1|2` refinement may ride along). With `context: true` the response
  is the focal entity in full **plus relation stubs grouped by role** —
  `parent`, `children`, `siblings`, `references`, `referenced_by`, `related`
  — each stub being id + title + status (+ relation provenance), reusing
  `stages/relational-expansion.ts` and `stages/cross-reference-traversal.ts`
  nearly as-is, and `stages/semantic-enrichment.ts` as the stub source for
  `related`. Stubs, not bodies: hydration is another `get`, exactly the
  recall pattern (`tools/backlog-recall.ts:38`). This makes `get` the single
  "expand" verb for *both* corpora — memories and entities — which is what
  ADR 0092.3 already decided for memory.
- **R-2. Time stays with `wakeup`.** `stages/temporal-overlay.ts` and
  `stages/session-memory.ts` are not folded into `get`; wakeup already owns
  "what happened recently" (`core/wakeup.ts`) and per-entity activity is a
  viewer/`wakeup --scope` concern. If per-focal session summaries prove
  needed, they land as a wakeup refinement, not a `get` payload.
- **R-3. Discovery stays with `search`.** `context(query=…)` mode
  (silent top-1 focal resolution) is dropped without replacement; the honest
  flow is `search` → pick → `get(id, context: true)`.
- **R-4. One retrieval language, protocolized.** AGENTS.md's protocol gains
  the third moment it's been missing: *orient* (`wakeup`) → *ask*
  (`recall`/`search`) → *expand* (`get`, with `context: true` when starting
  work on an entity). The protocol slot that context never had is the fold's
  real payoff.
- **R-5. Progressive-disclosure seam for substrates (ADR 0113).**
  User-defined substrates that opt into disclosure surfaces (e.g. REQ
  constraints in wakeup, recallable project knowledge) get relation stubs in
  `get(context: true)` for free, because the fold makes stub-shaped relational
  context a property of *every* entity, not of tasks blessed by a special tool.

**Why B over A**: keeps the unique capability, deletes the duplicate delivery.
**Why B over C**: C keeps two retrieval dialects and bets that renaming +
re-parameterizing fixes a tool whose failure was structural (no protocol
moment, focal-input ordering, bundle shape) — §3 says it wouldn't.

### Option C — Uplift as its own verb

Rename/redesign `backlog_context` (e.g. `backlog_orient <id>`) with fixed
ergonomics, register it everywhere, protocolize it. **Rejected**: every fix C
needs (stub output, protocol moment, availability) is something B gets by
riding surfaces that already won, at the cost of zero additional tools. ADR
0106's own logic cuts against a broad bundle tool: narrow, intent-shaped,
deferred-loaded tools are the direction; a twelve-section response is not.

## Part 5 — Migration plan

One change, no deprecation window. This is our own tool and we are its only
users (maintainer directive, 2026-07-16): no legacy paths, no
backwards-compatible mindset — write the new code, delete the old in the same
change.

1. `core/get` (or a thin `core/context-stubs.ts`) composes relational
   expansion + cross-ref traversal + semantic enrichment into role-grouped
   stubs; `tools/backlog-get.ts` grows the `context`/`depth` params. Existing
   usage-tracker expand semantics on `get` (ADR 0092.9 R-13) apply unchanged.
2. Simple size cap on stub lists (counts, not token packing) — the 12-level
   budgeter (`context/token-budget.ts`) is not carried over; stubs make it
   unnecessary.
3. In the same change, delete `tools/backlog-context.ts` (and its
   registration in `tools/index.ts`), `context/hydration-service.ts`,
   `context/token-budget.ts`, `stages/focal-resolution.ts`,
   `stages/temporal-overlay.ts`, `stages/session-memory.ts`, and the bundle
   assertions in `__tests__/context-hydration.test.ts`.
   `relational-expansion.ts`, `cross-reference-traversal.ts`, and
   `semantic-enrichment.ts` move under the `get` path with their tests.
4. AGENTS.md §Memory Protocol adds the *expand* step (R-4).

### Consequences

- ~2,000 source lines + ~2,800 test lines are **removed immediately** — no
  deprecated-description release, no transition period in which both surfaces
  exist.
- Any session instructions or muscle memory referencing `backlog_context`
  break at once; the fix is the protocol update in step 4, shipped in the
  same change.

Supersessions: this ADR **supersedes the tool surface of ADRs 0074–0078**
(`backlog_context` as delivery vehicle, the token-budget bundle, query-mode
focal resolution). It **preserves and re-homes** their pipeline contributions
(relational expansion, cross-references Phase 4, reverse references Phase 5).
ADR 0074's vision section — the backlog as shared memory for humans and agents
— is not superseded; it is the part that won.

## Part 6 — Falsifiability

This ruling should be revisited if:

- **Remote usage mining contradicts it**: querying the D1 operation log shows
  meaningful, *repeated* `backlog_context` adoption in any period where it was
  actually registered (currently impossible — see §2.1 — so this effectively
  means: after a fair A/B window in local mode, instrument both surfaces and
  compare demand).
- **Stub-shaped context proves too shallow**: if post-fold sessions routinely
  chain 6+ `get` hydrations after a `get(context: true)`, the bundle
  hypothesis (pre-packing beats round-trips) was right after all and Option C
  deserves a second look with agreed ergonomics.
- **`get` bloats**: if the `context` option measurably degrades the plain
  `get` path (latency or schema comprehension), split it back out as a
  narrow verb — but with stub output and a protocol moment, i.e. C informed
  by B, not a return to the bundle.
