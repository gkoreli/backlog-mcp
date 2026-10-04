# Repository architecture audit — 2026-10-03

Scope: server domain, storage, memory/search, shared contracts, CLI, MCP,
HTTP/composition, and viewer. Baseline: `1dbdcf5`. This is a sampled broad audit
and bounded cleanup
under [ADR 0134](../adr/0134-engineering-rules.md), not a claim that every module
is pure or that every runtime path has been exercised.

## Findings fixed in this change

- **High — consumer contracts owned by implementations.**
  `core/create`, `update`, `get`, `search`, `desk`, collision/contradiction
  analysis and other domain operations imported `storage/backlog-service.contract`.
  That contract imported `ResourceContent` from the filesystem/MCP manager and
  save/quarantine shapes from the storage adapter. `core/identity-resolution`
  likewise imported the git subprocess implementation for its runner type.
  Core now owns `backlog-service.contract`, `resource-content.contract`, and
  `git-runner.contract`, including the supporting domain shapes. All consumers
  point to those contracts. Storage's synchronous `ListFilter` is derived from
  the core filter with `query` omitted: storage filtering does not own search.
  This completes the relevant ADR 0134.1 Phase 2 moves and removes 19 known
  outward import violations without adding exceptions. The obsolete private
  storage service-contract source path is removed; no repository consumer or
  declared package export requires it. The resources barrel still exports
  `ResourceContent`, from its new owner.

- **Medium — duplicated retrieval and citation policy in peer adapters.**
  `cli/commands/get` and `tools/backlog-get` separately decided that successful
  memory reads increment usage, and that successful entity results with
  `context:true` count as context acts while resource reads/misses do not.
  `getItems` now invokes `get-usage.recordGetUsage` through the consumer-owned
  `RetrievalUsage` port; both adapters inject their selected runtime's tracker.
  Both remember adapters separately selected citations and excluded the minted
  memory ID. `remember` now owns that policy through `CitationUsage`, preserving
  its timing after storage, journaling and the advisory collision scan. Optional
  ports preserve existing callers that do not collect usage.

- **Medium — duplicated relation-group disclosure order.**
  Both get adapters enumerated children, siblings, references, reverse
  references, related entities, ancestors, descendants and declared typed
  relations. `get-context/listContextGroups` now supplies the common order and
  skips empty groups. Parent rendering, headings, indentation, error envelopes
  and resource formatting stay in the adapters. Stub compliance/depth text is
  still short presentation code; consolidating it would couple transport
  strings without fixing an observed divergence.

- **Medium — duplicate lexical path-containment predicate.**
  `resources/manager.isPathContained` duplicated `core/path-containment`.
  Resource reads now use the same pure predicate. Canonical realpath checks,
  URI decoding, allowed scan/orientation surfaces and fail-closed behavior
  remain owned by the resource boundary. Their policies are not interchangeable
  with the composition layer's documents-directory-only file reader.

## Remaining work, in priority order

1. **High — global capabilities bypass import enforcement.**
   `core/config.tryLoad` logs through `console.error`; `resolveContext` reads
   `process.env` and `process.cwd` when inputs are absent. Config also supplies
   real filesystem defaults. `core/memory-capture.captureCompletion` and
   `captureArtifact` use `Date.now` and `console.error` directly. The import
   scanner (`__tests__/helpers/import-graph.scanImports`) and layer rules only
   inspect import edges, so they cannot detect those accesses. A smaller import
   allowlist does **not** establish domain purity. Next slice: split pure
   configuration resolution from local default wiring, inject a diagnostic
   sink into capture, then enforce direct capability access using syntax-aware
   checks. Preserve config's invalid/unreadable diagnostics and post-write
   capture failure isolation; do not replace logging with silent swallowing.

2. **High — migration mixes planning with filesystem transaction work.**
   `core/migrate-docs-native` is approximately 1,600 lines: `planEntity`,
   config normalization and collision planning coexist with real filesystem
   defaults, source digests, `executePlan`, destination containment, exclusive
   writes, rollback and legacy cleanup. Separate a pure plan model/validator
   from a local snapshot reader and guarded executor. Preserve preflight,
   source-change detection, symlink rejection and rollback together; arbitrary
   size-based extraction could weaken these guarantees. This needs its own
   file-level plan and adversarial manual migration validation.

3. **High — a viewer status response can outlive its home selection.**
   `viewer/components/home-selector` starts asynchronous `/api/status` reads
   inside an effect and accepts every response into `provenance`. Switching
   A→B while A is slow can let A overwrite B's badge/root after B returns.
   `spotlight-search.doSearch` and `activity-panel.loadOperations` already use
   generation guards; `desk-page` keys its query by the request home ID.
   Follow-up: home-keyed query or generation guard, clear old provenance on
   selection changes, and test reversed response order and failure. This is
   identified from source; it has not been reproduced in a live browser here.

4. **Medium — discovery combines filesystem traversal and document semantics.**
   `core/document-discovery.discoverDocuments` merges real IO defaults with
   traversal, canonical containment, identity/frontmatter parsing, declaration
   classification, chronology and duplicate-path diagnostics. The dependency
   surface already exists in `document-discovery.types`. Move default wiring
   into local infrastructure, then isolate classification from the walker.
   Preserve lossless malformed documents and diagnostic source paths, rather
   than hiding failures during decomposition.

5. **Medium — HTTP app concentrates composition and read projections.**
   `server/hono-app.createApp` is approximately 1,000 lines. It mounts auth/MCP,
   builds request tool dependencies, serves viewer reads, enriches memory
   detail and operation rows, manages recent homes, SSE, local file routes and
   shutdown/restart. `/tasks/:id` composes parent/children, contradictions,
   advisory collisions and usage series; `/operations` enriches titles and
   parents. Move reusable read projections into core and local runtime mapping
   into composition, then separate route registration by capability. Keep
   authentication, origin checks, route order, HTTP errors and header/query
   precedence in HTTP. CLI process lifecycle and stateless HTTP request
   lifecycle should not be combined merely because their dependency maps look
   similar. Existing exported dependency shapes also retain broad `any` types.

6. **Medium — clock ownership and fallback construction remain inconsistent.**
   `core/wakeup` samples time for summaries and again for knowledge, and
   constructs a `BacklogMemoryStore` fallback even when an injected minter is
   available. `remember`, `recall`, create/update/edit, substrate intent execution
   and `operation-log.recordMutation` also sample global time. Other operations
   already accept `now` (desk, usage-series, consolidation and collision scans).
   Plan one operation clock and move concrete fallback composition outward.
   Preserve age/expiry semantics, timestamp ordering and ID allocation. Parsed
   dates such as `new Date(first)` in `usage-instrument` are deterministic
   conversions, not clock access; enforcement must distinguish them.

7. **Medium — search backend owns several independent mechanisms.**
   `memory/search/orama-search-service` is approximately 1,150 lines and owns
   disk persistence, embedding startup, document caches, BM25/vector execution,
   fusion/ranking, exact-ID/filter-only queries and mutations/reconciliation.
   Scoring, snippets, schema and query-intent already have separate modules.
   Extract cache persistence or backend execution behind existing search
   capabilities when touching them next; preserve ordering and initialization.
   `storage/local/backlog-service`'s ordered mutation chain and single-flight
   initialization are intentional correctness mechanisms, not redundant
  wrappers to remove.

## Shared package boundary and deliberate separation

- `shared/substrates/substrate-definition.schema` composes bounded declaration
  shapes for identity, intake, workflow, relations, intents and disclosure, then
  projects the same Zod schema into JSON Schema. It imports only Zod. The server
  compiler separately checks semantic consistency (`validateIntake`, schema
  compilation/write validation), and the executor applies mutations through
  injected ports. These are distinct layers of validation, not duplicated
  validators to collapse. The declaration's `permitted` field is explicitly
  reserved and unenforced; accepting it must not be described as authorization.
- Shared also contains builtin entity schemas, registry metadata, compiled
  disclosure/intent data shapes, ID and status vocabulary. Those types are used
  across server, memory and viewer; moving them into server would invert the
  package boundary. The sampled shared modules have no server/storage/adapter
  imports or ambient IO. Their size alone does not justify splitting them.
- Local and D1 storage differ deliberately: synchronous path-addressed open
  substrates versus a constrained closed async satellite. No consolidation or
  capability reduction is justified by superficial CRUD similarity.

## Validation and limits

- Workspace unit suites: server 1,506 passed / 2 pre-existing skips, memory 49
  passed, viewer 157 passed. After final contract/barrel cleanup and containment
  reuse, focused architecture, resource, get, remember and usage suites passed
  (88 tests). All automated filesystem writes use the existing memfs setup.
- Built CLI manual check in an isolated temporary Git repository: successful
  MEMO body expansion, resource/missing exclusion, a new memory's citation event
  against its predecessor, and invalid-write rejection with no additional
  feedback all passed. Fixture writes and derived usage/cache files stayed in
  the temporary repository.
- Server build/typecheck passed. Architecture rules now retain three core IO
  imports and one outward import (`wakeup` → concrete memory store). They still
  do not enforce direct global capability access or transitive package IO.
- This cleanup changes no schema, Markdown layout, ranking rule or transport
  formatting. No version bump or user-facing changelog entry is warranted for
  it. Existing Unreleased entries remain intact.
- Follow-ups above are prioritized evidence, not an approved blanket rewrite.
  Keep local functionality as the acceptance target; no D1 parity work is owed.
