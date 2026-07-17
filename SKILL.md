---
name: install-backlog-mcp
description: Agent-directed install of backlog-mcp — detect the host harness, register the MCP server, run the first wakeup, verify git stayed clean and the briefing stayed under budget.
---

# Install backlog-mcp (instructions for the installing agent)

You are an agent installing backlog-mcp for your user. Follow these steps in
order; run everything yourself — the user should not need to do anything by hand.

What you are installing: a markdown-backed memory engine where the repo's own
`docs/` folder is the store. Reads never move or rewrite existing files; writes
land as plain markdown the user reviews in git like any other diff.

## 0. Preconditions

- `node --version` must be >= 18. If not, STOP and report — do not install Node uninvited.
- `npx` must be able to reach the npm registry (it fetches the `backlog-mcp` package).

## 1. Detect the host harness

You normally know which harness you are running in. If unsure, probe in order:

| Evidence | Host | Step |
|---|---|---|
| You are Claude Code, or `claude` is on PATH | Claude Code | 2a |
| `.cursor/` in the project or `~/.cursor/` exists | Cursor | 2b |
| `codex` on PATH or `~/.codex/config.toml` exists | Codex CLI | 2c |
| Some other MCP-capable client | Generic MCP | 2d |
| No MCP client at all | CLI-only | skip to step 3 — the CLI is the full surface |

## 2. Register the MCP server

### 2a. Claude Code

```bash
claude mcp add --scope user backlog -- npx -y backlog-mcp
```

`--scope user` makes it available in every project and leaves the repo
untouched. If the user wants the config shared with their team, use
`--scope project` instead — it writes a committed `.mcp.json` (one new file;
that file is the only expected git change). Tools appear as `backlog_*` after
the next session start.

### 2b. Cursor

Merge — do not overwrite — this block into `~/.cursor/mcp.json` (all projects)
or `<repo>/.cursor/mcp.json` (this project only), then reload MCP servers in
Cursor's settings:

```json
{ "mcpServers": { "backlog": { "command": "npx", "args": ["-y", "backlog-mcp"] } } }
```

### 2c. Codex CLI

```bash
codex mcp add backlog -- npx -y backlog-mcp
```

If the installed Codex has no `mcp add` subcommand, append to
`~/.codex/config.toml`:

```toml
[mcp_servers.backlog]
command = "npx"
args = ["-y", "backlog-mcp"]
```

If your harness's own `--help` disagrees with this file, trust the `--help`.

### 2d. Any other MCP client

Stdio transport: command `npx`, args `["-y", "backlog-mcp"]` — same JSON shape
as 2b. HTTP transport: start the daemon first (`npx -y backlog-mcp` detached,
or `npx -y backlog-mcp serve` in the foreground) and point the client at
`http://localhost:3030/mcp`.

## 3. First contact — wakeup

From the user's repo root:

```bash
npx -y backlog-mcp wakeup
```

Zero setup is expected to work: a repo with a `docs/` folder gets a
project-scoped briefing (pre-existing, non-tool markdown like bare ADRs is read
losslessly); a repo without `docs/` falls back to the user's global home
(`~/.backlog/docs`). To adopt project-scoped memory in a docs-less repo, ask
the user before creating a `docs/` folder.

Show the user the briefing verbatim, then tell them, briefly:

- The loop is four verbs: `wakeup` (orient at session start), `recall` (ask),
  `remember` (keep a durable fact), `get` (expand any id).
- Docs-native promise: nothing was moved or rewritten. The tool's writes are
  plain markdown under `docs/` that appear as ordinary git diffs; a `.backlog/`
  control dir holds only local cache and ignores itself, so git stays clean.
- A live read-only viewer runs at `http://localhost:3030` once an MCP session
  (or a bare `npx -y backlog-mcp`) has started the daemon.

## 4. Verify

Run all three and include the results in your report:

1. **Git clean** — `git status --porcelain` shows nothing new except files you
   deliberately created (a project-scope `.mcp.json`, or a memory the user
   asked for). `.backlog/` must NOT appear in the output.
2. **Briefing budget** — the wire form must be <= 3072 bytes:

   ```bash
   npx -y backlog-mcp wakeup --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=Buffer.byteLength(JSON.stringify(JSON.parse(s),null,1));console.log(b+" bytes");process.exit(b<=3072?0:1)})'
   ```

3. **Host registration** (if step 2 applied) — after a session reload the
   `backlog_*` tools are listed; in Claude Code, `claude mcp list` shows
   `backlog … connected` (this may spawn the local daemon — that is intended).

## 5. If something fails — exact fallbacks, never improvise state

- **npx cannot fetch** (offline, registry down): report it and stop. Do not
  clone the repo or vendor code as a workaround unless the user asks.
- **Port 3030 taken by an unrelated process**: set `BACKLOG_VIEWER_PORT=<port>`
  in the daemon's environment. CLI verbs need no port at all.
- **Stale daemon from an older version**: `npx -y backlog-mcp` auto-replaces
  it; if `npx -y backlog-mcp status` still shows the old version, run
  `npx -y backlog-mcp stop` and retry.
- **First recall/search is slow**: a local embedding model downloads once
  (tens of seconds). It is local-first — no cloud call. Wait, and say so.
- **A registration flag is rejected**: your harness version differs from this
  file. Use the harness's own `--help` to find the equivalent command, then
  report the deviation.
- **`wakeup` errors**: report the exact message and stop. NEVER hand-create
  store files, edit the user's docs, rename anything, or commit to make a
  step pass.

## 6. Report back

Tell the user: which host you registered (and scope), the wakeup briefing you
saw, the verify results (git clean; N bytes <= 3072), and the loop in one
sentence: start sessions with `wakeup`, ask with `recall`, keep durable facts
with `remember`, expand any id with `get`.
