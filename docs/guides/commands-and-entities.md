# Commands and entities

These examples orient readers; the registered tool schema and `backlog --help`
are the argument contracts. Expand each MCP tool’s full input schema before
calling it. The Markdown body field is `content`.

## Substrates (Entity Types)

7 built-in substrate types, each declared once and stored as markdown files with YAML frontmatter. New types cost one declaration — the catalog is open-ended by design.

- Task (`TASK-`): work items.
- Epic (`EPIC-`): groups of tasks.
- Folder (`FLDR-`): organizational containers.
- Artifact (`ARTF-`): research, designs and other outputs.
- Milestone (`MLST-`): time-bound targets.
- Cron (`CRON-`): intake descriptors executed by an external scheduler.
- Memory (`MEMO-`): durable knowledge with provenance and correction lineage.

**Built-in work status values:** `open`, `in_progress`, `blocked`, `done`,
`cancelled`. Status fields and transitions belong to each substrate; project
declarations can define other vocabularies, and some types have no workflow.

Beyond the built-ins, a project can **declare its own substrate types as data** — a versioned JSON definition plus a bounded JSON Schema (Draft 2020-12), never executable code. Built-in and project-defined types share one project-scoped registry, so the catalog grows without touching storage, search, or the viewer (ADR 0113).

Example task file:

```markdown
---
id: TASK-0001
title: Fix authentication flow
status: open
parent_id: EPIC-0002
references:
  - url: https://github.com/org/repo/issues/123
    title: Related issue
evidence:
  - Fixed in PR #45
---

The authentication flow has an issue where...
```

## MCP Tools

### Memory (the core loop)

Four verbs, zero ceremony — orient, ask, keep, correct. Memories are first-class entities (`MEMO-` ids), hidden from ordinary `list`/`search` results; `recall` is their dedicated retrieval surface. `list type="memory"` explicitly includes them.

```
backlog_wakeup                            # Orient: one dense briefing (active work, top knowledge)
backlog_wakeup operation="OP-0001"        # Orient mid-flight: that operation's live state leads the briefing (goal, next action, constraints)
backlog_recall query="how do we release?" # Ask: hybrid-ranked recall, returns stubs to expand
backlog_remember title="Release procedure" content="..." layer="procedural" # Keep one atomic fact
backlog_forget ids=["MEMO-0042"]           # Retract: soft-expire (stays auditable in the viewer)
```

The briefing ends with a two-line memory protocol (when to recall, when to remember) and enforces a hard byte ceiling with a deterministic yield ladder — constraints never yield.

Retrieval is one language: **orient** (`wakeup`) → **ask** (`recall` / `search`) → **expand** (`backlog_get id=… context=true`).

Use `remember` with `supersedes="MEMO-0042"` when replacing a memory with a
corrected fact; `forget` retracts knowledge without a replacement.

### backlog_list

```
backlog_list                              # Recent entities, up to 20; no default status filter
backlog_list type="task" status=["open","in_progress","blocked"] # Active tasks
backlog_list type="task" status=["done"]  # Completed tasks
backlog_list type="epic"                  # Only epics
backlog_list parent_id="EPIC-0002"        # Tasks in an epic
backlog_list parent_id="FLDR-0001"        # Items in a folder
backlog_list query="authentication"       # Search across all fields
backlog_list counts=true                  # Include counts by status/type
backlog_list limit=50                     # Limit results
```

### backlog_get

```
backlog_get id="TASK-0001"                # Single item
backlog_get id=["TASK-0001","EPIC-0002"]  # Batch get
backlog_get id="TASK-0001" context=true   # Item + neighborhood stubs (parent/children/siblings/refs/referenced_by/related)
```

### Intent writes

Discover the verb, then read its complete input schema before constructing
arguments. Loading and deferral depend on the MCP client; a shortened tool
description is not its argument contract. The body field is `content`.

```
backlog_create_work title="Fix bug" content="Details..." parent_id="EPIC-0002"
backlog_start_task id="TASK-0001"
backlog_complete_task id="TASK-0001" evidence=["Fixed in PR #45"]
backlog_block_task id="TASK-0001" blocked_reason=["Waiting on API"]
backlog_plan_epic title="Q1 Goals" content="Quarterly outcomes"
backlog_organize_folder title="Research"
backlog_attach_artifact title="Findings" content="..." parent_id="TASK-0001"
backlog_target_milestone title="v2.0 Release" due_date="2026-03-01"
backlog_schedule_cron title="Weekly review" schedule="0 9 * * 1" command="..."
backlog_propose_adr title="Choose storage" content="..."
backlog_capture_requirement title="Local-first" content="No cloud dependency"
backlog_capture_prompt title="Founder directive" content="..."
```

Transitions have matching narrow verbs (`backlog_pause_cron`,
`backlog_resume_cron`, `backlog_accept_adr`, and `backlog_supersede_adr`). The
MCP surface intentionally has no generic create/update dialect: the active
substrate registry exposes only declared semantic intents. Operators retain
the low-level `backlog create` / `backlog update` CLI escape hatch for rare or
undeclared substrates.

### backlog_delete

```
backlog_delete id="TASK-0001"             # Permanent delete
```

### backlog_search

Full-text + semantic hybrid search with relevance scoring:

```
backlog_search query="authentication bug"
backlog_search query="design decisions" types=["artifact"]
backlog_search query="blocked tasks" status=["blocked"] limit=10
backlog_search query="framework" sort="recent"
backlog_search query="search ranking" include_content=true
```

### write_resource

Use native file editing for ordinary repository prose. Use `write_resource`
when an existing entity edit needs schema validation and canonical persistence
before success is returned. It edits the Markdown body. Create and transition
entities through the substrate-declared intent verbs above.

```
# Edit task body (use str_replace — protects frontmatter)
write_resource id="TASK-0001" \
  operation={type: "str_replace", old_str: "old text", new_str: "new text"}

# Insert after a specific line
write_resource id="TASK-0001" \
  operation={type: "insert", insert_line: 5, new_str: "inserted line"}

# Append to an existing artifact's body
write_resource id="ARTF-0001" \
  operation={type: "append", new_str: "New entry"}
```

Operations: `str_replace` (exact match, must be unique), `insert` (after line number), `append` (end of file).

## CLI bodies and write receipts

Writes say where they landed. `create`, `update`, `edit`, `delete`, and
`remember` print a second line naming the home and the file, and `--json` adds
the same `home`, `home_id`, and `source_path` fields the HTTP API returns:

```
$ backlog create "Investigate slow startup" -F notes.md
Created TASK-0042
  project home ~/code/app: docs/tasks/TASK-0042-investigate-slow-startup.md
```

For `create`, a body can come from `--content`, from any file you can read with
`-F/--body-file <file>` (as with `gh --body-file` and `git commit -F`), or
from stdin with `-F -`:

```bash
backlog create "Release notes" -F - <<'EOF'
## What changed
EOF
```


See [Memory protocol](memory-protocol.md) for recall/correction discipline and
[Homes and configuration](homes-and-configuration.md) for command selection.
