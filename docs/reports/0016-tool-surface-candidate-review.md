---
title: "0016 — Independent smaller-surface design review"
date: 2026-09-08
status: Design review — no empirical candidate trials
backlog_item: TASK-0011
---

# Read-only design review

This is a design review of hypothetical manifests, not an implementation or empirical client trial. The 8,034/3,473/3,277-token figures measure serialized manifests; they do not establish usability, model-visible context, latency, or task success ([inventory](0011-tool-surface-inventory.md), [candidate models](tool-surface-research/baseline/candidate-manifest-models.json)).

## Recommendation

Prototype **Candidate A first**, but only as an explicit profile layered over the existing compiled-intent architecture—not as the new universal default.

A preserves host-visible, operation-specific schemas for frequent task mutations. It tests whether profile curation works without first reversing ADR 0106.5’s rejection of a generic executor that hides exact input shapes ([ADR 0106.5](../adr/0106.5-intent-write-surface.md)). Its manifest is only 196 measured tokens larger than B, so that difference is not a persuasive reason to accept B’s additional discovery, stale-catalog, retry, and validation burden.

B should remain the challenger. It has better domain breadth—especially for custom substrates—but its outer `input` is unrestricted. The host validates only the generic envelope; exact validation happens after invocation. That weakens affordance quality, increases correction loops, and moves rather than eliminates schema context ([candidate model](tool-surface-research/baseline/candidate-manifest-models.json), [harness review](0013-tool-surface-harnesses.md)).

## Strongest objections and missing requirements

**Candidate A**

- “Daily” privileges tasks over equally valid ADR, requirement, reference, artifact, cron, milestone, and project-defined workflows. That is product policy, not a neutral compression.
- Optional profiles are underspecified: selection mechanism, default, home binding, reconnect behavior, discoverability, composition, and what happens when project definitions change.
- Omitted capabilities may look nonexistent. Server-wide discovery instructions are currently absent, and resources/prompts cannot be assumed to rescue autonomous discovery ([harness review](0013-tool-surface-harnesses.md)).
- `backlog_list`, body edit, and custom reference capture may be ordinary work rather than administration. Their omission needs observed workflow evidence.

**Candidate B**

- `catalog_revision` needs a canonical definition: what inputs it hashes, whether it includes quarantine state, home identity, substrate files, and compiler/runtime version.
- Discovery and execution must bind to the identical normalized home and registry snapshot. Wrong-home revisions, changed definitions, unknown actions, malformed inputs, and collisions must fail before any write.
- Specify deterministic search/ranking, pagination, exact-schema retrieval, structured error codes, retry instructions, idempotency, and whether discovery responses survive compaction.
- Prevent confused-deputy behavior: outer `home`, `project_root`, and `as` must not be overridable inside the generic input bag.
- The design assumes schema transfer through a prior tool result is usable across clients; that remains untested.

## Scenario matrix

| Scenario | Candidate A | Candidate B | Review |
|---|---|---|---|
| Cold-open | Direct `wakeup` | Direct `wakeup` | Equivalent; server instructions still missing |
| Find fact/document | `recall`, `search`, `get` | Same | Good; test whether missing `list` matters |
| Memory correction | Typed `remember`/`forget` | Same | Both retain current lifecycle surface |
| Create/start/complete work | Direct typed tools | Discover, then execute | A has clearer schemas and fewer steps |
| ADR supersession | Optional profile/CLI | Discover exact intent, execute | B covers it; A risks “unsupported” perception |
| Custom reference capture | Optional profile/CLI | Discover project intent, execute | Strongest case for B |
| Body edit | Optional profile/CLI | Optional admin/CLI | Neither supports it by default |
| Delete | Optional admin/CLI | Optional admin/CLI | Acceptable only as explicit destructive tail |
| Maintenance | Optional admin/CLI | Optional admin/CLI | Consolidation/contradictions need discoverable routing |
| Wrong home/stale discovery | Profile/catalog selection risk | Revision and two-call TOCTOU risk | Both must fail closed; B has more states |

## Acceptance gates that would falsify the recommendation

A-first is falsified if any of these occur in matched, hint-free trials:

1. In cold-open, task lifecycle, ADR supersession, custom reference capture, body edit, delete, and maintenance scenarios, users/agents cannot discover the correct path in **all supported client configurations** without repository-specific prompting.
2. Any wrong-home, stale-catalog, malformed-input, or collision case writes data. Required result: **zero writes**, structured error, correct home named.
3. A needs more than one capability-profile reconnect/change during a scenario, or the selected profile silently drifts after project-definition changes.
4. Across repeated matched runs, A’s first-attempt success is lower than B’s by more than 5 percentage points, or A causes more wrong-operation selections/retries.
5. A’s complete-journey context—initial instructions, discovery/help, schemas, results, retries, and compaction recovery—is not materially lower than baseline. Manifest reduction alone does not pass.
6. B matches or exceeds A’s task success and latency while preserving zero safety failures and reliably rediscovers after stale revisions. That would justify advancing B despite its generic host schema.

Trials must include current Codex, eligible Claude default/eager/threshold modes, standard and custom projects, mid-session intent changes, reconnects, and interrupted notifications ([required matrix](0013-tool-surface-harnesses.md)).

## Bugs versus deliberate escape hatches

Established defects include MCP delete reporting success on a miss, malformed CLI insert lines reaching ambiguous behavior, `forget` missing attribution/journal/SSE, and type-agnostic completion capture ([architecture audit](0014-tool-surface-architecture.md)).

Generic CLI create/update, `done → open` repair, forced deletion, direct Markdown editing, daemon control, and migration are deliberate operator escape hatches. They should be visibly local/operator-oriented, not silently treated as semantic equivalents. Memory bypass and unchecked parent/relation writes are established policy divergences, but restricting the generic CLI requires an explicit new ruling—not relabeling the escape hatch itself as a bug.

## Refactor sequencing

A bounded production refactor should precede exposure changes: establish memory lifecycle authority, shared workflow/relation validation, mutation receipts, a discriminated edit schema, and truthful delete receipts. These are core ownership seams, not tool-catalog concerns ([recommended order](0014-tool-surface-architecture.md)). Afterward, prototype A and B as thin exposure adapters over the same validated core; otherwise trials compare candidates atop known semantic divergence and risk institutionalizing it.

## Parent disposition

Accept A-first as **prototype order**, not as approval to remove tools or change the default. A’s task emphasis and omission of list/edit/custom-authoring are significant open product questions. B remains the challenger. The 5-percentage-point success tolerance above is a reviewer suggestion, not an adopted threshold or an observed result; baseline repeated trials must establish the actual acceptance criteria.

Do not make every proposed domain-policy restriction a prerequisite to a discovery experiment. Separate the reproduced parser/receipt defects from intentional operator freedoms; policy changes need their own ruling. Both prototypes must use the same underlying core behavior, disclose known baseline defects, and validate home/schema boundaries before any production exposure change.

Reviewer: gpt-5.6-sol, medium; read-only CLI worker, exit 0. Parent retained decision ownership and independently reproduced the selected findings in report 0014.
