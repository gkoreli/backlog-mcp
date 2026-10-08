# Development setup and runtime

Read this when installing dependencies, running local development, choosing
workspace or CLI commands, or understanding runtime topology and data layout.
These are active contributor instructions, reached from [AGENTS.md](../../AGENTS.md).
The architecture sections summarize the linked ADRs; those ADRs remain authoritative.

## Quick Start

Development and the local runtime use Bun 1.4.2, pinned in `.mise.toml`.
Run `mise install` and `mise exec -- bun --version` before installing dependencies.

```bash
bun install
bun run dev  # Starts MCP server + web viewer with hot reload (default port 5173)
```

## Monorepo Structure

Read [Packages and releases](packages-and-releases.md) when changing package
boundaries, exports, dependencies, bundling, or releases. This is an overview.

```
packages/
├── server/       # MCP server, CLI, HTTP API — published as `backlog-mcp`
├── viewer/       # Web UI built with `@nisli/core`
├── memory/       # Hybrid search and memory retrieval/ranking (private)
└── shared/       # Entity types, ID utilities (private, inlined at build)
```

The viewer uses [Nisli](https://github.com/gkoreli/nisli), a zero-dependency reactive Web Component framework published as [`@nisli/core`](https://www.npmjs.com/package/@nisli/core). Nisli started in this repository and now lives separately.

## Commands

### Workspace-wide

```bash
bun run build               # Build all packages (shared → viewer → server)
bun run test                # Run all workspace tests
bun run test:watch          # Watch mode (server only)
bun run dev                 # Server + viewer with hot reload (default port 5173)
bun run clean               # Remove dist/ from all packages
bun run typecheck           # Type-check all packages
```

### Per-package

```bash
bun run --filter backlog-mcp test          # Server tests only
bun run --filter @backlog-mcp/viewer test  # Viewer tests only
```

### CLI

`backlog wakeup` selects the nearest `.backlog/` or `.git` project boundary
from the working directory, including subdirectories and projects without
`docs/` yet. `--project-root <path>` selects an existing project directory
explicitly. For this command, `BACKLOG_HOME`, `BACKLOG_PROJECT_ROOT`, and
repository `home` settings do not select the home; documents-directory and
entity-context settings still apply inside the selected project.
Use `backlog --home global wakeup` for global work, or `--home all` for the
existing cross-home workflow. Outside a project, select a root or global
explicitly. Other CLI commands and the MCP bridge keep their existing home
resolution rules. See [ADR 0112](../adr/0112-docs-native-project-scoped-backlog.md#cli-wakeup-workspace-selection-amendment-2026-10-03).

```bash
backlog-mcp              # stdio MCP server (default, for MCP clients)
backlog-mcp serve        # HTTP server with web viewer
backlog-mcp version      # Show version
backlog-mcp status       # Check server status (port, version, task count, uptime)
backlog-mcp stop         # Stop the server
```

## Server Architecture

### Production Mode (MCP Clients)

When running via `backlog-mcp` (or `bun run start`):

- **HTTP server** spawns as a detached background process on port 3030
- **stdio bridge** runs in foreground, connects to HTTP server via `mcp-remote`
- HTTP server persists across sessions (shared by multiple MCP clients)
- Auto-restarts on version upgrades

### Development Mode

When running `bun run dev`:

- Runs Vite as the single dev server on one port (default `:5173`, overridden
  by `VITE_PORT`; Vite may use the next available port if it is occupied)
- Vite serves the SPA + assets + HMR natively
- The Hono backend (API/SSE/MCP) is loaded via Vite's SSR module graph as a fallback handler
- Single origin — mirrors prod topology (no proxy, no second process)
- Component edits hot-swap in place via `@nisli/core/vite-hmr`
- Ctrl+C cleanly shuts down
- Reads env from root `.env` file (loaded via Vite's `loadEnv`)

## Architecture Principles

- **The viewer is a window, not an editor** — entity writes happen through the
  agent surfaces (MCP intents and the CLI); the viewer reads and manages the
  daemon (restart, recent homes)
- **Real-time updates** — SSE pushes changes to the web viewer
- **Agent-first** — MCP and the CLI are both agent surfaces over one core;
  which one is primary is an open decision (EPIC-0001, TASK-0012)
- **Binding engineering rules** — layers, ports, and DDD rules are in
  [ADR 0134](../adr/0134-engineering-rules.md) and enforced by
  `packages/server/src/__tests__/architecture.test.ts`

## Data Model

Entity types are **substrates** ([ADR 0113](../adr/0113-user-defined-substrates.md)): Markdown with YAML frontmatter,
stored in the selected home's documents directory (`<repo>/docs/` or
`~/.backlog/docs/`), one folder per substrate. Filenames are `<ID>-<slug>.md`,
and the slug is frozen at creation ([ADR 0129](../adr/0129-semantic-filenames-id-plus-slug.md)).

Built-in substrates, with ID prefix and folder:

- **task:** `TASK-`, `tasks/`.
- **epic:** `EPIC-`, `epics/`.
- **folder:** `FLDR-`, `folders/`.
- **artifact:** `ARTF-`, `artifacts/`.
- **milestone:** `MLST-`, `milestones/`.
- **cron:** `CRON-`, `crons/`.
- **memory:** `MEMO-`, `memories/`.
- **adr:** `ADR `, `adr/` (including engine-allocated `x.n` threads).

Packaged definitions: **requirement** and **prompt** in `requirements/` and
`prompts/`, respectively. ADR is a compiled built-in substrate.

A project can declare more under `docs/substrates/` (ADR 0113). Entities link
through `parent_id` and typed references.

## File Structure

`packages/server/src/`, by ADR 0134 layer (see also the
[engineering guide](engineering.md) when changing code or file naming):

```
core/                   Domain: pure functions, domain types, ports (*.contract.ts)
  substrates/           Substrate compiler, registry, intent execution, storage identity
  get-context/          Relational context expansion
  requirements/         Requirement constraint stubs
substrate-definitions/  Built-in and packaged substrate declarations (domain data)
storage/                Infrastructure: docs-native filesystem storage, D1, git probes
memory/                 Infrastructure: memory store, usage tracking, telemetry
operations/             Infrastructure: operation journal
resources/              Infrastructure: resource manager
events/                 Infrastructure: event bus
auth/                   Infrastructure: OAuth for the Worker deployment
composition/            The per-home runtime every adapter shares (ADR 0134.1 R3)
cli/                    Adapter: the `backlog` CLI, stdio bridge, supervisor
tools/                  Adapter: MCP tools and compiled substrate intents
server/                 Adapter: Hono HTTP app, MCP endpoint, viewer routes
utils/                  Frozen (ADR 0134 R4.3): no new files
node-server.ts, dev-entry.ts, worker-entry.ts   Process entry points (composition)

packages/viewer/
├── components/    # Web components
├── services/      # App state, SSE client, URL state
├── utils/         # API client, date formatting
├── icons/         # SVG icon exports
├── markdown/      # Markdown rendering and syntax highlighting
├── theme/         # Tsa tokens and dark/light theme values
├── main.ts        # App initialization
└── styles.css     # App layout styling (theme and markdown CSS are colocated)
```

Nisli source and framework ADRs now live in the [Nisli repository](https://github.com/gkoreli/nisli):

- Source: <https://github.com/gkoreli/nisli/tree/main/packages/core/src>
- ADRs: <https://github.com/gkoreli/nisli/tree/main/docs/adr>

## Web Viewer Patterns

Read the [viewer guide](viewer.md#web-viewer-patterns) when changing icons,
styling, or filters. It owns the contributor patterns previously listed here.

## Testing

```bash
bun run test           # All workspace tests
bun run test:watch     # Watch mode (server)
```

Read [Testing and memfs](testing.md) when adding, changing, or running
tests, or investigating failures. It covers mocking, the read-only repository/git
probe exception, and debugging patterns.

For end-user setup, use [Installation](installation.md). Home selection and
migration live in [Homes and configuration](homes-and-configuration.md);
[the documentation map](../README.md) lists current topic owners.
