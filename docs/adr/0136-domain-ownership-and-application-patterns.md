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


### Stage 3 — derived lifetimes (2026-10-04)

The next bounded plan followed two observed ownership gaps at `1a21390`:
`hono-app.ts` released its event subscription only on abort, so cancelling the
response body leaked a subscriber and heartbeat; `orama-search-service.ts` loaded
and rebuilt active database/maps in place, leaving mixed state after failure and
resource payloads detached from a fresh database. The plan extracts the stream
lifetime and cache format/I/O owners, stages complete index state, and guards
publication against mutations/builds crossing asynchronous work. Search ranking,
cache version, selected-home policy and source Markdown remain unchanged.

`server/event-stream.ts` owns admission and one idempotent retirement for its
subscription, abort listener and heartbeat. Body cancellation, abort, already
aborted requests, setup/projection/serialization failures retire that stream.
Callback failures do not escape through the event bus into semantic writes.
`server/event-routes.ts` selects the runtime and attaches that home's provenance;
`AppDeps.eventBus` now uses the existing event-bus contract. An injected failing
unsubscribe is attempted once, with remaining callbacks inert; this does not
promise removal from an arbitrarily broken injected bus. SSE keeps its existing
framing and heartbeat-only behavior, with no replay or bounded backpressure policy.

`memory/src/search/search-index-snapshot.ts` owns the unchanged versioned format,
leaving custom entity vocabulary and payloads open. `search-index-cache.ts` owns
best-effort debounce and selected-path I/O. A unique sibling temporary file is
renamed after complete serialization/write; injected write/rename failure retains
previous complete bytes and attempts temporary cleanup. This is cache-file
replacement, not crash durability, fsync or multi-document atomicity. PathResolver
still owns path selection; the cache only creates its supplied path's directory.

Orama now publishes one database, entity/field/resource maps and embedding-schema
flag after successful load/build. Loaded candidates check document count and IDs,
filter metadata and declared projections against cached payloads, and require
finite embedding vectors of the declared dimension when that schema is flagged. Missing legacy
field maps keep format compatibility and permit only metadata checks. Orama owns
its inverted-index internals: arbitrary same-shaped internal corruption is not
fully validated here. Malformed or observably inconsistent caches become misses
and rebuild from supplied authoritative documents. Valid retained resources are
inserted into fresh databases rather than surviving only as detached payloads.

An admitted incremental mutation invalidates builds at entry and completion;
build admission/publication rejects while mutations are in flight. A later build
publication also invalidates older candidates. Superseded candidates throw the
named error and require reconciliation from current authoritative data. Failure
leaves the previous active state intact. Each query captures its database and
projection-map references through retrieval, fusion and snippet assembly, so
rebuild publication cannot mix index generations. Incremental mutations still
modify those maps in place; this is no snapshot-isolation claim for arbitrary
parallel incremental mutations or queries. Managed application mutation ordering
remains ADR 0135's boundary, and cache-first loading still requires reconciliation
to refresh native edits.

Focused unit evidence: actual Web streams/fake event buses and timers cover frame
compatibility, selected-home same-ID isolation, cancel/abort/early-abort and
setup/projection/serialization/release failures. Real Orama with memfs and mocked
embeddings covers resource rebuilds, malformed and inconsistent loaded cache,
open custom/prototype-shaped IDs, partial build failure, queries crossing rebuild,
mutations crossing builds in both admission orders, overlapping builds, and
write/rename failures with debounce retirement. Workspace build/typecheck and all 1,824 tests passed: server 1,605 with two
existing skips, memory 56 and viewer 163. Architecture import allowlists remain
empty. A built-module actual Node process exercised `/events` with a real Request,
ReadableStream reader cancellation and later abort: one subscription, one release
and zero remaining listeners. The same process used real Orama BM25 and disposable
temporary cache directories to confirm retained resources, separate same-ID cache
paths, inconsistent-payload cache rebuilding and absence of leftover temporary
files. The bus was injected; no OS watcher, model download, daemon lifetime or
user-corpus write is claimed. Temporary fixtures were removed. No dependency, version, publishing or installed CLI change is
needed. Ambient-clock/read-analysis cleanup remains future work.

### Stage 4 plan — observed memory analysis (2026-10-04)

At saved `b175699` / managed `a98f71e`, contradiction and consolidation folds
still sampled ambient time, collision analysis rebuilt its ID map for each focal,
and consolidation reread the memory corpus for nested collisions. Hono's detail
route independently read references/corpus and sampled analysis/projection time.
The next bounded phase constructs a request-local memory analysis view from one
explicit complete corpus and observation time, reuses its references/liveness,
and moves reusable detail reads into transport-free application orchestration.
Contradiction, collision, demand and projection policies keep their current wire
fields, thresholds, ordering, malformed-date/expiry behavior and usage precedence.

Touched analysis/projection functions require supplied time. CLI, MCP and HTTP
compatibility boundaries sample their clock once and pass it through; composition
forwards that time to the existing memory store projection. Narrow actual-consumer
read/search types replace the compatibility facade in touched flows. Structural
analysis for a live keyed detail requires complete reads; advisory collision
failure must still preserve authoritative detail for unkeyed/expired memories.
No bounded-list/search substitute may masquerade as a complete corpus. This view
is derived data for one selected home/read, not another store or an atomic native
filesystem snapshot. Wider clocks, routing and facade migration remain future work.


Stage 4 implementation: `core/memory-analysis-view.ts` constructs one detached
memory observation, with a private shared ID map, live-holder index and supplied
time. Ordinary records/arrays and membership are frozen; supported native dates
and binary typed arrays are copied without trying to freeze their mutable native
internals. This keeps unknown native fields lossless and avoids typed-array freeze
errors. It is not a promise that arbitrary native objects become deeply immutable.
Recognized analysis inputs and indexes remain stable within the view. The shared
`isMemoryLive` policy remains authoritative: malformed expiry stays visible/live
with diagnostics, while an exact valid expiry at observation time is expired.
Malformed creation retains age zero in the pure entry projection.

`core/memory-analysis.ts` reads the explicit complete corpus once. Contradiction
folds use the view's holder index; collision candidates resolve ranked hits through
its references, reuse it across focals, and keep existing eligibility, threshold,
ranking and tie breaks. Consolidation reuses the same view for nested collisions,
removing its second scan. Missing/raced ranked references are skipped; search
payloads do not replace observed authoritative memory payloads. Demand's existing
inclusive window and future-event behavior remain unchanged.

`core/entity-detail.ts` owns authoritative body/children/parent reads and optional
same-view memory analysis. `core/entity-references.ts` now owns pending/missing/
failed reference coalescing for both detail and history, normalizing synchronous
throws into the same cached rejected-promise contract; its map belongs to each
invocation/selected reader, with receiver binding preserved. Hono parses input
and attaches provenance to the existing detail response fields. A live keyed
memory requires complete structural reads and can fail visibly; unkeyed/expired
memory authority survives an unavailable advisory corpus/search, with collision
results omitted rather than falsely reported clean. A successful scan with a
raced missing focal still returns an empty candidate result. Children remain a
bounded presentation read and never substitute for the corpus.

Touched pure analysis, entry and usage folds require supplied time. CLI/MCP/HTTP
boundaries sample one clock for each analysis read and pass it through async
corpus/search work, usage windows and detail projection. Composition forwards the
supplied time into the existing usage-overlay store mint. Legacy one-argument
injected mint callbacks remain structurally compatible but cannot be forced to
honor a time they ignore. Wakeup also forwards its existing operation time through
that composed mint; this is no all-core clock migration. Touched list/search/get
and analysis/detail consumers now request their real read/search capabilities via
cohesive picks and the existing complete-corpus port, rather than write authority
from the compatibility facade. Readers and home resolution remain caller-owned.

Stage 4 focused evidence adds parser-realism cases for native binary/date fields;
frozen ordinary payloads and mutation-detached observations; inclusive demand,
malformed/exact-boundary validity and age-zero projection; one corpus across
consolidation/focal reads; missing/raced references; bound readers and failed
promise coalescing; required versus advisory failures; delayed corpus/search
across expiry/usage boundaries; cold MCP time sampling; and same-ID homes.
Architecture guards now reject ambient clocks in the touched analysis/detail,
reference/history and projection owners. Existing import exception lists stay
empty. Full workspace build/typecheck and test counts, plus manual verification,
are recorded after final acceptance below.

A built-module actual Node process used two disposable docs-native homes, actual
local storage and Orama BM25. Consolidation and detail each scanned once per home,
with unchanged bundle counts/conflict/collision fields and same-ID provenance
isolation. Native YAML binary/date payloads and raw Markdown survived. Shared home
validation rejected a malformed selection; injected unavailable corpus/search
readers preserved unkeyed authority but rejected required keyed analysis. Runtime
selection, the watcher and diagnostic logger were injected. No OS watcher, model
download, user-corpus mutation, global cache or atomic native filesystem snapshot
is claimed. Disposable fixtures were removed.

Previous write/recovery/lifecycle limits remain unchanged. Wider ambient clocks,
the remaining compatibility facade and larger Hono/Orama modules remain future
work. No dependency, version, publication or installed CLI change is needed.

The touched CLI/MCP `remember` drivers also sample one command time and supply a
constant callback through existing `RememberDeps.now`, reusing that value for
post-commit collision review. Remember passes its sampled value to the existing
journal/notification timestamp argument. Delayed-store unit cases for both
adapters verify one clock call, the entry/receipt timestamp, review eligibility
across expiry and one journal attempt. The broader memory-store correction clock
and legacy optional core remember clock remain their existing boundaries; this
phase does not claim every nested write effect samples the same clock.

Stage 4 final managed-checkout verification: workspace build/typecheck passed;
server 1,630 tests passed with two existing skips, memory 56 and viewer 163 passed
(1,849 total). This includes 25 additional failure/time/native-data/reuse cases.
The rebuilt actual-process disposable-home check passed again after the final
reference and remember changes. There are no new import exceptions.

## Stage 5 bounded plan — read adapters, query ownership and documentation

The next pass moves viewer entity/search/analysis route registration into one
HTTP read owner, retaining request-selected runtime resolution, error behavior,
provenance and route order. Orama query intent, retrieval/fusion and presentation
move into a query reader over the captured ready index view; lifecycle,
embeddings initialization, mutations and cache publication stay with the service.
The existing ID, memory-default, parsed-filter, recency and fusion contracts are
preserved. Query temporal decay samples time before asynchronous retrieval.

Recall stub ages accept supplied observation time from CLI/MCP/home-read
boundaries. Wakeup uses one supplied or compatibility-default time from entry,
including constraints and memory minting; Desk's HTTP caller supplies its runtime
clock. These are presentation/read-fold times, not a claim that nested memory
stores observe a transactional snapshot or share every clock. Wakeup, Desk and
cross-home reads request cohesive read capabilities rather than write authority.

README becomes 50–100 physical lines. Focused user guides own installation,
commands/entities, homes/configuration/migration and viewer use; contributor
owners retain development and architecture material. A bullet-based docs entry
map separates user guidance, contributor guidance and historical decisions.
Repository URLs keep the published npm README links usable. Maintained external
hook claims are checked against the official client documentation. ADR/task/
memory identities and historical content remain in place.

Acceptance: focused unit regressions for delayed observation and query behavior,
full build/typecheck/tests and empty architecture exception lists; actual built
module reads in disposable homes and npm README/link checks. Record actual versus
injected boundaries and clean fixtures. No dependency/version/publish change.

### Stage 5 code acceptance

`server/viewer-read-routes.ts` owns viewer entity discovery/detail, cross-home
search adaptation and read analysis. It consumes a read-only runtime type and
existing core owners; Hono assembly still owns authentication, home/process
controls, document proxies and static-route ordering. Task filter lookup now uses
a typed Map: ordinary unknown values remain unrestricted, and inherited object
keys cannot become status arrays. Desk binds selected readers and supplies one
runtime clock value before reads. Home provenance consumes only home/source-path
presentation capabilities.

`memory/src/search/orama-query-reader.ts` owns intent routing, SDK retrieval, fusion
and presentation over the captured ready generation. OramaSearchService retains
index lifecycle, embedding initialization/resources, incremental mutations and
cache publication. Existing overfetch-by-two, rank normalization, linear fusion,
decay, coordination bonus, exact title pin and final limit order remain intact.
Recent mode reorders the already limited set; filter-only mode skips retrieval;
caller type overrides stay fail-closed; exact-ID navigation and generic default
memory exclusion remain distinct. The query owner takes a supplied decay time
and has no ambient clock. Captured maps remain mutable under incremental writes;
this does not claim a transactional index snapshot or change generation rules.

Recall requires supplied stub-projection time and only the composer's recall
capability. CLI/MCP and each resolved home supply time before retrieval. Wakeup
uses one entry anchor for identity-delayed reads, constraint checks, expiry,
ages and minting. Wakeup, Desk, attribution and cross-home consumers now ask for
their actual cohesive read capabilities. Projected clocks retain the source
receiver. CLI uses its existing write-context clock; it acquires no new active
home state or alternate path resolver.

Remaining compatibility boundaries are explicit: direct wakeup and Desk calls
retain optional time defaults; nested recall stores retain their own retrieval,
expiry and usage timing; cross-home reads sample each selected runtime, not a
shared transactional instant. Outer application/CLI runtime assembly and MCP
list/get/search registrations still accept the full service facade. Other command
clocks and the memory-store correction clock remain future work. Existing write,
compensation, native-editor, runtime-admission and derived-state limits remain.

Eight additional unit cases cover delayed recall/wakeup/Desk/query time and
CLI/MCP registration forwarding; an existing projection case verifies clock
receiver binding. The full workspace suite passed: server 1,638 with two existing
skips, memory 56, viewer 163 (1,857 total). Workspace build/typecheck passed;
final server rebuild and focused 76-test read/ownership checks also passed after
last type/test refinements. All four import exception lists remain empty. One
older CLI attribution fixture needed its required write context restored.

Actual built Node processes used two disposable project homes, real local
storage and Orama BM25. Selected HTTP detail/Desk/search reads retained same-ID
home provenance, explicit memory navigation and default memory exclusion.
Malformed home/root input was rejected; unknown explicit search types returned
no rows. Recall/wakeup projections and Desk timestamps honored supplied time.
The prior native YAML/date/binary and required-versus-advisory analysis process
check also passed against the rebuilt route owner. Watchers, runtime selection
and diagnostic logging were injected; embeddings were disabled. These checks do
not claim OS watcher, model-download or global user-corpus coverage. Fixtures
were removed. No dependency, version, publication or installed-CLI change.
