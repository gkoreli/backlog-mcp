---
title: "0011 — MCP and CLI surface: measured baseline"
date: 2026-09-08
status: Research complete — baseline, not a surface decision
backlog_item: TASK-0007
---

# MCP and CLI surface: measured baseline

The default local MCP catalog has **27 tools**, consuming **34,156 bytes / 8,034 o200k_base tokens** as a compact serialized tools/list result. This is a payload measurement, not the actual prompt of any particular client. The same catalog represented by names and descriptions only is **7,807 bytes / 1,657 tokens**. Deferral changes when schemas are paid for; it does not make discovery descriptions or selected-tool schemas free.

The **11 static tools cost 4,608 tokens** when serialized as their own tools/list result, compared with **3,430 for the 16 intents**. The independently measured envelopes account for the four-token difference from the combined total. Pruning only the long tail of semantic verbs leaves most static metadata intact. `backlog_remember` (717), `backlog_capture_requirement` (716), `backlog_wakeup` (592), `backlog_recall` (507), and `write_resource` (481) are the largest individual tool objects. Small transition tools cost 125–160 each. Tool count alone misses this distribution.

## Method and limits

Baseline revision `2a0740883fa6611e88977705730450f54844d21e`, server 0.74.0, Node v24.19.0. Captured 2026-09-09 UTC / September 8 Pacific from rebuilt production HTTP/MCP code, using the MCP SDK client against localhost and isolated temporary homes. Standard and global homes began empty; custom added this repository's `docs/substrates/reference.json`. Nine sample calls seeded one epic, task, and memory, then exercised orientation, search, recall, relational expansion, and work transitions. Every call succeeded and runtimes/homes were cleaned up. BM25-only search avoided embedding startup for this measurement; this says nothing about production hybrid retrieval quality or cold-start latency.

Tokenizer: tiktoken 0.14.0; o200k_base. All JSON counts use compact serialization, UTF-8 bytes, and explicit `o200k_base`. These are not Claude token counts, provider billing, cumulative conversation attention cost, or a recording of a real harness model request. Do not add every help page or README to a baseline unless a client actually supplies it. Corpus size, timestamps, title lengths, and search mode affect response samples.

Reproduce from the repository root after `pnpm --filter backlog-mcp build`:

```sh
node docs/reports/tool-surface-research/capture-surface.mjs . /tmp/backlog-surface-capture
# In a disposable Python environment with tiktoken installed:
python docs/reports/tool-surface-research/measure-context.py /tmp/backlog-surface-capture .
```

This is a manual research experiment, not an integration test added to the unit suite. No production code or dependencies changed. The capture initially followed generated help paths recursively; the capture script was corrected to stop at help commands. This was a research harness error, not a product regression.

Raw manifests, help pages, sample responses, environment and detailed counts are retained in [the evidence directory](tool-surface-research/baseline/). Capture and measurement scripts are adjacent to it.

The names-only JSON array is 148 tokens. This is another accounting model, not the actual Claude baseline: this server marks wakeup always-loaded, and client wrappers/search instructions also cost context. Report 0013 distinguishes these loading modes.

## Catalog variation and protocol surface

| Selected catalog | Tools | Full serialized result bytes | o200k_base tokens | Name/description tokens |
|---|---:|---:|---:|---:|
| Standard local project | 27 | 34,156 | 8,034 | 1,657 |
| Global local home | 27 | 34,156 | 8,034 | 1,657 |
| Project with repository reference substrate | 28 | 35,864 | 8,444 | 1,700 |

The custom reference declaration adds 410 full-manifest tokens and 43 name/description tokens in this fixture. This demonstrates extensibility growth, not a maximum: the registrar iterates the selected registry's explicit intents (`packages/server/src/tools/register-substrate-intents.ts:124`). It does not enforce a total manifest budget.

Each local runtime advertises tools and resources with listChanged capability. Actual `resources/list` is empty; one resource template exposes `mcp://backlog/{+path}`. There is no advertised prompts capability and no prompt registration in server source. ResourceManager registers the template with no list callback (`packages/server/src/resources/manager.ts:352`). Its broad “Any file in the backlog data directory” description is wider than the docs-native addressability checks above it. `backlog_get` overlaps resource reading while adding entity addresses and relational expansion; that distinction should be taught explicitly.

The MCP HTTP route constructs a new server for each request with stateless transport (`packages/server/src/server/hono-app.ts:383`). No explicit server source call sends tool-list-change notifications. Advertised SDK listChanged support does not establish that a long-lived client refreshes a project catalog when definitions change. TASK-0009 investigates client behavior. Constrained runtimes explicitly omit compiled intents when their registration mode is unavailable; the 27-tool total is the local default, not a promise of D1 capability parity (`tools/register-tools.ts`).

## Every default tool and its application path

Paths below are relative to `packages/server/src/`. Input-field counts include transport/identity options. Individual tokens serialize one whole tool object; summing them differs slightly from tokenizing the combined array.

| MCP tool | Tokens | Fields | Responsibility | CLI path | Core implementation |
|---|---:|---:|---|---|---|
| `backlog_list` | 328 | 8 | Browse/filter entities | list | `core/list.ts` |
| `backlog_get` | 352 | 5 | Expand entity or document; optional relations | get | `core/get.ts` |
| `backlog_delete` | 188 | 4 | Delete entity | delete | `core/delete.ts` |
| `backlog_search` | 405 | 10 | Discover current documents/entities | search | `core/search.ts` |
| `write_resource` | 481 | 5 | Validate and persist an existing body edit | edit replace/append/insert | `core/edit.ts` |
| `backlog_wakeup` | 592 | 8 | Session orientation and resumption | wakeup | `core/wakeup.ts` |
| `backlog_recall` | 507 | 9 | Retrieve captured knowledge | recall | `core/recall.ts` |
| `backlog_remember` | 717 | 15 | Capture or replace knowledge | remember | `core/remember.ts` |
| `backlog_forget` | 298 | 7 | Expire memory; explicit expired-item GC | forget | `core/forget.ts` |
| `backlog_consolidation_candidates` | 437 | 8 | Find memory-distillation candidates | consolidation-candidates | `core/consolidation.ts` |
| `backlog_contradictions` | 299 | 3 | Inspect conflicting state holders/candidates | contradictions | `core/contradictions.ts` |
| `backlog_accept_adr` | 126 | 2 | Declared accept adr intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_attach_artifact` | 199 | 7 | Declared attach artifact intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_block_task` | 142 | 3 | Declared block task intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_capture_prompt` | 350 | 7 | Declared capture prompt intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_capture_requirement` | 716 | 15 | Declared capture requirement intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_complete_task` | 140 | 3 | Declared complete task intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_create_work` | 191 | 5 | Declared create work intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_organize_folder` | 156 | 4 | Declared organize folder intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_pause_cron` | 125 | 2 | Declared pause cron intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_plan_epic` | 194 | 5 | Declared plan epic intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_propose_adr` | 289 | 9 | Declared propose adr intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_resume_cron` | 125 | 2 | Declared resume cron intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_schedule_cron` | 185 | 7 | Declared schedule cron intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_start_task` | 125 | 2 | Declared start task intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_supersede_adr` | 160 | 3 | Declared supersede adr intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |
| `backlog_target_milestone` | 203 | 6 | Declared target milestone intent | Generic create/update escape hatch; no matching semantic command | `core/substrates/execute-substrate-intent.ts` |

Static registrations live in `tools/register-tools.ts`; generated declarations converge on `executeSubstrateIntent`. The test's historic **10,444 schema bytes** covers only compiled intent input schemas before the adapter adds actor metadata and before descriptions/MCP envelopes. It cannot represent the current complete context burden.

## CLI inventory and disclosure

The root help displays **19 entries**: three daemon operations (`serve`, `status`, `stop`), twelve data/memory operations (`list`, `get`, `create`, `update`, `delete`, `search`, `wakeup`, `recall`, `remember`, `forget`, `consolidation-candidates`, `contradictions`), two groups (`edit`, `migrate`), and `version`/`help`.

`edit` has `replace`, `append`, `insert`, and generated `help`; `migrate` has `docs-native` and generated `help`. Therefore there are **25 named command paths**, **19 executable operational leaves**, plus version and three help paths; groups are not additional operations. Running the executable with no subcommand starts the bridge. Both installed names, `backlog` and `backlog-mcp`, point to the same executable. The counted help pages preserve every option and positional argument; all exit 0.

Root help costs **448 tokens / 2,517 bytes**. All 26 help pages, including root, cost **2,994 tokens / 13,020 bytes** summed separately. Typical CLI use need not pay the latter. Global flags are JSON formatting and home/project selection. Create/update retain `--fields` JSON as the generic mutation tail; edit exposes body operations as subcommands. Server management, migration, knowledge maintenance, retrieval, and semantic work coexist at the same root help level. Root help still says “Task management MCP server,” contrary to the package description and NORTH-STAR's context/memory emphasis (`cli/index.ts:24`).

## Standing instructions and sample responses

AGENTS.md is 3,723 tokens in this encoding; its memory-protocol section alone is 768. README is 5,267. These are distinct source documents, not an assumed automatic harness cost. The full root AGENTS includes testing, architecture and publishing guidance unrelated to MCP; do not attribute all of it to this surface.

Repeated transport/identity schema entries provide another concrete target for investigation: `home` appears on 11 static tools, `project_root` on 11, and `as` on 19 tools. Their per-property object costs sum to 493, 352, and 931 tokens respectively, before accounting for boundary-token differences. This is a cost decomposition, not permission to weaken home isolation or attribution. Compiled intents currently omit advertised home-selection fields even though the HTTP pre-handler can inspect them (`server/mcp-request-runtime.ts`); the domain audit examines this mismatch.

Sample complete MCP response objects cost 584 tokens for wakeup, 136 for search, 157 for recall, 124 for get with a parent stub, and 28 for each task transition. These small fixtures demonstrate the measurement method only. They do not establish response ceilings or representative corpus quality.

## Implications for comparison

1. Measure at least eager and deferred clients; count description discovery, selected schemas, tool-search responses, standing instructions, and outputs separately.
2. Compare semantic intent reduction against static-tool/description simplification. There is no evidence that keeping 27 names is optimal, nor that replacing them with one untyped dispatcher preserves usability.
3. Separate daily knowledge/work flow from operations and maintenance in the candidate CLI help. This can clarify entry points without rewriting domain logic.
4. Keep custom-substrate growth and home-scoped discovery in every candidate. A small built-in demo alone would conceal the extension problem.
5. Next gate is TASK-0011: matched workflows, correct selections, failure behavior and cumulative context—not a claim that a smaller manifest has already improved agent outcomes.
