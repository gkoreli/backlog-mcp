---
title: "Architecture Audit — July 2026"
date: 2026-07-16
status: Proposed
---

# Architecture Audit — July 2026

## Executive summary

backlog-mcp's strongest architectural ideas are real and visible in the code:
substrates are a shared validation authority, core use cases are reused by MCP
and CLI, memory is durable and progressively disclosed, search has unusually
deep correctness tests, and the viewer is a capable local-first observation
surface.

The largest risks are not missing features. They are **correctness and
capability drift inside the local-first product**:

1. Search mutations and first-use initialization are not serialized.
2. Viewer failures and stale responses can look like valid empty/current data.
3. Resource search has no reconciliation path.
4. The first search can pay model download plus serial full-corpus embedding.
5. HTTP routes have accumulated business logic outside `core`.
6. CLI capabilities materially trail MCP and core.
7. The published Node compatibility promise is false.
8. The ADR index, README, and package metadata describe an older product.

The recommended order is: make local search and viewer state truthful first;
make search startup observable and fast second; converge transport adapters
third; then pay down usability, relevance, and distribution debt with
measurable budgets.

## Scope and method

This was a read-only audit of the current main tree after ADR 0114 landed
(`4fd792c`, `8f4f992`, `0385cb1`). It covered:

- ADR-to-code drift and decision-record governance;
- dead or vestigial code;
- ADR 0090 core-first layering;
- local storage and the retained-but-descoped D1 boundary;
- search quality, indexing, embeddings, persistence, and performance;
- viewer UX, accessibility, and reactive loading;
- CLI ergonomics and MCP parity;
- unit-test coverage;
- build and distribution footprint.

Three independent read-only audit streams covered architecture/ADRs,
search/performance/distribution, and viewer/CLI/tests. Every accepted finding
below was rechecked against the current files.

Current scale:

- 140 Markdown files in `docs/adr/` including its README; 139 ADR/audit records.
- 38 ADR files have normalized frontmatter (`title`, `date`, `status`).
- 116 non-test server TypeScript files and 49 server unit-test files.
- 39 non-test viewer TypeScript files and 5 viewer unit-test files.
- Current local artifacts: `packages/server/dist` 8.1 MiB and
  `packages/viewer/dist` 6.6 MiB. These may be stale and are diagnostic, not
  release-size claims.

### Deployment posture used for prioritization

Local filesystem deployment is the product north star. D1/Workers is retained
code but receives zero parity or feature investment; if remote hosting returns,
the intended shape is a VPS running the local filesystem product. This audit
therefore records D1 hazards as non-actionable boundary observations and
excludes them from the prioritized uplift backlog. The only justified D1 work
would be containment that prevents users from mistaking it for a supported,
equivalent deployment.

## Severity model

- **High** — data loss, false public contract, correctness race, or a primary
  workflow that can silently show the wrong result.
- **Medium** — architectural drift, material performance/ergonomic debt, or a
  weak seam likely to produce future divergence.
- **Low** — localized cleanup with limited current user impact.
- **Descoped** — a real defect in retained D1/Workers code, documented for
  truthfulness but assigned no engineering priority under the current posture.

## Findings

### 1. D1 silently discards cron fields, but D1 is descoped

**Severity: Descoped · Retained-code hazard · Effort: none planned**

The cron substrate requires `schedule`, `command`, and `enabled`, and supports
`last_run`/`next_run`
(`packages/shared/src/substrates/cron.ts:18-28`). The D1 row and initial schema
have none of those fields
(`packages/server/src/storage/d1/d1-storage.ts:29-45`;
`packages/server/migrations/0001_initial.sql:9-25`). D1 insert/update statements
persist only the older common fields
(`packages/server/src/storage/d1/d1-storage.ts:171-233`).

Remote creation or update can therefore report success and reread an incomplete
cron entity. There are no D1 storage/service unit tests.

**Recommendation:** do not invest in parity. If D1 remains user-reachable, add
the smallest explicit unsupported-mode guard or warning needed to prevent it
from being mistaken for the supported local product.

### 2. D1 implements a narrower search contract, but D1 is descoped

**Severity: Descoped · Retained-code hazard · Effort: none planned**

`IBacklogService.searchUnified` promises type, status, parent, sort, and limit
options (`packages/server/src/storage/backlog-service.contract.ts:32-38`).
Local search honors them
(`packages/server/src/storage/local/backlog-service.ts:102-128`). D1 accepts
only limit/status, does not apply status, and reports every non-epic substrate
as a task
(`packages/server/src/storage/d1/d1-backlog-service.ts:71-81`).

**Recommendation:** do not build D1 search parity. Keep the local contract
authoritative and, if the remote mode remains invocable, label it explicitly as
unsupported/constrained rather than widening its implementation.

### 3. Search writes and first initialization can race

**Severity: High · Correctness · Effort: M**

Local `add`, `save`, and `delete` invoke asynchronous index mutations without
awaiting them
(`packages/server/src/storage/local/backlog-service.ts:151-176`). Those
mutations perform asynchronous embedding and Orama work
(`packages/memory/src/search/orama-search-service.ts:715-771`). Search readiness
uses a boolean rather than a shared initialization promise
(`packages/server/src/storage/local/backlog-service.ts:40-59`), so concurrent
first searches can initialize and reconcile the same mutable index.

**Recommendation:** add a single-flight initialization promise and serialize
ordered search mutations. A successful write should not return before its
promised index update is accepted by that queue.

### 4. Resource search has no reconciliation path

**Severity: High · Search correctness/performance · Effort: M**

Startup reconciles entities, then blindly re-indexes every discovered resource
(`packages/server/src/storage/local/backlog-service.ts:42-58`). Resource
discovery recursively rereads Markdown files
(`packages/server/src/resources/manager.ts:36-69`), while
`indexResources` handles cached entries as duplicate insert/update work
(`packages/memory/src/search/orama-search-service.ts:780-818`). Deleted
resources are never reconciled out.

**Recommendation:** add fingerprint-based `reconcileResources()` with
add/update/remove sets and live resource mutation hooks. Warm startup should
embed only changed resources.

### 5. First search is a potentially minute-long bootstrap operation

**Severity: High · Performance/UX · Effort: L**

The embedding model initializes lazily and may download on first use
(`packages/memory/src/search/embedding-service.ts:14-28`). A fresh index embeds
tasks sequentially
(`packages/memory/src/search/orama-search-service.ts:221-247`) and then
resources sequentially (`:787-799`). The first call to `searchUnified` awaits
the entire path
(`packages/server/src/storage/local/backlog-service.ts:40-59`, `:111-113`).
The hybrid test permits a 60-second first-run timeout
(`packages/server/src/__tests__/search-hybrid.test.ts:57-61`).

**Recommendation:** serve BM25 immediately, enrich vectors in bounded
background batches, expose readiness/progress in status and viewer UI, and
make offline/degraded mode explicit.

### 6. The published Node compatibility promise is false

**Severity: High · Distribution · Effort: S**

The server advertises Node `>=18`
(`packages/server/package.json:47-48`) and builds for Node 18
(`packages/server/tsdown.config.ts:6-8`). Installed Commander 14 and Orama 3
manifests require Node 20+.

**Recommendation:** raise the package engine/build target to the actual minimum
and enforce it in CI, or deliberately downgrade dependencies and test Node 18.

### 7. HTTP has become a second business-logic layer

**Severity: High · ADR 0090 drift · Effort: L**

ADR 0090 requires HTTP, MCP, and CLI to be thin adapters over reusable core.
`hono-app.ts` directly implements list-filter mapping, detail aggregation,
parent/child lookup, memory contradiction/usage enrichment, search mapping,
operation enrichment/caching, and resource parsing
(`packages/server/src/server/hono-app.ts:140-204`, `:228-289`, `:337-412`).
It is 435 lines and even contains an unreachable return at `:286-288`.

**Recommendation:** extract viewer-facing use cases into `core/*`, then split
route registration by concern. HTTP should validate/translate, call core, and
format the result.

### 8. Viewer request races can render stale data as current

**Severity: High · UX correctness · Effort: M**

Resource loading starts unguarded fetches whenever the pane changes
(`packages/viewer/components/resource-viewer.ts:33-61`, `:74-87`).
Activity loading uses the same manual pattern
(`packages/viewer/components/activity-panel.ts:67-99`). Spotlight permits an
earlier slow request to replace a later query and clear its loading flag
(`packages/viewer/components/spotlight-search.ts:189-231`).

**Recommendation:** use keyed `query()` loading where possible; otherwise add
AbortController or generation guards. Unit-test out-of-order deferred fetches.

### 9. Viewer HTTP failures frequently masquerade as empty success

**Severity: High · UX correctness · Effort: M**

Shared API helpers never check `response.ok`
(`packages/viewer/utils/api.ts:40-55`). Activity and spotlight catch failures
and replace data with empty arrays/results
(`packages/viewer/components/activity-panel.ts:80-99`;
`packages/viewer/components/spotlight-search.ts:203-216`). Other queries parse
JSON without validating status.

**Recommendation:** introduce a typed `fetchJson` boundary that validates HTTP
status and payloads. Preserve prior data, show a retryable error, and reserve
empty states for successful empty responses.

### 10. The CLI no longer matches MCP/core capabilities

**Severity: High · Ergonomics/contract drift · Effort: M**

The CLI `get` command cannot request ADR 0114 context/depth
(`packages/server/src/cli/commands/get.ts:13-30`), while MCP can
(`packages/server/src/tools/backlog-get.ts:55-70`). CLI search lacks
`parent_id`; create lacks references and cron fields; update lacks references,
artifact, and cron lifecycle fields. There are zero unit tests that import CLI
command registration modules.

**Recommendation:** derive both transport surfaces from shared typed parameter
definitions. Add `get --context --depth` first, then close the remaining
capability matrix with Commander argv unit tests.

### 11. Primary viewer controls are not keyboard- or screen-reader-operable

**Severity: High · Accessibility · Effort: M**

Task rows, spotlight results, activity expanders, and home navigation are
clickable `<div>` elements without control semantics
(`packages/viewer/components/task-item.ts:73-82`;
`packages/viewer/components/spotlight-search.ts:413-450`, `:473-522`;
`packages/viewer/components/activity-panel.ts:233-253`;
`packages/viewer/components/backlog-app.ts:146-151`). Spotlight and system-info
overlays lack dialog roles, modal semantics, focus trapping, and focus
restoration (`spotlight-search.ts:574-618`;
`system-info-modal.ts:112-125`).

**Recommendation:** build a reusable accessible dialog primitive and convert
interactive rows to native controls or complete keyboard/ARIA equivalents.

### 12. Search cache snapshots are synchronous, non-atomic, and duplicative

**Severity: Medium-High · Reliability/performance · Effort: L**

Every persistence serializes the Orama index plus complete task/resource
caches and writes synchronously to one JSON file
(`packages/memory/src/search/orama-search-service.ts:160-175`). Indexed
documents also contain full content and vector arrays
(`packages/memory/src/search/orama-schema.ts:6-22`). A crash can truncate the
cache; recovery silently triggers a full rebuild.

**Recommendation:** use atomic temp-write/fsync/rename, move snapshot work off
the event loop, and measure whether full entity caches and JSON vectors are
necessary.

### 13. A transient embedding failure disables hybrid search for the process

**Severity: Medium-High · Operability · Effort: S/M**

Embedding initialization promises are retained after failure, the caught
reason is discarded, and no retry state exists
(`packages/memory/src/search/orama-search-service.ts:67-86`;
`packages/memory/src/search/embedding-service.ts:18-28`).

**Recommendation:** model `idle/loading/ready/degraded`, retain a structured
failure reason, allow bounded retry, and expose the state through `/api/status`.

### 14. Relevance has diagnostics, but no realistic corpus-level quality gate

**Severity: Medium · Search quality · Effort: M**

Ranking and scaling diagnostics explicitly avoid assertions
(`packages/server/src/__tests__/search-ranking-diagnostic.test.ts:127-145`;
`packages/server/src/__tests__/search-scaling-diagnostic.test.ts:57-89`).
Golden tests are valuable but use a small synthetic corpus
(`packages/server/src/__tests__/search-golden.test.ts:31-107`). Hybrid tests
mostly assert presence rather than rank.

**Recommendation:** maintain a versioned, anonymized query/judgment fixture and
gate MRR, nDCG, and recall@k by query class in BM25 and hybrid modes.

### 15. Long documents receive a single, unbudgeted embedding

**Severity: Medium · Search quality/performance · Effort: L**

Task and resource embedding text concatenates whole title/content into one
model input
(`packages/memory/src/search/orama-search-service.ts:91-93`, `:137-150`).
There is no chunking or token-budget seam.

**Recommendation:** chunk long documents with stable child identifiers,
retrieve chunks, and aggregate to parent entities. Benchmark answer placement
at the beginning, middle, and end before choosing chunk sizes.

### 16. Core-first dependency boundaries remain porous

**Severity: Medium · ADR 0090 drift · Effort: M**

`core/config.ts` performs filesystem reads, logs to console, and reads ambient
process state (`packages/server/src/core/config.ts:25-27`, `:46-55`, `:76-85`,
`:121-135`). `ToolDeps` and `AppDeps` use `any` for central capabilities
(`packages/server/src/tools/index.ts:29-49`;
`packages/server/src/server/hono-app.ts:24-60`). `core/types.ts` is a 572-line
contract god file and imports concrete resource-manager types
(`packages/server/src/core/types.ts:12-19`).

**Recommendation:** move config I/O to infrastructure, introduce named
capability contracts/discriminated Node-vs-Worker wiring, and split core
contracts into adjacent `*.types.ts` files.

### 17. ADR 0114 retained vestigial resource branches and task vocabulary

**Severity: Medium · Dead code/vocabulary drift · Effort: S**

The folded context composer returns entity stubs only, and production `get`
does not inject resource listing
(`packages/server/src/core/get.ts:14-22`;
`packages/server/src/core/get-context/context-stubs.ts:81-98`). Re-homed stages
still compute `related_resources`
(`packages/server/src/core/get-context/relational-expansion.ts:41-50`,
`:246-259`; `semantic-enrichment.ts:102-121`). Generic entity dependencies are
still named `getTask`, `listTasks`, and `taskToContextEntity`.

**Recommendation:** delete the unreachable resource branches and finish the
ADR 0106 entity-vocabulary migration in `core/get-context`.

### 18. Deprecated operation-log APIs remain in production

**Severity: Medium-Low · Dead compatibility surface · Effort: S**

`OperationLogger.log()` and `.read()` are explicitly deprecated
(`packages/server/src/operations/logger.ts:40-55`, `:67-70`). The old writer is
test-only; `.read()` survives because wakeup adapters have not moved to the
canonical async `IOperationLog.query()`.

**Recommendation:** make wakeup accept the canonical operation-log port, remove
the legacy methods, and test `recordMutation` plus the log contract.

`packages/server/src/tools/build-write-context.ts` is **not dead**: all four MCP
write adapters use it. It should not be removed.

### 19. Stateful viewer and CLI behavior is weakly covered

**Severity: Medium · Test coverage · Effort: L**

The viewer has 19 component source files but only three component test files.
Spotlight, resource viewer, activity panel, system info, task list/detail,
resize handle, markdown rendering, and SSE behavior lack component-level unit
coverage. No unit test imports CLI command registrations.

**Recommendation:** add isolated happy-dom/Nisli unit suites with mocked fetch,
fresh injectors/query clients, and effect flushing; add Commander argv mapping
tests. Keep the repository's unit-only, memfs-based policy.

### 20. The CLI JSON mode is not an automation contract

**Severity: Medium · CLI ergonomics · Effort: M**

Successful data commands serialize JSON, while validation errors print plain
text and call `process.exit`
(`packages/server/src/cli/runner.ts:28-43`). Edit exits inside its formatter,
and status/stop ignore the global JSON option
(`packages/server/src/cli/commands/edit.ts:6-15`;
`packages/server/src/cli/index.ts:29-72`).

**Recommendation:** return typed command outcomes to one top-level formatter
and exit-code boundary. JSON mode should emit structured success and error
objects for every command.

### 21. ADR and public-document governance has rotted

**Severity: Medium · Decision integrity/discoverability · Effort: M**

Only 38 of 139 ADR/audit documents have normalized frontmatter. The ADR README
does not list ADRs 0111–0114, says there are no proposed ADRs, and says there
are no superseded ADRs despite maintaining a superseded section
(`docs/adr/README.md`). The public README still claims five entity types
(`README.md:113-123`) while the canonical registry has seven
(`packages/shared/src/entity-type.ts:11-19`), omits all memory tools, and still
describes the product/package as a minimal task backlog
(`README.md:1-7`; `packages/server/package.json:2-14`).

**Recommendation:** define a normalized ADR metadata contract, generate the ADR
index, validate links/status/supersession in CI, and derive public entity/tool
catalogs from canonical registries where practical.

### 22. Distribution footprint is large and has no budget

**Severity: Medium · Distribution/performance · Effort: M/L**

Transformers is mandatory at install time; server and viewer ship source maps;
the full viewer is copied into the npm package
(`packages/server/package.json:57-67`;
`packages/server/tsdown.config.ts:14-25`; `vite.config.ts:52-56`). Mermaid's
dynamic import still emits a broad diagram chunk graph. The diagnostic local
server dist is 8.1 MiB, mostly viewer assets; installed Transformers and ONNX
trees are much larger, but platform/package measurements must be taken from a
fresh release build.

**Recommendation:** add CI budgets for tarball size, production install size,
viewer transfer/parse size, and source maps. Evaluate optional semantic-search
dependencies and narrower Mermaid loaders based on measured benefit.

### 23. The consolidation test suite contains date-rot

**Severity: Medium · Test determinism · Effort: S**

`core-consolidation.test.ts` freezes `NOW` at 2026-06-10 and creates “recent”
usage events relative to it
(`packages/server/src/__tests__/core-consolidation.test.ts:14`, `:140-155`).
`consolidationCandidates` uses real `Date.now()`
(`packages/server/src/core/consolidation.ts:174-175`). Once the fixed events
became older than the 30-day window, the service-backed test failed while the
pure clock-injected fold still passed.

**Recommendation:** inject `now` into `consolidationCandidates`, or set the
Vitest system clock explicitly. Audit other real-time core functions for the
same test seam.

## Prioritized uplift backlog

Each line is intentionally implementation-shaped:

| Priority | Gap → proposed fix → effort |
|---|---|
| P0 | Search writes/initialization race → single-flight startup + awaited ordered mutation queue → **M** |
| P0 | Published Node 18 support is false → raise engine/build target and enforce the minimum in CI → **S** |
| P0 | Viewer failures/stale requests show wrong or empty data → typed HTTP boundary + keyed/abortable loaders → **M** |
| P1 | Deleted/unchanged resources are reprocessed incorrectly → fingerprinted resource reconciliation and live hooks → **M** |
| P1 | First search blocks on semantic bootstrap → immediate BM25 + background vector enrichment + readiness UI → **L** |
| P1 | HTTP duplicates core behavior → extract viewer use cases and split route modules → **L** |
| P1 | CLI trails MCP/core → shared transport parameter contracts + parity matrix + argv unit tests → **M** |
| P1 | Search relevance has no realistic gate → versioned judgments + MRR/nDCG/recall@k CI thresholds → **M** |
| P1 | Primary viewer controls/modals are inaccessible → reusable dialog/control primitives + keyboard/ARIA tests → **M** |
| P2 | Search snapshots block and can truncate → async atomic snapshotting + compact cache representation → **L** |
| P2 | Hybrid failure is permanent and opaque → retryable embedding state machine exposed in health/status → **S/M** |
| P2 | Long documents collapse into one vector → chunk index + parent aggregation benchmark → **L** |
| P2 | Core contains infrastructure and weak dependency bags → move config I/O, type capabilities, split core contracts → **M** |
| P2 | ADR 0114 retains dead resource branches/task naming → prune branches and finish entity vocabulary → **S** |
| P2 | Viewer/CLI stateful behavior lacks unit coverage → focused Nisli and Commander unit suites → **L** |
| P2 | CLI JSON output is inconsistent → one typed result/error formatter and exit boundary → **M** |
| P2 | ADR/README/package metadata is stale → generated validated catalogs and normalized frontmatter → **M** |
| P2 | Distribution has no budget → fresh pack/install/chunk measurement gates; evaluate optional heavy features → **M/L** |
| P3 | Deprecated operation-log APIs remain → migrate wakeup to `query()` and delete compatibility methods → **S** |
| P3 | Consolidation test depends on calendar time → inject/freeze clock and scan similar tests → **S** |

## Recommended first three engineering phases

### Phase A — truthful local behavior

Ship the three P0 fixes together:

1. serialize search initialization/mutations;
2. introduce a typed viewer HTTP boundary with stale-request protection;
3. correct the Node engine/build target.

Exit gate: concurrent-search mutation tests, out-of-order viewer request tests,
and a CI job on the declared minimum Node release.

### Phase B — search availability before sophistication

Add resource reconciliation and make BM25 immediately available while semantic
indexing progresses in the background. Expose search mode, progress, and
degraded reason in `/api/status` and the viewer.

Exit gate: cold/warm first-query p50/p95 at 100/1k/10k documents; deleted
resources disappear; unchanged resources do not re-embed.

### Phase C — one product surface

Extract HTTP use cases into core, establish MCP/CLI capability parity, and add
the shared viewer HTTP boundary. Fix accessibility and state races through
tested reusable primitives rather than one-off patches.

Exit gate: a generated surface-parity matrix, Commander mapping tests, and unit
tests proving out-of-order responses cannot replace newer viewer state.

## Measurements to add before optimizing further

- Cold and warm server start time.
- First BM25 result time vs semantic-ready time.
- Search p50/p95 and peak RSS at 100/1k/10k entities/resources.
- Resource reconciliation counts and embedding calls per restart.
- MRR, nDCG, recall@k by query class.
- Search-cache bytes and snapshot event-loop delay.
- `npm pack` compressed/unpacked size and clean production install size.
- Viewer initial transfer, parse time, and per-feature chunks.
- Error/empty-state and keyboard-navigation unit coverage.

These measurements turn the uplift backlog from intuition into falsifiable
engineering contracts.
