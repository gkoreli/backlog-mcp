---
title: "backlog-mcp as Agentic Context Storage Engine (supersedes 0096)"
date: 2026-04-28
status: Proposed
supersedes: 0096-cron-entity-type.md
---

# 0097. backlog-mcp as Agentic Context Storage Engine

## TL;DR

backlog-mcp is not a task tracker that's growing orchestration features. It is — and
commits to being — **a storage engine for agentic context**: a markdown-backed, reactive,
composable substrate that agents write to and humans observe through the viewer.

This ADR defines that positioning explicitly, rejects the pressure to absorb execution
responsibility (schedulers, orchestrators, executors), and lays out the small extensions
needed to let external actors (crons, workers, validators) describe their work in the
store. The "agentic control panel" is not a new product — it is the emergent surface that
appears when agents write entities and the existing viewer renders them.

The concrete changes are:

1. A new `cron` entity type (intake descriptor only — not an executor).
2. A generic aggregate endpoint + one chart web component (the primitives for monitoring).
3. A markdown-based "composable document" pattern: user-written dashboards are resources
   with embedded query blocks. New monitoring views cost a markdown file, not a code sprint.

backlog-mcp the server remains a pure store. Schedulers, executors, and orchestrators
live outside it as MCP clients. This is the Unix/Postgres/git shape, not the Temporal shape.

## Context

### What backlog-mcp already is (grounded in the code)

Reading the current codebase, backlog-mcp has the following architectural properties:

- **Type-parameterized entity model.** `EntityType` enum + `TYPE_PREFIXES` + `ID_PATTERN`
  drive all entity handling. Adding a new type is ~3 lines in `packages/shared/src/entity-types.ts`
  plus one enum value + one prefix + one regex edit.
- **Type-agnostic storage.** `TaskStorage.iterateTasks()` yields any `.md` file matching
  `PREFIX-\d{4,}.md`. No type-specific paths, no type-specific schemas. Adding a new
  entity type requires zero changes to storage.
- **Generic resource catch-all.** `ResourceManager.resolve(uri)` maps `mcp://backlog/{+path}`
  to `dataDir/{path}`. Any file under the data directory is readable and writable via the
  existing `write_resource` tool (operations: `str_replace`, `insert`, `append`).
- **Generic viewer rendering.** `DocumentView` composes a header + `MetadataCard` +
  `<md-block>` body. `MetadataCard` renders *every* frontmatter key-value generically.
  `TaskList` filters by type via `TYPE_REGISTRY`. `TaskFilterBar` auto-generates the type
  filter buttons by reading the registry. Adding a new type = adding one registry entry.
- **Reactive live updates.** `LocalEventBus` emits `task_created` / `task_changed` /
  `task_deleted` / `resource_changed`. The viewer refetches via SSE on every change.
  New entity types participate for free.
- **Operation log = audit trail.** Every write (MCP or CLI) is logged with actor
  attribution, tool name, params, result. `ActivityPanel` renders this per-task and
  globally. New entity types participate for free.
- **Hybrid search over everything.** `OramaSearchService` indexes tasks, epics, resources.
  `backlog_search` and the spotlight UI query the same canonical method. New entity types
  participate for free.
- **Web Component + signals UI.** The viewer is built on `@nisli/core` — factory-composed
  components, signal-based state, declarative templates. Every component is reusable and
  embeddable. This is not incidental; it is the leverage surface.

### The pressure this ADR resists

Agent platforms trend toward unified orchestration: schedule, execute, retry, observe,
gate — all in one system (Temporal, Airflow, Inngest, Trigger.dev, LangGraph deployments).
The pull toward that shape is real and it is the wrong shape for this product. It trades
a defensible niche (markdown-backed substrate for agentic state) for a crowded commodity
(one more workflow engine).

Specifically, the rejected temptations are:

1. Running the scheduler inside backlog-mcp (rejected in ADR 0096's proposal C — see
   Alternatives below). Adds RCE surface, two-mode divergence, timer lifecycle, retry
   policies, and scope creep that never stops.
2. Building bespoke dashboards for each new observation need (cron dashboard, review
   dashboard, oncall dashboard). Each is a maintenance liability; the category never ends.
3. Owning agent execution semantics (retries, timeouts, durability). These are orchestrator
   concerns, not store concerns.

### The architectural tenet (restated)

From ARTF-0189: **"agents mutate, viewer observes, humans steer agents."** The viewer is
always read-only. All state changes flow through MCP tools. The viewer is not an editor.

This tenet is what makes "storage engine for agentic context" a coherent identity. The
store doesn't act; the store is acted upon. External actors do the acting. Humans steer
by conversing with those actors; the store is the shared memory they all read and write.

## Problem Space

Three concrete needs ARTF-0189 and subsequent discussion surface:

1. **Automated intake.** The backlog needs to fill itself with work that needs doing
   — review queue items, oncall alerts, companion CR checks. Today, every task enters
   the backlog via explicit human/agent action. There is no description of "this should
   happen every 30 minutes."

2. **Runtime observability.** When agents are running, humans need to see what they're
   doing — what writes happened, what reasoning led to them, which sessions are active,
   which crons fired recently, which failed. The existing operations log + activity panel
   already captures writes; reasoning must be captured by agent discipline (writing
   artifacts); but aggregate/time-series questions are not answerable from a filtered task
   list alone.

3. **Composable monitoring surfaces.** Different humans/agents want different views of the
   same substrate: a code-review control panel, an oncall control panel, a personal
   productivity panel. Each is a distinct composition of "entities I care about," not a
   new product feature.

All three must be solved without breaking the tenet (store-shaped, not orchestrator-shaped)
and without triggering per-feature dashboard proliferation.

## Proposals

### A. Absorb execution into backlog-mcp (rejected — this is ADR 0096's proposal C)

Run a scheduler in the server process. Spawn plugins. Create tasks from their output.
Ship retries, timeouts, dedup, plugin contract, cloud/local execution split inside the
core package.

- **Pro**: single product, single binary, integrated UX out of the box.
- **Con**: commoditizes backlog-mcp into a worse Temporal. Adds RCE surface to a server
  that may be exposed (cloud mode). Forces two different execution models (shell in local,
  webhooks in cloud). Every feature (retry, timeout, concurrency) becomes owned forever.
  Breaks the store-vs-orchestrator identity.
- **Rejected**: see Consequences of ADR 0096's proposal C — this ADR supersedes it.

### B. Build a full control-panel product with bespoke dashboards (rejected)

Add `CronDashboard`, `ReviewDashboard`, `OncallDashboard`, etc. as dedicated viewer
routes, each with bespoke components. Add orchestration features as they're requested.

- **Pro**: each dashboard is highly tuned to its use case.
- **Con**: combinatorial explosion. Every new use case = new code. Every change to
  entity structure = N dashboards to update. Doesn't compose. Doesn't scale to use cases
  users invent after ship.
- **Rejected**: this is the "new dashboard every other day" trap.

### C. Storage engine + external actors + composable documents (selected)

Commit backlog-mcp to being a pure storage engine for agentic context. Add the minimum
entity types needed to let external actors describe their work. Add *two primitives* to
the viewer (generic aggregate endpoint + one chart component) so monitoring composes out
of markdown documents instead of bespoke code.

- **Pro**: preserves and doubles down on the existing architectural shape — the
  extension points already support this.
- **Pro**: the control panel becomes emergent, not built. `?type=cron` is the cron
  monitor; `control-panel.md` with embedded query blocks is the custom dashboard.
- **Pro**: external actors (schedulers, workers, validators) are just MCP clients.
  Security surface on backlog-mcp doesn't grow. Cloud-mode stays clean.
- **Pro**: the ecosystem seeds itself — users write plugins, users write dashboards,
  users write agents. backlog-mcp benefits from all of them without owning any of them.
- **Con**: requires agent discipline (write reasoning as artifacts, not just outputs).
- **Con**: requires users to *compose* their control panels rather than get them prebuilt.
  Mitigated by shipping reference control-panel markdown documents for common flows.
- **Con**: the scheduler is not included in the npm package — users must run
  `studio-agents schedule` (or equivalent) as a separate process. Mitigated by making
  this trivially easy in the default local setup.

## Decision

**Proposal C.** backlog-mcp is an **agentic context storage engine**. The control panel is
an emergent surface, not a product feature.

### Positioning statement

> backlog-mcp is a markdown-backed, reactive storage engine for agentic context. Agents
> describe their work as entities (tasks, epics, artifacts, folders, milestones, crons,
> and future types). The viewer renders that description as a live control panel. External
> actors (schedulers, workers, validators) read and write the store as MCP clients. The
> core is never an orchestrator and never executes user-defined code.

### Evolution of the framing (how we got here)

The positioning above was not the starting point. It emerged through successive
tightenings during the ADR discussion, and each tightening made the architectural
commitments clearer. Preserving the evolution here is deliberate — later contributors
should see *why* the framing is what it is, not just *what* it is.

**Starting point: "task tracker for LLM agents."** This is the README framing as of this
ADR. It is accurate for how the product has been used to date, but it understates what
the architecture already enables. Tasks are one shape of durable agentic content — not
the only shape, and not the defining shape.

**First tightening: "storage engine for agentic context."** The observation that
triggered this: the substrate is type-agnostic from the beginning. `TaskStorage` iterates
*any* `.md` file. `ResourceManager` maps *any* path. `MetadataCard` renders *any*
frontmatter. `TYPE_REGISTRY` is extensible by definition. None of these were built to
support tasks specifically — they were built to support "entities with frontmatter" as a
generic primitive. The product has always been a storage engine; the framing just hadn't
caught up with the architecture.

**Second tightening: "data bank for the agentic toolchain."** The observation that
triggered this: once you commit to "storage engine," the natural question is *storage of
what?* The answer isn't "tasks and things related to tasks." The answer is *every kind of
durable, structured, searchable content an agent needs to do its job*. That includes:

- Tasks (already)
- Epics, folders, artifacts, milestones (already)
- Crons (this ADR)
- Agent configurations (instructions, skills, models, workflows) — currently scattered
  across `~/.aim/packages/...`, filesystem configs, dotfiles
- Rules / corrections / institutional knowledge (ARTF-0189 calls this "correction memory")
- Context files / project briefings — the "paste the architecture doc" prompt material
- CLI tool descriptions — what's installed, what it does, how agents discover it
- Prompt templates, reusable skills, checklists
- Session records — which agent ran, when, for which task, with what context
- Alarms / threshold breaches surfaced by monitoring actors

None of these are "tasks." All of them are *things an agent reads or writes to do work*.
All of them fit the existing substrate — typed markdown with frontmatter, searchable,
navigable, live-observable. The architectural commitment was already made years ago;
this ADR is the point where the product explicitly claims the full category.

**The category claim, restated**: backlog-mcp is to *agentic content* what git is to
*source code* and what Postgres is to *relational data* — the smallest, most reusable
primitive that the domain-specific tooling sits on top of. The domain-specific tooling
(schedulers, workers, review assistants, onboarding flows, knowledge managers) is built
*above* the substrate by external actors. The substrate wins because it is the layer
that never needs to be rebuilt for a new use case.

**Why capture all three framings, not just the latest?** Because each framing is true at
its own scope. "Task tracker for LLM agents" is the entry-point description — the README
lead. "Storage engine for agentic context" is the architectural description — what the
code actually is, which is what this ADR commits to. "Data bank for the agentic
toolchain" is the directional description — where the product compounds as entity types
multiply. A new contributor should be able to read this section and understand: the
product is a task tracker today, an agentic storage engine by architecture, and a data
bank for the full agentic toolchain in its trajectory. All three are simultaneously
correct; they differ in emphasis, not in contradiction.

### Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│ External actors — MCP clients of the store                                │
│                                                                           │
│   studio-agents schedule  → ticks crons, spawns plugins, creates tasks    │
│   studio-agents workers   → picks up open tasks, runs agents              │
│   studio-agents validators → verifies before posting                      │
│   Any other actor someone writes                                          │
│                                                                           │
│   ALL of these talk to backlog-mcp via MCP tools. None live in the core.  │
└───────────────────────────────────────────────────────────────────────────┘
                                   │
                        MCP tools (backlog_*, write_resource)
                                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ backlog-mcp — the storage engine                                          │
│                                                                           │
│   Entities: task, epic, folder, artifact, milestone, cron, [future]       │
│   Storage:  markdown + YAML frontmatter under $BACKLOG_DATA_DIR           │
│   Indexes:  Orama (hybrid BM25 + vectors) over all entities and resources │
│   Events:   SSE stream of every mutation                                  │
│   Audit:    operation log with actor attribution                          │
│   Queries:  MCP tools (read/write) + HTTP (for viewer) + aggregate endpt  │
│                                                                           │
│   DOES NOT:                                                               │
│     - run schedulers, timers, or cron daemons                             │
│     - spawn child processes or execute user-defined code                  │
│     - own retry/timeout/durability semantics                              │
│     - know anything about code review, oncall, or any domain              │
└───────────────────────────────────────────────────────────────────────────┘
                                   │
                           SSE + HTTP + MCP resources
                                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ Viewer — the observation surface (composable web components)              │
│                                                                           │
│   Per-entity views:  DocumentView + MetadataCard (auto-renders any FM)    │
│   Collection views:  TaskList with ?type=X filter (auto-registers types)  │
│   Aggregate views:   <aggregate-chart> fed by generic aggregate endpoint  │
│   Composable docs:   markdown resources with embedded query blocks        │
│                                                                           │
│   New monitoring needs:                                                   │
│     - If a list suffices → use URL filters (?type=cron&filter=active)     │
│     - If a chart is needed → embed <aggregate-chart> in a markdown file   │
│     - If a custom layout → compose existing components in a markdown file │
│                                                                           │
│   NEW DASHBOARDS ARE MARKDOWN FILES. NOT NEW COMPONENTS.                  │
└───────────────────────────────────────────────────────────────────────────┘
```

### The three concrete extensions

This ADR makes three specific additions to realize the vision. Each is small, generic,
and reinforces the "storage engine" identity rather than diluting it.

#### Extension 1: `cron` entity type

A `cron` is a **description of scheduled intake** — not an executor. It lives in the
store, visible to agents and the viewer, steerable through existing MCP tools. The
*scheduler* is external.

New `EntityType.Cron = 'cron'` with prefix `CRON`. New optional fields on `Entity`:

| Field         | Type    | Description                                        |
|---------------|---------|----------------------------------------------------|
| `schedule`    | string  | Cron expression (e.g., `*/30 * * * *`)             |
| `command`     | string  | Actor-interpreted command string (e.g., `studio-agents check-reviews`) |
| `enabled`     | boolean | Whether the external scheduler should run it       |
| `last_run`    | string  | ISO timestamp of last execution (written by scheduler) |
| `next_run`    | string  | ISO timestamp of next scheduled execution (written by scheduler) |

**Critical semantic choice: `enabled` is separate from `status`.** This reverses ADR 0096's
proposal to overload `status`. `status` keeps its existing meaning (does this entity still
matter?); `enabled` answers "should the scheduler run this right now?" This prevents the
`cancelled = paused` vs `cancelled = this isn't happening` collision.

**Plugin contract (what a command produces)** is defined by the external scheduler, not
by backlog-mcp. The store has no opinion. For the first-party `studio-agents schedule`
implementation, the contract is: JSON array of `{ title, description?, references?,
parent_id?, dedupe_key? }` to stdout.

**Dedup is the scheduler's job, not the store's.** The `dedupe_key` is a plugin-output
field the scheduler uses; it is not stored on tasks. The scheduler queries
`backlog_list parent_id=...` and filters by `references[].url` (or whatever key) before
creating.

#### Extension 2: Generic aggregate endpoint + one chart web component

Today the server answers "give me this entity" and "give me entities matching filter X."
It does not answer "count / sum / group by / window." This is the single gap that
prevents monitoring from composing.

**Add one endpoint** on the HTTP server:

```
GET /aggregate
  ?filter=type:cron,status:open    (AND semantics)
  &group_by=id                      (one of: id, type, status, parent_id, date)
  &metric=count | last_run | updated_count
  &window=24h | 7d | 30d | all
  &bucket=hour | day | week         (for time-series)
```

Response: `[{ key: string, value: number, ts?: string }]`. No auth, read-only, always on.

**Add one web component** in the viewer:

```html
<aggregate-chart
  filter="type:cron"
  group-by="id"
  metric="count"
  window="7d"
  bucket="day"
  kind="bar | line | sparkline | number">
</aggregate-chart>
```

Internally: calls the aggregate endpoint, subscribes to SSE for refresh, renders as SVG.
One component. Reused everywhere. Style matches existing viewer.

**These two primitives together answer every aggregate question the store will ever be
asked, for any current or future entity type.** They are generic, type-agnostic, domain-agnostic.
Adding a new entity type never requires touching them.

#### Extension 3: Composable documents — markdown resources as dashboards

`ResourceManager` already lets arbitrary markdown live at
`mcp://backlog/resources/{path}`. `<md-block>` renders any markdown. Extend `<md-block>`
(or its rendering pipeline) to recognize a small set of **query block web components**:

```markdown
# My Code Review Control Panel

## Active schedules
<entity-list type="cron" status="open,blocked"></entity-list>

## Cron runs in last 24h
<aggregate-chart filter="type:cron" metric="updated_count" window="24h" group-by="id"></aggregate-chart>

## Review tasks completed this week
<aggregate-chart filter="parent_id:EPIC-0043,status:done" window="7d" bucket="day" kind="line"></aggregate-chart>

## Latest failures
<entity-list type="artifact" title-contains="Failed" limit="10"></entity-list>

## In-flight reviews
<entity-list type="task" parent_id="EPIC-0043" status="in_progress"></entity-list>
```

This is a **dashboard that lives in the backlog itself** — an artifact (or resource)
under `mcp://backlog/resources/control-panels/code-review.md`. An agent can write it in
one turn. A user can version it in git. A team can share different panels for different
contexts. The viewer already renders markdown; the viewer already renders components.
The query blocks are the *only* new thing.

**This is the mechanism that prevents "new dashboard every day":** every new dashboard is
a markdown file, not a code change. The viewer ships the blocks; the humans (or agents)
compose the documents.

### Extension 4 (ratification, not implementation): the entity-type catalog is open-ended

This ADR introduces `cron` as the sixth entity type. That number is not special, and the
catalog is not closed. A core consequence of the storage-engine positioning is that
**every kind of durable agentic content that accumulates in the environment is a
candidate for an entity type in the store.**

This section does not implement any of these — it ratifies them as architecturally
supported so that future ADRs introducing them are seen as natural extensions of this
one, not as unrelated new features. Each of the types below has a motivating story that
the current substrate already supports end-to-end (storage, rendering, search, events,
operation log, cross-references, activity panel). Adding any of them costs on the order
of 25 LOC plus an icon.

| Proposed type | Purpose | Why it fits the storage engine |
|---------------|---------|---------------------------------|
| `session` / `work` | Record of an agent run — who ran, when, model, parent task, evidence produced | Already implicitly tracked by operation log; becomes a first-class, observable entity with children (artifacts), searchable, steerable |
| `rule` | A durable directive learned from a correction ("always verify component source before posting review comments") | ARTF-0189's "correction memory" primitive — agents `backlog_list type=rule scope=...` before acting; humans add new rules via agents |
| `context` / `brief` | Project or domain briefing loaded at session start — what the team does, what the architecture is, what the conventions are | Replaces "paste the Quip doc" bootstrap; agents auto-load on session start; humans maintain via `write_resource` |
| `cli_tool` | An agent-discoverable CLI capability in the environment — what's installed, how to invoke, example usage | Makes the environment self-describing; agents `backlog_search "code search tool"` to discover `ghx` or `cbx` without being told |
| `agent` | Agent configuration — instructions, model, capabilities, workflow, skill references | Today scattered across `~/.aim/packages/...`, dotfiles, MCP configs; consolidated into the store, cross-referenced from sessions and rules |
| `skill` / `playbook` | Procedural knowledge — how-to for a recurring workflow, composed from rules and contexts | Agents consult the skill before doing a class of work; humans version the skill like any other entity |
| `prompt` | Reusable prompt template, composed by reference from rules + contexts + skills | Replaces ad-hoc prompt pasting; templates are searchable, versioned, and discoverable |
| `alarm` | Threshold breach surfaced by a monitoring actor (queue depth, SLA miss, failure rate) | Monitoring actors `backlog_create type=alarm`; humans acknowledge via `backlog_update`; just another steerable entity |

**What this ratifies, architecturally:**

1. The substrate is intentionally open-ended in the type dimension. Closing it would be
   a mistake. The type-registry and ID-pattern extension points are **core product
   features**, not internal plumbing.
2. Future ADRs introducing any of the types above do not need to re-justify the
   architectural shape. The shape is this ADR. They need only justify the specific fields
   and the external actors that read/write the type.
3. Composition between entity types is the emergent value. When `rule` and `session`
   coexist, agents can inject scoped rules into session context. When `cli_tool` and
   `task` coexist, task descriptions can reference tools by ID. **The capabilities that
   appear from pairwise composition were not designed into the store — they emerge
   because the substrate is consistent.**
4. This is why the positioning phrase in the README should be *"data bank for the
   agentic toolchain"* and not just *"task tracker"* — the former is the trajectory the
   architecture commits to, the latter is the entry-point description.

**What this does NOT ratify:**

- Specific schemas for any of the proposed types. Those come in their own ADRs when the
  type is added.
- Any external actors that would write or read these types. Those are separate concerns
  (see the architecture diagram: actors are outside the store).
- A fixed ship order or priority. Some types may never be added if the use case doesn't
  emerge. The catalog is *possibility*, not *roadmap*.

### Agent discipline (no code, but architecturally material)

For the observation story to be complete, agents must write their *reasoning* as
artifacts, not just outcomes. This is a discipline, encoded in agent instructions, not a
code feature — but it is the piece that makes "observe all agent actions" reach the
observe-thinking level ARTF-0189 describes.

Pattern:

- Session starts → agent creates a `work`-or-`session`-typed entity (possibly a future
  extension 4; not required for this ADR to be valuable).
- Agent reads files / queries search / considers options → writes one artifact per
  meaningful step (`parent_id` = session entity).
- Agent makes a decision → writes an artifact capturing the decision and the evidence.
- Agent performs an action (comment, PR, commit) → updates the parent task with evidence.

The viewer auto-renders all of this. SSE streams it live. The operations log records it.
**The "watch the agent think" experience is emergent from (a) agent discipline + (b)
existing reactive viewer components.** No new UI.

## Cross-Reference Evidence Table

| Claim | File / Line | Evidence |
|-------|------------|---------|
| Entity types are type-parameterized enum + prefix map | `packages/shared/src/entity-types.ts:5-20` | `EntityType` enum + `TYPE_PREFIXES` record |
| ID pattern enforces known prefixes | `packages/shared/src/entity-types.ts:39` | `ID_PATTERN = /^(TASK\|EPIC\|FLDR\|ARTF\|MLST)-(\d{4,})$/` |
| Storage is type-agnostic (markdown + YAML) | `packages/server/src/storage/task-storage.ts:48-63` | `iterateTasks()` yields any `.md`, no type filter |
| `createTask()` passes arbitrary fields through | `packages/server/src/storage/schema.ts:22-40` | Conditional assignment for each optional field |
| Zod schema auto-registers types from shared | `packages/server/src/tools/backlog-create.ts:14` | `z.enum(ENTITY_TYPES)` reads the shared constant |
| Resource URIs are a pure catch-all | `packages/server/src/resources/manager.ts:79-101` | `mcp://backlog/{+path}` → `dataDir/{path}` |
| `write_resource` supports generic edit ops on any URI | `packages/server/src/tools/backlog-write-resource.ts:1-40` | `str_replace`, `insert`, `append` |
| EventBus emits typed events for SSE | `packages/server/src/events/event-bus.ts:8-17` | `task_created`, `task_changed`, `task_deleted`, `resource_changed` |
| Viewer auto-renders frontmatter via MetadataCard | `packages/viewer/components/metadata-card.ts:78-105` | Generic key-value rendering for every FM field |
| `DocumentView` composes header + metadata + markdown | `packages/viewer/components/document-view.ts:50-180` | Works for any entity type |
| Type filter bar auto-generates from registry | `packages/viewer/components/task-filter-bar.ts:23-29` | `TYPE_ENTRIES` iterates `TYPE_REGISTRY` |
| URL state already syncs `?type=` param | `packages/viewer/services/url-state.ts:40-55` | `type` is a first-class URL signal |
| Task list filters by type reactively | `packages/viewer/components/task-list.ts:45-52` | `app.type.value` filter already live |
| Viewer built on `@nisli/core` web components | `packages/viewer/main.ts:1-22` | `component()`, `html`, `signal`, `inject` |
| Operation log captures every MCP write | `packages/server/src/core/index.ts:18-32` | `withLog()` middleware wraps create/update/delete/edit |
| Hybrid search indexes tasks + resources | `packages/server/src/storage/backlog-service.ts:48-58` | `ensureSearchReady()` indexes both |
| New entity type requires ~25 LOC across packages | This ADR, Implementation Notes | Verified by inspection of the four touch points |

## Consequences

### Positive

- **Identity clarity.** backlog-mcp stops being "a task tracker with features" and becomes
  "the storage engine for agentic context." This is a defensible, rare, differentiated
  position in a market full of orchestration platforms.
- **Composability wins over product features.** Every new observation need is a markdown
  document, not a code sprint. Every new agent behavior is a new entity type, not a new
  subsystem. This compounds over time.
- **Zero execution surface in core.** Cloud-hosted backlog-mcp ships with no RCE surface.
  Local and cloud converge on the same core — the only difference is which external actors
  are attached.
- **Ecosystem becomes valuable.** Users write schedulers, plugins, dashboards, agents.
  backlog-mcp benefits without owning any of them. This is the git / Postgres / Prometheus
  pattern.
- **Existing architecture is fully exploited.** The type system, the viewer, the event
  bus, the search index, the operations log — all of these were built generic. This ADR
  ratifies that generality as the product strategy.

### Negative

- **Users must run a scheduler separately** to get automated intake. For local users,
  `studio-agents schedule` (or equivalent) becomes part of the recommended setup. For
  cloud-hosted instances, a Cloudflare Worker on a Cron Trigger plays the scheduler role.
  Documentation must make this easy.
- **Agent discipline is load-bearing.** The "observe agent thinking" story requires
  agents to write reasoning as artifacts. If agents don't, observation remains at the
  write-trace level, not the thought-trace level. Mitigated by updating agent instructions
  (non-code change).
- **No prebuilt dashboards.** Users who want a "cron dashboard" must either use the
  `?type=cron` URL filter or compose a markdown document with `<aggregate-chart>` blocks.
  Mitigated by shipping reference control-panel markdown files for common flows
  (code-review, oncall, personal-productivity) as part of the repository.
- **Aggregate endpoint and chart component are new code** (~400-600 LOC). This is real
  work, but it is written *once* and reused for every future monitoring need.
- **Deviation from the "one binary ships everything" story.** Self-hosting users must
  understand that they are running a store + a scheduler (and potentially workers).
  Three processes, not one. Mitigated by a single `pnpm dev` target that launches all of
  them locally.

## Alternatives Considered

### Proposal A (rejected): absorb the scheduler into backlog-mcp

This is ADR 0096's proposal C. It fails because (a) it introduces RCE surface into a
server that may be network-exposed, (b) it forces two irreconcilable execution models
(shell for local, webhooks for cloud), (c) every orchestration feature request becomes a
scope-creep vector, and (d) it commoditizes backlog-mcp into a worse version of products
that already exist. ADR 0096 is superseded by this ADR.

### Proposal B (rejected): build dashboards per feature

Ship a `CronDashboard`, `ReviewDashboard`, `OncallDashboard`, etc. Each is a bespoke
viewer route with bespoke components. This fails because (a) it's combinatorial —
N use cases × M entity types × K cross-cuts, (b) every entity schema change becomes
K dashboard updates, (c) it can't anticipate use cases users invent after ship, and
(d) it conflicts with the existing generic viewer architecture that was built to *avoid*
this pattern.

### Split into two ADRs (considered, merged)

Earlier discussion suggested splitting "cron entity" and "scheduler architecture" into
two ADRs. This ADR keeps them in one document because the store-vs-actor split is the
*point*, and separating them would obscure that the scheduler is an external actor, not
a backlog-mcp feature. The scheduler's internal design is left to the external project
(`studio-agents`) that owns it.

## Implementation Notes

### Changes by package

**packages/shared** (~15 LOC):
1. Add `Cron = 'cron'` to `EntityType` enum (`src/entity-types.ts`).
2. Add `[EntityType.Cron]: 'CRON'` to `TYPE_PREFIXES`.
3. Update `ID_PATTERN` regex: `^(TASK|EPIC|FLDR|ARTF|MLST|CRON)-(\d{4,})$`.
4. Extend `Entity` interface with `schedule?`, `command?`, `enabled?`, `last_run?`,
   `next_run?` — all optional, all string/boolean primitives.

**packages/server** (~50 LOC for entity + ~400-600 LOC for aggregate endpoint):
1. `src/storage/schema.ts` — pass through the new optional fields in `createTask()`.
2. `src/tools/backlog-create.ts` — add `schedule`, `command`, `enabled` to Zod schema
   (all optional). Reject `schedule`/`command` if `type !== 'cron'` to prevent noise on
   other types.
3. `src/tools/backlog-update.ts` — add same fields to update schema, including `last_run`
   and `next_run` (so schedulers can write them).
4. `src/server/hono-app.ts` — add `GET /aggregate` endpoint with the filter/group_by/
   metric/window/bucket parameters described in Extension 2.
5. Tests for: filter parsing, group-by aggregation, time-bucketing, SSE-driven refresh.

**packages/viewer** (~300-500 LOC):
1. `type-registry.ts` — add `EntityType.Cron` entry with icon, gradient, label. No
   `extraFields` needed; `MetadataCard` auto-renders frontmatter. (Note: I verified that
   `extraFields` in the registry is currently declarative-only — `MetadataCard` doesn't
   consult it; the rendering is already fully generic.)
2. New `icons/cron.svg` (one icon).
3. New `<aggregate-chart>` web component. Single file. Uses existing `@nisli/core`
   `component()` + `query()` pattern to fetch and reactively re-render.
4. New `<entity-list>` web component (or confirm existing `TaskList` can be embedded
   with explicit filter props). Used inside markdown documents.
5. Extend `<md-block>` to render these custom elements inline without sanitization
   escaping them (HTML allow-list for `aggregate-chart` and `entity-list` tags).
6. Ship 2-3 reference control-panel markdown files under `packages/server/reference/`
   (`code-review-panel.md`, `oncall-panel.md`, `personal-panel.md`), seeded into new
   `$BACKLOG_DATA_DIR/resources/control-panels/` on first run (opt-in).

**External: `studio-agents`** (not part of this ADR, tracked separately):
1. `studio-agents schedule` subcommand — polls `backlog_list type=cron status=open
   enabled=true`, ticks due crons, spawns `command`, parses JSON output, calls
   `backlog_create` with each item, updates `last_run`/`next_run` via `backlog_update`.
2. Failure path: creates an artifact child of the cron with the error output, sets
   `enabled=false` on repeated failures (configurable).
3. Ships as a separate binary/process. Local users run it alongside `backlog-mcp`.

### Migration and backward compatibility

- No existing entity files change format. `CRON` is a net-new prefix.
- `isValidEntityId('CRON-0001')` becomes `true` after the regex update. Old clients
  reading new task files with `type: cron` will see an unknown-but-valid string;
  `TaskStorage` tolerates unknown types (the type filter is string-equality, not enum).
- The aggregate endpoint is additive. Existing endpoints unchanged.
- Extensions to `md-block` allow-list are scoped to the two new components.

### Explicit non-changes

This ADR explicitly does NOT:
- Add a scheduler to the server process.
- Add a plugin loader, plugin sandbox, or plugin directory convention inside backlog-mcp.
- Add retry, timeout, concurrency, or queue semantics to the server.
- Add prebuilt dashboards as viewer routes.
- Add a "control panel" view to the viewer navigation (the control panel is markdown).
- Add any new MCP tool beyond what already exists.

These are all either external actor responsibilities or out of scope for a storage engine.

## Success Criteria

The ADR succeeds if, six months after implementation:

1. At least one external scheduler (first-party `studio-agents schedule`) is in production
   use, and backlog-mcp has received zero feature requests related to scheduling internals.
2. At least three user-authored control-panel markdown documents exist that are NOT part
   of the reference set — indicating the composability pattern is working.
3. No new per-feature dashboard components have been added to the viewer since this ADR
   shipped. All monitoring needs were satisfied by aggregate-chart + entity-list + URL
   filters.
4. **At least two new entity types beyond `cron`** have been added from the Extension 4
   catalog (e.g. `rule`, `context`, `session`, `cli_tool`) — each in <50 LOC across
   shared + viewer. This is the load-bearing criterion for the "data bank" trajectory:
   if entity types don't multiply, the substrate claim is theoretical rather than real.
5. At least one *emergent* cross-type behavior has appeared — an agent composes two
   entity types in a way that wasn't explicitly designed (e.g. rules auto-injected into
   session context, tasks referencing CLI tools by ID, contexts loaded at session start).
   This tests the "composition is the emergent value" claim.
6. The phrase "agentic storage engine" or "data bank for the agentic toolchain" appears
   in the README, at least one blog post, and any public positioning material. The
   identity has been named and committed to externally, not just in the ADR.

## Open Questions

1. **`session` / `work` as a future entity type.** Should this ADR include it, or is it
   orthogonal? Recommendation: ship separately once crons are in production and we have
   signal from actual agent-session observation needs. The risk of preempting is lower
   than the cost of over-scoping this ADR.
2. **Aggregate endpoint query language.** The filter syntax in Extension 2 is a simple
   AND-of-equalities. Do we need range filters (`created_at>2026-01-01`) or full-text
   filters? Recommendation: ship the minimum, iterate from actual dashboard authoring
   pain.
3. **Query block sandboxing inside markdown.** If users author markdown documents with
   `<aggregate-chart>` tags, must we prevent malicious filter expressions from DoSing the
   aggregate endpoint? Recommendation: filters are read-only and bounded by the store's
   existing access control; no additional sandbox needed at this stage.
4. **Scheduler process in cloud mode.** Cloudflare Cron Triggers can tick a worker that
   reads crons and calls `backlog_create` via HTTP. This is a natural fit but is tracked
   in the `studio-agents` / cloud deployment ADR, not here.

## References

- ADR 0096 (superseded by this ADR): Cron Entity Type — Scheduled Task Intake.
- ADR 0065: Unified Entity Model Substrates — the original generalization that this ADR
  builds on.
- ADR 0066: Frontend Type Registry Substrates Viewer — the generic viewer pattern that
  makes new entity types free.
- ADR 0073: MCP-First Unified Search — the canonical search pattern that new entities
  participate in automatically.
- ADR 0074: Agent Context Hydration Architecture — the context-building pattern that
  schedulers + workers consume.
- ARTF-0189: North Star — Co-Review Process Automation. The vision document that this
  ADR operationalizes.
