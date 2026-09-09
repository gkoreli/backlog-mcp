---
title: "0014 — Tool surface: domain ownership audit"
date: 2026-09-08
status: Research complete — code audit; manual checks noted separately
backlog_item: TASK-0010
---

# TASK-0010 — Domain ownership and MCP/CLI semantic divergence audit

## Executive finding

The transport layering is mostly sound: MCP and CLI adapters generally call shared core functions, and canonical storage validates the resulting entity shape. Priority labels below describe research impact, not confirmed release-blocking incidents. Generic CLI lifecycle repair is deliberately retained by ADR 0106.5; restricting it requires a new ruling. The important divergence is that semantic invariants are not uniformly owned by that shared write funnel.

Schema validation protects identity, field types, allowed enum values, and canonical serialization. It does **not** protect transition history, memory lifecycle rules, relation targets, or parent validity. Consequently, the generic CLI escape hatch—and in several cases `write_resource` and `backlog_delete`—can bypass rules enforced by semantic MCP verbs.

The largest risk is memory: `remember` implements substantially more than “create a memory-shaped entity,” but generic create/update/edit/delete remain able to manipulate that same substrate without those lifecycle rules.

## Observed ownership and call-path matrix

| Responsibility | Public paths | Core/domain owner | Persistence/read owner | Observed boundary |
|---|---|---|---|---|
| Semantic entity creation | Generated MCP intent tools | `executeSubstrateIntent` → `createEntity` | `IBacklogService` → `DocsNativeFilesystemStorage` → active substrate registry | Compiler fixes defaults and narrows inputs; storage validates final shape. |
| Semantic transitions | Generated MCP transition/set-field tools | `executeSubstrateIntent` → `updateEntityPostimage` | Service/storage/registry | Executor validates subject type, transition preimage, relation target type, and full postimage. |
| Generic entity creation | CLI `create` | `createEntity` | Same service/storage/registry | Same routing, persistence, capture, journal, and SSE funnel; no intent semantics. |
| Generic entity update | CLI `update` and `--fields` | `updateEntity` → `updateEntityPostimage` | Same service/storage/registry | Protects server-owned identity and validates final shape, but has no workflow/relation history checks. |
| Body editing | MCP `write_resource`; CLI `edit` | `editItem` | `service.save` → registry | Operates on any entity ID, including memories and workflow documents. |
| Generic deletion | MCP `backlog_delete`; CLI `delete --force` | `deleteItem` | `service.delete` | No substrate or lifecycle policy; storage unlinks the matching document. |
| Explicit memory capture | MCP `backlog_remember`; CLI `remember` | `remember` | `MemoryComposer` → `BacklogMemoryStore` → `persistNewEntity` | Owns memory-specific validation, correction lineage, state-key closing, attribution, and collision scan. |
| Memory retraction/GC | MCP/CLI `forget` | `forget` | `MemoryComposer` → `BacklogMemoryStore.forget` → service save/delete | Correct soft-expire/GC semantics, but bypasses the shared mutation journal/SSE funnel. |
| Retrieval/context | MCP/CLI get/search/recall/wakeup; HTTP viewer reads | Core read functions and `HomeReadCoordinator` | Service/search/memory store | ADR 0114’s relational context is folded into `get(context:true)`; viewer is primarily a read projection. |
| Viewer | `/tasks`, `/search`, `/api/desk`, `/operations`, resource routes | Some core compositions plus route-level presentation/enrichment | Request-selected service/runtime | No general viewer entity-write API. The viewer adds memory usage/conflict projections and home provenance. |
| Automation | MCP cron create/pause/resume; generic CLI writes | Intent executor or generic entity core | Cron entity storage | backlog-mcp stores descriptors; an external scheduler executes commands. |
| Administration | CLI server/migration commands; HTTP restart/shutdown/home registry routes | Command- or server-specific modules | Local runtime/control state | Properly separate from substrate semantics; should not be folded into a domain dispatcher. |

Supporting paths:

- Intent registration is mechanical and delegates to core: `packages/server/src/tools/register-substrate-intents.ts:62-103,106-140`.
- Core creation owns routing, persistence, capture, journaling, and events: `packages/server/src/core/create.ts:87-188`.
- Core updating owns merge, canonical save, completion capture, journaling, and events: `packages/server/src/core/update.ts:73-147`.
- Storage revalidates every canonical write: `packages/server/src/storage/local/docs-native-filesystem-storage.ts:242-273,384-403`.
- Registry validation chooses the active substrate validator by `type`: `packages/server/src/core/substrates/project-substrate-registry.ts:106-137`.
- HTTP viewer routes are read-side compositions: `packages/server/src/server/hono-app.ts:446-605,685-778,834-950`.

## Prioritized findings

### High-impact design conflict — Memory lifecycle can be bypassed by generic managed writes

**Observed facts**

`remember` enforces rules not present in `MemorySchema`:

- non-empty trimmed title/content;
- valid entity IDs for context and references;
- `supersedes` must identify a memory;
- derived memories require source references;
- ISO date validation and non-inverted validity intervals.

See `packages/server/src/core/remember.ts:65-101`. It also assigns provenance and delegates correction behavior to the store, `:103-127`.

`BacklogMemoryStore` performs the actual lifecycle side effects: `supersedes` expires the named predecessor and `state_key` expires other live holders before inserting the new memory (`packages/server/src/memory/backlog-memory-store.ts:79-119,121-129`).

By contrast:

- CLI `create` accepts arbitrary substrate fields: `packages/server/src/cli/commands/create.ts:22-53`.
- CLI `update` accepts arbitrary field changes: `packages/server/src/cli/commands/update.ts:11-42`.
- `updateEntity` mechanically merges those values and asks storage only to validate the final postimage: `packages/server/src/core/update.ts:124-147`.
- `MemorySchema` constrains individual field shapes but does not enforce ISO dates, derived-source requirements, state-key uniqueness, or supersession side effects: `packages/shared/src/substrates/memory.ts:56-116`.
- `editItem` edits the body of any entity: `packages/server/src/core/edit.ts:20-44`.
- `backlog_delete` and CLI delete can hard-delete any entity, including a live memory: `packages/server/src/tools/backlog-delete.ts:15-34`; `packages/server/src/cli/commands/delete.ts:10-26`.

Therefore, a managed CLI update can rewrite an add-only memory, install a `state_key` without closing the previous holder, assign malformed temporal values, or set `supersedes` without expiring the predecessor. `write_resource` can rewrite the memory body. MCP `backlog_delete` can hard-delete it despite the memory contract saying live hard deletion is a human action (`packages/server/src/core/forget.ts:1-8`).

This is a validated code-path fact, not a hypothetical storage failure: canonical storage checks the postimage’s schema, while the missing rules require preimage comparison or multi-entity effects.

**Minimal seam**

Make memory lifecycle the managed-write authority without introducing a package:

- Route generic memory creation through `remember`, or reject `type=memory` from generic creation with a clear pointer to `backlog remember`.
- Reject memory lifecycle/body changes in generic `updateEntity` and `editItem`, unless an explicitly designed maintenance override is later approved.
- Reject live-memory deletion from MCP `backlog_delete`. The existing forced local CLI can remain the explicit human/operator hard-delete path if that is the intended ruling.
- Keep direct markdown editing as the human-visible external path; reconciliation can remain lossless/lenient.

**Validation plan**

Unit-test with the real memfs-backed local runtime that:

1. generic creation cannot create `derived:true` without sources;
2. generic update cannot bypass `state_key`/`supersedes`;
3. managed body edits cannot rewrite a memory;
4. MCP delete refuses a live `MEMO-` ID;
5. the explicitly retained human/operator deletion path remains documented and tested.

### Domain-policy divergence — Generic CLI status updates bypass compiled workflows

**Observed facts**

Semantic transitions validate both subject substrate and allowed preimage:

- subject type check: `packages/server/src/core/substrates/execute-substrate-intent.ts:69-83`;
- transition precondition and idempotency: `:98-111`;
- validated postimage before persistence: `:187-218`.

The task workflow permits only declared edges such as open/blocked → in-progress and open/in-progress/blocked → done (`packages/server/src/substrate-definitions/builtin-substrate-intent-definitions.ts:12-33`).

Generic `updateEntity` has no transition check; it merges `status` or `fields.status` and saves (`packages/server/src/core/update.ts:125-147`). CLI exposes both `--status` and `--fields` (`packages/server/src/cli/commands/update.ts:13-34`). Storage only checks that the resulting status is an allowed enum member.

The tests explicitly encode that generic `done → open` succeeds (`packages/server/src/__tests__/memory-capture.test.ts:155-160`). That confirms generic update is mechanical maintenance, not a synonym for semantic transition.

This creates observable consequences:

- terminal states can be reopened;
- ADR status can be changed without required supersession lineage;
- task completion can be reached without the declared verb;
- a task can be completed, reopened, and completed again, generating repeated episodic completion memories because capture triggers whenever the postimage is `done` and the preimage is not (`packages/server/src/memory/capture-rules.ts:18-25`).

Additionally, `shouldCaptureCompletion` does not check `entity.type === task`, so a generic update of an epic, milestone, or cron into `done` also qualifies for “task completion” capture. The stated rule says task completion only (`packages/server/src/memory/capture-rules.ts:6-13`), while the predicate at `:23-25` is type-agnostic.

**Minimal seam**

Keep generic field maintenance, but separate workflow-field mutation from ordinary update:

- Add one core workflow-transition validator using active registry metadata/preimage.
- Require status changes to match a declared transition by default.
- If raw maintenance remains necessary, expose it as an unmistakable local-only override rather than the normal `--status` path.
- Independently narrow completion capture to `next.type === 'task'` unless broader completion capture is deliberately adopted.

Do not generate another family of hand-written CLI commands solely to mirror MCP; this is an invariant-ownership issue, not necessarily a command-count issue.

### Domain-policy divergence — Relation and parent integrity differs by mutation path

**Observed facts**

`relate-and-transition` validates both endpoint existence, source type, target type, cardinality, transition state, and both postimages before writing (`packages/server/src/core/substrates/execute-substrate-intent.ts:249-305`).

Generic create/update fields receive no equivalent endpoint validation. Semantic create intents also map declared relation arrays directly into `createEntity`; the creation funnel validates their JSON shape but does not resolve relation targets (`execute-substrate-intent.ts:144-183`; `core/create.ts:141-164`).

Likewise, built-in substrates declare valid parent types—for example tasks allow task/epic/folder/milestone (`packages/shared/src/substrates/task.ts:18-29`)—but the declaration is not consulted by managed writes. `routeContainer` selects a string parent but does not verify existence or type (`packages/server/src/core/container-routing.ts:97-122`). Repository search found `validParents` declarations but no server-side enforcement consumer.

Therefore:

- combined semantic relation operations are integrity-aware;
- semantic creates and generic CLI field writes are only shape-aware;
- all creates can persist dangling or type-invalid `parent_id` values.

**Minimal seam**

Add a narrow core relational-postimage validator that receives the service and active registry metadata. Invoke it from managed create/update and reuse it from the intent executor. Validate:

- parent existence and permitted parent substrate;
- declared relation target existence and target substrate;
- relation cardinality/type.

Do not apply this validator to lossless external reads; the North Star explicitly permits imperfect repository prose to remain readable.

### Domain-policy divergence — `forget` mutates storage outside attribution and live-update ownership

**Observed facts**

`recordMutation` describes itself as the single mutation journal/SSE entry point and names create, update, delete, and resource edit callers (`packages/server/src/core/operation-log.ts:1-12,20-60`).

`remember` explicitly records its semantic write after durable storage (`packages/server/src/core/remember.ts:127-140`).

`forget` accepts no `WriteContext`; it calls `memoryComposer.forget` and returns only a count (`packages/server/src/core/forget.ts:15-63`). The backing store directly saves expired memories or deletes expired ones (`packages/server/src/memory/backlog-memory-store.ts:168-200`). Neither MCP nor CLI supplies agent attribution for forget.

Consequences are observable:

- no `backlog_forget` journal entry;
- no actor attribution;
- no `task_changed`/`task_deleted` event emitted through the core mutation funnel for affected memory IDs (filesystem reconciliation may still cause refreshes);
- the viewer’s operation history cannot explain why a memory expired or disappeared.

**Minimal seam**

Have the memory mutation return an affected-ID receipt, including soft-expired versus deleted IDs, and let core `forget` record the semantic mutation and emit per-ID events. Pass `WriteContext` through both MCP and CLI. This can remain a narrow server/core contract; no new package is justified.

### Adapter defect — Delete’s MCP receipt reports success for a miss

`deleteItem` deliberately returns `{deleted:false}` for a missing ID (`packages/server/src/core/delete.ts:10-35`). CLI preserves that distinction (`packages/server/src/cli/commands/delete.ts:23-24`). MCP ignores the boolean and always replies `Deleted <id>` (`packages/server/src/tools/backlog-delete.ts:26-34`).

This is a transport-only bug. Return a structured receipt or an error/not-found message when `deleted` is false. Add a wrapper-level unit test; core behavior already has coverage at `packages/server/src/__tests__/core-invariants.test.ts:685-697`.

### Adapter defect — Body-edit validation is split and CLI accepts malformed line numbers

MCP’s nested operation schema makes all operation-specific fields optional (`packages/server/src/tools/backlog-write-resource.ts:30-40`), while core casts the result to `Operation` without runtime validation (`packages/server/src/core/edit.ts:30-32`).

CLI parses insert lines with `parseInt` and performs no integer check (`packages/server/src/cli/commands/edit.ts:63-67`). Core range checks do not reject `NaN`; JavaScript `splice(NaN, …)` behaves as insertion at index zero (`packages/server/src/resources/operations.ts:47-55`). Inputs such as `abc` or `1junk` therefore do not have a reliable shared failure contract.

**Minimal seam**

Define one discriminated runtime schema for `str_replace`, `append`, and `insert`, validate in `editItem`, and make both adapters use it. Require finite integer line numbers. This is a small consolidation with direct parity value.

### Exposure growth — Project-defined intent growth is bounded per declaration, not per manifest

**Observed facts**

Each substrate declaration permits up to 64 intents (`packages/shared/src/substrates/substrate-definition.schema.ts:174-198`). Individual declarations are limited to 256 KiB (`packages/server/src/core/substrates/compile-substrate-definition.ts:23-24,63-81`). The loader iterates all discovered declarations and composes every valid intent; no total intent/tool cap is visible (`packages/server/src/core/substrates/load-substrate-definitions.ts:27-40,83-110`). Every compiled executable intent is registered for the selected MCP runtime (`packages/server/src/tools/register-substrate-intents.ts:120-138`).

Name collisions and static/retired-name shadowing are handled correctly through registry quarantine and reservations (`packages/server/src/core/substrates/project-substrate-registry.ts:381-409`; `packages/server/src/server/tool-name-reservations.ts:1-32`). Unsupported `relate` and `append-relation` declarations are visibly quarantined rather than exposed as failing tools (`register-substrate-intents.ts:16-43,120-125`).

**Inference, not measured performance**

Manifest size grows linearly with project-declared executable intents. The actual agent context/selection cost depends on the harness’s deferred-tool behavior and was not measured in this audit.

A single generic dispatcher would reduce names but would also hide exact per-intent schemas and reintroduce `type`/`verb` discrimination—the tradeoff already documented in ADR 0106.5 (`docs/adr/0106.5-intent-write-surface.md:519-522`). I found no evidence here sufficient to reverse that ruling.

A smaller surface should first remove semantic overlap and enforce ownership. If custom intent growth becomes real, the smallest next investigation is an exposure policy or bounded manifest profile—not a second execution architecture. Any cap or opt-in policy needs live project/harness trials before adoption.

## Recommended architecture seams, in order

1. **Memory managed-write policy:** make `remember`/`forget` authoritative for memory lifecycle; prevent generic MCP operations from bypassing it.
2. **Managed mutation validation:** one preimage/postimage validator for workflow and relation rules, reused by generic core and intent execution.
3. **Mutation receipt:** affected IDs and mutation kind for multi-entity and bulk lifecycle operations, enabling truthful journal/SSE handling.
4. **Edit operation schema:** one runtime discriminated union at core/shared level.
5. **Adapter receipt parity:** preserve core outcomes such as `deleted:false`.
6. **Manifest governance only after trials:** retain compiler-owned exact intent schemas unless measured harness evidence favors a curated exposure layer.

These seams fit existing folders and contracts; none requires a speculative new package or a broad rewrite.

## Facts versus concerns

- **Validated from code:** generic CLI writes receive canonical schema validation.
- **Validated from code:** canonical schema validation does not inspect prior workflow state.
- **Validated from code/tests:** generic `done → open` is allowed.
- **Validated from code:** memory-specific invariants and side effects live in `remember`/`BacklogMemoryStore`, not generic CRUD/edit/delete.
- **Validated from code:** forget mutations lack journal/SSE/actor context.
- **Validated from code:** parent and most create-time relation targets are not resolved.
- **Untested concern:** real harness context cost from custom intent growth.
- **Untested concern:** frequency of users or agents invoking generic CLI writes against memories or declared workflows.
- **Untested concern:** concurrency behavior beyond the already documented compensating two-entity supersession design.
- **Not claimed:** any measured improvement in agent selection accuracy from reducing tool count.

## Checks performed

Read-only commands used:

- `sed`/`nl -ba` over `AGENTS.md`, TASK-0010, ADRs 0090/0106.5/0114, NORTH-STAR, and the cited source/test files.
- `rg`/`find` to trace adapters, core functions, schema validation, workflow/relation consumers, routes, and project substrate declarations.
- `git rev-parse HEAD` confirmed baseline `2a0740883fa6611e88977705730450f54844d21e`.
- `git status --short` showed parent-owned research changes; none were modified.
- No tests were run and no repository/backlog mutations were performed. Existing tests are cited as evidence but were not re-executed.

Model: `gpt-5.6-sol`
Reasoning effort: medium
## Parent manual verification — 2026-09-08

The isolated production HTTP/MCP + CLI capture in `tool-surface-research/capture-surface.mjs` reproduced:

- Invalid home enum and non-string project root were rejected by `remember` with otherwise valid input. Wrong-substrate transitions, restarting a done task, and undeclared tools were also rejected. The mutation journal was unchanged across all six rejection cases.
- Valid `home`/`project_root` fields on a generated create intent were rejected as unknown schema keys. This is a discoverability/transport inconsistency, not an observed cross-home write.
- Generic CLI `update TASK-0001 --status open` accepted a done task. Existing tests and ADR 0106.5 establish this as an intentional operator escape hatch; changing it requires a policy decision.
- `edit insert TASK-0001 not-a-number ...` returned exit 0 and a successful insertion receipt. This corroborates the parser/NaN defect.
- MCP deletion of absent `TASK-9999` returned `Deleted TASK-9999`.
- Generic CLI creation of `type=memory, derived=true` with no entity_refs succeeded; `backlog_remember` rejected equivalent memory input with the required-source error. This corroborates the managed-write policy conflict.

Exact responses are in [boundary-observations.json](tool-surface-research/baseline/boundary-observations.json). The other findings remain code-audit results with the validation plans above; they were not all exercised manually. No production fixes were made during this research phase.
