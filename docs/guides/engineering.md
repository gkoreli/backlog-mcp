# Engineering and file naming

Read this when writing, reviewing, moving, or refactoring code, or diagnosing architecture-test failures.
These are active contributor instructions, reached from [AGENTS.md](../../AGENTS.md).

The summaries below aid navigation; [ADR 0134](../adr/0134-engineering-rules.md)
and its [enforcement record](../adr/0134.1-enforcing-the-engineering-rules.md)
remain the authority for engineering rules. The file naming convention below
is maintained here; there is no ADR 0109 file.

## Code Style

Binding engineering rules (layers, ports, DDD, boundaries, enforcement) are in
[ADR 0134](../adr/0134-engineering-rules.md). The bullets below are a summary.

- **`index.ts` files are barrel exports only** — never put implementation in `index.ts`
- **No re-exporting between packages** — import from the source package directly
- **Minimal code** — only what's needed to solve the problem
- **Declarative with named functions** — not inline callbacks
- **Never use `!` non-null assertions** — use proper narrowing (ternary, `if` check, `??` fallback)
- **Composable, modular, no god files** — decompose into meaningful single-purpose modules; composition over inheritance; strongly typed throughout; JSDoc on exported functions and non-obvious decisions
- **Core-first layering (ADR 0090)** — business logic lives in `src/core/*` as standalone, transport-free functions; MCP tools, CLI commands, and HTTP routes are thin adapters that map params and call core. Any consumer can reuse core.

### Architecture (ADR 0134, enforced)

Layers in `packages/server/src/` and what each may import:

- **Domain** (`core/`, `substrate-definitions/`): may import core,
  `@backlog-mcp/shared`, `@backlog-mcp/memory`, `zod`, and pure Node
  (`node:path`, `node:crypto`, `node:util`).
- **Infrastructure** (`storage/`, `memory/`, `operations/`, `resources/`,
  `events/`, `auth/`): may import core and other infrastructure.
- **Composition** (`composition/`, `node-server.ts`, `dev-entry.ts`,
  `worker-entry.ts`): may import everything.
- **Adapters** (`cli/`, `tools/` (MCP), `server/` (HTTP)): may import core,
  infrastructure, and composition; never each other, except `server` mounting
  `tools` for the MCP endpoint.

`src/__tests__/architecture.test.ts` checks every import against these rules.
When it fails:

- **"has no new violations"**: you added an import that breaks a rule. Fix
  the import: move the code to the layer that owns it, or depend on a port.
  Adding it to `KNOWN_VIOLATIONS` is not a fix; that needs an ADR amendment.
- **"lists no fixed violations"**: you fixed a known violation. Delete its
  entry from `KNOWN_VIOLATIONS` in `src/__tests__/helpers/architecture-rules.ts`.
  The list only shrinks.
- **"adds no files to utils/"**: put the file in the folder named for its
  concept.

Shared logic that two adapters need goes in `core/`. A shared runtime piece
goes in `composition/`. Transport policy (path containment, loopback-only
routes) stays in its own adapter (ADR 0134 R2.6).

Use the existing `utils/paths.PathResolver` for package/dist/viewer/bin paths
and reusable local path mechanics (tilde/user paths and canonicalization).
Its `projectRoot` is the installed package root. Caller workspace/home choices
remain per-call core data, with resolver capabilities injected through ports;
do not add mutable active-home state to the singleton or import it into core.
Keep strict existing-path reads distinct from missing-ancestor canonicalization
and keep containment/lock policy at the owning boundary. See the
[repository audit correction](../reports/0018-repository-architecture-audit-2026-10-03.md#pathresolver-correction-after-maintainer-review).

### File naming convention

This convention was labelled "ADR 0109"; there is no ADR file. This section is the source.

The repo historically mixed `types.ts`, `*-types.ts`, and would-be `*.types.ts`.
Settle on **suffix-based naming where files are tightly related**, by role:

- **Satellite types** (types that serve exactly one sibling module) → co-locate as
  `<base>.types.ts`. Example: `disk-storage-adapter.ts` + `disk-storage-adapter.types.ts`.
- **Module-wide types** (shared across a whole folder) → keep the folder's
  `types.ts` (the pattern in `core/`, `core/substrates/`, `core/get-context/`,
  `resources/`). Do not split these into per-file satellites.
- **Shared contracts/interfaces** (an interface implemented by several modules and
  consumed widely) → name by the *contract*, not an implementation:
  `<name>.contract.ts`. Example: `IBacklogService` in
  `core/backlog-service.contract.ts` (implemented by local + D1 services).
  A port lives with its consumer (ADR 0134 R1.2).
- **Tightly-coupled siblings in general** share a base name and differ only by
  suffix (`.types.ts`, `.contract.ts`, `.test.ts`) so they sort adjacently and the
  relationship is obvious.

Apply to new and touched files; do not do a sweeping repo-wide rename (churn +
merge-conflict risk) — let legacy `types.ts` files migrate opportunistically.
