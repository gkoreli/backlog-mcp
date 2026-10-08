# backlog-mcp

A local-first, Markdown-backed engine for agent context and memory.
Tasks, decisions and memories share one store across MCP clients, the CLI
and a live read-only viewer. Humans can read, edit and diff the files directly.

Entities are Markdown with YAML frontmatter. A project’s substrate declarations
own its types, fields and workflows. Local hybrid search combines text and
embeddings; progressive disclosure keeps orientation small and expands content
when the agent needs it.

![backlog-mcp viewer](https://raw.githubusercontent.com/gkoreli/backlog-mcp/main/backlog-viewer-ui.png)

## Install

Requires [Bun](https://bun.sh/docs/installation) 1.4.2 or newer.

Add this to `.mcp.json` or your MCP client configuration:

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

For agent-assisted setup, ask your agent to read and follow the
[installation skill](https://github.com/gkoreli/backlog-mcp/blob/main/SKILL.md).
The default command starts a persistent local HTTP server and bridges MCP stdio
requests to it. See [installation and server lifecycle](https://github.com/gkoreli/backlog-mcp/blob/main/docs/guides/installation.md).

## Quick start

From your project directory, explicitly select its home (even without `docs/` yet):

```bash
bunx --bun backlog-mcp --home project --project-root . wakeup
bunx --bun backlog-mcp --home project --project-root . create "Fix authentication flow" --content "Investigate the failing login."
bunx --bun backlog-mcp --home project --project-root . list --type task
bunx --bun backlog-mcp --home project --project-root . recall "authentication decisions"
bunx --bun backlog-mcp --home project --project-root . remember "Describe one verified durable login convention." --title "Login convention" --layer semantic
```

For MCP task work, discover and inspect the full schemas of
`backlog_create_work`, `backlog_start_task` and `backlog_complete_task`.
The Markdown body field is `content`; declarations may add required fields.

Wake up once at session start. Recall when prior knowledge matters, inspect its
age and correction lineage, then expand selected entities with `backlog_get`
(`context: true` includes relation stubs). Remember one durable fact per memory;
correct an old fact with `supersedes` or `state_key`.
See the [memory protocol](https://github.com/gkoreli/backlog-mcp/blob/main/docs/guides/memory-protocol.md).

## Viewer

Open [localhost:3030](http://localhost:3030) while the server is running.
The [Desk](http://localhost:3030/desk) surfaces at most seven attention items
with provenance and copy-ready instructions for your agent. The viewer provides
search, entity detail, activity and live updates; edits flow through your agent
or native Markdown files. See [viewer usage](https://github.com/gkoreli/backlog-mcp/blob/main/docs/guides/viewer-usage.md).

## Documentation

- [Documentation map](https://github.com/gkoreli/backlog-mcp/blob/main/docs/README.md): users, contributors and historical decisions.
- [Commands and entities](https://github.com/gkoreli/backlog-mcp/blob/main/docs/guides/commands-and-entities.md).
- [Homes, configuration and migration](https://github.com/gkoreli/backlog-mcp/blob/main/docs/guides/homes-and-configuration.md).
- [Claude Code session hooks](https://github.com/gkoreli/backlog-mcp/blob/main/docs/guides/claude-code-hooks.md).
- [Development](https://github.com/gkoreli/backlog-mcp/blob/main/docs/guides/development.md), [testing](https://github.com/gkoreli/backlog-mcp/blob/main/docs/guides/testing.md) and [releases](https://github.com/gkoreli/backlog-mcp/blob/main/docs/guides/packages-and-releases.md).
- [ADR index](https://github.com/gkoreli/backlog-mcp/blob/main/docs/adr/README.md) and [product direction](https://github.com/gkoreli/backlog-mcp/blob/main/docs/NORTH-STAR.md).

Local Markdown remains the source of truth. Legacy Workers/D1 hosting is retained
and descoped; see the [installation guide](https://github.com/gkoreli/backlog-mcp/blob/main/docs/guides/installation.md#self-hosting-legacy-descoped).

MIT licensed. [npm package](https://www.npmjs.com/package/backlog-mcp) ·
[Maintainer’s engineering story](https://gkoreli.com/one-hundred-pull-requests).
