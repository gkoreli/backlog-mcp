# CLI and MCP

Read for setup, home selection, invocation, and managed writes. Examples reflect
the local implementation, including unreleased declared action dispatch; the installed CLI help and selected MCP tool's
full input schema determine what is available. Do not infer commands from ADR plans.

## Choose an available interface

Use the project's existing MCP connection or `backlog` executable. If the package
is available through npx, `npx backlog-mcp <command>` runs the same CLI. Installing
or upgrading is a separate task; ordinary retrieval does not require reinstallation.
An MCP stdio configuration is:

```json
{
  "mcpServers": {
    "backlog": { "command": "npx", "args": ["-y", "backlog-mcp"] }
  }
}
```

With no subcommand, this launches the stdio bridge to the persistent local daemon.
Client configuration files and registration commands depend on the host agent.

## Select one home deliberately

Project documents live under `<project-root>/docs/`, with derived state under
`.backlog/`. Global documents live under `~/.backlog/docs/`. Do not put substrate
definitions in the control directory. Use explicit selection in scripts:

```bash
backlog --home project --project-root /absolute/repo --json list --type adr --limit 10
backlog --home project --project-root /absolute/repo get 'ADR 0106.5' --context
backlog --home global recall 'release procedure' --limit 5
```

MCP tools exposing `home` and `project_root` accept equivalent selection fields;
read their full schemas. Generated actions may use the connection's selected
home instead of listing those transport fields themselves. Do not invent inputs.
Check connection/bridge selection before writing an action without home fields.
`home=all` is supported only by wakeup, recall, and search: global plus one
selected project, never all previously visited projects, and never a write target.

CLI wakeup discovers the nearest `.backlog/` or `.git` project boundary and ignores
home/root environment defaults; pass `--project-root` or `--home global` when needed.
Other commands retain their own selection defaults. A retrieval `context` is an
entity ID inside a home, not a project path or a substitute for home selection.

## Retrieve progressively

```bash
backlog --home project --project-root /absolute/repo wakeup
backlog --home project --project-root /absolute/repo recall 'storage correction' --limit 5
backlog --home project --project-root /absolute/repo search 'storage correction' --types adr
backlog --home project --project-root /absolute/repo get 'ADR 0135' --context
```

MCP counterparts are `backlog_wakeup`, `backlog_recall`, `backlog_search`,
`backlog_list`, and `backlog_get`. Get accepts `id` (a string or array), while CLI
get takes positional IDs. MCP `context: true` maps to CLI get `--context`.
List/search are bounded results, not complete inventories. Memories are hidden
from ordinary list/search; explicitly list `type=memory` or use recall.

## Managed writes through declared actions

MCP exposes declared actions such as `backlog_create_work`, `backlog_complete_task`,
and project-defined actions compiled from `intents`. Discover the actual name and
inputs. For example, task completion can carry `evidence: ["Fixed in PR #45"]`;
blocking requires `blocked_reason`, an array of reasons in the built-in contract.

CLI exposes `actions [type]` to discover the selected home's catalog and exact
JSON input schemas. `act <tool-name-or-type.verb> --input '<JSON object>'` calls
the same core executor as MCP; for example:

```bash
backlog --home project --project-root /absolute/repo --json actions task
backlog --home project --project-root /absolute/repo --json act task.complete \
  --input '{"id":"TASK-0001","evidence":["Fixed in PR #45"]}'
```

Inspect the installed help first: older versions lack this dispatcher. Unsupported
mechanics are marked non-executable in discovery. Legacy generic `create` and
`update` remain available, and their migration is pending; generic status updates
do not enforce declared transitions. Use declared actions for lifecycle changes
and `remember` for coordinated memory corrections. Native Markdown editing can
follow the project's explicit authoring conventions.

For ordinary document creation on today's CLI, inspect `create --help` and the
selected substrate's schema. This spelling does not authorize arbitrary lifecycle changes:

```bash
backlog --home project --project-root /absolute/repo --json \
  create 'Investigate startup' --type task --parent EPIC-0002 -F notes.md
```

`-F/--body-file` reads a body file; `-F -` reads stdin. It is exclusive with
`--content` and its `--source` alias. `--fields` accepts one JSON object for
substrate-specific fields. These flags belong to create, not remember.
Use `remember`, not generic create/update/edit, for memory knowledge and corrections.

## Interpret the outcome

Use `--json` for automation. Document writes can return `home`, `home_id`, and
`source_path`; read the actual receipt rather than guessing a filename. Successful
primary writes can carry warnings for failed derived effects. Preserve a committed
write and inspect its ID before retrying; a blind retry can create a duplicate.
MCP delete's current text can say "Deleted" even for an absent ID; check structured
`deleted` or verify the result instead of treating that string as deletion evidence.

Agent attribution uses an explicit CLI `--as` / MCP `as` where offered, then
worktree git config, `BACKLOG_AGENT`, checkout config, and user config. Use the
established identity; do not stamp a shared checkout merely for one session.
