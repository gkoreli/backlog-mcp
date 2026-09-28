# Development Guide

## Quick Start

Development uses Node 24 LTS via mise.

```bash
pnpm install
pnpm dev  # Starts MCP server + web viewer with hot reload (port 3040)
```

## Monorepo Structure

```
packages/
├── server/       # MCP server, CLI, HTTP API — published as `backlog-mcp`
├── viewer/       # Web UI built with `@nisli/core`
└── shared/       # Entity types, ID utilities (private, inlined at build)
```

The viewer uses [Nisli](https://github.com/gkoreli/nisli), a zero-dependency reactive Web Component framework published as [`@nisli/core`](https://www.npmjs.com/package/@nisli/core). Nisli started in this repository and now lives separately.

## Commands

### Workspace-wide

```bash
pnpm build               # Build all packages (shared → viewer → server)
pnpm test                # Run all workspace tests
pnpm test:watch          # Watch mode (server only)
pnpm dev                 # Server + viewer with hot reload (port 3040)
pnpm clean               # Remove dist/ from all packages
pnpm typecheck           # Type-check all packages
```

### Per-package

```bash
pnpm --filter backlog-mcp test          # Server tests only
pnpm --filter @backlog-mcp/viewer test  # Viewer tests only
```

### CLI

```bash
backlog-mcp              # stdio MCP server (default, for MCP clients)
backlog-mcp serve        # HTTP server with web viewer
backlog-mcp version      # Show version
backlog-mcp status       # Check server status (port, version, task count, uptime)
backlog-mcp stop         # Stop the server
```

## Server Architecture

### Production Mode (MCP Clients)

When running via `backlog-mcp` (or `pnpm start`):
- **HTTP server** spawns as a detached background process on port 3030
- **stdio bridge** runs in foreground, connects to HTTP server via `mcp-remote`
- HTTP server persists across sessions (shared by multiple MCP clients)
- Auto-restarts on version upgrades

### Development Mode

When running `pnpm dev`:
- Runs Vite as the single dev server on one port (default `:5173`)
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
  [ADR 0134](docs/adr/0134-engineering-rules.md) and enforced by
  `packages/server/src/__tests__/architecture.test.ts`

## Data Model

Entity types are **substrates** (ADR 0113): Markdown with YAML frontmatter,
stored in the selected home's documents directory (`<repo>/docs/` or
`~/.backlog/docs/`), one folder per substrate. Filenames are `<ID>-<slug>.md`,
and the slug is frozen at creation (ADR 0129).

| Substrate | Prefix | Folder | Source |
|---|---|---|---|
| task | `TASK-` | `tasks/` | built in |
| epic | `EPIC-` | `epics/` | built in |
| folder | `FLDR-` | `folders/` | built in |
| artifact | `ARTF-` | `artifacts/` | built in |
| milestone | `MLST-` | `milestones/` | built in |
| cron | `CRON-` | `crons/` | built in |
| memory | `MEMO-` | `memories/` | built in |
| adr, requirement, prompt | | `adr/`, `requirements/`, `prompts/` | packaged definitions |

A project can declare more under `docs/substrates/` (ADR 0113). Entities link
through `parent_id` and typed references.

## File Structure

`packages/server/src/`, by ADR 0134 layer:

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
├── services/      # App state, SSE client, markdown, URL state
├── utils/         # API client, date formatting
├── icons/         # SVG icon exports
├── main.ts        # App initialization
└── styles.css     # All styling
```

Nisli source and framework ADRs now live in the [Nisli repository](https://github.com/gkoreli/nisli):

- Source: <https://github.com/gkoreli/nisli/tree/main/packages/core/src>
- ADRs: <https://github.com/gkoreli/nisli/tree/main/docs/adr>

## Web Viewer Patterns

### Icons
- No emojis — use SVG icons from `viewer/icons/index.ts`
- Futuristic gradient style matching `logo.svg`

### Styling
- Components inherit colors from parent elements
- Selection states must be consistent across all item types
- Tree connectors use `::before`/`::after` pseudo-elements

### Filters
- "All" option goes last in filter lists
- Child tasks without visible parent show as orphans (not hidden)

## Testing

```bash
pnpm test           # All workspace tests
pnpm test:watch     # Watch mode (server)
```

All tests use **memfs** for in-memory filesystem mocking. See [AGENTS.md](AGENTS.md) for testing guidelines.
