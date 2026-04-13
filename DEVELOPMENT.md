# Development Guide

## Quick Start

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
- Runs HTTP server directly in foreground on port 3040
- Uses `tsx watch` for hot reload on file changes
- Ctrl+C cleanly shuts down
- Reads port from `.env` file (`BACKLOG_VIEWER_PORT`)

## Architecture Principles

- **UI is read-only** — all mutations happen via MCP tools from the LLM
- **Real-time updates** — SSE pushes changes to the web viewer
- **MCP-first** — designed for agents, the viewer is a human window into agent work

## Data Model

5 entity types, all stored as markdown files with YAML frontmatter in a single `tasks/` directory:

| Type | Prefix | Purpose |
|------|--------|---------|
| Task | `TASK-0001` | Work items |
| Epic | `EPIC-0001` | Groups of related tasks |
| Folder | `FLDR-0001` | Organizational containers |
| Artifact | `ARTF-0001` | Attached outputs (research, designs) |
| Milestone | `MLST-0001` | Time-bound targets with due dates |

Entities can have `parent_id` (any entity) and `epic_id` (epic membership). References are `{url, title}` objects.

## File Structure

```
packages/server/src/
├── cli/           # CLI commands (bridge, supervisor, server-manager)
├── context/       # 5-phase agent context hydration pipeline
├── events/        # Event bus (SSE real-time updates)
├── middleware/     # Auth middleware
├── operations/    # Operation logging middleware
├── resources/     # MCP resource manager, URI operations
├── search/        # Orama search, embeddings, scoring, tokenizer
├── server/        # Fastify HTTP, MCP handler, viewer routes
├── storage/       # Task storage, backlog service, entity factory
├── substrates/    # Entity type system backend
├── tools/         # 7 MCP tools (list, get, create, update, delete, search, context)
└── utils/         # Logger, paths, date

packages/viewer/
├── components/    # 18 web components
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
