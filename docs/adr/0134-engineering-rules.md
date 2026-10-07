---
id: ADR 0134
type: adr
title: 'Engineering Rules — Layers, Domain Model, Boundaries, and Code Quality'
status: accepted
date: '2026-09-28'
description: >-
  Defines binding engineering rules for dependency direction, domain ownership
  and code quality. Requires pure core policy, thin peer adapters, injected
  capabilities and a shrinking architecture ratchet, with phased cleanup of
  existing violations.
references:
  - url: ./0090-cli-tool-and-core-extraction.md
    title: 'Historical relates_to: 0090-cli-tool-and-core-extraction.md'
  - url: ./0091-runtime-clean-worker-bundle.md
    title: 'Historical relates_to: 0091-runtime-clean-worker-bundle.md'
  - url: ./0104-local-first-deployment-posture.md
    title: 'Historical relates_to: 0104-local-first-deployment-posture.md'
  - url: ./0106.5-intent-write-surface.md
    title: 'Historical relates_to: 0106.5-intent-write-surface.md'
  - url: ./0112-docs-native-project-scoped-backlog.md
    title: 'Historical relates_to: 0112-docs-native-project-scoped-backlog.md'
  - url: ./0117-the-write-boundary.md
    title: 'Historical relates_to: 0117-the-write-boundary.md'
  - url: ./0133-atomic-document-creation.md
    title: 'Historical relates_to: 0133-atomic-document-creation.md'
evidence:
  - >-
    Historical frontmatter status: "Accepted (goga, 2026-09-28) — Phases 1 and 3
    implemented by 0134.1 and shipped in 0.76.0; Phases 2 (partly), 4 and 5
    open"
  - 'Historical frontmatter author: "Claude (for goga)"'
  - >-
    Historical frontmatter relates_to:
    ["0090-cli-tool-and-core-extraction.md","0091-runtime-clean-worker-bundle.md","0104-local-first-deployment-posture.md","0106.5-intent-write-surface.md","0112-docs-native-project-scoped-backlog.md","0117-the-write-boundary.md","0133-atomic-document-creation.md"]
---

# 0134. Engineering Rules

## Context

backlog-mcp's architecture is currently described across many ADRs, each
restating part of it: ADR 0090 (core is pure), ADR 0091 (inject capabilities),
ADR 0104 (binding engineering principles), ADR 0106.5 R8 (file reading is a
local-adapter concern), the file naming convention labelled ADR 0109, now in the
[engineering guide](../guides/engineering.md#file-naming-convention) (there is no ADR file for it), and the code-style guidance
originally in `AGENTS.md` (now in that guide). None of them says where code lives, what it may depend on, or how
a violation is found. As a result, some of those principles have eroded without
anyone noticing.

The erosion has a cost, and one example is recent. Commit `2207110` made
`cli/runner.ts` build its runtime through `server/local-app-request-runtime.ts`.
The CLI thereby inherited the HTTP server's source-path resolver, which is
contained to the home because request-supplied paths are a capability on the
server (ADR 0112 R-2). `backlog create --source /tmp/draft.md` stopped working,
and nothing in the codebase marked the change as a policy decision. It was one
adapter importing another. `c460830` fixed the symptom. These rules exist to
make that class of mistake visible before it ships.

The goal is code that is easy to **build, refactor, improve, and reason
about**:

- **Build:** a new capability has one obvious place to go.
- **Refactor:** dependency direction is fixed, so moving code never creates
  cycles or hidden coupling.
- **Improve:** each policy exists once, so fixing it fixes every caller.
- **Reason about:** a file's path tells you its layer and its concept, and its
  imports tell you what it can affect.

These rules are binding. A change that breaks one either fixes the violation or
amends this ADR. Existing violations are listed in [Current state](#current-state)
and are migrated under a ratchet (R6.2): the list may only shrink.

## Rules

### R1. Layers and dependency direction (hexagonal)

Paths are relative to `packages/server/src/`.

| Layer | Paths | May depend on | Must not depend on |
|---|---|---|---|
| **Domain (core)** | `core/` | `@backlog-mcp/shared`, `@backlog-mcp/memory`, `zod`, its own ports | storage, server, cli, tools, Node IO, `process` |
| **Infrastructure** | `storage/`, `resources/`, `operations/`, `events/`, `memory/`, `auth/` | core (domain types and ports) | server, cli, tools |
| **Driving adapters** | `cli/`, `tools/` (MCP), `server/` (HTTP/Hono) | core, composition | each other |
| **Composition** | `node-server.ts`, `dev-entry.ts`, `worker-entry.ts`, `composition/` | everything | — (never imported by core or infrastructure) |

- **R1.1 Core is pure.** No `node:fs`, `node:os`, `node:child_process`,
  `process.env`, `process.cwd()`, or `console` in `core/`. Anything from the
  outside world (filesystem probes, clock, home directory, environment) arrives
  as an injected dependency object. `BacklogHomeDeps` in
  `core/backlog-home.types.ts` is the pattern. The real implementations of
  those objects live outside core and are wired by composition. This restates
  ADR 0090 principle 1 and ADR 0091, and makes both enforceable.
- **R1.2 Ports are owned by their consumer.** The interface core calls lives in
  core as `<name>.contract.ts` (file naming, [engineering guide](../guides/engineering.md)), and infrastructure implements it.
  Core never imports a port from the layer that implements it. Precedent:
  `IntentRegistryPort` (ADR 0106.5 Phase B step 1).
- **R1.3 Adapters are peers and thin.** An adapter parses input, calls core,
  and formats output, following ADR 0090's "MCP wrapper pattern". An adapter
  never imports another adapter. If two adapters need the same runtime, that
  runtime belongs to composition (R1.4). If they need the same logic, it
  belongs in core (R2.2). One dependency is declared rather than forbidden:
  the HTTP adapter (`server/`) mounts the MCP adapter (`tools/`) because it
  serves the MCP endpoint. `tools/` never imports `server/` (0134.1 R1.5).
- **R1.4 One composition per process entry.** Building a runtime (a home, its
  storage, search, memory, operation log, and intent registry) happens in
  composition, not inside an adapter. The per-home runtime the CLI, MCP and
  HTTP share lives in `composition/` (moved there by 0134.1 R3). An
  adapter-specific policy, such as containment of request-supplied paths, is
  passed in by that adapter and is never decided by the shared runtime
  (R2.6). A rule that holds for every caller is not transport policy: reading
  only inside the documents directory (`readLocalFile`) belongs in the shared
  runtime.
- **R1.5 Capabilities are injected, not imported.** A runtime-specific
  capability (file reading, source paths, git) is an injected function, so the
  Worker bundle and tests can omit or replace it (ADR 0091).
- **R1.6 Packages are bounded contexts.** `shared` holds wire and entity types.
  `memory` holds memory composition. `server` holds the backlog domain and its
  adapters. `viewer` is a client of the HTTP API only. A package imports another
  package's public entry point, never its files ([engineering guide](../guides/engineering.md): no re-exporting
  between packages). `shared` and `memory` never import `server`.

### R2. Domain model (DDD)

- **R2.1 One ubiquitous language.** The names in the ADRs are the names in the
  code, the CLI flags, the MCP schemas, and the JSON fields. Each concept has
  one word:

  | Term | Meaning | Defined in |
  |---|---|---|
  | home | a document universe: `global` or `project` | ADR 0112 R-1, `core/backlog-home.types.ts` |
  | context | an entity subtree inside a home (e.g. `FLDR-0001`) | ADR 0112 R-8, ADR 0112.3 |
  | substrate | a declared document type (task, epic, memory, …) | ADR 0113 |
  | intent | a semantic write operation compiled from a substrate | ADR 0106.5 |
  | provenance | where a result came from: `home`, `home_id`, `source_path` | ADR 0112 R-9, `core/home-provenance.types.ts` |
  | write boundary | the managed path by which entities are written | ADR 0117 |

  A rename happens everywhere at once, with a migration where data or config
  is affected. Precedent: `scope` → `context` (ADR 0112.3). A synonym that
  appears in one layer is a defect, even if it's only in a comment.
- **R2.2 Each concept has one module in core, and projections live next to
  it.** A value derived from a domain object, such as a display form, a wire
  shape, or a summary, is computed by one core function beside the object,
  and every adapter calls that function. Example: `core/home-presentation.ts`
  (ADR 0128), and `core/home-provenance.ts`, which moved out of `server/` in
  `c460830` after the CLI had duplicated it.
- **R2.3 Value objects are constructed, not assembled.** A domain value with
  invariants (a canonical home, a document address, a status token) is created
  by one constructor function that validates and normalizes it, such as
  `createBacklogHome` or `core/document-address.ts`. Callers do not build its
  object literal by hand.
- **R2.4 One write path per aggregate.** Entities are created through
  `core/persist-new-entity.ts` under the home-local lock (ADR 0133), and
  managed writes go through the write boundary (ADR 0117). No adapter or
  infrastructure module writes a managed document another way.
- **R2.5 Domain errors are typed.** Core throws named error classes that carry
  domain meaning, such as `BacklogHomeResolutionError`. Adapters map them to
  exit codes, HTTP statuses, or MCP error results. Core never formats for a
  transport (ADR 0090 principle 3).
- **R2.6 Transport policy stays in the transport.** A rule that exists because
  of how a caller reaches the system belongs to that caller's adapter or
  composition, not to core and not to the shared runtime. Examples:
  - path containment for request-supplied paths: HTTP/MCP (ADR 0112 R-2)
  - reading local files as the invoking user: CLI (ADR 0106.5 R8)
  - loopback-only control routes: HTTP (ADR 0131)

### R3. Contracts at boundaries

- **R3.1 Core returns data, and adapters format it** (ADR 0090 principle 5).
  The same concept has the same shape on every adapter: `backlog create --json`
  and the HTTP API return the same `HomeProvenance` fields.
- **R3.2 Wire shapes change additively.** Adding a field is a changelog entry.
  Removing or renaming one needs an ADR ruling and a changelog entry in the
  same change. Human-readable output keeps its first line parseable
  (`Created ID …`).
- **R3.3 Validate once, at the edge.** Untrusted input (CLI flags, MCP
  arguments, HTTP bodies, frontmatter) is parsed with a schema (zod or the
  compiled substrate JSON Schema) where it enters. Past that point, code
  trusts its types and does not re-validate defensively.
- **R3.4 Errors say what to do next.** An error that a caller, human or agent,
  can resolve names the fix: the flag, the value, or the alternative command.
  `Source path must be a file inside backlog home …` failed this rule and cost
  an agent several turns. Tests assert the fix hint, not just the message.
- **R3.5 Every write reports where it landed.** A mutating command or tool
  returns provenance (R2.1) for what it changed, so neither an agent nor a
  script has to guess which home a write went to (ADR 0112 R-9).

### R4. Modules, files, and naming

- **R4.1 One concept per file, and no god files.** A file that takes on a
  second responsibility, or grows past about 400 lines, gets split along its
  concepts. For example, `cli/commands/create.ts` keeps registration and input
  resolution, and `cli/commands/create-output.ts` holds formatting.
- **R4.2 Name files by role** ([engineering guide](../guides/engineering.md), "File naming convention"): `<base>.types.ts` for satellite
  types, `<name>.contract.ts` for ports, `<base>.test.ts` for tests, and
  `types.ts` only for types shared across a whole folder.
- **R4.3 Name folders for domain concepts, not technical buckets.** `utils/`
  is frozen: nothing new goes in it, and its files move to the concept they
  serve when touched (for example `utils/global-home-paths.ts` → the home
  concept). New shared code goes in a concept folder.
- **R4.4 `index.ts` is a barrel only** ([engineering guide](../guides/engineering.md)). A module never imports
  its own barrel. Cross-folder imports use the barrel where one exists.
- **R4.5 Every file starts with a short comment that states its
  responsibility,** and every exported function has JSDoc that cites the ADR
  or prior art it implements.
- **R4.6 Declarative, named functions.** Callbacks passed to `run`, `.action`,
  `.filter` and similar are named functions, not anonymous arrows
  ([engineering guide](../guides/engineering.md)), so that stack traces and code search can find them.

### R5. Reuse, root causes, and type safety

- **R5.1 Search before you write.** Before adding a function, look for the
  concept in core (`rg` for its ubiquitous-language term). A second
  implementation of an existing policy is a defect, even when it is faster to
  write.
- **R5.2 Fix root causes.** Don't patch symptoms at call sites, and don't catch
  and ignore a failing dependency. Fix it or its contract. The `--source`
  regression was fixed by giving the CLI its own reader (R2.6), not by
  loosening the server's containment.
- **R5.3 No silent fallbacks.** Failing open is allowed only where an ADR says
  so, and the code cites that ADR at the fallback. Example: recording recent
  homes, ADR 0128 R3, at `cli/runner.ts`.
- **R5.4 Strict types.** No `any` in exported signatures, no `!` non-null
  assertions ([engineering guide](../guides/engineering.md)), and `import type` for type-only imports
  (`verbatimModuleSyntax`). Narrow with checks, not casts.
- **R5.5 Borrow battle-tested conventions.** When an established tool already
  has a convention for the same problem, adopt it and cite it in the file
  header. Examples: `-F/--body-file` and `-` for stdin from `gh` and `git`,
  Keep a Changelog. A hand-written alternative needs a
  recorded reason.

### R6. Verification and enforcement

- **R6.1 Unit tests with memfs, no integration tests** ([testing guide](../guides/testing.md)). Every
  change passes `pnpm build && pnpm test` and `pnpm typecheck` before it is
  committed, which is what CI runs (`.github/workflows`).
- **R6.2 Architecture rules are tests, with a ratchet.**
  `src/__tests__/architecture.test.ts` checks every import, using the
  TypeScript compiler's import scanner (`helpers/import-graph.ts`) and the
  rules in `helpers/architecture-rules.ts`. It fails when:
  - core imports Node IO or an outer layer (R1.1, R1.2);
  - an adapter imports another adapter (R1.3);
  - infrastructure imports an adapter or composition (R1);
  - a file is added under `utils/` (R4.3).

  Known violations are listed in `KNOWN_VIOLATIONS` (0134.1 §Audit explains
  each). The test also fails if a listed violation has been fixed but not
  removed, so the list can only shrink.
- **R6.3 Invariants and contracts are tested where they are owned.** Core
  invariants go in `core-invariants.test.ts`. A port's contract is tested once
  against every implementation.
- **R6.4 Formats another program reads are tested against that reader.** YAML
  frontmatter is round-tripped through `gray-matter`, and JSON Schemas are
  checked with `ajv`.

### R7. Change process

- **R7.1 Follow the development loop** ([development loop](../guides/development-loop.md)): research the current
  state and write it up with file citations, plan as an ADR with numbered
  rulings, engineer in phases starting from core, run a validation pass, then
  record the outcome.
- **R7.2 Commit small and conventional** (`feat(cli): …`, `docs(adr): …`),
  with the `CHANGELOG.md` entry in the same change ([packages and releases](../guides/packages-and-releases.md#versioning--changelog)).
- **R7.3 ADRs cite files and commits, not intentions** ([development loop](../guides/development-loop.md)).

### R8. Dependencies

- **R8.1 A new runtime dependency needs a line in this ADR** saying what it
  does, where it is imported, and why no existing dependency covers it. The
  current runtime set (`packages/server/package.json`) is `@hono/node-server`,
  `@huggingface/transformers`, `@modelcontextprotocol/sdk`, `@orama/orama`,
  `@orama/stopwords`, `@parcel/watcher`, `ajv`, `arctic`, `commander`,
  `gray-matter`, `hono`, `mcp-remote`, and `zod`.
- **R8.2 A dependency is imported by one module that acts as its adapter.**
  For example, the MCP SDK is used only under `tools/` and `server/`, and
  Orama only under search. Other code reaches it through a port.

## Current state

> **Superseded by [0134.1](0134.1-enforcing-the-engineering-rules.md) §Audit.**
> This table came from quick greps and undercounts (core has 37 outward
> imports, not about 20). The allowlist in `architecture.test.ts` is the
> source of truth.
Audit of `packages/server/src` at `c460830`. These are the allowlist entries
for R6.2.

| Rule | Violation | Where |
|---|---|---|
| R1.1 | Core imports Node IO | `core/backlog-home.ts`, `core/config.ts`, `core/document-discovery.ts`, `core/migrate-docs-native.ts` |
| R1.1 | Core reads `process.env` / `process.cwd()` as defaults | `core/config.ts:168,177`, `core/backlog-home.ts:178,346` |
| R1.1 | Core writes to `console` | `core/config.ts` (2) |
| R1.2 | Core imports its main port from infrastructure | `IBacklogService` from `storage/backlog-service.contract.ts`, in 17 core files |
| R1.2 | Core imports infrastructure types and helpers | `core/identity-resolution.ts` → `storage/local/git-runner.js`; `core/migrate-docs-native.ts`, `core/normalize-memory-refs.ts` → `storage/storage-identity.js` |
| R1.3 | Adapter imports adapter | `cli/runner.ts` → `server/local-app-request-runtime.ts`, `server/local-runtime-request-resolver.ts`; `cli/runner.types.ts` → `server/app-request-runtime.types.ts` |
| R1 | Infrastructure imports an adapter | `storage/local/local-runtime.ts` → `server/tool-name-reservations.ts` |
| R4.1 | Files over 400 lines | `core/migrate-docs-native.ts` (1621), `server/hono-app.ts` (1016), `core/types.ts` (1014), `core/substrates/compile-substrate-intents.ts` (867), `core/wakeup.ts` (859), and 10 more between 400 and 540 |
| R4.3 | Technical bucket | `utils/` (9 files) |
| R5.4 | `any` in source | 22 occurrences outside tests |

## Engineering plan

Each phase is its own commit series and leaves the suite green. No phase
changes behavior. Behavior changes are separate ADRs.

1. **Enforce.** Add `architecture.test.ts` (R6.2) with the allowlists above.
   From this point, new violations fail the suite. **Done** (0134.1, `3ce5a1e`).
2. **Own the ports.** Move `IBacklogService` to
   `core/backlog-service.contract.ts`, move the `GitRunner` type to a core
   contract, and move the storage-identity helpers core uses into core
   (R1.2). Imports change, code doesn't. **Partly done:** the storage-identity
   helpers, the storage catalog contract and the operation-log port moved in
   0134.1 R2. `IBacklogService` (which imports storage and resource types) and
   `GitRunner` remain.
3. **Extract composition.** Move the shared runtime to `composition/` and
   have `cli/runner.ts` and the HTTP runtime both depend on it (R1.3, R1.4,
   R2.6). Move `server/tool-name-reservations.ts` to core, since reserved
   names are a domain rule. **Done** (0134.1, `0c129ec`, `3166e1c`). No
   transport policy had to be passed in: the only one, `resolveSourcePath`,
   had no consumers and was deleted.
4. **Purify core.** Replace the IO defaults in `core/backlog-home.ts`,
   `core/config.ts`, and `core/document-discovery.ts` with required injected
   dependencies, wired in composition (R1.1). `core/migrate-docs-native.ts`
   moves to an infrastructure migration module that calls core. Also inject
   the `BacklogMemoryStore` fallback that `core/wakeup.ts` constructs. **Open.**
5. **Split by concept, opportunistically.** Split `core/types.ts` into
   satellite `.types.ts` files, and split `server/hono-app.ts` into route
   modules. Do each when the file is next touched for another reason
   ([engineering guide](../guides/engineering.md) file naming: no sweeping renames).

## Consequences

### Positive

- A file's path states its layer, and its imports state what it can affect.
  Reviewing a change for coupling becomes a matter of reading imports.
- Adapters stay thin, so choosing the primary agent surface (CLI or MCP,
  TASK-0012) stays cheap and reversible. Neither surface can quietly
  accumulate logic the other lacks.
- A policy fixed once is fixed for every caller (R2.2, R5.1).
- The ratchet turns this ADR from guidance into a gate without requiring a
  big-bang refactor.

### Costs

- Phases 2–4 touch many imports. They are mechanical but create merge
  conflicts with concurrent work, so each should land quickly.
- Injected dependencies make call sites more verbose than importing `fs`.
  That cost is accepted, because it is what makes core testable without memfs
  and portable to the Worker (ADR 0091).
- An import-scanning test is a heuristic. It can't see dynamic `import()`
  across layers, so R1 is also checked in code review.

## Rejected alternatives

- **A lint plugin (`eslint-plugin-boundaries`, dependency-cruiser) instead of a
  test.** Both are viable, but each adds a dependency and config language for
  one check. A vitest file that runs in the existing suite, using the
  TypeScript compiler API or plain regex over imports, is enough. Revisit if
  the rules outgrow it (R8.1).
- **Restating the rules only in `AGENTS.md`.** Guidance that isn't enforced is
  how the current violations accumulated. `AGENTS.md` should link to this ADR
  instead of duplicating it.
- **Fixing the violations first and writing the rules later.** Without the
  ratchet, new violations land while the old ones are being fixed.

## References

- ADR 0090 (core purity, wrapper pattern), ADR 0091 (capability injection),
  ADR 0104 (binding principles), ADR 0106.5 R8 (local-adapter file reading),
  [engineering guide](../guides/engineering.md) file naming ("ADR 0109"), ADR 0112 R-1, R-2, R-8, R-9 (homes, discovery,
  provenance), ADR 0117 (write boundary), ADR 0128 (home presentation,
  fail-open recent homes), ADR 0133 (atomic creation).
- `2207110` (the CLI adopted the server's resolver), `c460830` (CLI body-file
  reader, `HomeProvenance` moved to core).
- Structure adapted from gshell ADR-0002, Engineering rules.
- Alistair Cockburn, *Hexagonal Architecture* (ports and adapters). Eric Evans,
  *Domain-Driven Design* (ubiquitous language, value objects, aggregates,
  bounded contexts).
