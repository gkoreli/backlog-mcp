# Domain and flow assessment — 2026-10-03

- **Baseline:** `7bbcb074ae935168bc15847234a126cd42d27e44`, after the
  contract/retrieval cleanup and PathResolver correction. This extends
  [report 0018](0018-repository-architecture-audit-2026-10-03.md); that report
  remains the historical record of those changes and its seven follow-ups.
- **Purpose:** identify ownership and reuse opportunities by tracing actual
  flows, rather than equating fewer imports, smaller files, or more classes
  with a stronger domain model. This change is an assessment, not implementation
  approval for every proposal below.
- **Constraints:** human-visible Markdown is authoritative; custom compiled
  substrates remain open; no LLM enters managed writes; viewer reads remain
  read-only; no local capability is reduced for the descoped D1 satellite.
- **Authority:** [ADR 0134](../adr/0134-engineering-rules.md),
  [ADR 0106.5](../adr/0106.5-intent-write-surface.md),
  [ADR 0113](../adr/0113-user-defined-substrates.md),
  [ADR 0117](../adr/0117-the-write-boundary.md), and
  [ADR 0133](../adr/0133-atomic-document-creation.md).
  ADR 0117's exact best-effort logging contract refines the earlier journal
  language; ADR 0106.5 R12 explicitly accepts compensated multi-document writes.

## Traced flows and the invariants they cross

- **Creation:** CLI normalized fields or compiled intent defaults →
  `core/create.createEntity` → `persistNewEntity` → local service `create` →
  storage allocation and canonical write under the home lock → derived index →
  eligible memory capture → one semantic journal attempt/event → adapter
  provenance. Atomic ID allocation already has the narrow `EntityCreationPort`.
  Persistence and derived-effect acknowledgement are currently coupled.
- **Update:** CLI patch or compiled transition/set-field → entity read →
  postimage construction → `updateEntityPostimage`/`stampUpdatePostimage` →
  separately locked storage save → index → completion capture → journal/event.
  The read and save do not share a revision check. Generic update's historical
  null-means-delete differs intentionally from a compiled literal-null assignment.
- **Body edit:** `core/edit.editItem` → read → `applyOperation` → independent
  timestamp assembly → save/index → journal/event inside one catch. This path
  bypasses the shared postimage policy, and its result cannot distinguish a
  failed text application from a failure after persistence.
- **Memory correction:** `remember`/composer → `BacklogMemoryStore.store` →
  expire explicit predecessor and matching state-key holders → create successor.
  The invariant is one live holder per key plus durable correction lineage,
  spanning multiple documents. The holder scan is a bounded list, and predecessor
  closure happens before successor creation.
- **Read/discovery:** get/list/wakeup and analysis → service storage/search reads
  → context/disclosure projections → usage/provenance → CLI/MCP/HTTP formatting.
  Corpus analysis often uses the same default-20 list as human display. Search
  carries full cached entities beside bounded searchable-field projections.
- **Native edit and viewer search:** watcher → full service reconciliation →
  Orama entity/resource caches → HTTP unified results/snippets → Spotlight.
  Reconciliation and Spotlight each lose information at different projections.
- **Runtime selection:** CLI invocation or HTTP request selection → canonical
  home → local service graph → `createLocalAppRequestRuntime` → actor/context and
  tool/write dependency mapping. A CLI invocation owns shutdown; the server owns
  cached runtimes by root. Those lifetimes and environment policies are distinct.

## Findings, ordered by consequence

### F1 — High: bounded display listing is used as a complete repository read

- **Evidence:** [storage list](../../packages/server/src/storage/local/docs-native-filesystem-storage.ts)
  defaults `limit = 20`; [BacklogService.list](../../packages/server/src/storage/local/backlog-service.ts)
  passes it through. [BacklogMemoryStore](../../packages/server/src/memory/backlog-memory-store.ts)
  uses `list({type: Memory})` for state-key closure, `forget`, and `size`.
  [contradictions](../../packages/server/src/core/contradictions.ts),
  [collision candidates](../../packages/server/src/core/collision-candidates.ts),
  [consolidation](../../packages/server/src/core/consolidation.ts), and
  [agent attribution](../../packages/server/src/core/agent-attribution.ts)
  also ask whole-corpus questions through an unbounded-looking bounded call.
- **Mechanism/impact:** filtering a recent page afterward cannot find an older
  explicitly named forget target, predecessor, conflicting belief, or author.
  `size` can report at most 20 live memories. `wakeup.descendantSet` also caps each
  parent's children, which can change context membership, not just display size.
  `get-context` mixes capped reads with a `100_000` sentinel. The parent audit
  reproduced the storage case using 25 canonical memory documents in a disposable
  directory: counts reported 25, `size` reported 20, and forgetting the oldest ID
  returned zero while it remained live. Actual filesystem storage/service were
  used; unused search/resource dependencies were mocked. This was not a CLI test.
- **Owner/reuse:** give exhaustive consumers a narrow corpus-read capability,
  backed by existing storage `iterateEntities`/`iterateDocuments`. Keep bounded
  query/display semantics explicit. An async scan or collected snapshot can be
  chosen without exposing synchronous filesystem details to domain consumers.
  Do not scatter huge numeric limits or change the public list default.
- **Scope/dependencies:** local service contract, memory adapter, analysis,
  context traversal and attribution callers. Audit intentional wakeup display
  caps separately; recall's search over-fetch is a ranking tradeoff, not a
  substitute for a complete scan.
- **Acceptance:** memfs fixtures exceeding 20 memories and 20 siblings; older
  state-key holder closed; older explicit ID forgotten; full live count;
  contradiction/consolidation candidates beyond the first page; complete subtree.
  Fix mock fidelity: `memory-store-contract.test`'s fake list returns every row
  regardless of limit, concealing the production default.

### F2 — High: the write lock does not protect read-modify-write intent

- **Evidence:** [updateEntity](../../packages/server/src/core/update.ts) reads and
  assembles a full postimage before `service.save`. Storage `mutate` refreshes
  its snapshot under the home lock, but `saveCurrent` uses that snapshot for
  path/adoption lookup and writes the passed entity without a preimage check.
  Body edit and compiled single-entity intents have the same shape.
- **Mechanism/impact:** two callers can read one version and save different
  full postimages; the later save restores fields from its stale read. Ordered
  search mutation serialization does not protect the domain read. The parent
  audit independently reproduced title/content lost update against actual
  compiled core functions with a controlled in-memory repository and a read
  barrier. That proves the core scheduling case, not a full CLI/process race.
- **Owner/reuse:** a consumer-owned conflict-aware mutation capability can carry
  an expected revision/preimage and an intended postimage, or apply a validated
  mutation against a fresh read within a home-local critical section. Reuse the
  existing creation lock/port pattern, registry validator and timestamp policy.
  Keep operation construction in core and lock/bytes/revision mechanics in local
  infrastructure. A universal entity class is unnecessary.
- **Scope/dependencies:** explicit design ruling first: conflict detection versus
  retry/rebase, and whether no-op writes advance timestamps. Native file edits
  do not cooperate with the managed lock; a lock alone cannot promise protection
  from every editor. Existing Markdown digests are potential revision material,
  not a second authoritative database.
- **Acceptance:** deterministic interleaved independent-field updates, same-field
  conflict, stale text edit, external preimage change, no journal/capture on a
  rejected conflict, isolation across homes, and preservation of atomic creation.

### F3 — High: a committed document can be reported as a failed mutation

- **Evidence:** local service add/create/save/delete persist first and then await
  index add/update/remove. An index rejection therefore rejects the caller after
  Markdown changed. Core create/update wait for that service return before their
  journal attempt and capture. `editItem` catches both apply/save failures and
  `recordMutation` failures as `{success:false}`.
- **Mechanism/impact:** retrying a failed create can create another document;
  retrying edits can apply a text operation twice. A successful durable write may
  lack its normal semantic acknowledgement and journal attempt. Existing intent
  compensation tests model save-persisted-then-rejected, but do not establish a
  complete local index-failure process reproduction.
- **Journal distinction:** [OperationStorage.append](../../packages/server/src/operations/storage.ts)
  swallows local filesystem errors, as ADR 0117 permits. Standard journal IO loss
  is best-effort loss, not an exception thrown into `editItem`. A parent-controlled
  core reproduction with an injected throwing log did persist the new body and
  return failure; event subscribers can also throw through the synchronous local
  bus. Do not conflate these cases or demand crash-atomic journaling.
- **Owner/reuse:** define committed-write versus derived-effect outcomes at the
  managed mutation boundary. Options include an acknowledged commit with explicit
  repairable index status, or a typed committed-but-degraded outcome. Reuse the
  ordered index chain, watcher/full reconciliation, and one semantic journal
  owner. Do not add a generic logging decorator that loses semantic attribution.
- **Scope/dependencies:** decision affects service results, core error handling,
  adapter receipts/provenance, index dirty/retry handling, and sink contracts.
  Failed effects must not be silently swallowed under an undocumented policy.
  Correct `operation-log.ts`'s stronger “single operation”/“pure function” header
  to describe an injected best-effort effect, not an atomic guarantee.
- **Acceptance:** injected index failure after add/save/delete; exactly one durable
  mutation and honest receipt; repair restores searchable truth; one journal
  attempt under the chosen policy; throwing sink/subscriber semantics; retries
  cannot silently duplicate creation. Preserve ADR 0117 exact actor/input capture.

### F4 — High: memory correction owns a multi-document invariant informally

- **Evidence:** `BacklogMemoryStore.store` calls `expireMemory(supersedes)` and
  closes matching state-key holders before `persistNewEntity`. Each save/create
  has its own local lock. F1 limits holder discovery even without concurrency.
- **Mechanism/impact:** successor failure can leave the prior fact expired with
  no replacement; concurrent stores can both discover the same holders and leave
  two live successors. These failure/interleaving risks are inferred from source,
  not reproduced as a full local correction flow here.
- **Owner/reuse:** put deterministic correction planning beside the memory
  concept: successor, predecessor IDs/preimages, closure time, and lineage.
  Execute through a narrow home-local repository capability. Reuse
  `persistNewEntity`, full corpus reads, validity policy and conflict-aware writes.
  Keep historical documents and ADD-only correction lineage. Do not make the
  whole home an enormous object aggregate or add LLM conflict resolution.
- **Scope/dependencies:** F1 first; F2/F3 decisions before changing consistency.
  Creating the successor first merely swaps “missing current fact” for “two live
  facts”; reordering alone does not solve the operation. Explicit compensation
  with detectable partial failure or a guarded local plan needs an ADR ruling.
- **Acceptance:** replacement validation/persistence failure, predecessor closure
  failure, simultaneous same-key replacements, repeated explicit supersedes,
  older holder beyond 20, exact expiry boundary, and lineage retained on disk.

### F5 — High: reconciliation detects search-text changes, not all read-model changes

- **Evidence:** [OramaSearchService.reconcile](../../packages/memory/src/search/orama-search-service.ts)
  updates a cached entity only when `updated_at` or projected fields change.
  `taskToDoc` also indexes status/type/parent, and unified/exact-ID results return
  the full cached entity. [createSearchEntityDocument](../../packages/server/src/core/substrates/create-search-entity-document.ts)
  need not project every returned/filterable field; builtins omit `parent_id`
  and status from searchable text fields. Native edits need not advance a timestamp.
- **Mechanism/impact:** a native parent/status edit with unchanged timestamp and
  searchable text can leave filters stale; an unprojected custom field edit can
  leave search result payloads stale even though storage get sees the new value.
  This is a source-derived counterexample, not an executed browser reproduction.
- **Owner/reuse:** distinguish index identity/filter/text fingerprint from cached
  payload freshness. Refresh payloads on an authoritative snapshot change; only
  recompute text/embeddings when their inputs change. Reuse the named field
  projection and reconciliation queue. Alternatively hydrate result IDs through
  an injected current read port, after assessing ranking/filter consistency cost.
- **Scope/dependencies:** search package cache reconciliation and persistence;
  local service must supply enough snapshot data. No registry implementation
  dependency belongs in memory. This is more urgent than splitting the large
  Orama class solely by line count.
- **Acceptance:** native status/parent edits without timestamp changes, custom
  field absent from search projection, exact-ID and fulltext payload agreement,
  cache reload, removal, and no unnecessary embedding work on metadata-only edits.

### F6 — Medium: body edits and write errors bypass existing policy modules

- **Evidence:** `editItem` always adds `updated_at`; `stampUpdatePostimage`
  preserves absent or author-owned custom timestamps and pins identity. A strict
  custom schema can reject the added field, or an accepted timestamp can be
  overwritten. `create.ts`/`update.ts` duplicate `normalizeWriteError`;
  `persist-new-entity.ts` matches “No storage claim…” error text in two places.
- **Owner/reuse:** share postimage stamping and named write-error conversion;
  make missing storage claim a typed domain error. A narrow validated-save
  primitive should permit the correct semantic journal owner. Preserve edit's
  text-operation input/result and resource-edit attribution; calling the public
  update function blindly would change receipt/log parameters and capture policy.
- **Scope/dependencies:** timestamp/error cleanup is bounded; catch/outcome
  restructuring depends on F3. Preserve compiled literal-null semantics and
  generic null-means-delete. Raw resource editing remains a separate authorized
  Markdown write lane under ADR 0117, not a reason to canonicalize native files.
- **Acceptance:** strict custom body edits without timestamps, retained custom
  timestamps, builtin advancement, failed apply without write/log, typed unknown
  substrate errors, canonical-adoption guard, and one semantic journal entry.

### F7 — Medium: temporal validity has multiple implementations and different answers

- **Evidence:** contradiction/collision `isLive` treats an invalid expiry as live;
  store recall and consolidation also retain it (`NaN <= now` is false), but
  `BacklogMemoryStore.size` excludes it (`NaN > now` is false). MemorySchema
  accepts `valid_until` as nullable optional string. Store-to-entry minting can
  produce `expiresAt: NaN`; creation-date fallback samples a new clock.
- **Owner/reuse:** a pure memory validity projection should distinguish missing,
  valid and malformed time, using one operation time. The existing collision and
  contradiction folds are good consumers; their local duplicate predicates are
  not an established shared authority. Put serializable policy in shared or the
  memory public API according to actual consumers, never import server into memory.
- **Scope/dependencies:** extracting identical valid-date behavior is safe; choosing
  malformed-date visibility/quarantine is an explicit policy decision. Preserve
  lossless native documents and diagnostics rather than silently rewriting dates.
- **Acceptance:** missing/null, invalid string, before/at/after expiry, consistent
  size/recall/analysis, and stable minting within one operation. Join the clock
  injection work already identified in report 0018 instead of inventing another clock.

### F8 — Medium: the broad service port hides required local capabilities

- **Evidence:** [IBacklogService](../../packages/server/src/core/backlog-service.contract.ts)
  combines reads/writes, allocation, search, counts, sync traversal, resources,
  quarantine and disclosure behind many optional members. Moving ownership into
  core fixed import direction but did not make the contract cohesive.
  BacklogService dependencies name concrete OramaSearchService/ResourceManager;
  memory's existing `SearchService` covers only a subset of local reconciliation.
- **Owner/reuse:** narrow actual consumers first: corpus read for F1, conflict-aware
  mutation for F2, document lookup, and search reconciliation/query capabilities.
  Start with `Pick`/named consumer contracts and compose them into the existing
  façade. `EntityCreationPort`, intent registry/validator ports, RetrievalUsage,
  CitationUsage and `resolveDocumentUri`'s small port are existing precedents.
- **Scope/dependencies:** local required capabilities should be checked in
  composition rather than silently returning empty context when missing. Explicit
  constrained/read-only graphs may still omit capabilities. No one-interface-per-
  method exercise or speculative replacement search engine is justified.
- **Acceptance:** consumers tested with minimal typed fakes; writable local
  composition fails visibly on missing required capabilities; readonly mode is
  explicit; architecture allowlist shrinks; open substrates and existing façade
  compatibility survive incremental migration.

### F9 — Medium: Spotlight rebuilds a closed projection the server already supplies

- **Evidence:** [SpotlightSearch](../../packages/viewer/components/spotlight-search.ts)
  locally defines a task/epic/resource union and generates snippets from fixed
  title/content/evidence/references fields, discarding HTTP `snippet`. The server's
  registry-projected search/snippet path already supports arbitrary substrate
  fields and string type keys. Memory tags/entity refs are also absent from the
  viewer's reference reconstruction.
- **Mechanism/impact:** a valid custom-field match can render a title fallback
  without explaining the match. Closed casts hide the actual open API contract.
- **Owner/reuse:** consume the existing plain-text `SearchSnippet` wire shape and
  open substrate type; keep HTML escaping/highlighting and rendering in viewer.
  Use a small HTTP client projection beside existing viewer API types rather
  than importing the memory implementation. Server matching remains authoritative.
- **Scope/dependencies:** independent bounded viewer slice; custom type filters
  and richer badges are separate product scope. Preserve provenance in cross-home
  results, request-generation guards and the read-only UI.
- **Acceptance:** custom field and memory reference matches, safe plain-text
  highlighting, missing-snippet compatibility if retained, cross-home navigation,
  reversed responses and home selection changes. Apply the existing reactive
  viewer skill; do not replace lifecycle/query mechanisms with another framework.

### F10 — Medium: runtime mappings repeat capabilities and optionality

- **Evidence:** [local app runtime](../../packages/server/src/composition/local-app-request-runtime.ts)
  already adapts the graph, but Hono `createRequestToolDeps`, MCP
  [buildWriteContext](../../packages/server/src/tools/build-write-context.ts) and
  [CLI runner](../../packages/server/src/cli/runner.ts) rebuild overlapping bundles.
  [AppRequestRuntime](../../packages/server/src/composition/app-request-runtime.types.ts)
  has many optional concrete infrastructure members. MCP checks actor/log;
  intent registration independently checks registry/validator/quarantine reporting.
- **Owner/reuse:** construct a transport-free managed-write capability bundle in
  composition after actor and context have been selected, using narrow contracts.
  Keep explicit-agent overlay, header/query precedence and CLI environment rules
  in their adapters. Reuse existing provenance and get-usage/citation modules;
  do not duplicate their behavior in a new context helper.
- **Scope/dependencies:** after F8 clarifies required capability groups. This is
  internal cleanup, not permission to unify process lifetime, CLI local-file
  access and HTTP request containment. A typed writable/readonly composition
  distinction is more useful than adding optional flags to every function.
- **Acceptance:** same selected home, actor, context, provenance and capture
  capability across CLI/MCP; explicit actor override; no bootstrap actor leaking
  into another home; no new adapter-to-adapter imports.

### F11 — Medium: runtime cache shutdown has an unstated admission boundary

- **Evidence:** [LocalRuntimeRegistry](../../packages/server/src/storage/local/local-runtime-registry.ts)
  caches promises by canonical root, but `close` deletes before awaiting stop;
  `closeAll` clears before draining. A concurrent get can start a replacement
  while the old graph still reconciles/flushes the same cache. Root equality also
  reuses a graph even if a later descriptor has different document/control paths.
- **Owner/reuse:** state the registry lifecycle contract: reject/wait during
  draining, or explicitly support per-root replacement with coordinated retirement.
  Validate descriptor compatibility or define configuration-refresh semantics.
  Reuse existing single-flight creation and deterministic close ordering.
- **Scope/dependencies:** lower priority until an actual reload/close caller needs
  overlapping admission; normal final process shutdown may have no new requests.
  Startup leak suspicion was rejected: `LocalRuntime.startOnce` unsubscribes on
  reconciliation failure. Do not add redundant teardown on that assumption.
- **Acceptance:** get during close, in-flight creation shutdown, repeated close,
  stop failure, closeAll admission, same root/different descriptor and independent
  roots. Existing tests cover basic single-flight/retry/close, not these interleavings.

## Boundary decisions that should stay separate

- **Identity, address and filesystem path:** `document-identity` extracts observed
  native-document identity; `substrates/storage-identity` maps active claims to
  canonical keys; `document-address` classifies retrieval spellings and follows
  storage lookup; PathResolver supplies filesystem/package mechanics. These are
  different domain questions. Reuse their existing constructors/resolvers and
  remove caller synthesis when encountered; do not merge them into a global
  “identity service” or introduce strict ID parsing that closes custom substrates.
- **Workflow status versus memory validity:** shared `statusToken` and
  `matchesDeclaredStatus` already centralize declared-status comparison. Registry
  workflow transitions carry substrate meaning. Memory expiry is a different
  invariant (F7). Mapping all types onto TaskStatus would violate ADR 0113.
- **Entity versus generic resource:** service reconciliation excludes typed source
  paths from generic indexing, using ResourceManager's root-relative scan prefix.
  Preserve that one-document/one-hit rule, quarantined documents' resource
  visibility and orientation files. Snapshot/index projection modules can move
  beside the local service; they must not invent another authoritative store.
- **Compiled intent versus CRUD:** compiler declaration validation, executor
  precondition/postimage validation and storage canonical-write validation check
  different boundaries. Shared DTO/schema ownership and server execution should
  remain separate. Multi-entity executor is deliberately the one journal owner;
  calling public update twice would create false semantic success entries.
- **Compensation:** `executeRelateAndTransition` can restore captured originals
  after partially persisted writes. Without expected revisions that restoration
  can overwrite a concurrent edit. This is a source-inferred extension of F2;
  preserve current explicit compensated/partial-failure outcomes until evidence
  supports amending ADR 0106.5 R12. Do not silently add a general transaction API.
- **Placement:** pure memory correction/validity beside core memory concepts;
  bytes/lock execution under local storage; capability graph construction in
  composition; read projections beside their concepts; wire-only shapes in
  shared/public package APIs. Prior migration/discovery IO moves remain needed,
  but are not prerequisites for every bounded correction above.

## Ordered next slices

- **Slice A — complete corpus reads and list eligibility (first, bounded).**
  Implement F1's explicit full-read capability and migrate invariant/analysis
  callers. Also fix `core/listItems` excluding memories *after* service limiting:
  20 newer memories can currently starve older visible work. Eligibility belongs
  before pagination in a named read policy, not a fixed list of builtin types.
  Preserve public default limits and intentionally bounded displays. Requires
  realistic memfs/port fixtures; no new transaction design needed.
- **Slice B — fresh search payloads and shared viewer snippets (independent).**
  Address F5 and F9 before broad Orama/Hono decomposition. Separate payload,
  filter and text freshness; consume the existing wire snippet. These are
  observable fixes with focused tests and changelog entries when implemented.
- **Slice C — managed mutation contract (design, then phases).**
  Write an ADR ruling for F2/F3: revision conflicts, commit acknowledgement,
  derived-index repair and effect failure semantics. Then add the narrow local
  capability; migrate single-entity operations; unify body stamping/errors (F6);
  validate real competing processes and native edits with temporary fixtures.
  No generic retry or framework before those choices are explicit.
- **Slice D — correction plans and compensation (depends on A/C).**
  Implement F4 with explicit failure recovery and conflict checks. Apply the same
  revision principle to multi-intent compensation only under an amended ruling.
  Consolidate validity/time (F7) after choosing malformed-date behavior. Preserve
  predecessor documents, semantic journal ownership and partial-failure honesty.
- **Slice E — composition and opportunistic module moves (after contracts).**
  Narrow F8 ports, derive F10 context bundles and decide F11 lifecycle admission.
  Extract local snapshot/index projections, Hono read projection/route modules,
  migration planner/executor and discovery classification as separate commits.
  Reuse existing home/provenance/address/status modules. Do not couple this work
  to a sweeping rename of `types.ts`, utils relocation or an entity hierarchy.

## Verification and limits

- Evidence is source tracing against the baseline, selected existing tests and
  ADRs. Two parent audit reproductions used compiled core functions and controlled
  in-memory ports: independent-field lost update, and persisted body edit with a
  throwing injected journal. These are not real-filesystem unit tests and not
  proof of a complete multi-process local race. A third parent reproduction used
  actual filesystem storage in a temporary fixture to demonstrate the 25/20 memory
  count and older-ID forget failures; it did not exercise search or the CLI.
- The other failure/concurrency counterexamples are explicitly source-derived.
  No browser, live user corpus, index-failure process or simultaneous correction
  experiment was run for this document. Proposed acceptance checks are future
  work, not passing tests claimed by this report.
- This assessment changes documentation only. `pnpm build`, `pnpm typecheck`, and
  workspace unit tests passed with Node 24.14.1: server 1,513 passed / 2 existing
  skips, memory 49 passed, viewer 157 passed (1,719 passed total). Markdown links
  were resolved to existing files and `git diff --check` passed. No new unit tests
  were added, and these passing suites do not invalidate the counterexamples.
  No production code, version,
  changelog, installed package, publication or push is part of this change.

## Implementation after maintainer authorization

The assessment above is the historical baseline. The maintainer subsequently
requested engineering; [ADR 0135](../adr/0135-complete-reads-and-managed-mutation-consistency.md)
records the accepted decisions, staged changes and verification limits.

- **F1:** complete async/sync corpus capabilities replace bounded invariant reads;
  eligibility precedes display pagination. Local fixtures cover older holders and
  siblings beyond 20; public display defaults remain bounded.
- **F2/F3/F6:** exact-Markdown preimages guard managed read-modify-write under the
  home lock. Core updates/body edits/intents, forgetting/GC and legacy usage writes
  carry the guard; conflicts do not journal a rejected attempt. Commit receipts
  acknowledge authoritative changes independently of projection/index/log/event
  failure, and search repairs on its next query. Stamping and typed write errors
  have named owners. Atomic file publication preserves bytes and permission bits.
- **F4/F7:** a pure correction plan validates the complete locked holder set and
  successor before execution. Guarded compensation preserves exact original bytes;
  unrecoverable native changes return explicit partial-failure IDs. Memory validity
  and entry minting share a lossless malformed-date policy and operation time.
  Committed diagnostics pass through store/composer/remember. Intent compensation
  likewise preserves intervening edits and reports partial failure.
- **F5/F9:** reconciliation refreshes filter fields and full cached payloads without
  requiring timestamp or searchable-text changes; embeddings are reused when text
  is unchanged. Spotlight renders server snippets with escaped highlights and open
  substrate keys. HomeSelector ignores stale responses and disposed refreshes.
- **F8/F10/F11:** real mutation and memory consumers have narrow ports; the local
  service depends on search/catalog capabilities and separate snapshot projection.
  Writable local composition requires complete reads and managed mutation/correction
  capabilities. CLI/MCP share context construction, preserving adapter actor/context
  policy. Runtime replacement waits for successful retirement; stop failures can be
  retried, and incompatible paths/family descriptors are rejected.
- **Remaining core I/O:** config/discovery defaults moved to local wrappers.
  Migration has a read-only domain planner, shared normalization/digests and a local
  executor preserving quarantine, preflight, exclusive publication and rollback.
  The explicit execution boundary rejects stale bytes, target occupation and
  symlink/root replacements. PathResolver owns ancestor canonicalization; injected
  capabilities preserve controllable reads. The architecture allowlist is empty.

Workspace build/typecheck and unit tests passed: server 1,562 / 2 existing skips,
memory 49, viewer 163, totaling 1,774 passing tests. Actual disposable-process checks
covered corpus counts, conflicting writes, simultaneous corrections, permissions,
shutdown admission and migration/discovery containment. ADR 0135 identifies which
callbacks were mocked; these are not claims of complete CLI/browser/OS-watcher
coverage or universal native-editor transactions.

The broad compatibility facade and large Hono/Orama modules remain. Further route
or engine decomposition is optional structural work, with no remaining correctness
fix from these findings substituted by a type-only move. Multi-document recovery is
compensating, journals remain best-effort, and graph admission is not an all-request
lease. No version bump, installed-package replacement, push or publication occurred.
