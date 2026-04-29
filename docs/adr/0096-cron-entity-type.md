---
title: "Cron Entity Type — Scheduled Task Intake"
date: 2026-04-28
status: Superseded
superseded_by: [0097, 0097.1, 0098]
---

> **Status note (2026-04-28)**: This ADR is superseded. It is preserved
> as a record of the first-draft design and the reasoning that led to
> the reframing.
>
> Key decisions reversed by ADR 0097 + 0097.1 + 0098:
>
> 1. **Scheduler location** — 0096 proposed running an in-process
>    scheduler inside backlog-mcp and executing user-defined plugin
>    commands. ADR 0097 reframed backlog-mcp as a **storage engine,
>    never an orchestrator**. The scheduler is an external process
>    (MCP client); backlog-mcp stores cron entities and renders them,
>    nothing more.
> 2. **`status` vs `enabled`** — 0096 proposed overloading `status`
>    with cron lifecycle semantics (`blocked` = errored,
>    `cancelled` = paused, `done` = retired). ADR 0097.1 introduced a
>    **separate `enabled` field**. Reason: a cron can be
>    `enabled=true status=done` (completed intake preserved for audit)
>    or `enabled=false status=open` (paused but still active work) —
>    semantics that cannot coexist on a single field.
> 3. **Deduplication** — 0096 put dedup logic inside backlog-mcp.
>    ADR 0097 pushes dedup to the external scheduler; the storage
>    engine stays domain-agnostic.
> 4. **Cloud mode** — 0096 required HTTP webhook plugins for the
>    Workers deployment. With the scheduler external, the cloud path
>    just stores cron entities like any other; no special handling.
>
> The fields landed here (`schedule`, `command`, `last_run`,
> `next_run`) are correct and unchanged. ADR 0097.1 added one more:
> `enabled`. The final architecture lives in
> [ADR 0098](./0098-unified-substrate-architecture.md) — cron as one
> substrate among the rest.

# 0096. Cron Entity Type — Scheduled Task Intake

## Context

backlog-mcp is an agentic backlog where agents create tasks, track progress, and attach
artifacts. Humans observe via a read-only web viewer. All mutations flow through the agent
harness (MCP tools or CLI). This architecture tenet — **agents mutate, viewer observes,
humans steer agents** — applies to everything.

Currently, tasks enter the backlog only when an agent or human explicitly creates them.
There is no automated intake mechanism. For workflows like code review triage, oncall
queue monitoring, or GitHub PR tracking, someone must manually trigger the agent to check
for new work and create tasks.

The co-review automation vision (ARTF-0189) identified this gap: the backlog needs a way
to fill itself with work that needs doing, on a schedule, without human intervention for
each individual task.

## Problem Space

We need scheduled task creation that:

1. **Stays true to the architecture** — agents have full visibility and control over the
   scheduling configuration. The viewer displays it read-only. No hand-edited config files.
2. **Is domain-agnostic** — backlog-mcp doesn't know about code reviews, oncall tickets,
   or GitHub PRs. Domain logic lives outside the core.
3. **Uses existing tools** — no new MCP tools. Agents configure crons through the same
   `backlog_create` / `backlog_update` / `backlog_delete` they already know.
4. **Is composable** — follows the same patterns as existing entity types (task, epic,
   artifact, folder, milestone).

## Proposals

### A. External cron (crontab / launchd) calling a script (rejected)

A system-level cron job runs a shell script that calls backlog-mcp's MCP tools or HTTP API
to create tasks.

- **Pro**: Zero changes to backlog-mcp
- **Pro**: Uses battle-tested OS scheduling
- **Con**: Invisible to agents — they can't list, modify, or disable cron jobs
- **Con**: Invisible to the viewer — humans can't see what's scheduled
- **Con**: Configuration lives in crontab/launchd, not in the backlog
- **Con**: Violates the tenet: agents should have full visibility and control

### B. New MCP tools for cron management (rejected)

Add `backlog_cron_create`, `backlog_cron_update`, `backlog_cron_list`, etc. as dedicated
tools with cron-specific parameters.

- **Pro**: Clean API surface for cron operations
- **Con**: Duplicates the existing CRUD pattern — `backlog_create` already handles 5 types
- **Con**: Agents must learn new tools for a concept that maps naturally to entities
- **Con**: Violates DRY — the create/update/delete/list pattern is already solved

### C. Cron as a first-class entity type (selected)

Add `cron` as the 6th entity type alongside task, epic, artifact, folder, and milestone.
Cron entities are created, updated, and deleted through existing MCP tools. The backlog-mcp
server runs a lightweight scheduler that executes cron commands on schedule and creates
child tasks from the output.

- **Pro**: Zero new MCP tools — `backlog_create type="cron"` just works
- **Pro**: Full agent visibility and control through existing tools
- **Pro**: Viewer displays crons alongside other entities — same treatment
- **Pro**: Composable — lives under epics, has parent_id, follows all existing patterns
- **Pro**: Domain-agnostic — the command is a user-defined plugin script
- **Con**: Adds scheduling responsibility to the backlog server process
- **Con**: New fields on Entity interface (schedule, command, last_run, next_run)

## Decision

**Proposal C** — cron as a first-class entity type.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent (MCP / CLI)                                               │
│   backlog_create type="cron" title="Review queue"               │
│     schedule="*/30 * * * *"                                     │
│     command="studio-agents check-reviews"                       │
│     parent_id="EPIC-0043"                                       │
├─────────────────────────────────────────────────────────────────┤
│ Core: packages/shared/src/entity-types.ts                       │
│   EntityType.Cron = 'cron'                                      │
│   TYPE_PREFIXES[Cron] = 'CRON'                                  │
│   Entity interface += schedule, command, last_run, next_run     │
├─────────────────────────────────────────────────────────────────┤
│ Storage: packages/server/src/storage/                           │
│   TaskStorage — unchanged (type-agnostic, stores .md files)     │
│   schema.ts — createTask() passes through new fields            │
├─────────────────────────────────────────────────────────────────┤
│ Scheduler: packages/server/src/cron/scheduler.ts        [NEW]   │
│   - On server start: load all cron entities, schedule them      │
│   - On entity change (via EventBus): re-schedule affected cron  │
│   - On tick: run command, parse output, create child tasks      │
│   - Deduplication: skip if task with same dedupe_key exists     │
│   - Update cron entity: last_run, next_run timestamps           │
├─────────────────────────────────────────────────────────────────┤
│ Plugin: ~/.backlog/plugins/ (user-defined)                      │
│   review-queue.js → stdout: [{ title, description, refs }]     │
│   oncall-check.sh → stdout: [{ title, description, refs }]     │
│   Contract: run, output JSON array of task shapes, exit         │
├─────────────────────────────────────────────────────────────────┤
│ Viewer: packages/viewer/type-registry.ts                        │
│   TYPE_REGISTRY[Cron] = { prefix: 'CRON', label: 'Cron',       │
│     icon: cronIcon, isContainer: true, hasStatus: true,         │
│     extraFields: ['schedule', 'command', 'last_run', 'next_run']│
│   }                                                             │
├─────────────────────────────────────────────────────────────────┤
│ Viewer: detail pane                                             │
│   Schedule (human-readable), command, status, last/next run,    │
│   child tasks created by this cron                              │
└─────────────────────────────────────────────────────────────────┘
```

### Entity Fields

New optional fields on the `Entity` interface:

| Field      | Type   | Description                                    |
|------------|--------|------------------------------------------------|
| `schedule` | string | Cron expression (e.g., `*/30 * * * *`)         |
| `command`  | string | Plugin script path or shell command to execute  |
| `last_run` | string | ISO timestamp of last execution                 |
| `next_run` | string | ISO timestamp of next scheduled execution       |

### Status Mapping

Cron entities reuse existing statuses with cron-specific semantics:

| Status       | Cron meaning                              |
|--------------|-------------------------------------------|
| `open`       | Active — scheduler runs it on schedule    |
| `blocked`    | Errored — last run failed, paused         |
| `cancelled`  | Paused — agent explicitly disabled it     |
| `done`       | Retired — no longer needed                |

### Plugin Contract

A plugin is any executable that:
1. Runs to completion (no long-running processes)
2. Outputs a JSON array to stdout: `[{ title, description?, references?, parent_id? }]`
3. Exits with code 0 on success, non-zero on failure
4. Is domain-specific — backlog-mcp never interprets the output beyond the JSON contract

```typescript
/** Plugin output shape — same fields as backlog_create params */
interface PluginTaskOutput {
  title: string;
  description?: string;
  references?: Array<{ url: string; title?: string }>;
  parent_id?: string;
}
```

### Deduplication

When a cron creates tasks, duplicates are avoided by checking `references[0].url` against
existing tasks under the same parent epic. If a task with the same reference URL already
exists and is not `done` or `cancelled`, the cron skips it.

### Scheduler Design

The scheduler is a lightweight in-process timer, not a full job queue:

- **Local mode**: `setInterval`-based, checks cron expressions against current time
- **Cloud mode (Workers)**: Cloudflare Cron Triggers invoke the worker on schedule
- **Reactive**: Subscribes to EventBus for `task_created`/`task_changed`/`task_deleted`
  events on cron entities — re-schedules without server restart

## Cross-Reference Evidence Table

| Claim | Source File | Evidence |
|-------|------------|---------|
| Entity types defined via enum + prefix map | `packages/shared/src/entity-types.ts:5-20` | `EntityType` enum, `TYPE_PREFIXES` record |
| Adding a type = add enum value + prefix + update regex | `packages/shared/src/entity-types.ts:39` | `ID_PATTERN = /^(TASK\|EPIC\|FLDR\|ARTF\|MLST)-(\d{4,})$/` |
| `nextEntityId()` is type-parameterized | `packages/shared/src/entity-types.ts:56-58` | `nextEntityId(maxId, type)` → `formatEntityId(maxId + 1, type)` |
| Storage is type-agnostic (markdown + YAML frontmatter) | `packages/server/src/storage/task-storage.ts:1-30` | `TaskStorage` reads/writes `.md` files via `gray-matter` |
| `createTask()` passes through optional fields | `packages/server/src/storage/schema.ts:20-35` | Conditional field assignment: `if (input.due_date) task.due_date = input.due_date` |
| Zod schema auto-registers new types | `packages/server/src/tools/backlog-create.ts:14` | `z.enum(ENTITY_TYPES)` — reads from shared constant |
| Create flow: tool → core → storage → event | `packages/server/src/core/create.ts:15-24` | `createItem()` → `nextEntityId()` → `createTask()` → `service.add()` |
| Viewer type registry maps type → UI config | `packages/viewer/type-registry.ts:15-21` | `TYPE_REGISTRY` record with icon, gradient, label, extraFields |
| EventBus emits typed events for SSE | `packages/server/src/events/event-bus.ts:10-18` | `BacklogEvent` with seq, type, id, tool, actor, ts |
| Viewer extraFields render in detail pane | `packages/viewer/type-registry.ts:19-21` | Milestone has `extraFields: ['due_date']`, Artifact has `['content_type', 'path']` |

## Consequences

**Positive**:
- Agents create and manage cron jobs through tools they already know
- Viewer shows cron status, schedule, and output — full human visibility
- Domain logic stays outside backlog-mcp — plugins are user-defined scripts
- Composable: crons live under epics, create child tasks, follow all existing patterns
- The backlog fills itself — automated intake without manual triggering

**Negative**:
- Server process gains scheduling responsibility — must handle timer lifecycle
- New fields on Entity interface increase surface area (4 optional fields)
- Plugin execution introduces security surface — server runs user-defined commands
- Cloud mode (Workers) requires different scheduling mechanism (Cron Triggers)

## Implementation Notes

### Changes by package

**packages/shared** (3 changes):
1. Add `Cron = 'cron'` to `EntityType` enum
2. Add `[EntityType.Cron]: 'CRON'` to `TYPE_PREFIXES`
3. Update `ID_PATTERN` regex to include `CRON`
4. Add `schedule`, `command`, `last_run`, `next_run` to `Entity` interface

**packages/server** (4 changes):
1. `schema.ts` — pass through new cron fields in `createTask()`
2. `backlog-create.ts` — add `schedule` and `command` params to Zod schema (optional, only for type=cron)
3. `backlog-update.ts` — allow updating `schedule`, `command` fields
4. New `cron/scheduler.ts` — scheduler that loads cron entities, runs commands, creates tasks

**packages/viewer** (2 changes):
1. `type-registry.ts` — add `EntityType.Cron` entry with icon, gradient, extraFields
2. Detail pane — render schedule, command, last_run, next_run, child task list

### Plugin resolution

Commands are resolved in order:
1. Absolute path: `/path/to/script.js` — run directly
2. Plugin directory: `review-queue` → `~/.backlog/plugins/review-queue.js`
3. PATH lookup: `studio-agents check-reviews` — run via shell

### Security considerations

- Plugin execution is opt-in — no plugins run unless a cron entity exists
- Commands run with the same permissions as the backlog-mcp server process
- Cloud mode does NOT support arbitrary command execution — only HTTP webhook plugins
- The viewer never triggers execution — it only displays results
