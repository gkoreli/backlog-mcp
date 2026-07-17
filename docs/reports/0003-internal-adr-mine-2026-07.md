---
title: "Internal ADR Mine — Shelved, Deferred, Parked, and Superseded-but-Alive Optionality"
date: 2026-07-17
status: Final
author: granite-subagent
---

# Internal ADR Mine — July 2026

Directive: "continue mining adrs code architecture authoritative docs." This
report is a systematic sweep of the repo's own decision corpus — all of
`docs/adr/` (153 files), `docs/proposals/` (19), `docs/reports/`,
`docs/NORTH-STAR.md`, `docs/evaluation/`, `docs/prompts/`,
`docs/framework-adr/` — plus code-level deferral markers across `packages/`
— for buried optionality: everything SHELVED, DEFERRED, PARKED, or
SUPERSEDED-BUT-ALIVE that the project's fast evolution left behind.

Every entry carries an exact citation (file + section/quote), what precisely
was deferred, the recorded revival trigger, and a classification:

- **BUILD-SHAPED** — could be chartered as a work slice today, consistent
  with the north star.
- **GARDEN** — valuable, waits for a named trigger.
- **DEAD** — superseded; the superseding decision is cited.

## Method

1. **Dogfood-first navigation.** The corpus was navigated with the product
   itself: `node packages/server/dist/cli/index.mjs --home project
   --project-root <repo-root>` with `search`, `recall`, `wakeup`, `get`,
   `list`, `contradictions`, `consolidation-candidates`. Twenty CLI
   interactions across sixteen distinct navigation questions; every hit,
   miss, and friction event logged (see the friction log section — it is
   first-class experimental data, not an appendix).
2. **Parallel close-read sweeps.** Four reader passes covered ADRs
   0001–0091, 0092–0106.5, 0107–0120 (+ NORTH-STAR, evaluation, prompts,
   framework-adr), and proposals/reports. Each pass hunted sections titled
   Deferred / Future / Out of scope / Open questions / Phase N / Alternatives
   considered, plus inline "for now" / "later" / "parked" language.
3. **Code-marker sweep.** `packages/` source (not dist) grepped for TODO,
   FIXME, deferred, parked, "for now", quarantine, "phase two", seam, and
   the known named seams (P-4 allocator, engine-agnostic search,
   wakeup(operation=), D1).
4. **Verification.** Flagship entries were re-read first-hand and quotes
   pinned with line-level grep. Grep/read fallbacks from dogfood misses are
   recorded in the friction log.

## The mined inventory

Entries are deduplicated across sources: one capability = one entry, citing
every site where it was shelved. Classifications are editorial calls made
against `docs/NORTH-STAR.md`; where a named trigger has arguably already
fired, that is said explicitly. Paths are repo-relative.

Counts: **21 BUILD-SHAPED · 28 GARDEN · 22 DEAD** (plus a closed-deferral
appendix showing the 0092.x series' self-closing chains).

### BUILD-SHAPED — charterable as a slice today

**B1. The cold-open wakeup fix charter (Slices A/B/C).**
`docs/proposals/wakeup-first-impression-2026-07.md` §"The fix charter" — one
bounded orientation line of openable stubs (README, AGENTS.md, vision doc,
index docs), injected temporal-recency map, pretty-UTF-8 ≤3,072-byte gate.
Subsumes `docs/proposals/nisli-zero-setup-cold-open-2026-07.md` §Impact
("bootstrap pointers"), `docs/proposals/cold-open-ab-experiment-2026-07.md`
§Impact (temporal grounding, root-doc ingestion, empty-wakeup honesty), and
`docs/reports/exp1-nisli-bolton/` BUG-0001/BUG-0002 (both P0). Trigger:
named acceptance harness — "Nisli EXP-1a: clean bolt-on; first-wakeup grade
>=8/10; useful in under [a minute]" (`wakeup-first-impression-2026-07.md:249`)
and the EXP-2 rerun where the tool must beat raw files. Evidence pressure:
EXP-2 measured tool-only 8/10 at +76% tokens vs raw files 10/10; EXP-1
scored wakeup 1.0/5; this mine's F4 (wakeup shows 1 of ~25 decisions) is a
fresh third strike in the same class.

**B2. The EXP-1 repair batch.** `docs/reports/0002-exp1-aime-bolt-on-bugs.md`
(B-1 git-dirtying cache, B-2 oldest-ID disclosure fallback, B-3 silent
requirement downgrade, B-4 `remember` writes absent from the journal) plus
`docs/reports/exp1-nisli-bolton/README.md` BUG-0003/0004/0005 (resource
status not searchable; variadic-tags footgun; read-only wakeup dirties
checkout). All Open. `docs/proposals/aime-bolt-on-trial-2026-07.md` §5 sizes
the "measured repair-and-rerun slice" at M with a hard falsifier: "falsified
if either rerun still scores below 4/5". Defect-class work, not features.

**B3. Implicit qrels from the journal → 0116 baseline v2.**
`docs/proposals/implicit-qrels-from-journal-2026-07.md` §Proposal — "a
read-only extraction fold" over query→stubs→hydration sequences emitting
candidate qrels. Trigger: recall-affecting ranking is ruled blocked until
baseline v2, which needs real recall queries with judgments
(`docs/evaluation/README.md`; baseline v1 is search-only, 235 reviewed
qrels in `docs/evaluation/search-qrels-v1.jsonl`). Caveat recorded by the
usage instrument: the journal was empty at proposal time — the fold is
charterable now, its input accumulates with usage.

**B4. `wakeup(operation=)` focal selection + operation-state substrate.**
Shelved in code: `packages/server/src/__tests__/amnesia.test.ts:23-28` —
"Deferred by design: `wakeup(operation=<agent>)` focal selection rides ADR
0119's identity substrate; with one live operation doc per project the
declared section already delivers the briefing." Confirmed unbuilt: the
wakeup inputSchema (`packages/server/src/tools/backlog-wakeup.ts:59-74`)
has no `operation` parameter. Asked of Goga in
`docs/proposals/amnesia-test-continuity-engine-2026-07.md` §"Decision asked
of Goga" (operation-state substrate as project-authored definition, S).
Listed verbatim in `docs/reports/0001-phase-one-vision-uplift.md` §"Phase
Two scope (recorded, not started)". Trigger: ADR 0119 (Accepted) supplies
the identity substrate; more than one live operation doc per project ends
the "declared section suffices" escape.

**B5. ADR 0120 completion to its fixture gate.**
`docs/proposals/semantic-contradiction-detection-2026-07.md` header:
"Status: Validated build — implemented under ADR 0120"; but ADR 0120
frontmatter is still Proposed and
`docs/reports/0001-phase-one-vision-uplift.md` records "Phase A committed
15a8257, parked". Trigger: the proposal's own gate — "The evaluation
fixture gains 4+ judged collision cases… Precision on these is the
go/no-go for enabling write-time surfacing by default." An authorized,
in-flight build parked mid-flight: finishing it is the cheapest way to
convert sunk design into the differentiator lane
(`docs/adr/0092.13-contradiction-detection.md` calls contradiction
surfacing "the human-in-the-loop differentiator").

**B6. ADR 0118.1 Slice A — the session-start decision rubric.**
`docs/adr/0118.1-intent-gated-recall-lifecycle-hooks.md` (Proposed, design
only) supersedes 0118's every-turn premise; the Phase Two ledger
(`docs/reports/0001-phase-one-vision-uplift.md`) lists "0118.1 Slice A
build" as recorded-not-started. The idea garden
(`docs/proposals/uplift-idea-garden-2026-07.md` §Visionary) prices the
first step: "the cheapest first step is now the decision rubric line in
wakeup (S)."

**B7. ADR 0119 agent-substrate implementation.**
`docs/adr/0119-agent-substrate-and-derived-correlation.md` — status
"Accepted (goga, 2026-07-16)" but design-only; implementation is a named
Phase Two ledger item. Prerequisite of B4.

**B8. Memory verbs in the operation journal.** Deferred twice:
`docs/adr/0092.6-memory-phase-c-engineering-record.md` §"Next phases"
("operation-log entries for remember/forget — memory writes are currently
invisible to the activity panel") and
`docs/adr/0092.10-memory-phase-e-engineering-record.md` §"Next loops" #4.
The idea garden prices it S: "Post-0106.5 this got cheap." Trigger has
FIRED: EXP-1 B-4 (`docs/reports/0002-exp1-aime-bolt-on-bugs.md`) observed
`remember` writes absent from the journal in the field, graduating this
from deferral to defect.

**B9. `include_expired` recall (historian mode).**
`docs/adr/0092.4-memory-phase-a-b-engineering-record.md` §"Deferred,
explicitly" and `0092.6` §follow-ups; garden entry "Historian mode" prices
it S — "just a read param + provenance labeling." No gate recorded.

**B10. Usage-aware memory list views + sparkline extensions.**
`docs/adr/0092.14-usage-sparklines.md` §"Deferred (next loops)" —
"Split-by-type sparkline… the data supports it; one color ships first" and
a per-row usage column "once the detail view proves the read pattern"
(partial gate). Garden lists "Usage-aware memory list views · S".

**B11. Agent-diary viewer facet.** Deferred three times:
`docs/adr/0092.5-agentic-memory-landscape-2026.md` §"Beyond the current
roadmap" ("'what did agent X learn this week' — falls out of the existing
`source` field nearly for free"), `0092.10` §"Next loops" #1, `0092.11`
§Deferred. No gate; stronger now that ADR 0119 gives agents durable
identity.

**B12. CLI parity for context expansion.**
`docs/proposals/architecture-audit-2026-07.md` F10 ("CLI trails MCP") and
garden entry: "`backlog get --context --depth` exists only via MCP." S.

**B13. `/recall` HTTP route on the warm daemon.** Garden §tiny-tool:
"Smallest enabling piece of the proactive-recall vision, shippable
standalone." Sanctioned by the supersession note in
`docs/adr/0118-proactive-recall-hooks.md`: 0118.1 "reverses this ADR's
dismissal of a separate REST route for one narrow seam: clients that
cannot use MCP."

**B14. `backlog doctor`.** Garden §tiny-tool ("The memory-health
observatory's CLI seed") and already specified in
`docs/adr/0113-user-defined-substrates.md` §"Phase E — validation and
migration ergonomics" ("Add `backlog doctor` diagnostics for invalid
definitions, external document drift…").

**B15. llms.txt + AGENTS.md stub emission.** Garden §tiny-tool — "makes
every non-MCP agent able to navigate the corpus for free." S.

**B16. Agentic read-loop recipe as a shipped skill.** Garden §S — "Nobody
has written the reusable agent skill." The server side is already ruled:
`docs/adr/0116-search-and-rag-uplift.md` R-10 keeps agentic RAG "an
external read loop" — the recipe is the missing artifact of that ruling.

**B17. Evaluation-methodology write-up + stub-grammar registry.** Garden
§design-pattern: publish the control-vs-recorded-baseline split
(JUDGING.md exists at `docs/evaluation/JUDGING.md`; the public write-up
does not) and "record the grammar in the 0113 R7 disclosure descriptor."
Both S, credibility assets.

**B18. Usage-instrument follow-on telemetry.**
`docs/proposals/usage-instrument-observed-coverage-2026-07.md` §"Cost &
falsifiability" — "Three follow-on hypotheses are recorded, not built
here: 1. Logging zero-result recalls… 2. A correlation/session id… 3.
Wakeup can report sections served…" #1 is what makes recall hit-rate
measurable at all (this mine's recall misses had no trace).

**B19. Architecture-audit charter menu (non-D1).**
`docs/proposals/architecture-audit-2026-07.md` §"Prioritized uplift
backlog" — ~20 findings, e.g. "P0 | Search writes/initialization race →
single-flight startup + awaited ordered mutation queue → M" and "P0 |
Published Node 18 support is false." Governed as "menus not mandates";
each row is a pre-sized slice.

**B20. Cross-encoder rerank — the trigger is close to fired.** The
longest-lived deferral chain in the corpus:
`docs/adr/0083-search-service-review-and-next-generation.md` §Improvement
2 ("the single highest-impact improvement"), deferred in
`docs/adr/0092.4-memory-phase-a-b-engineering-record.md` §"Deferred,
explicitly" ("cross-encoder re-ranking (ADR 0083 #9 — the remaining
'aboutness' ceiling…)"), echoed in test code
(`packages/server/src/__tests__/search-golden.test.ts:446`), caged by
`docs/adr/0116-search-and-rag-uplift.md` R-9 ("If the fixture proves daily
aboutness failures after candidate retrieval is sound, benchmark the
quantized MiniLM L6 cross-encoder…"). Baseline v1
(`docs/evaluation/reports/search-baseline-v1.json`) records aboutness as
by far the worst query class — nDCG@10 0.528 (bm25) / 0.572 (hybrid)
against ≥0.80 for every other class — exactly what 0083 predicted — so
R-9's gate is one judged-failure analysis away from open.

**B21. Substrate `validParents` enforcement.**
`docs/adr/0098-unified-substrate-architecture.md` §"Follow-up
opportunities" — "Currently declared but not enforced. A follow-up can
wire this as a refinement at create/update time." Small write-boundary
hardening consistent with ADR 0117's strict-managed-writes posture.

### GARDEN — valuable, waiting on a named trigger

*Retrieval & ranking (governed by ADR 0116's gates):*

**G1. Engine-agnostic retrieval seam / Orama swap.**
`docs/adr/0116-search-and-rag-uplift.md` R-2: "Replacing Orama requires a
reproduced product-corpus correctness, scale, or operability ceiling that
cannot be fixed at lower cost." The live seam is
`packages/memory/src/search/types.ts:107-126` ("Implementations can use
Orama, MiniSearch, Elasticsearch, etc."); the garden upgrades it "from
spike to posture" with named contingencies (LanceDB JS / sqlite-vec) on
the Orama-maintenance-mode intel. Ancestors: `docs/adr/0040-search-
storage-decoupling.md` (original seam; flagged as decayed by 0083 §2.8)
and `docs/adr/0101-search-index-reconciliation.md` §"Future direction (not
implemented)" ("If the scoring complexity becomes untenable… Delete the
BM25/fusion/scoring stack entirely. This would remove ~1000 lines").

**G2. Staged BM25-first initialization.** 0116 R-4 — built only "If
availability fails its gate" (Phase 0 cold-start measurement). Related
audit finding F5 (minute-long first search) is the pressure record.

**G3. Snapshot hardening, async workers, binary vectors, compaction.**
0116 R-6: "admitted by incident or budget… Async workers, binary vectors,
a cache module, and compaction remain shelved." Garden: "Explicitly
incident/budget-gated (audit F12; 0116 R-6 shelved-until-incident)."

**G4. Embedding challenger swap.** 0116 R-7: one same-dimension challenger
(Arctic Embed S) only "If semantic failures are reproduced"; BGE small
next only if inconclusive; long-context models only after tail failures
survive a 512-token model. The garden's embedding-quality half
(EmbeddingGemma, potion-retrieval) waits on the same fixture; the
Transformers.js v4 speed half is S and ungated (near-BUILD).

**G5. Deterministic heading-path chunking; late chunking.** 0116 R-8:
"Chunk only when tail-content recall proves the need"; "Late chunking,
overlaps, summaries, and semantic splitters are deferred until a specific
boundary failure justifies them." Garden: late-chunking spike "only
becomes pickable after a model succession."

**G6. Corroboration boost (Hindsight proof_count, ±10%).**
`docs/adr/0092.10-memory-phase-e-engineering-record.md` §"Next loops" #3;
garden: "Blocked-on: recorded baseline existing first" — and recall-
affecting ranking stays blocked until baseline v2 (B3 is the unblocker).

**G7. Recall native context filter + overfetch ladder.**
`docs/proposals/recall-overfetch-note-2026-07.md`: verdict "leave it, with
one fixture obligation. No production change is justified today"; the
ladder (native `epic_id` where-clause, overfetch-floor bump, promote
`layer`/`valid_until` to native schema) activates only "if the canary
[recall-02] ever fails."

**G8. Subtree-scoped recall.** Garden §technical — "descendants are
invisible (0092.3 Phase C note)." Temperature rising with docs-native
folder nesting; no hard gate.

**G9. Native Orama fields for memory layer/tags.**
`docs/adr/0092.4-memory-phase-a-b-engineering-record.md` §"Deferred,
explicitly" — "if memory corpora outgrow JS filtering."

**G10. Cross-home content collapse + cross-home contradiction detection.**
`docs/adr/0112.1-per-home-retrieval-composition.md:110` ("contradiction
detection is deferred until a real case demands it") and `:146`
("provenance-retaining collapse remains deferred per ADR 0116 R-3").

**G11. Session memory layer.** Garden §architectural — "The composer
deliberately leaves the `session` layer unregistered." No trigger named.

*Memory system:*

**G12. Karta as memory-store upgrade path.**
`docs/adr/0092-plugin-based-agentic-memory-architecture.md` §"Future:
Karta as Upgrade Path" — "If Karta ships JS bindings or an HTTP API, it
can replace the native implementation without changing any backlog tools.
The abstraction exists for this reason." The `MemoryStore` plugin boundary
is kept alive precisely for this.

**G13. Cross-system memory sync; multi-user partitions.** Recurring
frontmatter defers in `0092.1`, `0092.3` ("Defers: cross-system memory
sync… multi-user memory partitions"). Gated by the single-user local-first
posture (ADR 0104).

**G14. Memory-to-memory link graph.**
`docs/adr/0092.2-phase-3-implicit-episodic-capture.md` §"Open questions
deferred" — "Don't add a parallel graph yet."

**G15. Label-propagation consolidation clustering.**
`docs/adr/0092.7-phase-d-consolidation-engineering-plan.md` §"Deferred
(explicitly)" — "when entity bucketing proves insufficient at real corpus
sizes."

**G16. Contradictions dashboard roll-up.**
`docs/adr/0092.13-contradiction-detection.md` §"Deferred (next loops)" —
"the per-memory chip ships first; the roll-up follows demand." (The
near-duplicate-embedding detector deferred in the same section has since
graduated into ADR 0120 — see B5.)

**G17. Capacity-triggered archive GC + staleness report.**
`docs/adr/0092.9-phase-e-usage-feedback-research-and-plan.md` §Rulings
("Deferred to the next loop: capacity-triggered archive GC with protected
classes (FSFM shape); staleness report"). Trigger: capacity pressure.

**G18. Event-level consolidation demand.**
`docs/adr/0092.12-demand-aware-consolidation-ripeness.md` — "a one-line
follow-up if the ordering ever proves too coarse."

**G19. Memory templates; public benchmark page; tense-aware and
sleep-time consolidation; write-time reconciliation.**
`docs/adr/0092.5-agentic-memory-landscape-2026.md` §"Beyond the current
roadmap (parked, not planned)" + garden §technical/§architectural. No
triggers recorded; all steal-shaped.

**G20. Compliance-lane extensions: edit-time constraint verdicts;
requirement deltas grammar.** Garden §architectural — "the compliance lane
is essentially unshipped at scale (only Mneme)"; steal OpenSpec
ADDED/MODIFIED/REMOVED. Wait on the 0113.1 constraint surface proving out.

**G21. Location-aware disclosure / inclusion-mode frontmatter.**
`docs/proposals/validated-location-aware-disclosure-2026-07.md` §"Trunk or
branch": "BRANCH; reject implementation now… Revisit only when a real
client supplies touched paths and journal/A-B evidence shows broad
retrieval noise. A 30-session pilot must retain at least 95% of judged
relevant stubs." A garden prior deliberately overturned by reproduction —
kept only behind its named trigger.

**G22. Latency-quality Pareto fold.**
`docs/proposals/validated-latency-quality-frontier-2026-07.md` — print the
non-dominated frontier "only when the evaluation program has three or more
genuine operating points."

*Write surface & substrates:*

**G23. P-4 thread-child allocator.**
`docs/proposals/container-routing-at-intake-2026-07.md` §"P-4 — Thread
numbering rides existing allocation": "Implementation disposition —
deferred by name… It remains owned by the docs-native allocation seam
established by ADR 0112 R-7. Implement it when the first real
thread-continuation consumer appears, or when a 0106.5 semantic intent
needs child allocation." Code boundary:
`packages/server/src/storage/storage-identity.ts:126-129` ("Thread child
allocation is intentionally outside this boundary"); the
`numbered-threaded` strategy is declared and parsed on read but has no
write-side allocator. Named in the Phase Two ledger.

**G24. `relate` / `append-relation` executor cases.**
`docs/adr/0106.5-intent-write-surface.md` R5, wired as a visible
quarantine in `packages/server/src/tools/register-substrate-intents.ts:15-18`:
reason "operation kind not yet executable — 0106.5 R5 initial-16 scope",
escape path "The first real project declaration needing relate or
append-relation triggers implementation." A model deferral: named trigger
shipped inside the diagnostic.

**G25. Substrate-declared search/recall intent descriptors; generic
registry-backed MCP write fallback; batch-write atomicity.** All 0106.5:
R1 ("Search and recall descriptors stay deferred until ADR 0113 Phase C
proves a need"), §Rejected options ("Escalation trigger: live usage
repeatedly shows agents need MCP writes for undeclared substrates"), R12
("If real concurrent use demonstrates that compensation is insufficient,
that pressure justifies a storage-level atomic mutation design"). Related:
`docs/adr/0094-transport-agnostic-operation-logging.md` §Out of scope
(`cause_id` cascading-write correlation — "irrelevant until we have
cascading writes to correlate"; no-op suppression; log compaction at
~90MB/year).

**G26. `backlog renumber` core operation.**
`docs/adr/0112-docs-native-project-scoped-backlog.md:380-384` — "A future
`backlog renumber` core operation performs that rewrite transactionally."
Trigger: the first real Git-branch identity collision.

*Platform, viewer, and legacy seams:*

**G27. ADR 0097 extension bank.** `docs/adr/0097-agentic-storage-engine-
positioning.md` Extensions 2 (aggregate endpoint + `<aggregate-chart>`), 3
(composable markdown dashboards), 4 (eight ratified-unbuilt entity types:
session/work, rule, context/brief, cli_tool, agent, skill, prompt, alarm —
"The catalog is possibility, not roadmap"), deferred by
`0097.1-cron-entity-engineering-plan.md` frontmatter. Partially being
realized through a different mechanism (user-defined substrates, ADR 0113;
`agent` via ADR 0119; `prompt` shipped) — the rest waits on per-type
demand. Plus small 0097.1 follow-ups: humanized cron schedule ("If it
becomes a pain"), activity-panel actor filter.

**G28. Assorted gated engineering seams.** Reverse-reference index
(`packages/server/src/core/get-context/cross-reference-traversal.ts:26-39,118-121`
KNOWN HACKs; trigger "backlogs > 1000 tasks"; capability now lives under
`get(context: true)` per ADR 0114); wakeup L1 caps
(`docs/adr/0092.1:` "In a mature backlog with 19+ active tasks");
`BacklogEvents`→framework Emitter (`docs/adr/0102` — "Only one consumer
exists"); build `isolatedDeclarations` watch (`docs/adr/0099` — "If
isolatedDeclarations support improves in Zod or oxc"); per-repo config
absorption of dataDir/port/memory defaults (`docs/adr/0105` §follow-ups);
tool gating for non-Tool-Search clients + server-side cwd resolution
(`docs/adr/0106` §Open questions, `0105` §Critique); Eisenhower
signal-derived priority suggestions (`docs/adr/0084` §Alternatives #2 —
"valuable as a future suggestion layer"); Orama native `where` filtering
past 10K entities (`docs/adr/0073` §Hacks #4); Turborepo "when build
caching… provide[s] real value" (`docs/adr/0088`); viewer home-selector
"(later) Recently opened" list + session-scoped `/homes` endpoint
(`docs/adr/0112.4:57,88-90`); tool-use optimizer / anti-pattern detection
(the never-rebuilt half of `docs/adr/0018` Phases 3-4); Algolia
reconsideration conditions (`docs/adr/0049` §"When to Reconsider" —
weakened but never revoked by 0104).

*Goga-gated (decision, not trigger):*

**G29. Loro as derived-history substrate.**
`docs/NORTH-STAR.md:476` — "sole-truth Loro (0107 as written) is not
adopted as-is"; owner Goga. `docs/prompts/0002:` "I would love to explore
Loro as well but I don't want to lose the .md files." Sub-deferrals inside
`docs/adr/0107`: apply_patch diff dialect (`:98` — "noted so the door
stays open"), markdown-export-now-or-later (`:141`). ADR 0107 remains
"Proposed (design-first; no code until ratified)."

**G30. Parked-on-Goga ledger.**
`docs/reports/0001-phase-one-vision-uplift.md` §"Decisions parked on Goga"
verbatim: "The NAME (Kvali proposal); Agent-vs-Contributor substrate
naming; historical memory data location…; @nisli/ui 0.4.0; D1 code
quarantine; Loro exploration." The Kvali rename
(`docs/proposals/naming-and-positioning.md` §"Recommendation: Kvali")
carries its whole positioning execution behind it.

**G31. External-landscape steal bank.** The garden's verified landscape
notes (`docs/proposals/uplift-idea-garden-2026-07.md`): Zep/Graphiti
bi-temporal valid-time framing, basic-memory typed observation lines +
`memory://` addressing, spec-kit constitution file, Tessl spec
back-propagation, MemPalace verbatim-first, Cline `activeContext.md`,
claude-mem trajectory→observation capture. Each S; no triggers, pure
optionality inventory.

### DEAD — superseded, with the superseding decision

**D1. Every-turn proactive recall (ADR 0118 as operational decision).**
`docs/adr/0118-proactive-recall-hooks.md` frontmatter: "status: PARKED,
ONLY EXPLORATION DO NOT IMPLEMENT ANY TIME SOON"; superseded by
`docs/adr/0118.1` ("supersedes every-turn UserPromptSubmit recall,
automatic result injection, and the REST-route disposition; retains
stub-first recall, client-owned hooks, fail-open behavior, and warm-daemon
feasibility evidence" — frontmatter `supersedes_in_part`). Alive remnant:
the retained mechanics, and 0118.1's own excluded list
(`0118.1:288-302`, "These are not deferred features hidden inside the
design. They are outside the decision.").

**D2. Loro-as-sole-truth.** Superseded by `docs/adr/0112` ("its binary
Loro-as-sole-truth premise cannot apply to project homes") and
`docs/NORTH-STAR.md:476`. Alive remnant: G29.

**D3. Runtime wakeup budget allocator.**
`docs/proposals/wakeup-budget-ledger-2026-07.md` superseded by
`docs/proposals/validated-wakeup-byte-budget-2026-07.md` ("A runtime
aggregate allocator is rejected/shelved… The allocator created the
regression it was supposed to prevent"). Alive remnant: the ≤3,072-byte
tripwire (B1 Slice C). Reopen only if a real briefing exceeds the budget
with facts that "genuinely need to coexist."

**D4. Epistemic claim-typing enum.**
`docs/proposals/validated-epistemic-claim-typing-2026-07.md`: "BRANCH and
rejected: it is a second vocabulary for distinctions already expressed by
provenance, layer, kind, derived status, lineage, and validity."
Conditional reopen thresholds recorded (40+ real memories, ≥90% annotator
agreement, ≥20% changed decisions).

**D5. LAFS / LongMemEval-V2 latency-formula import.**
`docs/proposals/validated-latency-quality-frontier-2026-07.md`: "do not
import LongMemEval-V2's 1–200-second scalar into a 30-millisecond local
search path." Alive remnant: G22.

**D6. In-server generative answer engine.**
`docs/adr/0038-comprehensive-search-capability.md` §"Phase 4: RAG"
(Orama AnswerSession, streaming synthesized answers) and `docs/adr/0049`
§Future. Superseded by `docs/adr/0116` R-10: "Query decomposition,
sufficiency judgment, iterative search, answer synthesis, and citations
remain with the calling agent." Alive remnant: B16 (the read-loop recipe).

**D7. Context-hydration tool surface and its deferral tail.**
`docs/adr/0073` §Phase 5, `0074` §Viewer UI (Future), `0078` #12-14
(persistent `ReverseReferenceService`, `include_parent_reverse_refs`,
`bidirectional`), `0075` time-windowed queries, `0076` `session_id`,
tokenizer upgrades. Superseded by `docs/adr/0114` (header: "disposes of
the tool surface built by ADRs 0074–0078" — context folds into the
memory-verb language). Alive remnants: the KNOWN-HACK seams under
`get(context: true)` (G28) and the session-id idea reborn as B18.

**D8. `backlog_list` query param deprecation + dual snippet/score paths.**
`docs/adr/0073` §Hacks #1-3. Superseded by `docs/adr/0106` (semantic
intent tools replace the verb surface) — the cleanup became moot when the
surface it cleaned was replaced.

**D9. Generic CRUD MCP tools (`backlog_create`/`backlog_update`).**
Kept as escape hatch by `docs/adr/0106` §Migration; deleted by
`docs/adr/0106.5` R3/R7 ("deleted from the MCP surface. They are not
renamed, hidden, deprecated, or regenerated"). SUPERSEDED-BUT-ALIVE: the
capability survives as the local CLI escape hatch (`backlog create/update
--fields <json>`, 0106.5 R3).

**D10. ADR 0018's memory/knowledge-graph phases; ADR 0008's decay
phases; ADR 0036's pruning system.** The 2025-era "self-maintaining
knowledge graph" ambitions (health decay, WIP limits, temporal graph,
ambient context push). Superseded by the 0092.x memory architecture
(`docs/adr/0092-plugin-based-agentic-memory-architecture.md` onward — with
the decay idea reborn as usage-aware ripeness in 0092.12) and the
docs-native pivot (`docs/adr/0112`). Alive remnant: the tool-call
optimizer half of 0018 (G28).

**D11. Agent-runner subsystem roadmap.** `docs/adr/0016` Phases 5-8
(structured metadata, log search, agent collaboration, perf metrics),
`docs/adr/0017` §"Future Enhancements (Out of Scope)", `docs/adr/0048`
agent-artifact indexing. The delegation/agent-runner subsystem was
abandoned in the pivot to context & memory engineering (NORTH-STAR); no
successor rebuilt its telemetry. Scheduling survived externally
(`docs/adr/0097.1` §Follow-ups: `studio-agents schedule`).

**D12. In-process cron scheduler.** `docs/adr/0096` Proposal C, banner:
"Key decisions reversed by ADR 0097 + 0097.1 + 0098" — the scheduler is an
external MCP client, never in-process.

**D13. The D1/Workers expansion cluster.** ADR 0089's Vectorize semantic
search + Durable-Objects push ("Vector search via Vectorize is Phase 3";
"real-time push requires Durable Objects (future work)"), ADR 0091/0090's
upload-companion CLI, ADR 0100's auth roadmap (revocation tooling, atomic
rotation, DCR — "if this becomes multi-tenant"), ADR 0021's ChatGPT-app
SaaS phases, worker actor attribution
(`packages/server/src/worker-entry.ts:27-30`, "future work will derive it
from OAuth session"), audit findings F1/F2. All quarantined by
`docs/adr/0104-local-first-deployment-posture.md`: "maintained as a
constrained satellite, not evolved as an equal… receives fixes, not
feature investment. No new ADR work should expand D1 scope." Code carries
the tombstones: `packages/server/src/storage/storage-adapter.ts:22`
("Closed satellite filter retained by the descoped D1 adapter"),
`packages/server/src/storage/d1/d1-backlog-service.ts:95` (D1 hard-fails
runtime substrates). Recorded revival: 0104 — "If remote access matters
later, prefer approaches that preserve the local engine (e.g. hosting the
Node server) over re-implementing on D1."

**D14. Hosting open tension (Workers+D1 vs Fly.io).**
`docs/adr/0013.7`: "The hosting question is parked as an explicit Open
Tension, not silently dropped." Resolved by `docs/adr/0104` — "now
resolved in favor of neither: local is primary."

**D15. StreamableHTTP migration / stateless-mode thread.**
`docs/adr/0013.4` ("Revisit… when mcp-remote is updated"), `0020`, `0022`.
Superseded by `docs/adr/0089`'s transport unification and 0104's posture.

**D16. Pluggable EventBus cloud backends (Redis/NATS).**
`docs/adr/0063` Option 3 ("can be swapped to Redis Pub/Sub, NATS… when the
server goes multi-instance for cloud deployment"). The trigger itself was
deleted by 0104; the local seam remains, its activation condition does
not.

**D17. Early writable-resource / URI phases.** `docs/adr/0001` Phases 2-3
(locking, versioning, permissions), `0004`/`0006`/`0007` future
enhancements — all headed "Superseded by ADR-0031"; the write surface was
re-decided again by `docs/adr/0086`/`0087` and finally
`docs/adr/0117-the-write-boundary.md`.

**D18. `read_resource` deprecation-when-Kiro-supports-resources.**
`docs/adr/0009` §Future. The client/transport landscape it awaited was
reset by 0089/0104.

**D19. Old-era viewer/journal features.** Task versioning, git-commit
integration, weekly/monthly rollups, markdown export, activity heatmap,
AI weekly summaries, activity search, log rotation
(`docs/adr/0054`-`0060` out-of-scope sections, `0059` §"Adjacent
Proposals"), Spotlight personalization/saved-searches/pinned items
(`docs/adr/0050`-`0052`, `0062`). Superseded by the pivot: the memory
observability lane was rebuilt on its own terms (0092.11-0092.14); the
rest has no successor and no recorded revival pressure.

**D20. Folder-title-match auto-scope.** `docs/adr/0105` §Option 4:
"Rejected; at most a last-resort fallback, not implemented."

**D21. `MemPalaceStore` pythonia adapter.** Removed by
`docs/adr/0092.6`: "untested, unused… competitors are for inspiration, not
residence in the codebase." Alive remnant: the `MemoryStore` plugin
boundary itself (G12).

**D22. Superseded scoring generations.** ADR 0044 score-attachment
("Superseded for canonical search" per `docs/adr/0116:383`), ADRs
0051/0072 ("ADR-0051 and ADR-0072 are superseded. Their scoring approaches
are deleted" — `docs/adr/0081-independent-retrievers-linear-fusion.md`).

### Appendix: the 0092.x series self-closes (closed deferrals, for corpus hygiene)

Nearly every "Deferred / Next loops / Open questions" item in
0092.1-0092.10 was picked up by a later loop — evidence that the deferral
discipline works when triggers are named: forget/remember verbs (deferred
0092.1/0092.2 → shipped 0092.6); cross-session durability (0092.1 §Q4 →
0092.4 durable MEMO- entities); echo/fizzle attribution (0092.1 §Q4 →
0092.5 R-11 → 0092.9/0092.10); contradiction detection ("premature" in
0092 → 0092.13); compaction-into-semantic (0092.1/0092.2 → Phase D
0092.7/0092.8); recall-demand ripeness ("no data source today" 0092.7 →
R-16 log 0092.9/0092.10 → closed by 0092.12, whose header names itself
"Closing the 0092.7 Deferral"); viewer affordances (0092.6 → 0092.11 →
0092.13 → 0092.14); query-intent parser (0101 Phase 4 uncommitted →
shipped 0092.4); MCP-tool-schemas-from-substrates (0098 follow-up → being
realized by 0106.5's compiled `intentInputSchema`). Affirmatively rejected
(not shelved — no revival intended): LLM extraction in the write path, LLM
importance scoring, external graph DBs, summarize-then-drop compaction,
persona-conditioned synthesis, LLM-judged forgetting, threshold deletion,
unbounded usage influence (`docs/adr/0092.5` §"Rejected, with reasons",
`0092.9` §Rejected).

## What the tool did and didn't do for this job — dogfood log

All commands ran from the repo root as
`node packages/server/dist/cli/index.mjs --home project --project-root $PWD <cmd>`.

### Interaction log

| # | Command / question | Result |
|---|---|---|
| 1 | `wakeup` — "orient me in this project" | **Partial.** Returned scope FLDR-0001, a north-star pointer, and exactly ONE decision (ADR 0111) with `counts: active=0 epics=0 knowledge=0 ...`. The corpus has ~25 Proposed/Accepted ADRs; wakeup surfaced one. Root cause found (F4 below) — this became a headline finding of the mine. |
| 2 | `list` — inventory the backlog | **Hit.** Full entity listing incl. freeform statuses; surfaced ADR 0119 and ADR 0120, which a truncated `ls \| head -150` of `docs/adr/` had missed. The tool beat raw shell here. |
| 3 | `search "deferred"` | **Strong hit.** 15/15 relevant results across types (adr, proposals, reports, audit resources); snippets carried the shelving language directly (e.g. 0092.12 "closing the 0092.7 deferral", container-routing "P-4 explicitly deferred"). |
| 4 | `search "P-4 thread allocator seam"` | **Hit, top-1 exact.** `container-routing-at-intake-2026-07.md` with the deferral sentence in the snippet. |
| 5 | `recall "disclosure swap flags"` | **Miss.** "No memories found" — the project home contains zero MEMO- entities (F3). Fallback: grep + ADR 0113 read. |
| 6 | `recall "wakeup budget"` | **Miss** (same empty store). An exit-code-1 initially blamed on the CLI turned out to be this miner's own zsh glob error; re-tested in isolation, `recall` exits 0 on empty — correct behavior, honestly reported (F2). |
| 7 | `get "ADR 0118"` | **Hit.** Full body by human ID; frontmatter carried `status: PARKED, ONLY EXPLORATION DO NOT IMPLEMENT ANY TIME SOON` and `superseded_in_part_by: 0118.1...` — the supersession chain was legible from the tool alone. |
| 8 | `search "engine-agnostic search seam"` | **Partial.** Surfaced the search-ADR lineage (0038, 0073, 0079, 0083, 0116, evaluation README) but not the seam's actual home (`packages/memory/src/search/types.ts`) — code is outside the index, reasonably. Fallback: grep. |
| 9 | `search "Loro CRDT history"` | **Hit.** 0107 top-1 plus the two supersession quotes that settle its status: ADR 0112 "its binary Loro-as-sole-truth premise cannot apply to project homes" and PROMPT 0002 tenet "I would love to explore Loro as well but I don't want to lose the .md files". |
| 10 | `search "D1 quarantine cloudflare workers"` | **Hit.** The full lineage in one screen: 0089 (migration) → 0093 (hardening) → 0091 (worker bundle) → 0104 (deprioritization) → search-baseline "quarantine seam" note. |
| 11 | `search "wakeup operation focal selection"` | **Partial.** Found the wakeup proposal cluster (budget ledger, first impression, byte-budget "reject the allocator") but not the amnesia-test proposal that actually holds `wakeup(operation=...)`. Fallback: grep `operation=`. |
| 12 | `contradictions` | Clean honest empty ("0 live keyed memories"). |
| 13 | `consolidation-candidates` | Clean honest empty ("0 live episodic memories"). |
| 14 | `search "recall on every user prompt"` | **Hit.** 0118 and 0118.1 as top-2 — exactly the supersession pair for the every-turn premise. |
| 15 | `search "idea garden parked uplift"` | **Hit, top-1.** |
| 16 | `list --status parked` | **Miss.** "No items found" although ADR 0118's literal status contains PARKED (F6). |
| 17 | `get "mcp://backlog/proposals/uplift-idea-garden-2026-07.md"` | **Hit.** Resource hydration by URI works; stub-then-hydrate held up for the whole mine. |
| 18 | `search "superseded" --types adr --sort recent` | **Degraded.** 2 results (bm25) vs 10 results (hybrid) for the same query without `--sort recent` (F5). |
| 19 | `search "reject the allocator byte budget tripwire"` | **Hit, top-1** (`validated-wakeup-byte-budget-2026-07.md`). |
| 20 | `search "cross-encoder rerank aboutness"` | **Hit.** 0083 with the "BM25 has no concept of aboutness" snippet, plus 0116's no-hosted-reranking rule — question answered in one query. |

**Tally: 11 hits, 3 partials, 4 misses, 2 honest-empties.** Search on the
docs-native corpus was the workhorse — every conceptual navigation question
("who shelved X, what superseded Y") landed in the top 3 with usable
snippets. The misses cluster in two places: the memory verbs (empty store)
and status-shaped filtering (freeform statuses).

### Friction events

- **F1 — flag inconsistency.** `search` takes `--types`; `list` takes
  `--type`. Cost one failed command (`error: unknown option '--types'`).
- **F2 — false alarm, retracted.** An apparent recall exit-code-1 on empty
  results was re-tested in isolation: `recall` exits 0 and prints an honest
  "No memories found" — consistent with the product's own posture ("no
  memory" is valid, `packages/server/src/tools/backlog-recall.ts:13-14`).
  The original failure was this miner's shell quoting, not the tool.
  Recorded because a friction log that only survives when it flatters the
  logger is not data.
- **F3 — the repo's own project home has zero memories.** `recall` could
  contribute nothing to navigating the product's own decision corpus; the
  docs-native ADR index carried the entire mine. The corpus IS the memory
  here — which validates docs-native, but means the memory half of the
  product is unexercised on its own repo (consistent with the fleet's
  "baseline v2 blocked until real memory corpus arrives" posture).
- **F4 — WORST FRICTION EVENT: wakeup surfaces 1 of ~25 decisions.** The
  packaged ADR substrate declares
  `includeStatuses: ['proposed', 'accepted', 'living']`
  (`packages/server/src/substrate-definitions/packaged-substrate-definitions.ts:294`)
  and the wakeup fold matches raw status strings exactly
  (`packages/server/src/core/wakeup.ts:344-346`,
  `(declared.wakeup.includeStatuses as readonly unknown[]).includes(status)`).
  The corpus's real statuses are freeform — `Proposed`,
  `Accepted (goga, 2026-07-16)`, `PARKED, ONLY EXPLORATION...` — so only
  ADR 0111 (whose status happens to be lowercase `accepted`) survives the
  filter. A cold-opening agent would believe this project has one decision.
  This is the same defect class EXP-2's Cold-Open loss (8/10 vs raw files)
  points at: the briefing under-discloses not because the fold is wrong but
  because status vocabulary is unnormalized at the match site.
- **F5 — `--sort recent` silently degrades retrieval.** It switches hybrid →
  bm25-only and, for `"superseded"`, shrank 10 results to 2 with no warning.
  Recency sorting costs recall invisibly.
- **F6 — freeform statuses are invisible to status filters.** `list
  --status parked` finds nothing while a PARKED ADR exists; same root cause
  as F4 (no normalization/containment matching for status vocabulary).

None of the friction blocked the mine; every miss had a one-step grep
fallback. But F4/F6 are product findings, not tooling nits: they were found
*because* this job used the product on its own corpus.

## Top 5 build-shaped candidates

1. **B1 — Cold-open wakeup fix charter.** The north star's own acceptance
   test is currently losing to `cat` (EXP-2: 8/10 vs 10/10 at 1.8x the
   tokens); three independent experiments and this mine's F4 all point at
   the same fold.
2. **B3 — Implicit-qrels extraction.** One read-only script stands between
   the project and baseline v2, which is the ruled unblocker for the
   entire gated ranking/reranking/fusion lane (G6, B20, R-9).
3. **B2 — EXP-1 repair batch.** Defect-class, S/M-sized, with a recorded
   pass/fail rerun gate — the fastest honest win in the corpus.
4. **B4 — `wakeup(operation=)` + operation-state substrate.** Every
   dependency is now landed (0113 registry merged, 0119 accepted); it is
   the Amnesia Test's product half and the demo "no surveyed competitor
   can run."
5. **B5 — ADR 0120 to its fixture gate.** Already authorized and partially
   committed, parked mid-flight; finishing costs a fixture, not a design,
   and completes the human-in-the-loop differentiator lane.
