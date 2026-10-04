# AGENTS.md — backlog-mcp

backlog-mcp is a local-first, markdown-backed engine for agent context and
memory. Tasks, decisions, and memories share one store, used through the CLI,
MCP, and a live read-only viewer. Humans can read, edit, and diff the markdown
without the tool.

## Critical constraints

- Preserve human-visible markdown and one source of truth. No LLM in the server
  write path. Local mode grows; D1/Workers is descoped, retained with no parity
  owed. Never compromise local capabilities for D1 parity.
- For code changes, follow [ADR 0134](docs/adr/0134-engineering-rules.md):
  transport-free business logic in core, thin peer adapters, injected ports,
  modular typed code. Fix architecture violations; never grow the allowlist.
- Unit tests only, with mocked external dependencies and memfs. Repository/git
  probes may read real files via `vi.importActual('node:fs')`, never write them.
  Read the testing guide for any test work, including running and debugging.
- User-facing changes need a `CHANGELOG.md` entry; every version bump updates
  the changelog in the same change. See the packages and releases guide.
- Before calling a tool, expand its full input schema. Discovery summaries are
  not argument contracts; the shared Markdown body field is `content`.

## Minimal memory loop

- Wake once at session start: `backlog_wakeup` / `backlog wakeup`. Do not repeat
  during ordinary work. After context loss, recover from the durable work record;
  wakeup with `operation` can restore a known live operation.
- Recall when prior knowledge matters, once per topic: `backlog_recall` /
  `backlog recall "<topic>"`. Search the current corpus with `backlog_search`;
  expand selected entities with `backlog_get` (`context: true` for relation stubs).
- Inspect age, provenance, and correction lineage. Current user direction,
  project decisions, and verified contracts outweigh stale memories.
- Remember durable, non-obvious facts with `backlog_remember`, one fact per
  memory. Correct with `supersedes` or `state_key`; never duplicate contradictions.

## Read on demand

Choose the links that match the task; this is a discovery map, not a read-all list.
The guides are active instructions. Existing ADRs remain authority for their rules.

- [Product direction](docs/NORTH-STAR.md) — Read this when assessing product scope, priorities, or architectural tradeoffs.
- [Development setup and runtime](docs/guides/development.md) — Read this when installing dependencies, running local development, choosing workspace/CLI commands, or understanding runtime topology and data layout.
- [Testing and memfs](docs/guides/testing.md) — Read this when adding, changing, or running tests, or investigating failures.
- [Engineering and file naming](docs/guides/engineering.md) — Read this when writing, reviewing, moving, or refactoring code, or resolving architecture failures; includes the convention labelled “ADR 0109” (no ADR file exists).
- [Viewer styling and markdown](docs/guides/viewer.md) — Read this when changing components, themes, styles, markdown, highlighting, or viewer bundle size.
- [Development loop](docs/guides/development-loop.md) — Read this when researching, designing, planning, implementing, or validating features or architecture; includes manual fail-closed validation for untrusted or per-home/tenant inputs.
- [Memory protocol](docs/guides/memory-protocol.md) — Read this when using backlog knowledge/entities/tool schemas, capturing or correcting memories, consolidating, or recovering context.
- [Packages and releases](docs/guides/packages-and-releases.md) — Read this when changing package boundaries, dependencies, exports, builds, deployment assumptions, user-facing behavior, changelog, versions, or publishing.
