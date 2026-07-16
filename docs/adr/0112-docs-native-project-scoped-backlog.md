---
title: "0112. Docs-Native Project-Scoped Backlog — Open Markdown Truth, Scoped Homes, Human IDs"
date: 2026-07-16
status: Proposed
supersedes_in_part:
  - "0107-loro-as-truth-local-first-history-substrate.md — project homes only: committed Markdown is authoritative; Loro may be derived history/sync or remain confined to the global home"
  - "0092.9-phase-e-usage-feedback-research-and-plan.md — project homes only: recall usage remains local overlay state and does not rewrite committed memory frontmatter"
relates_to:
  - 0098-unified-substrate-architecture.md
  - 0104-local-first-deployment-posture.md
  - 0105-per-repo-config-auto-scope.md
  - 0107-loro-as-truth-local-first-history-substrate.md
---

# 0112. Docs-Native Project-Scoped Backlog

## Context

backlog-mcp has outgrown the assumption that one user-global task directory is
the product. Its strongest current capabilities — substrates, hybrid retrieval,
progressive disclosure, and agentic memory — all operate over human-readable
frontmatter Markdown. The missing architectural step is to let those
capabilities attach directly to the documents a project already owns.

The target experience is:

```text
repo/
├── docs/                         ← committed project truth; already valid on day 0
│   ├── adr/
│   ├── requirements/
│   ├── prompts/
│   ├── memories/
│   ├── tasks/
│   ├── artifacts/
│   ├── proposals/
│   ├── substrates/               ← optional declarations; ADR 0113 owns contents
│   ├── NORTH-STAR.md
│   └── NAMING.md
└── .backlog-mcp/                 ← local control plane and derived state
```

The global backlog remains, but it becomes another home with the same shape:

```text
~/.backlog/
├── docs/                         ← global documents
└── .backlog-mcp/                 ← global config/cache/operational state
```

This is not a sync feature. Project files are the backlog. No import copy, no
shadow database, and no migration is required for an existing `docs/` tree.

The pressure is already visible in the maintainer's own usage. After 117 pull
requests and almost 1,000 tasks/artifacts, he reported using backlog-mcp less:
finding the right epic and deciding where old work belongs had become work of
their own, and the tool was losing value as it successfully preserved more.
The essay ends with the contradiction that he is documenting the system's
progress while avoiding its present form. The global pile is the scaling
disease this ADR addresses: project artifacts should live in the repository
they describe, so corpus size, navigation, review, and ownership follow the
project's own structure rather than one ever-growing global taxonomy
([“117 Pull Requests Later”](https://gkoreli.com/one-hundred-pull-requests)).

**Supersedes in part:** ADR 0107 remains Proposed, but its binary
Loro-as-sole-truth premise cannot apply to project homes. In project mode,
committed Markdown is authoritative. Loro may be derived history/sync there, or
a future accepted 0107 design may confine sole-truth Loro to the global home.

### Current implementation audit

The present code cannot express this model without a deliberate refactor:

- `PathResolver.backlogDataDir` resolves one process-global directory, defaulting
  to `~/.backlog` (`packages/server/src/utils/paths.ts:67-87`).
- `FilesystemStorage` reads every substrate from one hard-coded `tasks/`
  directory and maps an entity ID directly to `<id>.md`
  (`packages/server/src/storage/local/filesystem-storage.ts:10-32`).
- Local identity allocation is `getMaxId()` followed later by `add()`, so the
  scan and write are not atomic (`packages/server/src/core/create.ts:37-59`;
  `packages/server/src/storage/local/filesystem-storage.ts:156-171`).
- `BacklogService`, `ResourceManager`, the memory composer, operation logger,
  and usage tracker are module/process singletons tied to that one global path
  (`packages/server/src/storage/local/backlog-service.ts:19-38`;
  `packages/server/src/resources/manager.ts:197-201`;
  `packages/server/src/memory/bootstrap.ts:31-75`;
  `packages/server/src/operations/storage.ts:12-17`).
- Search derived state is likewise fixed at
  `$BACKLOG_DATA_DIR/.cache/search-index.json`
  (`packages/server/src/storage/local/backlog-service.ts:26-30`).
- ADR 0105 correctly identified that a detached shared MCP server cannot use
  its own cwd as the caller's project, but its `BACKLOG_SCOPE` environment
  workaround is still process-wide. The first bridge that starts the detached
  server supplies its environment; later clients reuse that process
  (`packages/server/src/cli/server-manager.ts:48-62`). One process environment
  therefore cannot safely represent N simultaneous projects.
- The local bridge does know the caller's cwd, but currently forwards no
  project context when it starts `mcp-remote`
  (`packages/server/src/cli/bridge.ts:11-29`).
- The HTTP endpoint creates a fresh `McpServer` and stateless transport for
  each request while registering tools against the global service
  (`packages/server/src/server/hono-app.ts:94-117`). Project selection must be
  request-scoped; mutating a singleton between requests would race clients.
- `ResourceManager` already proves the useful half of the desired behavior: it
  recursively indexes Markdown as path-addressed resources. It is currently
  limited to `$BACKLOG_DATA_DIR/resources/`
  (`packages/server/src/resources/manager.ts:32-68`).
- Memory recall currently filters `context` by exact `parent_id`, not by a
  storage home (`packages/server/src/memory/backlog-memory-store.ts:119-149`).
  "Which home?" and "which entity subtree inside that home?" are distinct
  concepts and must not share one overloaded field.

### Day-0 acceptance case: aime

`/Users/goga/Documents/goga/aime/docs` is the living acceptance fixture:

| Existing path | Day-0 interpretation |
|---|---|
| `adr/0023.1-uplift-driven-exploration-map.md` | ADR document, local key `0023.1`, thread root `0023` |
| `requirements/REQ-0001-identity-in-system-prompt.md` | Requirement document, explicit/path key `REQ-0001` |
| `prompts/0001-tasks-and-vision.md` | Prompt document, local key `0001` |
| `requirements/README.md` | Generic document, not a malformed requirement |
| `proposals/herdr-event-stream-continuity-v1.md` | Generic document until a proposal substrate claims it |
| `NORTH-STAR.md`, `NAMING.md` | Generic top-level documents |
| `herdr-schema.json` | Generic text resource |

If this tree cannot be discovered, searched, read, and attributed to its source
paths without moving or rewriting any file, the design has failed.

## Decision

### R-1 — A backlog has multiple homes; every home has the same shape

A **backlog home** is:

```ts
interface BacklogHome {
  kind: 'global' | 'project';
  id: string;         // "global" or the canonical project root
  root: string;       // ~/.backlog or the project root
  documentsDir: string;
  controlDir: string;
}
```

Defaults:

| Home | Root | Committed/readable truth | Local control state |
|---|---|---|---|
| Global | `~/.backlog` | `~/.backlog/docs` | `~/.backlog/.backlog-mcp` |
| Project | repository/workspace root | `<root>/docs` | `<root>/.backlog-mcp` |

`documentsDir` is configuration, not architecture. A repository may select
another open directory, including an existing documentation folder with a
different name. The default is `docs` because that is the adoption path and
the established practice in aime and backlog-mcp itself.

The storage, search, memory, resource, operation-log, and viewer graph is
instantiated **per home**, not process-wide. A runtime registry may cache those
graphs by canonical home root, but no request changes ambient global state.

### R-2 — Project discovery is bounded, deterministic, and caller-scoped

We reject "scan the whole repository and guess which Markdown matters." That
creates surprising capture, makes monorepos ambiguous, and turns discovery
cost into an unbounded function of repository size.

Project-root input is resolved in this order:

1. Explicit `project_root` / `home` on the call.
2. Caller environment (`BACKLOG_PROJECT_ROOT`, `BACKLOG_HOME`) read by the CLI
   or local bridge — never by the shared server as per-client state.
3. Per-request transport context:
   - the bundled stdio bridge sends its cwd as
     `X-Backlog-Project-Root` and the selected home as `X-Backlog-Home`;
   - direct clients may send the same headers;
   - MCP roots are an optional fallback when the client and connection support
     them.
4. Repository config discovered from the caller root/cwd.
5. A conventional `docs/` under the resolved workspace or VCS boundary.
6. Global home.

The bridge header is the primary local-MCP answer to ADR 0105's transport
asymmetry. It varies per bridge request even when every client shares one
detached HTTP server. The installed `mcp-remote` dependency already supports
custom request headers; no new side channel is required.

MCP roots remain useful guidance, but are not the only contract: clients may
omit them, may expose several roots, and the current server runs stateless
request transports. When several roots contain eligible homes, the resolver
must not guess. It returns an ambiguity diagnostic and requires an explicit
root/home for single-home operations. Multi-home reads may use the caller's
whole explicit root set.

All candidate roots and final paths are canonicalized. A project documents
directory must remain within its declared root; symlinks that escape the root
are not followed by default.

### R-3 — Open documents are truth; hidden state is only control or derivation

Project content belongs in the visible documentation tree. `.backlog`,
`.backlog-mcp`, database blobs, and search indexes must never become the only
place where a project decision, requirement, prompt, task, or memory exists.

The split is:

```text
docs/                         truth: commit, review, grep, edit, link
.backlog-mcp/config.json      optional committed configuration
.backlog-mcp/config.local.json local override
.backlog-mcp/cache/           disposable derived indexes
.backlog-mcp/state/           local operational telemetry
```

Recommended `.backlog-mcp/.gitignore`:

```gitignore
config.local.json
cache/
state/
```

Search indexes and embedding vectors are disposable derived state. Operation
and memory-usage JSONL are valuable local operational evidence but are not
document truth; deleting them loses telemetry, not project artifacts.

Most importantly, a read must not dirty the repository. Project-mode recall
usage, `last_used_at`, and usage counts live in the local usage overlay under
`.backlog-mcp/state/`; they are not flushed back into committed memory
frontmatter. This deliberately changes the current ADR 0092.9 implementation,
which updates a memory entity after usage
(`packages/server/src/memory/usage-tracker.ts:80-99`).

### R-4 — `docs/substrates/` is the declaration discovery seam

ADR 0112 owns where declarations are found; ADR 0113 owns their schema,
validation, compilation, and the semantics of ADR, requirement, prompt, and
other user-defined substrates.

Discovery rules:

1. Read declaration files only from
   `<documentsDir>/substrates/**/*.json`.
2. Normalize every path to a POSIX-style path relative to `documentsDir`.
3. Sort by normalized relative path before compilation.
4. Pass each declaration to ADR 0113's compiler with its exact `sourcePath`.
5. Never use "last declaration wins." Duplicate type names, folder claims, or
   identity prefixes are deterministic errors that cite every source path.

Built-in definitions enter the same compiler with virtual source paths such as
`builtin:adr`. A project definition may extend or replace a built-in only
through an explicit mechanism defined by ADR 0113, never accidentally through
filesystem iteration order.

### R-5 — Per-substrate folders organize typed documents; everything else is still useful

Folder names are declarations/conventions, not a universal pluralization rule.
The default catalog may bind:

```text
docs/adr/
docs/requirements/
docs/prompts/
docs/memories/
docs/tasks/
docs/artifacts/
docs/proposals/
```

This intentionally preserves natural existing names such as `adr/` rather than
forcing `adrs/`.

The recursive document scan is deterministic (lexical normalized relative
path) and classifies files in this order:

1. A compiled substrate folder/path claim plus a matching identity shape.
2. An explicit recognized `type`/identity in frontmatter, if the substrate
   permits out-of-folder documents.
3. Generic document/resource.

An unclaimed Markdown file is indexed and readable as a generic document. It
is not silently ignored and is not rewritten to manufacture frontmatter.
Supported non-Markdown text formats such as JSON and YAML are indexed as
generic resources but do not become typed frontmatter entities.

A README or malformed typed candidate remains visible with a diagnostic. It
does not disappear from search, and entity mutation tools do not rewrite it
until it satisfies a compiled substrate definition. Ordinary native file
editing remains available because it is still a repository file.

### R-6 — Identity is local, path-derived, and substrate-neutral

Project identity cannot assume today's four-character entity prefixes.
The living corpus already contains three valid styles:

- numeric: `0001-tasks-and-vision.md`;
- threaded numeric: `0023.1-uplift-driven-exploration-map.md`;
- explicit prefixed: `REQ-0001-identity-in-system-prompt.md`.

Discovery produces a neutral identity record before ADR 0113 assigns meaning:

```ts
interface DocumentIdentity {
  sourcePath: string;
  pathKey?: string;          // 0001, 0023.1, REQ-0001
  declaredId?: string;       // optional frontmatter id
  slug?: string;
  threadRootKey?: string;    // 0023 for 0023.1
  threadParentKey?: string;  // 0023.1 for 0023.1.2
  observedDate?: string;     // non-authoritative discovery chronology
  dateSource?: 'git-first-add' | 'filesystem-mtime';
}
```

Rules:

- In an identity-bearing substrate folder, the filename key is the physical
  identity. The slug is descriptive and may change without changing identity.
- Frontmatter `id` is optional semantic metadata. If present, ADR 0113
  validates that it agrees with the filename/substrate identity. A mismatch is
  a diagnostic, not a silent alias.
- Files without an identity-bearing name remain path-identified generic
  documents.
- The canonical in-memory reference is
  `(home, substrate, local key)`. Source path is always returned as provenance.
- Human-facing display identity is substrate-owned: the same neutral `0001`
  may render as `PROMPT 0001`, while `0023.1` may render as `ADR 0023.1`.
- Existing Markdown links stay native relative links. backlog-mcp resolves and
  enriches them; it does not replace readable links with opaque database IDs.

Thread structure is first-class, not merely decorative filename text.
Discovery derives the root/parent keys generically; ADR 0113 decides what
threading means for each substrate (ADR continuation, proposal branch, memory
lineage, or unsupported).

Many existing project documents, including bare aime ADRs, have no
frontmatter date. Discovery may expose **non-authoritative chronology** without
rewriting them:

1. Prefer the Git first-add timestamp when the file is tracked and history is
   available.
2. Otherwise expose filesystem mtime.
3. Always include `dateSource`; never present either value as a declared
   document date.

The Git/filesystem reader is an injected discovery dependency, not hidden I/O
inside identity parsing. ADR 0113 may surface this as `inferred_date` /
`date_source` for ordering and diagnostics. It must never persist the inference
as authoritative frontmatter.

### R-7 — Allocation is optimistic and atomic; Git-branch collisions are diagnosed

There is no central numeric counter shared by clones and branches.

For a substrate whose compiled identity policy requests sequential numbers:

1. Scan the target collection's parsed identities.
2. Select the next root or child sequence.
3. Create the destination file with exclusive-create semantics.
4. If another local writer won, rescan and retry.

This closes the current same-worktree `getMaxId()`/later-write race.

No local algorithm can reserve `0024` across disconnected Git branches.
Therefore duplicate `(substrate, local key)` values are a validation error,
even when the slugs produce different filenames and Git itself reports no
textual conflict. The branch being integrated renumbers its new document and
updates references before merge. A future `backlog renumber` core operation
performs that rewrite transactionally; the indexer never invents a timestamp
or lexical tie-break because either would make identity depend on checkout
order.

### R-8 — Home selection and entity context are separate API concepts

ADR 0105 used `scope` for an entity subtree (`FLDR-0001`). Project homes add a
different dimension. We will not overload the same field with both meanings.

- **home**: which document universe — `project`, `global`, or `all`.
- **context/scope**: an entity/document subtree inside the selected home.

Resolution:

```text
home:
  explicit call
  > caller BACKLOG_HOME
  > repo config
  > discovered project docs home
  > global

context within that home:
  explicit context/scope
  > caller BACKLOG_CONTEXT
  > repo config
  > none
```

The bridge forwards caller defaults per request. The detached server's process
environment is not a multi-client default store.

When a project home is selected but invalid, the call errors. It must never
silently write to global, because that would leak project memory and tasks into
the wrong home.

### R-9 — Project is the default in a project; cross-home reads are explicit

With a discoverable project documents home:

- `wakeup`, `search`, `list`, `get`, and `recall` default to that project.
- `create`, `remember`, `update`, and other writes default to that project.
- User-global preferences or memories go global only when the caller
  explicitly selects `home: global`; content/kind heuristics do not guess.
- Outside a project home, global is the default.

`home: all` is read-only:

- Search/recall query each home independently, then merge candidate ranks with
  rank fusion rather than comparing raw per-index scores.
- The selected set is global plus the project roots explicitly supplied by the
  caller/connection. It never scans the machine or reuses every project a
  long-lived daemon happened to see previously.
- Every result carries `home`, `home_id`, `source_path`, and substrate identity
  provenance.
- Wakeup groups sections by home so a global task cannot masquerade as project
  work.
- An unqualified ID is resolved only in the active home. Cross-home ambiguity
  is an error, never "project wins" or "global wins" by accident.
- Writes reject `home: all`.

### R-10 — Project Markdown is authoritative; Loro is derived there or global-only

ADR 0107 is Proposed and conflicts with this decision where it makes a binary
`LoroDoc` the sole truth and Markdown an optional projection. In a docs-native
project, a committed Markdown file edited through normal repository tools must
be authoritative or the day-0 promise is false.

Therefore ADR 0112 explicitly supersedes that premise **for project homes**:

- Markdown + frontmatter are truth.
- Git is the project-level review/history substrate already present.
- Loro may later provide derived local history, concurrent edit assistance, or
  peer sync, but loss of the Loro cache cannot lose or invalidate documents.
- `write_resource` and native edits both write the authoritative Markdown
  surface; reconciliation updates indexes/derived history from files.

This does not reject Loro as a technology or pre-decide the global home. It
narrows the valid 0107 designs: Loro is derived history/sync in project mode,
or a sole-truth Loro experiment is confined to the global home under a later
accepted decision. A project may never have a binary store and an editable
committed file competing for authority.

### R-11 — The old global layout gets one migration, not permanent dual-format code

The current global store remains a first-class capability, but its flat
`~/.backlog/tasks/` layout is not carried forever.

Ship one core-first migration:

```bash
backlog migrate docs-native --home global [--dry-run]
```

It:

1. Parses every old entity and routes it to the compiled substrate folder under
   `~/.backlog/docs/`.
2. Moves generic resources into the new document tree without rewriting their
   content.
3. Moves local config/telemetry into `~/.backlog/.backlog-mcp/`.
4. Discards and rebuilds search caches.
5. Emits a deterministic plan/report before mutation and refuses identity
   collisions.

After cutover, runtime code reads only the docs-native layout. We do not keep a
dual reader, dual writer, deprecation alias matrix, or D1 parity implementation.
ADR 0104 already makes local mode the growing product; D1 is outside this
thread.

## Architecture

```text
CLI cwd / MCP bridge header / explicit call / MCP root
                         │
                         ▼
               resolveBacklogHome()
                         │
             canonical BacklogHome descriptor
                         │
                         ▼
              LocalRuntimeRegistry
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
 DocsFilesystemStorage  Search/Resources  Memory/Operations
 (Markdown truth)       (derived cache)   (home-local state)
        │                │                 │
        └────────────────┴─────────────────┘
                         │
                         ▼
           core create/get/search/recall/wakeup
                         │
              thin MCP / CLI / HTTP adapters
```

The registry is an optimization, not authority. A runtime is keyed by canonical
home root and can be recreated entirely from `docs/` plus optional local state.

## File-Level Engineering Plan

All automated tests are unit tests over memfs and injected dependencies. Manual
validation uses real processes after the unit suite; no integration-test suite
is introduced.

### Phase A — Home, discovery, and identity core

Add:

- `packages/server/src/core/backlog-home.ts`
- `packages/server/src/core/backlog-home.types.ts`
- `packages/server/src/core/document-discovery.ts`
- `packages/server/src/core/document-discovery.types.ts`
- `packages/server/src/core/document-identity.ts`
- corresponding `packages/server/src/__tests__/*.test.ts`

Responsibilities:

- pure home/config/root resolution;
- bounded walk-up and path containment;
- deterministic recursive document/declaration ordering;
- neutral path/frontmatter identity parsing;
- injected Git-first-add / filesystem-mtime chronology with explicit
  non-authoritative provenance;
- duplicate diagnostics carrying every source path;
- an aime-shaped memfs fixture proving the Day-0 acceptance table.

Extend `packages/server/src/core/config.ts` or replace its scope-only model with
the home/context configuration above. Do not preserve ambiguous environment or
field names merely for compatibility.

### Phase B — Per-home storage and runtime composition

Replace ambient paths with constructor-injected home descriptors:

- `packages/server/src/storage/local/filesystem-storage.ts`
  → docs-native, per-substrate path storage;
- `packages/server/src/storage/storage-adapter.ts`
  → source-path/document-identity operations and atomic create;
- `packages/server/src/storage/local/backlog-service.ts`
  → constructible per home, not a private singleton;
- add `packages/server/src/storage/local/local-runtime.ts`;
- add `packages/server/src/storage/local/local-runtime-registry.ts`;
- make `ResourceManager`, `OperationStorage`, memory bootstrap, usage tracker,
  and search cache paths runtime-owned rather than module singletons.
- add a docs-tree watcher behind an injected interface; `@parcel/watcher` is the
  named Node candidate because it provides recursive native subscriptions,
  coalesces large change bursts such as Git checkouts, and can query changes
  since a saved snapshot.

Until the Phase E migration and default cutover ship atomically, the Vite dev
entry may select this runtime only through temporary
`BACKLOG_DOCS_NATIVE=1` scaffolding. This flag is not a supported configuration
surface and is deleted in Phase E.

Generic documents share the search/read graph but remain distinct from typed
entity writes. Watch notifications only trigger reconciliation; startup/full
reconciliation remains the correctness boundary, so dropped watcher events
cannot make the cache authoritative.

### Phase C — Request-scoped transports and viewer APIs

Update:

- `packages/server/src/cli/bridge.ts` — forward caller cwd/home/context as
  headers supported by `mcp-remote`;
- `packages/server/src/cli/runner.ts` — resolve a runtime per invocation;
- `packages/server/src/server/hono-app.ts` — build `HomeContext` from explicit
  params/headers and register tools against the selected runtime;
- `packages/server/src/server/node-app.ts` — inject the runtime registry, not a
  singleton service graph;
- MCP and CLI tools — add `home` while retaining a separate entity
  `context`/`scope`;
- viewer REST endpoints — accept and return home provenance; viewer navigation
  carries the active home rather than assuming one global store.

Two simultaneous bridge clients rooted in different repositories must be
unit-tested with independent mocked runtimes. No request may observe another
request's home through mutable module state.

### Phase D — Search, memory, and cross-home composition

Update:

- per-home Orama cache paths and resource indexes;
- memory store construction per runtime;
- usage tracker to keep project read telemetry in
  `.backlog-mcp/state/memory-usage.jsonl` without saving memory frontmatter;
- operation log to `.backlog-mcp/state/operations.jsonl`;
- `search`, `recall`, and `wakeup` result types with `home` and `source_path`;
- explicit `home: all` rank fusion and grouped wakeup output.

Reconciliation remains mandatory because native repository edits bypass the
server. ADR 0101's source-vs-cache lesson becomes more important, not less.

### Phase E — Global migration and legacy deletion

Add:

- `packages/server/src/core/migrate-docs-native.ts`
- `packages/server/src/core/migrate-docs-native.types.ts`
- `packages/server/src/cli/commands/migrate-docs-native.ts`
- memfs unit tests for dry-run, collision refusal, routing, and rollback-safe
  ordering.

Then remove:

- the flat all-types `tasks/` reader/writer;
- process-global `BACKLOG_DATA_DIR` as the storage selection mechanism;
- permanent compatibility branches for old scope/home names;
- any assumption that all document IDs match `PREFIX-NNNN`.

Manual exit validation:

1. Point the real CLI/bridge at aime with no content migration.
2. Search and read every row in the Day-0 acceptance table.
3. Create one project memory and confirm only `docs/memories/` changes.
4. Recall/search repeatedly and confirm Git remains clean.
5. Run two project bridges against the shared detached server and confirm
   isolation.
6. Dry-run and execute the global migration, restart, and verify the old layout
   is no longer consulted.

## Consequences

### Positive

- Adoption becomes attachment, not import: an existing docs tree is useful
  immediately.
- ADRs, requirements, prompts, memories, tasks, and future substrates share one
  architectural substrate without becoming one undifferentiated type.
- Project artifacts are reviewable in Git and readable without backlog-mcp.
- The global and project modes use one home abstraction instead of separate
  products.
- Per-request home selection fixes ADR 0105's shared-server cwd/env limitation.
- Human filenames and native links remain primary; opaque IDs become an
  optional substrate choice rather than infrastructure law.
- Derived state can be deleted and rebuilt without losing project truth.

### Costs and trade-offs

- The singleton-heavy local graph must become per-home and injectable. This is
  a real refactor across storage, search, resources, memory, operations, MCP,
  CLI, HTTP, and viewer code.
- Native file edits mean reconciliation is a permanent responsibility.
- Branch-local sequential IDs cannot be made globally collision-free without a
  coordination service; merge-time validation and renumbering are the honest
  model.
- Cross-home search needs rank fusion and provenance; raw scores from separate
  indexes are not directly comparable.
- Read telemetry no longer appears in committed memory frontmatter. The viewer
  must overlay local state when present.
- This explicitly supersedes ADR 0092.9's frontmatter usage-summary writes for
  project homes; its ranking/feedback semantics remain, backed by local overlay
  state instead.
- ADR 0107 must be revised before implementation because binary sole truth is
  incompatible with docs-native authority.

## Rejected Alternatives

### Hidden `./.backlog` as project truth

Rejected as the default because it defeats repository-native exploration and
review. It remains possible through configured `documentsDir`, but the product
does not steer users there.

### Recursively scan every Markdown file in the repository

Rejected as excessive magic. It captures READMEs, vendored docs, generated
content, and monorepo siblings without a stable project boundary. Scan the
resolved documents directory; configure another directory explicitly.

### Copy project docs into `~/.backlog`

Rejected because it creates two truths and a synchronization problem. Index
the originals.

### Keep `~/.backlog` as the only store and map projects to `FLDR-*`

Rejected because it leaves ADRs and requirements split between repository
truth and backlog truth, preserves opaque project identity, and does not solve
day-0 docs adoption.

### Use one process-wide env-selected project

Rejected because the detached server is shared. Process env describes the
server process, not the MCP request/client that is currently calling it.

### Make a Loro blob authoritative for project homes and export Markdown

Rejected for project homes because native repository edits would modify a
projection rather than truth. Loro may derive from project Markdown; the
direction of authority cannot reverse there.

## References

- [ADR 0098 — Unified Substrate Architecture](./0098-unified-substrate-architecture.md)
- [ADR 0092.9 — Memory Usage Feedback](./0092.9-phase-e-usage-feedback-research-and-plan.md)
- [ADR 0101 — Search Reconciliation](./0101-search-index-reconciliation.md)
- [ADR 0104 — Local-First Deployment Posture](./0104-local-first-deployment-posture.md)
- [ADR 0105 — Per-Repo Config and Auto-Scope](./0105-per-repo-config-auto-scope.md)
- [ADR 0106.3 — Storage Layer Restructure](./0106.3-storage-layer-restructure.md)
- [ADR 0107 — Loro as Truth](./0107-loro-as-truth-local-first-history-substrate.md)
- [MCP 2025-11-25 Roots specification](https://modelcontextprotocol.io/specification/2025-11-25/client/roots)
- [Official MCP TypeScript SDK — stateful Streamable HTTP and roots](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStreamableHttp.ts)
- [Official MCP filesystem server — roots handling precedent](https://github.com/modelcontextprotocol/servers/blob/main/src/filesystem/index.ts)
- [mcp-remote custom headers](https://github.com/geelen/mcp-remote#custom-headers)
- [`@parcel/watcher` — recursive native filesystem subscriptions and snapshots](https://github.com/parcel-bundler/watcher)
- aime living corpus: `/Users/goga/Documents/goga/aime/docs`
