# Installation and server lifecycle

Install [Bun](https://bun.sh/docs/installation) 1.4.2 or newer. The local CLI
and daemon require Bun; Node is not a runtime alternative.

Add to your MCP config (`.mcp.json` or your MCP client config):

```json
{
  "mcpServers": {
    "backlog": {
      "command": "bunx",
      "args": ["--bun", "backlog-mcp"]
    }
  }
}
```

### Install by telling your agent

The whole setup is one message to your agent:

> Read https://raw.githubusercontent.com/gkoreli/backlog-mcp/main/SKILL.md and follow it to install backlog-mcp.

[SKILL.md](../../SKILL.md) is written for the agent, not for you: it detects the host harness (Claude Code, Cursor, Codex, any MCP client, or plain CLI), registers the server, runs the first `wakeup` against your repo, and verifies that git stayed clean and the briefing stayed under budget.

## How It Works

Running `bunx --bun backlog-mcp` (the default MCP config) does the following:

1. **Starts a persistent HTTP server** as a detached background process — serves both the MCP endpoint (`/mcp`) and the web viewer (`/`) on port 3030
2. **Bridges stdio to it** — your MCP client communicates via stdio, which gets forwarded to the HTTP server via `mcp-remote`
3. **Version-aware startup**: if the installed package is newer than the running server, startup replaces the older daemon. Package installation/update and daemon restart are separate steps; `--bun` runs the executable under Bun, including executables with Node shebangs
4. **Resilient recovery**: If the bridge loses connection, a supervisor restarts it with exponential backoff (up to 10 retries). Connection errors like `ECONNREFUSED` are detected and handled automatically

The HTTP server persists across agent sessions — multiple MCP clients can share
it. Each request selects its own backlog home, so one daemon can serve the
global `~/.backlog/docs/` and several projects without mixing their state. With
no explicit home or configuration override, a discovered repository with a
`docs/` directory selects the project home; otherwise selection falls back to
global. The web viewer is always available at
`http://localhost:3030`.

## Manage the local server

```bash
bunx --bun backlog-mcp status
bunx --bun backlog-mcp stop
bunx --bun backlog-mcp version
bunx --bun backlog-mcp serve  # foreground server
```

The detached daemon binds to loopback. Treat it as a trusted local service:
request-supplied project roots select local capabilities, not remote tenants.
See [Homes and configuration](homes-and-configuration.md) for selection and migration,
and [Viewer usage](viewer-usage.md) for the read-only interface.

## Self-hosting (legacy, descoped)

A Cloudflare Workers + D1 build exists for an always-on remote endpoint, but it is **descoped** — retained, not evolved. It lacks local embeddings, hybrid-search/RAG parity, and agentic memory, and no new capability targets it. Local-first is the architecture; remoteness is meant to be reached by **syncing local stores**, not by promoting a remote database to the source of truth.

If you specifically need the legacy remote mode, its Workers config lives in `packages/server/wrangler.jsonc` and its schema in `packages/server/migrations/`. Deploy with `bunx --bun wrangler deploy` from `packages/server`, then point an MCP client at it via `mcp-remote https://<your-worker>.workers.dev/mcp`.
