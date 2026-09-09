---
title: "0017 — Controlled Codex trials of the current and smaller tool surfaces"
date: 2026-09-08
status: Pilot complete — broader client and recovery evaluation remains open
backlog_item: TASK-0011
---

# Controlled client trials

Six actual Codex runs exposed a concrete tradeoff. The typed 10-tool set completed task work but could not author the requested ADR/reference. The 8-tool discovery/executor prototype completed the full workflow in both runs, with additional calls and recoverable input errors. The current 28-tool custom-project catalog completed the full workflow in the required-startup round without tool errors.

This pilot does not select a universal default. It shows why tool-count reduction alone cannot be the acceptance criterion: A excludes work, while B moves some work into schema discovery and transfer. B remains a credible candidate; the measured pilot does not justify rejecting it merely because its outer schema is generic.

Both experiment servers loaded the pre-`129ec1c` build (research checkpoint `346c904`). Their full catalog objects were checked equal to each other and to the captured custom-project baseline. The concurrent schema-description change landed after these trials; rerunning on later main revisions may change counts.

## Controlled setup

Client: Codex CLI 0.153.4. Model: gpt-5.6-terra, medium reasoning. Each invocation ignored the user MCP configuration, used a empty non-repository client working directory and the read-only filesystem sandbox, and connected only to a localhost fixture endpoint. Requested MCP writes were explicitly authorized within disposable fixture data. No client used shell, another server, or repository files to complete the task. The common prompt is retained in [prompt.txt](tool-surface-research/client-trials/prompt.txt).

Each variant and round had its own home containing one task, one procedural memory, and the repository's reference substrate. The compound goal was to find the stored evidence convention, start/complete the task with that evidence, propose an ADR, and capture a structured external reference. Disk contents independently confirmed completion, evidence, and created documents. The reference declaration makes the full baseline **28 tools**, whereas report 0011's default without project declarations was 27.

An experimental proxy filtered the current catalog for A, or exposed the six core tools plus schema discovery and execution for B. All mutations delegated to the same rebuilt production HTTP/core implementation. B's executor resolved the current home-bound catalog revision and called the existing compiled intent tool; it did not implement domain transitions itself. Its discovery search was a simple substring filter, and its envelope errors were generic. Those prototype choices can affect retries and are not properties of every possible discovery design.

A intentionally had no operator shell/profile-switching tail during this MCP-only experiment. Its failures establish incompleteness of that default under this constraint; they do not establish that an engineered optional-profile product would fail.

## Results

Counts below exclude initialization, tools/list and independent manual probes. Elapsed time includes client startup and model work. A's shorter runs perform less work and are not equivalent-throughput comparisons.

| Round | Surface | MCP calls | Error receipts | Elapsed seconds | Verified durable outcome |
|---|---|---:|---:|---:|---|
| Initial | Full 28 | 0 | 0 | 10.6 | No writes; model reported no available actions |
| Initial | Typed 10 | 4 | 0 | 26.8 | Task done with correct evidence; ADR/reference unavailable |
| Initial | Discovery 8 | 13 | 1 | 58.4 | Task done; ADR and reference created |
| Required startup | Full 28 | 8 | 0 | 47.4 | Task done; ADR and reference created |
| Required startup | Typed 10 | 5 | 0 | 37.1 | Task done with correct evidence; ADR/reference unavailable |
| Required startup | Discovery 8 | 14 | 2 | 47.1 | Task done; ADR and reference created |

The initial full-catalog client fetched all 28 tools at the server but claimed none were exposed and made no calls. The next round set the server `required=true` and succeeded. This does **not** establish startup timing as the cause: the model invocation also changed, and no raw model-request injection trace was captured. Keep the failed run in the record rather than dropping it or treating it as definitive evidence against a large catalog.

The startup variation was deliberate: Codex documents a grace period for optional MCP startup and a required-server option. The second round eliminated optional-server omission as an intended setup behavior. [Official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

B's initial error used `args` instead of the advertised `input` field. Its second-round discovery errors requested limits 50 and 100 when the advertised maximum was 20. The model recovered in both runs. More specific validation errors could improve recovery; a production implementation must not copy this prototype's generic error messages without evaluation.

## Context accounting

Tokenization is tiktoken 0.14.0, o200k_base, as recorded in the machine evidence. These counts tokenize serialized payloads; they are not Claude counts or peak client context. Raw protocol object order produces small differences from the SDK-normalized static models in report 0015, even though the full catalog objects compare equal by content.

| Required-startup surface | Initial manifest payload tokens | Tool names/arguments + result payload tokens across calls | CLI-reported cumulative input tokens | Cached input subset |
|---|---:|---:|---:|---:|
| Full 28 | 8,457 | 1,194 | 314,068 | 284,928 |
| Typed 10 | 3,475 | 609 | 224,461 | 201,472 |
| Discovery 8 | 3,275 | 3,020 | 230,262 | 210,432 |

Do not add cumulative input tokens to payload counts: the former already counts repeated model inputs and includes cached material. It is neither unique injected context nor maximum context occupancy. The payload columns exclude host wrappers, hidden instructions, native tool-discovery calls and client-internal schema loading. Cached input is a subset, not additional tokens.

In the successful matched round, B used a smaller initial manifest and lower reported cumulative input, while issuing six more MCP calls and two retries. Elapsed times were nearly equal in this one sample. That result supports further evaluation of B; it proves neither a general quality improvement nor a regression. A's lower numbers omit two requested outcomes and cannot be presented as an equivalent-capability win.

## Boundary checks and limits

After the initial clients finished, seven manual B probes rejected without any mutation-journal change:

1. Selecting another fixture's home.
2. Supplying a stale revision string.
3. Supplying invalid input to a real compiled intent.
4. Smuggling project selection inside the inner argument bag.
5. Naming an undeclared action.
6. Trying to route remember through the intent executor instead of its dedicated domain path.
7. Supplying an invalid discovery limit.

These checks validate the prototype's narrow rejection paths. They do not establish race freedom across a real schema reload, atomicity of multi-entity writes, authentication isolation, or client behavior after compaction. The proxy restricts all variants to their designated fixture home; it is not a production home resolver or authorization implementation.

No Claude runs, threshold-mode trials, missing-notification/reconnect tests, or actual mid-session definition-change/compaction experiments were performed. Two rounds with one compound prompt each are a pilot, not statistical evidence. The startup setting changed between rounds. Future repetitions should randomize scenario order, use more than one model, compare a fully discoverable optional tail, and measure schema rediscovery after context loss.

## Reproduction and evidence

[observations.json](tool-surface-research/client-trials/observations.json) contains the scrubbed per-call arguments/results, error receipts, client usage, final agent reports and independently checked disk outcomes. Client/turn metadata and authentication headers are excluded. Full transient event logs remained outside Git; the durable evidence includes only this experiment's data.

```sh
# Rebuild server first. The server prints three isolated endpoints and writes server.json.
node docs/reports/tool-surface-research/client-trial-server.mjs . /tmp/backlog-client-trial
# In separate shells, or concurrently as independent trials:
python docs/reports/tool-surface-research/run-client-trial.py baseline /tmp/backlog-client-trial
python docs/reports/tool-surface-research/run-client-trial.py daily /tmp/backlog-client-trial
python docs/reports/tool-surface-research/run-client-trial.py discovery /tmp/backlog-client-trial
# After clients finish:
python docs/reports/tool-surface-research/probe-client-trial.py /tmp/backlog-client-trial
```

Use a fresh server/data root for another round. `--optional-startup` reproduces the first round's optional setting. Stop the owned server after evidence capture; its printed state file records the temporary data root for explicit cleanup. No production endpoint or package dependency changed. These are manual research programs, not repository integration tests.

## Disposition

Keep TASK-0011 in progress. A is suitable for an optional focused profile, not yet a complete universal default. Continue comparing B with typed approaches that preserve domain breadth; improve its error/recovery contract before judging it. TASK-0012 remains open: a final ADR must decide capability coverage, CLI/operator responsibility, context budgets and migration using the broader evaluation evidence.
