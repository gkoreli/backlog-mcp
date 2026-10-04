---
title: "0136. Domain ownership and application patterns"
date: 2026-10-03
status: "Accepted — maintainer authorized implementation and future architecture conventions"
extends:
  - 0134-engineering-rules.md
  - 0135-complete-reads-and-managed-mutation-consistency.md
relates_to:
  - 0112-docs-native-project-scoped-backlog.md
  - 0113-user-defined-substrates.md
  - 0117-the-write-boundary.md
  - 0125-consumer-agnostic-core-compose-dependencies.md
---

# 0136. Domain ownership and application patterns

The maintainer asked for further engineering using DDD, DRY and SOLID and an
authoritative design convention for future work. This decision extends ADR
0134's dependency rules and ADR 0135's consistency contracts. It supersedes
neither. Earlier home, substrate, native-edit and consumer-agnostic decisions
remain authoritative. Their historical implementation inventories are not a
description of the current tree.

## Evidence and bounded implementation

Server paths below are relative to `packages/server/src/`; paths beginning with
`memory/src/` are relative to `packages/`.

At `77eefe7` the six-stage refactor had complete corpus reads, exact-byte
preimages, committed diagnostics, coordinated corrections, injected config and
discovery reads, and a separate migration executor. Import exception groups
were empty. That establishes dependency direction at scanned imports; it does
not prove all policy is pure or all invariants are enforced.

Three remaining flows justified this iteration:

- HTTP and CLI independently projected home-owned capabilities for cross-home
  reads. `composition/home-read-runtime.ts` now constructs this projection once.
  Adapter-selected readers remain authoritative. Projection does not introduce
  write authority, ambient home selection or broader filesystem access.
- `server/hono-app.ts` owned operation interpretation, title resolution and
  response assembly. Concurrent enrichment cached values only after awaiting
  reads, permitting repeated lookups. `core/operation-entry.ts` owns historical
  interpretation; `core/operation-history.ts` owns read orchestration and caches
  promises before awaiting. `server/operation-routes.ts` parses HTTP and attaches
  provenance. `server/mcp-route.ts` owns stateless MCP transport assembly, keeping
  request selection, intent registration and telemetry semantics intact.
- Search projection and filtering mixed policy with Orama lowering. In
  particular, an explicit empty status list rejected exact-ID matches but was
  omitted from indexed filtering. `memory/src/search/search-selection.ts` now
  constructs a copied/frozen value for both cached predicates and typed Orama
  lowering. `memory/src/search/search-document.ts` owns declared field projection
  and embedding inputs. Tests drive actual Orama parity without merging
  corpus/display/query contracts.

Derived episodic capture also sampled another ambient time and wrote to console
inside core. Capture now accepts the operation time and returns warnings.
Create/update sample one optional injected clock and use that time for their
stamping, capture, journal and notification. Capture failure cannot reject or
repeat the committed primary mutation. This is a bounded cleanup, not a claim
that every legacy application entrypoint has injected time.

## Binding conventions

### R1. Separate policy, application orchestration and effects

Domain policy consists of typed values and pure operations over supplied data.
It validates an invariant or computes a plan/projection without performing I/O,
reading ambient state or constructing a runtime. Examples include
`core/memory-validity.ts`, `core/memory-correction.ts`, `core/document-address.ts`
and `core/operation-entry.ts`.

Application orchestration calls consumer-owned ports in a defined sequence. It
owns use-case completion and joins domain policy with effects. `core/create.ts`,
`core/update.ts`, `core/home-read-coordinator.ts` and `core/operation-history.ts`
are application functions even though they share `core/` with policy modules.
Keeping both under core is permitted; extraction follows a cohesive concept,
not a mandatory new layer directory. Application code must remain transport-free
and may not import adapters, infrastructure or composition.

Infrastructure implements ports and owns filesystem publication, locks, search
engine calls, journals and subscriptions. Composition assembles those effects
for a selected home. Driving adapters parse caller input, provide their explicit
policy, invoke application code and format results. Shared composition never
inherits CLI permissions from HTTP, or HTTP containment from CLI.

New policy functions receive time as a value. New application flows receive
clocks/readers through capabilities and sample a clock once per operation when
temporal consistency matters. No console, environment or cwd access belongs in
core. Existing optional clock defaults in command/analysis entrypoints are
migration debt, not a design precedent or an exception to ADR 0134 R1.1.
Deterministic date conversion from supplied data remains permitted.

### R2. Model concepts and place invariants with their owners

A home is the selected document universe, not a mutable global selector. A
document identity/address names authoritative Markdown; its storage revision
names exact observed bytes. A substrate is an open declaration of schema,
identity, intent and disclosure policy. A memory holder has temporal validity
and correction lineage. An operation records actor and semantic input; history
is a read projection of that record, not another authoritative record.

These are useful concept boundaries, not a requirement for one class, aggregate
or package per noun. Prefer immutable typed data and constructor/operation
functions when that centralizes a real invariant. Keep unknown custom fields,
open substrate names, native lossless reads and existing serialization. Do not
force custom substrates into task enums or inheritance hierarchies.

Package roles are practical dependency boundaries: shared owns entity/wire
contracts, memory owns retrieval/composition algorithms and search adapters,
server owns document/application/runtime flows, viewer consumes HTTP. A package
boundary alone does not prove a DDD bounded context. In particular, memory and
document persistence cooperate across packages. Shared must not become a bucket
for implementation convenience or import server/memory/viewer.

Use existing `PathResolver` mechanics for local paths and canonicalization.
Pass selected home and containment policy explicitly. Its package-root singleton
does not own the active home; do not add another resolver or ambient selector.

### R3. Repositories and composition expose real consumer capabilities

A port belongs to the consumer and names a cohesive capability, not a concrete
implementation or every method on a facade. Complete corpus scans, bounded
display lists, ranked search and committed mutation outcomes are distinct
contracts. An unavailable required local capability fails visibly. Never
substitute a display page for a complete read or claim D1 parity through a
weaker fallback.

The compatibility `IBacklogService` remains while callers migrate. New consumers
use cohesive capability types, such as `EntityUpdateRepository` or the history
reader's `Pick<IBacklogService, 'get'>`, rather than taking the facade by default.
Do not introduce one interface per method unless independent ownership or
implementations warrant it. Preserve receiver binding on injected methods.

Composition constructs an isolated graph for an immutable selected home.
`createHomeReadRuntime` projects only home-owned read capabilities;
`createManagedWriteContext` requires explicit actor and journal authority.
Request caches are local to that operation/home, never process-global by entity
ID. A CLI reader that returns no content remains authoritative; it must not
fall through to a different reader after invocation.

### R4. Queries and projections have a single policy owner

Normalize query selection once, then lower it for a backend or evaluate it over
cached values. Unspecified selection and explicitly empty selection differ:
an empty allowed set selects nothing. Caller type selection overrides parsed
type intent; exclusions intersect it. Default memory visibility, entity-only
search, exact-ID navigation and resource behavior are named query policies,
not interchangeable corpus filters. Tests must compare equivalent policies.

The substrate registry chooses searchable fields. The memory search package
flattens that explicit projection; Orama lowering maps it to indexed fields.
Payload freshness, searchable/filter representation and embedding inputs remain
distinct so metadata/payload edits do not recompute unrelated embeddings.
Use named pure projections rather than maintaining parallel field assemblies.
Adapters attach transport presentation/provenance; they do not reinvent domain
status, validity or historical interpretation.

### R5. State the aggregate and commit boundary truthfully

The authoritative managed write is one document publication. Its identity,
schema, expected preimage and path policy are checked at the write boundary.
The local home lock coordinates cooperating writers and allocation; it does
not make the whole home a crash-atomic aggregate or lock native editors.

Memory correction and multi-intent changes cross document boundaries. Use
deterministic plans, prevalidation and guarded exact-postimage compensation.
Report recovered versus partial failure. Do not introduce a generic transaction
framework or claim rollback after an intervening native edit.

After commit, search, capture, journal and live events are derived/best-effort
effects with their established diagnostic contracts. Report known failures as
committed diagnostics and repair pending where applicable; never replay a
semantic write to retry a derived effect. Standard journal append remains
best-effort under ADR 0117. Runtime retirement guards admission/replacement;
it is not a lease over all outstanding service calls.

### R6. Apply DRY and SOLID to behavior, not superficial shape

Before adding policy, search the vocabulary and actual callers. Reuse one owner
when behavior and authority are the same. Similar-looking transport/path rules
may legitimately differ; require an explicit policy input before sharing them.
Do not deduplicate coincidentally similar code into boolean-heavy helpers.

Use these patterns when they solve an observed problem:

- Value constructors and pure plans for centralized invariants and deterministic
  review; plain typed values are usually sufficient.
- Ports/adapters and constructor injection for effects, backed by actual consumer
  needs. Composition is the only place that builds the complete graph.
- A read projection for history/search/presentation derived from authoritative
  data. This is a read/write separation, not a second authoritative database.
- Request-local promise caching for repeated independent reference reads;
  single-flight lifecycle guards for shared runtime admission/retirement.
- Explicit strategies such as an injected reader or field projector when policy
  truly varies. A function often suffices; use classes for owned lifecycle/state.

Single responsibility means one reason for policy to change. Open/closed means
new substrates enter through declarations and ports, not growing closed enums.
Substitution means equivalent capabilities honor filtering/commit/failure
contracts. Interface segregation follows use cases; dependency inversion means
effects implement consumer-owned ports. None requires class hierarchies.

Reject abstract base repositories, generic units of work, service locators,
decorator frameworks, an event-sourced shadow store, duplicated resolvers and
speculative engines. No new dependency is needed for this iteration. Compose
the installed library pipeline under ADR 0125 rather than replacing its tokenizer
or ranking mechanics with imitation code.

### R7. Migrate incrementally and enforce what is claimed

Change a cohesive flow with its consumers and contract tests. Preserve wire
names, open data and successful receipts; document additive diagnostics and
behavior corrections in the changelog. Do not sweep-rename or split solely to
hit a line count. Large Hono and Orama modules still have incremental work;
this ADR does not declare them comprehensively decomposed.

Keep import allowlists empty. Architecture checks enforce dependency direction;
pure model and query tests enforce invariants; adapter tests enforce mapping.
Broaden enforcement as a concept moves, without grandfathering fresh violations.
Unit tests use memfs/mocked effects. Real-process manual checks use disposable
homes only and record which dependencies were real or mocked.

Review every touched flow with this checklist:

- Which concept owns each invariant, and is there already an implementation?
- Which functions are pure policy, application orchestration, effects or assembly?
- Are home, actor, scope, clock and path authority explicit at the boundary?
- Does the consumer receive exactly the complete/bounded/ranked capability needed?
- Do predicate and backend selection agree on empty sets, precedence and exclusions?
- Does the result distinguish uncommitted failure, commit diagnostics and partial recovery?
- Can a cold consumer use the same contract without warm-state assumptions?
- Do tests prove behavior with custom fields, concurrency, failures and home isolation?
- Are wire changes, residual guarantees and discoverable guidance recorded accurately?

## Engineering record

Stage 1 (`1b96a2b`) implements shared home-read composition, history policy and
orchestration, focused MCP/history route ownership, and deterministic derived
capture diagnostics.


Stage 1 verification: workspace build/typecheck passed; server 1,571 tests passed
with two existing skips, memory 49 and viewer 163 passed (1,783 total). New tests
cover delayed shared references, input order, unknown/prototype-shaped historical
tools, missing references, per-read/home cache isolation, reader precedence,
receiver binding, rejected missing homes, one sampled operation clock and
post-commit capture warnings with one journal/event attempt. Existing MCP/body
selection and CLI/cross-home tests pass. A built-module actual Node process used
two disposable docs-native homes, actual storage and Hono requests: three history
records resolved two distinct IDs per home with correct titles/provenance, and
missing-home projection failed. Journal query, unused search/catalog and runtime
resolution were injected; this does not claim an OS watcher or daemon lease test.


Stage 2 centralizes normalized selection and pure search projections. Both
indexed and cached routes consume the same selection value. An explicit empty
status/type list selects nothing, including entity-only search's `docTypes`.
Without a positive type selection, explicit exclusions retain the established
entity-only rule; generic queries also retain memory exclusion even when another
type is excluded. Positive resource selection overrides that implicit resource
rule; explicit excluded resources still cannot enter. Direct memory ID navigation
keeps its existing visibility. Empty parent text retains indexed behavior as no
containment selection. No schema/index-version or successful wire shape changed.

The Orama service now owns engine lifecycle/retrieval, not field flattening or
selection precedence. It passes projected fields and typed enum predicates to the
existing engine/tokenizer/ranking pipeline. Payload, filter representation and
embedding inputs stay distinct, preserving metadata updates and vector reuse.

Ownership guards now reject process/console access across server core, ambient
clocks in selected pure policy/capture modules, and effect/Orama imports in the
pure search value/projection modules. They also check shared/memory package
import direction. These are explicit checks for those rules, not a proof of
transitive purity or an exemption for legacy ambient-clock defaults elsewhere.
The existing dependency allowlists remain empty.


Stage 2 verification: workspace build/typecheck passed; server 1,583 tests passed
with two existing skips, memory 56 and viewer 163 passed (1,802 total). Seven
real-Orama/memfs cases cover empty/invalid selections, full-text/filter-only/ID/URI
queries, custom type precedence, parent containment, exclusion intersection,
explicit resources and memory navigation/default visibility. Seven pure model
cases cover frozen copies, status tokens, open vocabulary, declared fields and
payload/filter/embedding separation. Five ownership checks pass alongside the
existing empty import allowlists.

A built-module actual Node process used a disposable docs-native home and real
Orama BM25: empty selections returned no matches, explicit resources and direct
memory navigation worked, generic queries excluded memory, and an injected capture
outage left a completed task persisted with `memory_capture_failed`. There was
one capture attempt, one real journal entry and one injected notification, with
the supplied operation timestamp. The watcher, capture outage, notification and
diagnostic logger were injected; no OS-watcher, model download or user-corpus
mutation is claimed. Temporary fixtures were removed. The first diagnostic
logger append was denied by the filesystem sandbox; the repeated check explicitly
replaced that diagnostic sink before running, while retaining the real selected
home journal.

The scoped iteration is complete. Remaining clock defaults in older application
entrypoints, the compatibility facade and larger Hono/Orama lifecycle modules
remain incremental work. Prior guarantees stay unchanged: cross-document recovery
is compensation rather than crash atomicity; native editors do not hold managed
locks; standard journal append remains best-effort; runtime retirement controls
admission rather than every outstanding call. D1 remains descoped. No dependency,
version, publication or installed CLI change was needed.
