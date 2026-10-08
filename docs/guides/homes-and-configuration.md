# Homes and configuration

A home is one Markdown corpus and its derived local state. Global documents live
in `~/.backlog/docs/`; a project home uses its selected `docs/` directory and
ignored `.backlog/` control state. Each request owns its selection. `--home all`
reads global plus one supplied project, not every recent project.

## Environment defaults

```bash
BACKLOG_VIEWER_PORT=3030       # HTTP server port
BACKLOG_HOME=project           # Optional caller default: project or global
BACKLOG_PROJECT_ROOT=/path     # Optional explicit project root
BACKLOG_CONTEXT=FLDR-0001      # Optional entity context inside the home
```

CLI `wakeup` uses the current project's nearest `.backlog/` or `.git` boundary,
even without `docs/`, and ignores the home/root environment defaults above.
Use `--project-root <path>` to select a project explicitly, `--home global`
for global work, or `--home all` for cross-home orientation. Outside a project,
an explicit selection is required. Other commands retain their existing defaults.

Create a `.env` file for local development — see [`.env.example`](../../.env.example).

### Agent identity (the attribution ladder)

Writes attribute to an agent identity — an `AGENT-` doc id or a declared
principal like `aime:granite` — configured **once** at the scope it belongs
to, exactly like git identity itself
([ADR 0119.1](../adr/0119.1-implicit-identity-capture.md)):

```bash
git config extensions.worktreeConfig true         # once per repo: enables worktree stamps
git config --worktree backlog.agent aime:granite  # this delegation worktree IS this agent
BACKLOG_AGENT=aime:granite                        # this harness session (settings env block)
git config backlog.agent aime:granite             # this checkout — single-agent checkouts only
git config --global backlog.agent goga            # machine-wide standing default
```

First present rung wins, most deliberate first: explicit `--as` / MCP `as` →
worktree config → `BACKLOG_AGENT` → checkout config → user config → absent.
The worktree stamp deliberately beats the environment: a spawned agent
inherits its parent's env through no choice of its own, while the stamp was
placed for it at delegation time. The wakeup meta line always names the
winning rung — `identity: granite (worktree config)` — and stays an honest
`identity: absent` when nothing is configured. One anti-pattern: never stamp
a **shared** checkout (a directory both you and an agent work in) — identity
there belongs to the session env, which scopes to the session, not the
directory.

## Docs-native migration

Stop the detached server before migrating an existing global backlog:

```bash
bunx --bun backlog-mcp stop
bunx --bun backlog-mcp --home global migrate docs-native --dry-run
bunx --bun backlog-mcp --home global migrate docs-native
```

This routes the old flat `~/.backlog/tasks/` Markdown into
`~/.backlog/docs/`, moves tool-owned state, and rebuilds derived caches. A
retired custom root can be supplied for this command only:

```bash
BACKLOG_DATA_DIR=/path/to/old/backlog \
  bunx --bun backlog-mcp --home global migrate docs-native
```

For a project that already has the old control directory, migrate only its
tool-owned state; committed `docs/` is never touched:

```bash
bunx --bun backlog-mcp --home project --project-root /path/to/repo \
  migrate docs-native
```

Both commands are idempotent and fail closed when old and new control layouts
are both present.
