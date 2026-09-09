---
title: "0012 — Tool surface: workflow ambiguity audit"
date: 2026-09-08
status: Research complete — parent reviewed
backlog_item: TASK-0008
---

# TASK-0008 — journeys and capability-meaning map

**Worker:** gpt-5.6-terra, medium reasoning.
**Scope:** read-only repository research at `2a07408`; no wakeup, backlog mutations, Git mutations, or production changes. Parent owns decisions.

## Executive finding

The coherent product loop is already stated and mostly implemented:

`wakeup` → `recall` or `search` → `get` (optionally `context:true`) → intent-shaped write / `remember` → correction or maintenance when warranted.

This is not seven interchangeable features. The most material ambiguity is between:

- **memory retrieval**: prior distilled, scoped facts and episodes, intentionally hidden from ordinary search/list;
- **document discovery**: current indexed entity/resource corpus;
- **entity expansion**: the full body plus unique relational neighborhood;
- **generic mutation/editing**: an intentionally local operator tail, not a recurring agent-facing MCP job.

The evidence supports the memory loop as the intended core, but does **not** establish universal recurring adoption or reliable cold-open success on every docs-native corpus. Existing dogfood reports document both a useful loop and serious disclosure/coverage failures.

## Workflow / ambiguity matrix

| Journey | Intended entry and follow-up | Competing meanings / surprising exclusions | Evidence and practical role | Escape hatch / open question |
|---|---|---|---|---|
| Cold-open orientation | `wakeup` once; then select a surfaced task/ADR/requirement and `get`; use `recall` for learned convention or `search` for corpus discovery. | `list` can appear to be an inventory alternative, but lacks the intentional “what matters now” briefing. `wakeup` is deliberately always-loaded, while other tools are meant to be deferred. | **Strong intent; mixed observed result.** North Star defines one-command orientation in under a minute, including decisions, conventions, active work, requirements, and vision (`docs/NORTH-STAR.md:25-51`). A real mine found `wakeup` surfaced only one of roughly 25 decisions because freeform statuses failed exact matching (`docs/reports/0003-internal-adr-mine-2026-07.md:637-644`, `677-706`). | Raw docs/shell/grep remain a legitimate fallback. Question: should cold-open be treated as unmet until real-corpus disclosure tests pass, rather than as “shipped” based on the interface alone? |
| Post-compaction / amnesia | `wakeup(operation=…)` for a declared operation document; ordinary continuation uses wakeup, then targeted `get`/recall. | Generic wakeup tells current project state; operation-focused wakeup is supposed to restore *my* goal, next action, and constraints. They are related but not duplicates. | **Strong operational pressure; implementation claims should be separately verified.** Six of nine agents compacted/cleared in one operation; durable hand-written anchors enabled recovery (`docs/NORTH-STAR.md:55-82`). A compaction summary contradicted the source prompt, while the disk anchor corrected it (`docs/proposals/amnesia-test-continuity-engine-2026-07.md:94-102`). | Do not infer that operation documents will stay current. The proposal explicitly says the feature shrinks if agents let anchors rot (`…amnesia-test-continuity-engine-2026-07.md:135-145`). |
| Find a fact vs. find a document | **Fact / “how do we do X?”:** `recall`, then `get(MEMO-id)`. **Document / “find things about X”:** `search`, choose result, then `get`. **Known current item:** `get` directly. | This is the most likely user confusion: both retrievals use related ranking machinery, but memories are intentionally absent from ordinary search/list. `search` is discovery of live indexed entities/resources; recall is captured knowledge/episodes with provenance and trust signals. | **Strong semantic distinction.** Tool descriptions explicitly draw it: recall is distinct from search and advises trust evaluation (`packages/server/src/tools/backlog-recall.ts:40-48`); search is corpus discovery (`…/backlog-search.ts:23-30`). ADR 0114’s overlap analysis finds no substitute for “how do we do Y?” or “have I hit this before?” (`docs/adr/0114-memory-context-surface-disposition.md:89-115`). | Search succeeds well in a memory-empty corpus: 11 hits, 3 partials, 4 misses, 2 honest empties in the ADR mine (`docs/reports/0003-internal-adr-mine-2026-07.md:660-664`). The product must explain that a recall miss can mean “no captured memory,” not “no relevant docs.” |
| Expand an item and understand its neighborhood | `get(id, context:true)` when starting work; hydrate only the relevant returned stubs with another `get`. | `get` is raw/full content; `get(context:true)` adds parent/children/siblings/references/reverse references/related stubs. It superseded the prior context *delivery tool*, not its unique relational capability. Search first, then get, is deliberate; no silent top-hit focal selection. | **Strong architectural rationale; adoption evidence limited.** ADR 0114 chose folding to preserve reverse references while removing the competing bundle tool (`docs/adr/0114-memory-context-surface-disposition.md:212-269`). The MCP description gives the exact starting-work cue (`packages/server/src/tools/backlog-get.ts:61-68`). | Test the fold’s premise in use: ADR 0114 says repeated chains of 6+ hydrations would challenge stub-first delivery (`…:310-326`). |
| Record a durable fact | `remember` after learning a stable fact, procedure, or preference; one atomic fact; attach context/refs where useful. | It is not a task-event logger: task completion is intended to create episodic trace automatically. It is also not a generic notes dump—quality affects recall trust. | **Moderate-to-strong.** The North Star names four memory verbs as the proven core (`docs/NORTH-STAR.md:327-344`). One real Aime trial reports that recall replaced re-derivation after capture, and completion left a durable trace (`docs/proposals/aime-bolt-on-trial-2026-07.md:105-114`). | Prior CLI UX had a variadic `--tags` footgun; current CLI source shows the repair to comma-separated tags (`packages/server/src/cli/commands/remember.ts:25-42`). Continue to distinguish a fixed code path from measured recurring user success. |
| Correct or retract a fact | New replacement: `remember(... supersedes: MEMO-id)` or stable `state_key`; no replacement: `forget`. Review possible conflicts with `contradictions` before resolution. | “Forget” is soft expiry/audit preservation, except explicit expired-item GC. A new `state_key` holder should close prior holders, but collision candidates are advisory rather than contradiction verdicts. | **Strong rule; real-corpus frequency unproven.** One-source-of-truth-per-fact is an invariant (`docs/NORTH-STAR.md:253-255`); exact tool contracts are in `backlog-remember.ts:42-50`, `backlog-forget.ts:25-33`, and `backlog-contradictions.ts:22-34`. | The project’s later ADR mine found zero live memories, so its clean contradictions/consolidation responses validate honesty on emptiness—not correction demand (`docs/reports/0003-internal-adr-mine-2026-07.md:643-651`). |
| Work lifecycle | Default MCP: `create_work` → `start_task` → `complete_task` / `block_task`; use `get(context:true)` when beginning a selected task. | “Create work” is an agent-facing intent. Generic `create/update` are deliberately not equivalent MCP options; they are CLI operator/script escape hatches. Completion’s evidence field is workflow evidence, not necessarily a memory write by the caller. | **Strong policy, limited direct adoption evidence.** ADR 0106.5 specifies the initial task verbs (`docs/adr/0106.5-intent-write-surface.md:244-275`) and deletes generic MCP create/update while retaining CLI `--fields` tail (`…:277-304`). The CLI still exposes generic create/update (`packages/server/src/cli/commands/create.ts:22-53`, `update.ts:11-42`). | The Aime report demonstrated task completion plus an auto-created memory, but that is one trial, not population usage (`docs/proposals/aime-bolt-on-trial-2026-07.md:105-114`). |
| ADR authorship | `propose_adr` → `accept_adr`, or `supersede_adr`; `get` and search expose decision bodies and lineage. | ADR authorship is a specific semantic lifecycle, not merely “create a document.” Generic CLI create may be needed for rare fields/tail work, but makes the semantic path less discoverable. | **Strong modeled capability; CLI parity conflict observed.** ADR intent verbs are explicit (`docs/adr/0106.5-intent-write-surface.md:259-263`). The 0.62 dogfood found an analogous gap: MCP had `capture_requirement`, CLI only generic `create --type requirement` (`docs/proposals/aime-bolt-on-trial-2026-07.md:123-127`). | Need evidence whether operators actually need a CLI semantic ADR workflow, versus whether generic CLI plus native Markdown is sufficient by design. |
| Memory maintenance | `consolidation-candidates` → inspect member MEMOs → derived `remember` → `forget` retired episodic members; `contradictions` for human-adjudicated conflict review. | These are periodic maintenance jobs, not default per-agent/session verbs. The store identifies candidates but must not autonomously distill or adjudicate. | **Clear bounded workflow; demand unproven in this project corpus.** Tool description explicitly assigns judgment to an external agent (`packages/server/src/tools/backlog-consolidation.ts:24-36`); no LLM write-path invariant reinforces this (`docs/NORTH-STAR.md:239-241`). | Keep maintenance deferred or operator-triggered until a non-empty sustained corpus proves frequency and harness value. |

## Home selection: a cross-cutting source of friction

Observed contract:

- Writes and ordinary reads select `global` or `project`; read-only `wakeup`, `recall`, and `search` may select `all`.
- `all` means global plus the explicit/bridged project only—never a scan of prior projects (`packages/server/src/tools/home-input.ts:9-23`).
- Project knowledge belongs in the repository; global is cross-project (`docs/NORTH-STAR.md:256-259`, `359-397`).
- Context resolution is separate from home selection; precedence is explicit input → `BACKLOG_CONTEXT` → home configuration (`packages/server/src/core/config.ts:126-178`).

Inference: home is a necessary correctness boundary, not another daily “capability.” The default daily loop should make project scope ambient and only surface home selection when the agent explicitly needs cross-project knowledge. The broad input schema repeats this choice across tools, so it contributes to manifest/context cost even when normally omitted.

## Current local aggregate telemetry snapshot

I inspected only aggregate counts in this repository’s `.backlog/state/` files, without opening sensitive query/content values:

| File | Aggregate |
|---|---|
| `operations.jsonl` | 30 rows: 13 `backlog create`, 6 `backlog update`, 4 `backlog remember`, 7 `backlog_remember` |
| `memory-usage.jsonl` | 26 rows: 16 recall, 3 expand, 2 cite, 5 usage-summary |
| `retrieval-telemetry.jsonl` | 31 rows (not parsed beyond line count) |

This is **evidence that these instrumented events occurred in this project home**, not evidence of unique users, successful task outcomes, satisfaction, or tool discovery behavior. It also cannot establish absence of reads:

- operations is mutation-only by construction;
- search demand is absent from the mutation and legacy memory-usage journals;
- plain non-MEMO `get` reads have no memory-usage event;
- recall misses append no legacy memory-usage event;
- legacy memory-usage events have no session/actor identity.

**Parent verification correction:** current `memory/usage-tracker.ts:57-96` also writes a separate session-stamped Tier-1 retrieval telemetry stream. It records searches, recall misses, and entity `get(context:true)` expansions. This project snapshot contains 8 search, 16 recall, and 7 expand events with actor/session fields. The older evaluation README below predates that instrumentation; its limitations must not be generalized to today’s telemetry. These small counts include the parent’s current research/development activity and are not an independent adoption sample.

Those historical overlay limits are documented explicitly in `docs/evaluation/candidates/README.md:31-64`. Prior dogfood also demonstrated the older instrumentation gap: successful remembers absent from operations while recall appeared in the usage overlay (`docs/reports/0002-exp1-aime-bolt-on-bugs.md:67-77`). Current aggregate rows should therefore not be retroactively treated as a complete behavioral history.

## Proposed core daily loop (not a ruling)

1. **Orient once:** `wakeup` at session start; use `operation` only when resuming declared operation state.
2. **Ask deliberately:** choose `recall` for “learned fact / prior episode / convention”; choose `search` for “current artifact / document / topic.”
3. **Expand only after selection:** `get`; add `context:true` only when taking up an entity and its relationships matter.
4. **Act through the narrowest semantic write:** task/ADR intent where declared; native repository edit for ordinary prose; CLI generic create/update only for an operator/script/undeclared tail.
5. **Preserve durable learning sparingly:** `remember` an atomic, reusable fact; correct with `supersedes` or `state_key`, retract with `forget`.
6. **Maintain on a cadence, not every session:** consolidation/contradiction review when corpus size or a surfaced concern warrants it.

### Competing options

- **Memory-first default (recommended candidate):** above loop; preserves the North Star’s protocol moments and keeps discovery vs learned knowledge explicit.
- **Document-first default:** `wakeup → search → get`, with recall only after search fails. This fits a project with no MEMOs, but weakens the product’s distinctive stored-learning promise and would make memory capture less valuable.
- **One universal search:** merge memories into ordinary search/list. This reduces choice but erases the current distinction between distilled, trust-weighed knowledge and live corpus documents; no evidence here shows that the distinction itself is harmful.
- **Surface generic CRUD/edit more prominently:** easier tail access, but directly conflicts with ADR 0106.5’s no-parallel-MCP-dialect decision and North Star tool-cost rule (`docs/NORTH-STAR.md:201-209`; `docs/adr/0106.5-intent-write-surface.md:507-531`).

## Evidence gaps worth preserving for TASK-0011/0012

- No controlled representative-agent trials here; manifest context cost and successful selection rates require the parent’s live measurements and later evaluation.
- Cold-open remains contradicted by real dogfood: intended one-minute orientation versus an audit where wakeup under-disclosed decisions.
- The project’s past empty memory corpus means memory’s role in navigating this repository was untested in that audit, despite the separate Aime trial.
- No evidence supports treating every semantic intent as duplication: task, ADR, and correction verbs encode workflow/validity that generic CRUD does not.
- Conversely, consolidation, contradiction review, broad home selection, generic CLI mutation, server management, migration, and destructive delete appear maintainer/exception capabilities—not default recurring agent work.

## Checks performed

- Read `AGENTS.md`, TASK-0008, NORTH-STAR, ADR 0106.5, ADR 0114, MCP registrations/descriptions, CLI command sources, relevant proposals and dogfood reports.
- Checked baseline identity (`2a07408`) and observed pre-existing dirty research-document changes without modifying them.
- Read aggregate counts only from the project-local journals.
