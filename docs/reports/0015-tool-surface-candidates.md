---
title: "0015 — Smaller tool surfaces: candidates and evaluation gate"
date: 2026-09-08
status: In progress — static models and design review; client trials pending
backlog_item: TASK-0011
---

# Smaller tool surfaces: candidates and evaluation gate

The audits support a compact daily context/memory workflow, typed domain actions, and a clearly disclosed operational tail. They do **not** yet establish which smaller surface agents use most reliably. This report separates measured manifest arithmetic from that unresolved product decision.

Inputs: [inventory](0011-tool-surface-inventory.md), [workflows](0012-tool-surface-workflows.md), [harness behavior](0013-tool-surface-harnesses.md), and [domain ownership](0014-tool-surface-architecture.md).

## Two falsifiable candidates

Both candidates keep six daily capabilities unchanged for comparison: wakeup, recall, search, get, remember, and forget. This preserves the distinction between learned knowledge and current documents. Neither candidate removes substrate definitions, changes markdown authority, or requires a new execution engine.

**A — Ten typed daily tools.** Add create_work, start_task, complete_task, and block_task to the six. Move authoring intents and the five other static tools behind explicit optional capability sets or the local operator CLI. Existing exact MCP input schemas remain intact. This candidate tests whether a stable, curated default is sufficient; it must demonstrate that users can find an omitted action without assuming the product cannot do it. Profile/configuration changes and reconnection are real costs.

**B — Eight tools with declared-intent discovery.** Add a discovery tool and an executor to the six. Discovery returns brief action summaries or one exact compiled input schema; execution accepts the selected action, catalog revision, and input. It must resolve that action against the current selected-home registry, validate against the existing compiled schema, then call the existing intent executor. No arbitrary CRUD or project callback is permitted. The other five static tools still require an explicit maintenance/operator route. This is a model for an experiment, not an implemented API or accepted naming decision.

B reduces names partly by moving schemas into tool responses. Its host-visible `input` is an open object, so the host loses the original argument schema and the model must transfer it correctly from discovery. Calling this “typed execution” is only justified by server validation, not by the MCP envelope. Stale schemas, wrong-home reuse, skipped discovery and additional round trips must be tested. A claimed small manifest cannot hide those costs.

## Static arithmetic, not agent performance

| Surface | Default tools | Compact manifest bytes | o200k_base tokens | Change from baseline |
|---|---:|---:|---:|---:|
| Current | 27 | 34,156 | 8,034 | — |
| A: typed daily set | 10 | 15,553 | 3,473 | −56.8% |
| B: discovery + executor | 8 | 14,983 | 3,277 | −59.2% |

A and B differ by only **196 initial payload tokens** in this model. That is insufficient evidence to choose B’s additional protocol. The difference can readily be overtaken by one schema-discovery result or retry. A’s reduction also removes default availability for 17 existing tools, so it is not an equivalent-capability performance win.

The proposed B tools include the existing home/project selectors and actor field; this model does not obtain savings by silently removing those boundaries. Other schemas/descriptions are unchanged. No candidate server instructions, tool-search wrapper, optional-profile discovery output, loaded tail schemas or CLI-help calls are included; those must be added in the trial.

Reproduce with the disposable tokenizer environment from report 0011:

```sh
python docs/reports/tool-surface-research/model-candidates.py /tmp/backlog-surface-capture
```

The exact proposed envelopes and counts are in [candidate-manifest-models.json](tool-surface-research/baseline/candidate-manifest-models.json). They are research fixtures only.

## Scenario matrix for matched trials

| Scenario | Current baseline path | Candidate A question | Candidate B question |
|---|---|---|---|
| Cold-open and post-compaction | wakeup, targeted get; optional operation | Can the compact default explain the whole product? | Does the agent understand discovery without a long standing prompt? |
| Learned fact versus current document | recall versus search, then get | Does guidance improve selection without merging corpora? | Same; discovery should not distract from retrieval |
| Correct obsolete memory | remember with supersedes/state_key; forget without replacement | Preserve lineage and temporal semantics | Same; generic executor must not become a second memory dialect |
| Create/start/complete task | three typed intent calls | Default has full typed path | Count discovery, schema transfer, execution, retry costs |
| ADR proposal/supersession | typed ADR intents | Can the authoring tail be found and enabled? | Are both IDs, relation rules and compensation semantics preserved? |
| Novel reference substrate | project-declared capture_reference | How does a previously unknown action enter an optional set? | Does current-home discovery expose its exact schema? |
| Existing document body edit | write_resource or native edit; CLI edit | Can an MCP-only client reach the strict-edit path? | Is it an explicit retained capability or absent? |
| Delete missing/live memory | generic delete versus forget | Preserve honest receipts and separate operator deletion policy | No hidden execution path may bypass memory policy |
| Memory maintenance | consolidation/contradiction tools | How are candidates surfaced without routine menu clutter? | Do not add maintenance to a mutation dispatcher merely to claim coverage |
| Malformed home/input | reject without mutation | Validate both profile selection and invocation | Bind discovery/execution to home; never reuse another home's intent |
| Changed project schema | fresh tools/list versus cached client | Test catalog refresh/reconnect explicitly | Reject stale revision before write; recover with fresh discovery |
| Unsupported action or no shell | unknown tool / explicit CLI tail | Honest, discoverable capability limitation | Unknown intent fails; no guessed generic write |

## Independent review

[The independent design review](0016-tool-surface-candidate-review.md) recommends A as the first prototype, while explicitly retaining B as a challenger. Parent agrees with the trial order. Neither is accepted as the public default; omitted workflows and the two-step schema-transfer costs remain unresolved.

## Trial design and completion gate

Use identical seeded documents and goals for baseline/A/B, including a custom substrate absent from model priors. Run current Codex and eligible Claude default/eager modes, recording exact versions, model/settings and whether payload injection is observable. Vary scenario order; use repeated trials rather than one successful trace. Keep manual experiments in isolated real processes; any automated repository tests remain unit tests with external dependencies mocked.

Record successful durable outcome, first correct action, unsupported-action handling, extra discoveries, retries, help calls, initial visible metadata, added schemas, input/output tokens, calls, elapsed latency and compaction recovery. Use an explicit tokenizer and distinguish serialized-payload accounting from provider/model-request observations. State any unavailable instrumentation.

Acceptance requires all domain and home-isolation cases to retain their expected behavior, no silent capability loss in the claimed supported client set, and a measured context reduction that survives discovery/help/retries. Treat the current defects in report 0014 as known baseline defects, not guarantees to preserve. Set numerical usability/latency tolerances from the baseline trials before comparing candidates; do not invent performance percentages from manifest arithmetic.

**Update:** [Report 0017](0017-tool-surface-client-trials.md) now records six real Codex runs and seven executor-boundary probes. It demonstrates capability loss in A’s MCP-only default and successful but more call-heavy execution in B. The broader client/compaction/refresh matrix remains incomplete.

Do not close TASK-0011 based on this report alone. Prototypes, real client selections, cumulative-token comparisons and stale-catalog adversarial execution remain pending. TASK-0012 must choose and record the public surface only after that gate, with explicit ADR supersessions and a bounded engineering plan.
