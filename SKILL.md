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
- Record `git status --porcelain` before installation so verification can
  distinguish existing changes from installation effects.

## 1. Detect the host harness

Use the harness identified by the user or the active session. Installed
executables show availability, not which harness is active. If the host is
unknown, establish it before choosing a registration target:

| Evidence | Host | Step |
|---|---|---|
| Active session or user identifies Claude Code | Claude Code | 2a |
| Active session or user identifies Cursor | Cursor | 2b |
| Active session or user identifies Codex CLI | Codex CLI | 2c |
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
backlog_briefing=$(npx -y backlog-mcp wakeup --json)
```

Check that the command succeeded before continuing; retain its JSON for the
budget check below. Show the captured briefing to the user.

Without an explicit home or configuration override, a discovered repo with a
`docs/` folder gets a project-scoped briefing (pre-existing, non-tool markdown like bare ADRs is read
losslessly); a repo without `docs/` falls back to the user's global home
(`~/.backlog/docs`). To adopt project-scoped memory in a docs-less repo, ask
the user before creating a `docs/` folder.

After showing the captured briefing, explain briefly:

- Retrieval is `wakeup` (orient), `recall` / `search` (ask), `get` (expand).
  `remember` keeps a durable fact; `forget` retracts one. Read a selected
  tool's full schema when calling it; discovery summaries omit argument detail.
- Docs-native promise: nothing was moved or rewritten. The tool's writes are
  plain markdown under `docs/` that appear as ordinary git diffs; a `.backlog/`
  control dir holds configuration, caches and runtime state journals. Runtime
  cache/state paths are ignored; project configuration may be tracked.
- A live read-only viewer runs at `http://localhost:3030` once an MCP session
  (or a bare `npx -y backlog-mcp`) has started the daemon.

## 4. Verify

Run all three and include the results in your report:

1. **Git clean** — `git status --porcelain` shows nothing new except files you
   deliberately created (a project-scope `.mcp.json`, or a memory the user
   asked for). Compare with the pre-install state: existing tracked `.backlog/`
   configuration is legitimate; generated caches and state must stay ignored.
2. **Briefing budget** — the wire form must be <= 3072 bytes:

   ```bash
   printf '%s' "$backlog_briefing" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=Buffer.byteLength(JSON.stringify(JSON.parse(s),null,1));console.log(b+" bytes");process.exit(b<=3072?0:1)})'
   ```

3. **Host registration** (if step 2 applied) — after a session reload the
   `backlog_*` tools are listed; in Claude Code, `claude mcp list` shows
   `backlog … connected` (this may spawn the local daemon — that is intended).

## 5. If something fails — exact fallbacks, never improvise state

- **npx cannot fetch** (offline, registry down): report it and stop. Do not
  clone the repo or vendor code as a workaround unless the user asks.
- **Port 3030 taken by an unrelated process**: set `BACKLOG_VIEWER_PORT=<port>`
  in the daemon's environment. CLI verbs need no port at all.
- **Stale daemon from an older version**: startup replaces it when the
  installed package is newer. Check `npx -y backlog-mcp version` and
  `npx -y backlog-mcp status` to
  distinguish the installed package from the running daemon before retrying.
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
