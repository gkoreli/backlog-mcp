---
title: "backlog-mcp — North Star"
date: 2026-07-16
status: Proposed
owner: gkoreli
home: "~/Documents/goga/backlog-mcp"
---

# backlog-mcp — North Star

> **Your backlog is your agent's memory.**
> A markdown-backed storage engine for agentic **context and memory** — one substrate
> model, progressive disclosure at the core, living in the repo it belongs to.

**Status:** vision (supersedes the "task backlog MCP server" and "context engineering
for your agents" framings) · **Owner:** gkoreli · **Written:** 2026-07-16

> This document is the vision. It sits above the ADR thread and outranks it: when an ADR,
> a feature, or a refactor drifts from a Tenet or Invariant here, the North Star wins and
> the ADR is what changes. Names and internals are settled in ADRs (cited throughout);
> *what we are building and why* is settled here.

---

## The Cold-Open Test (the first scenario that defines success)

An agent — or a human — **cold-opens a repository it has never seen.** Nothing was set
up. No briefing was pasted. There is just a `docs/` folder, committed to the repo like any
other source.

The agent runs **one** command — `wakeup` — and in **under a minute** knows:

- the **decisions** that shaped this codebase (the ADRs),
- the **conventions** it must follow (the memories),
- the **active work** and what's blocked (the tasks),
- the **product requirements** it must not derail (the requirements),
- and the **north-star vision** it is serving.

Not because a human maintains a wiki. Because **the repo's docs folder IS the backlog**,
and the backlog IS the agent's memory. The briefing is ~600 dense tokens; the agent
hydrates deeper only where it must.

At the same moment, a **teammate opens the same folder on GitHub** — having installed
nothing, never having heard of this tool — and reads every artifact as plain frontmatter
markdown: `docs/adr/0098-unified-substrate-architecture.md`,
`docs/memories/0107-release-is-typecheck-test-tag-publish.md`,
`docs/requirements/0003-human-visibility-is-non-negotiable.md`.

**When both are true at once — agent oriented in a minute, human reading everything with
zero install, from the same committed folder — the product has done its job.** Adoption
cost was zero. Nothing moved. Nobody was locked in.

---

## The Amnesia Test (its twin — the same scenario, pointed at time)

Cold-open orients an agent that has *never seen* this repo. Its twin orients an agent
that has *forgotten* it. During the 2026-07-16 vision-uplift operation, **six of nine
fleet agents were compacted or context-cleared in a single working day** — the
orchestrator twice, one engineer mid-turn at its most critical gate. Every recovery was
the same motion: *read a durable document, be oriented, continue.*

That is the Cold-Open Test **pointed at time instead of space.** An agent recovering from
compaction and an agent cold-opening an unseen repo are **the same agent: one with no
context and a docs folder.** Amnesia recovery is not a new capability to build — it is the
capability we already claim, aimed at the moment an agent's own working memory is erased.
And that moment is a *law of the environment*, not an edge case: the harness guarantees it
(Codex auto-compacts, Claude compacts within its window) — the only variables are when and
how much is lost.

So the memory engine owes a **second executable gate**, twin to the Cold-Open E2E: seed a
store with a live **operation document** mid-flight, hand a fresh agent nothing but
`wakeup(operation=…)`, and assert it can state its goal, its next action, and its
constraints without reading anything else. The briefing that orients a stranger and the
briefing that restores an amnesiac differ by exactly one section — the live operation
state (an *operation substrate* declared as data, dogfooding ADR 0113; `wakeup` gaining an
operation argument that rides ADR 0119's identity substrate).

**When both tests pass — a stranger oriented in a minute, an amnesiac restored to its own
goal in a minute, from the same committed docs folder — the memory engine has done its
whole job: continuity across space *and* time.** (Proposal + operational evidence:
`docs/proposals/amnesia-test-continuity-engine-2026-07.md`.)

---

## What It Is — *your backlog is your agent's memory* (the north star of north stars)

backlog-mcp started as **a task backlog for LLM agents**. It became **context engineering
for your agents**. It is now, and commits to being, **context *and* memory engineering for
agents** — and the single sentence that names it is:

> **Your backlog is your agent's memory.**

Work that line literally, because it is literally true in the architecture. A task, an
ADR, a captured lesson, a product requirement — all of them are the same thing: a
**durable, structured, searchable artifact an agent reads to do its work and writes to
record what it learned.** The backlog is not a to-do list next to the memory; the backlog
*is* the memory (ADR 0092.3, Part 3 — "the backlog IS the memory," taken to its
conclusion: memories are backlog entities, recall rides the same search pipeline as
everything else).

Underneath the tagline are three architectural claims, each already load-bearing in code:

1. **It is an agentic storage engine** (ADR 0097). Not a task tracker growing features —
   a markdown-backed, reactive, composable *substrate* that agents write to and humans
   observe. It is to *agentic knowledge* what git is to *source* and Postgres is to
   *relational data*: the smallest reusable primitive everything else sits on. The store
   never orchestrates and never executes user code — orchestrators are external clients.

2. **Its type system is substrates** (ADR 0098, 0106.1). One declaration per type drives
   schema, validation, storage, viewer UI, and agent hints — everything derives from it.
   *Substrate* = the definition (7 today, design-time); *Entity* = an instance (N,
   runtime); *Projection* = a shaped view. The catalog is deliberately **open-ended**:
   most durable knowledge objects in a software project are expressible as substrates.

3. **Progressive disclosure is built into the core** — not bolted on. A dense wakeup
   briefing → memory stubs → `backlog_get` hydration on demand; token budgets; deferred,
   intent-shaped tools at the MCP boundary (ADRs 0092.3, 0106). *Never dump; always
   disclose progressively.* This is one of the defining architectural shifts of agentic
   engineering, and we built the product around it.

And its gravity is **memory**. In real daily use the four memory verbs
(wakeup/recall/remember/forget) won decisively over the context-hydration tools. The
North Star names that honestly: **the memory verbs plus progressive disclosure ARE the
product's retrieval story.** Context engineering does not disappear — it survives as a
*capability folded into that one retrieval language* (`wakeup`=orient, `recall`/`search`=ask,
`get`=expand), not as a competing surface (ADR 0114; see Tenet 4 and Open Decisions).

## What It Is (and Is NOT)

**It IS:**

- **A store, not an actor.** Agents mutate, the viewer observes, humans steer the agents
  (ARTF-0189, ADR 0097). All state changes flow through MCP tools; the viewer is
  read-only.
- **Markdown on disk you can read without the tool.** Every artifact is frontmatter
  markdown. The tool is a convenience over the files, never a gate in front of them.
- **Local-first, forever** (ADR 0104). Filesystem storage, Orama hybrid BM25+vector search
  with local embeddings, agentic memory, live viewer over SSE. This is where the product
  grows.
- **A memory you can *see*.** No surveyed competitor (Mem0, Letta, Graphiti, MemPalace —
  ADR 0092.5) gives the human a live, browsable, editable window into agent memory,
  including the agent's own *contradictions* (ADR 0092.13). We get it for free from being
  markdown + a viewer.

**It is NOT:**

- **Not a project-management SaaS.** No boards-as-product, no seats, no lock-in. The
  artifacts belong to *your* project, in *your* repo, under *your* git history.
- **Not a vector-DB memory black box.** The contrast is the whole point: memories you can
  open, read, edit, and diff in a text editor — versus an opaque embedding table you must
  query to inspect. If you can't read it, it isn't our memory.
- **Not an orchestrator.** It schedules nothing and executes no user code (ADR 0097 rejects
  the Temporal/Airflow shape). Scheduling, retries, and agent execution are external MCP
  clients. Orchestration is a *different product* (aime), and it talks to this store like
  any other client.
- **Not cloud-first — the D1/Workers path is descoped.** Local-first is not one mode among
  two; it **is** the north star. Even remote hosting is a **VPS running the same
  local-filesystem architecture** — never Cloudflare Workers, never a D1-like database. The
  existing D1/Workers code is **retained but not evolved**: no new capability targets it and
  nothing anywhere carries a parity obligation to it. (This supersedes-in-part ADR 0104's
  "constrained satellite" framing — the satellite is now descoped, not maintained toward
  parity.)
- **Not a migration.** Adoption is bolt-on. If it requires moving your files or rewriting
  your docs, we designed it wrong.

## Tenets

1. **Your backlog is your agent's memory.** Tasks, ADRs, lessons, and requirements are one
   kind of thing — durable artifacts an agent reads and writes. Do not build a "memory
   system" beside the "backlog"; deepen the one substrate that is both.
2. **Never dump; always disclose progressively.** *Agent context should expand like a
   filesystem: names first, shape on demand, full content only when opened.* A dense
   briefing first, pointers second, full bodies only when the agent opens them. Token
   budget is a first-class design constraint at every surface — wakeup (~600 tokens),
   recall (stubs), `get(context:true)` (relation stubs), tool manifests (deferred loading).
   If a surface floods context, it is broken (ADRs 0092.3, 0106; essay: *One Hundred Pull
   Requests*).
3. **Most durable knowledge is a substrate.** New knowledge types cost one declaration, not
   a subsystem (ADR 0098). Adding a type must not touch storage, search, events, the op
   log, or the viewer's generic rendering — if it does, the generality regressed.
4. **Memory is the proven core loop — bias toward it.** Four verbs, zero ceremony:
   `wakeup` (orient), `recall` (ask), `remember` (keep), `forget` (correct). Reading memory
   must be cheaper than re-deriving, or agents correctly stop calling it — so recall
   correctness is a contract with tests, not a hope (ADR 0092.3, Part 2).
5. **Speak intent at the port; hide the substrate in core.** MCP tools are named for what
   the agent *wants* (`remember`, `recall`, `schedule`), not for what the database *stores*
   (`create(type=memory)`). The substrate abstraction stays internal and DRY behind one
   funnel; the boundary speaks the domain's language (ADR 0106, hexagonal).
6. **Docs-native, zero-migration adoption.** The backlog bolts onto the repo's `docs/`
   folder. Day-0, fully backwards compatible, nothing moved. Adoption cost is zero because
   the artifacts were going to live in the repo anyway.
7. **Capture small, compress upward.** Write atomic facts; let consolidation distill
   clusters into fewer derived memories over time (ADRs 0092.7, 0092.12). Usage ranks the
   useful up and decays the stale down — self-curating, no manual gardening (ADR 0092.9).
8. **A tool must earn its context cost.** Every tool in the manifest is a permanent tax on
   every session's context. A tool earns its place only when it beats the agent's *native*
   primitives — Edit, the filesystem, search — by enough to justify the tokens it costs
   forever: schema-enforced writes, true intent semantics, retrieval the harness can't do.
   When a tool merely re-skins a capability the agent already has, fold it away or cut it
   (ADR 0114 folded `backlog_context` into `get`; ADR 0117 weighs `write_resource` against
   native Edit — and "leave it alone, don't solve it" is a legitimate answer). Prefer
   folding a capability into an existing verb over minting a new surface (PROMPT 0002 #7,
   #10).
9. **Build under pressure; never for a theory.** Build the smallest thing that solves a
   problem you *actually have*, start using it, let real use uncover the next problem, then
   address that. Almost never anticipate, and never over-engineer a solution to a problem
   that doesn't exist yet. New surface is earned by a *felt* pressure — this whole
   architecture is the residue of that loop, not a plan drawn up front (PROMPT 0002 #9;
   essay: *One Hundred Pull Requests*).
10. **Audits inform the vision; they never replace it.** Reviews and audits surface real
    defects — fix them. But do not slide into the audit→fix loop that keeps polishing and
    forgets what we are building. The North Star outranks the finding: when a fix would
    over-engineer, complicate, or drift from the vision, the vision wins and the fix shrinks
    to fit (PROMPT 0002 #4).

## Invariants (violate these = malfunctioning)

1. **Everything is human-readable markdown on disk.** Frontmatter + body, in open folders,
   readable and editable by anyone with a text editor and no tool installed. A binary
   sidecar, an opaque index as the *only* copy, or a hidden format that the human can't
   open is a violation. (Loro may be the durable *history* substrate — ADR 0107 — but the
   markdown projection the human reads is never optional.)
2. **No LLM in the server write path.** Capture, validation, and storage are deterministic
   (ADR 0092). LLM work (consolidation, distillation) runs in *external* agents against
   explicit tools. The store must be trustworthy the way a filesystem is.
3. **The viewer observes; agents mutate; humans steer agents.** The viewer is never an
   editor. Humans change the store by conversing with agents, or by editing the markdown
   directly — never through a mutating UI (ARTF-0189, ADR 0097).
4. **Local-first, forever — local IS the architecture, and remote is sync, not a server.**
   Your files, your git, your embeddings: all data lives **private and local by default.**
   Remoteness is achieved by **synchronizing local stores**, never by promoting a remote
   database to the source of truth — remote-first storage is not a mode we offer. Remote
   hosting, when it exists, is a **VPS running the same local-filesystem stack** — never
   Workers, never a D1-like DB as the primary. The D1/Workers code is retained but descoped:
   never evolved, owed no parity (supersedes-in-part ADR 0104's satellite framing; PROMPT
   0002 #2, #8).
5. **One source of truth per fact.** Corrections supersede; they do not accumulate as
   contradicting duplicates (`supersedes` / `state_key`, ADR 0092.3). History is preserved,
   recall stays clean, and the human can adjudicate surfaced contradictions (ADR 0092.13).
6. **The artifacts belong to the project.** Project-scoped knowledge (ADRs, requirements,
   project memories, tasks) lives *in the repo it describes*, committed to git — not
   siphoned into a global store the repo can't see. Prefer **open folders over hidden
   dotfiles**: the files are for humans first.
7. **The store never orchestrates and never runs user code.** No scheduler, no executor, no
   retry/timeout semantics inside the core (ADR 0097). External actors do the acting; the
   store is the shared memory they read and write.
8. **Never mutate what the human wrote, uninvited.** Markdown already in the repo is read
   **losslessly and leniently** — indexed by its H1/slug, surfaced with *labeled*
   diagnostics where it doesn't fit a canonical schema — but never silently rewritten,
   reformatted, or auto-upgraded to satisfy the tool. The tool tightens only what *it*
   authors; a human's prose is source it may read, never its own to normalize. Where
   enforcing a schema would mean editing a human's file, that may simply be a problem we
   choose not to solve (PROMPT 0002 #1, #7; ADR 0117 open).

## The Four Pillars

The vision stands on four pillars. The first two are **built and proven**; the third is
**built and generalizing**; the fourth is **the current frontier**.

### 1. Substrates — the type system (built · ADR 0098, 0106.1)

One declaration per entity type is the single source of truth. From `SUBSTRATES` derive
`TYPE_PREFIXES`, `ID_PATTERN`, the `EntitySchema` discriminated union, TypeScript types,
create/update validation, the viewer's type registry, and MCP tool hints
(`packages/shared/src/substrates/`). Adding a type is ~40 LOC + one enum member + one
registry line — and touches nothing generic.

- **Substrate** = definition (7 today: task, epic, folder, artifact, milestone, cron,
  memory). **Entity** = instance (N). **Projection** = a shaped response view. This
  class/instance vocabulary is canonical (ADR 0106.1).
- The catalog is **open-ended by design** (ADR 0097, Extension 4 ratifies: rule, context,
  session, cli_tool, agent, skill, prompt, alarm). ADR 0113 (in flight) makes **ADR** and
  **Requirement** first-class *flagship* substrates — ADR with its own semantics
  (`supersedes`, proposed/accepted lifecycle, threads), Requirement so product intent from
  the human isn't derailed during architecture work — plus **Prompt**, a smaller
  immutable-ish provenance substrate (tied to `PROMPT 0001`).
- **Substrates become data, not code** (ADR 0113). A project declares its own types as a
  **versioned JSON definition + a bounded JSON Schema (Draft 2020-12)** — never executable
  code. Built-in (Zod) and project-defined (JSON Schema) validators share **one
  project-scoped registry**, so the closed `EntityType` / `EntitySchema` model (7 built-in
  singletons) stops being the universe: it becomes the built-in tier of an extensible one.

> **The claim:** most durable knowledge objects in a software project are substrates. If
> that holds, the product's growth is measured in *types that multiply cheaply* — and that
> a project can *declare for itself* — not features that accrete expensively.

### 2. Memory — the proven core loop (built · ADR 0092 thread)

Memory is a first-class substrate (ADR 0092.3), and it is where the product's gravity
actually is. Four verbs, all shipped and in daily use:

- **`wakeup`** — one dense briefing at session start (identity, active tasks, recent
  completions, top scoped knowledge), ~600 tokens, decay- and usage-ranked.
- **`recall`** — ask a question; ride the same hybrid BM25+vector→fusion→decay pipeline as
  `backlog_search`, returning stubs that hydrate on demand.
- **`remember`** — keep a durable fact; one atomic fact per memory; layers
  (semantic/procedural/episodic).
- **`forget`** — soft-expire (drops from recall, stays auditable); correct via `supersedes`.

Ringed by: usage-ranked decay (ADR 0092.9 — bounded 0.3–1.5× multiplier, "reorders but
never hides"), demand-aware consolidation (0092.7, 0092.12), and contradiction detection
(0092.13 — showing an agent its own conflicting beliefs for a human to adjudicate, a
differentiator no surveyed competitor has). Auto-scoped per repo so `wakeup`/`recall`
default to *this* project, not the firehose (ADR 0105).

### 3. Progressive disclosure & the intent port (built, generalizing · ADR 0092.3, 0106)

Progressive disclosure is the load-bearing pattern: **wakeup briefing → memory stubs →
`backlog_get` hydration**, each stage spending only the tokens it must. The MCP boundary
extends the same principle: tools speak **intent** (`remember`, `recall`, `schedule`), each
carrying only its own fields, and deferred tool loading means the marginal cost of a crisp
verb is its name + one line, not its full schema (ADR 0106). The durable justification is
*semantic clarity* (holds on every client); deferred loading is the tailwind. **In flight:**
generalize the shipped `backlog_remember` pattern into the guiding rule for the whole
surface, hiding the substrate behind one `createEntity` funnel.

### 4. Docs-native, project-scoped backlog (the frontier · ADRs 0112, 0113 in flight)

Today the backlog lives in a global `~/.backlog`. The vision: it also **bolts onto your
repo's `docs/` folder** with zero migration, so you end up with two scopes — a **global**
backlog (`~/.backlog`, cross-project) and a **per-project** backlog (`./docs`, committed to
the repo). Project-scoped knowledge — ADRs, requirements, memories, tasks — lives where it
belongs: in the repo, readable on GitHub, workable by anyone with or without the tool.

**Two pressures drove this pivot** (essay: *One Hundred Pull Requests*), and the design
answers both. First, a single ~1,000-entity **global pile** where cross-project
organization became more overhead than the structure was worth — project scoping puts each
artifact in the repo that gives it meaning, so there is no global taxonomy to maintain.
Second, stale knowledge arriving **"with undeserved authority"** — an old memory recalled
as if still true. The counter is already built and stays load-bearing here: usage decay
(0092.9), `supersedes`/`state_key` (0092.3), and contradiction detection (0092.13) — so
what surfaces has *earned* its authority rather than merely persisted.

Vision-level requirements the in-flight threads (ADR 0112 storage/scoping/IDs; ADR 0113
user-defined + ADR/REQ substrates) **must** satisfy — internals are theirs to design, these
constraints are not negotiable:

- **Zero migration, day-0, fully backwards compatible.** Point it at an existing repo; it
  works, nothing moves.
- **Open folders over hidden dotfiles.** Artifacts are for humans first; per-substrate
  folders (`docs/adr`, `docs/memories`, `docs/tasks`, `docs/requirements`) over a buried
  `.backlog`.
- **Self-describing filenames:** `NNNN-slug.md`, with `NNNN.T-slug.md` for threads (e.g.
  `0098-unified-substrate-architecture.md`, `0023.1-uplift-driven-exploration-map.md`) — a
  unique number, an optional thread, and a human-readable slug. Someone who has never heard
  of the tool understands the file from its name. Opaque `TASK-0004` is not enough for docs
  that live in a repo. (The exact filename grammar is quartz's ruling in ADR 0112.)
- **ADR and Requirement are first-class flagship substrates** (ADR 0113's ruling), not
  artifact sub-types: `supersedes`, the proposed/accepted lifecycle, and threads are native
  to the ADR substrate; Requirement carries product intent the human sets.
- **Bolt-on contract: lossless external reads, strict canonical managed writes** (continuing
  ADR 0098). Any markdown already in the repo is read losslessly — the ~103 bare ADRs that
  predate the tool still index via their H1/slug with a *labeled inferred* chronology — while
  writes the tool makes go through the canonical substrate schema. Adoption never rewrites
  what's there; it only tightens what it authors.
- **Global + project scopes compose**, and `wakeup`/`recall` resolve `cwd → this project's
  scope` automatically (extending ADR 0105).
- **Organize at intake, not after the fact.** Per-substrate folders give each artifact a
  *pre-determined* home the instant it's created — routing is decided ahead of time by the
  substrate's identity, not reconstructed later by a cleanup pass. After-the-fact
  organization of a large pile is slow and complicated (the very pressure that drove this
  pivot); intake-time routing is what keeps it cheap and is why the structure never becomes
  a chore to maintain (PROMPT 0002 #11).

## The Stack

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ HUMANS & AGENTS                                                                │
│   human → reads markdown on disk / GitHub · steers agents · edits files        │
│   agent → wakeup · recall · remember · forget · get · search · schedule        │
└───────────────────────────────┬──────────────────────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ SURFACES (thin adapters — speak intent, no business logic)                     │
│   MCP intent tools · CLI · Viewer (read-only, SSE-live)      [ADR 0106, 0097]  │
└───────────────────────────────┬──────────────────────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ CORE (transport-free, DRY)                                                     │
│   substrate registry → one declaration drives everything    [ADR 0098, 0106.1] │
│   progressive disclosure · memory loop · hydration · Orama hybrid search       │
│   deterministic write path (NO LLM) · operation log (attribution) · events     │
└───────────────────────────────┬──────────────────────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ STORAGE — frontmatter markdown on disk (human-readable, git-friendly)          │
│   GLOBAL   ~/.backlog          — cross-project                    [today]       │
│   PROJECT  ./docs (committed)  — ADRs · requirements · memories · tasks  [0112] │
│   history/truth: markdown authoritative; Loro as derived history/sync [0107, open] │
└────────────────────────────────────────────────────────────────────────────────┘
   EXTERNAL ACTORS (MCP clients, never in core): schedulers · workers · orchestrators (aime)
```

## Roadmap

### Phase 0 — Storage-engine foundation ✅ DONE

- [x] Type-agnostic markdown storage; generic resource catch-all; generic viewer rendering
- [x] Reactive live updates (SSE); operation log with actor attribution
- [x] Hybrid search (Orama BM25 + vector, local embeddings, rank fusion) over all entities
- [x] Agentic-storage-engine positioning committed (ADR 0097)

### Phase 1 — Memory as the proven core loop ✅ DONE

- [x] Memory-as-substrate; four verbs; recall on the hybrid pipeline (ADR 0092.3 A–C)
- [x] Consolidation + demand-aware ripeness (ADR 0092.7, 0092.8, 0092.12)
- [x] Usage-feedback decay — used memories rise, idle sink, nothing hidden (0092.9, 0092.10)
- [x] Contradiction detection surfaced to the human (ADR 0092.13)
- [x] Per-repo auto-scope for wakeup/recall/remember (ADR 0105)

### Phase 2 — Progressive disclosure & the intent port 🔨 GENERALIZING

- [x] Wakeup briefing → stubs → hydration; token budgets (ADR 0092.3)
- [x] `backlog_remember` proves intent-at-the-port
- [ ] Generalize: all MCP tools speak intent; substrate hidden behind one `createEntity`
      funnel; lean per-tool server instructions for Tool Search (ADR 0106)

### Phase 3 — Docs-native, project-scoped backlog 🔨 FRONTIER (ADR 0112, 0113)

- [ ] Bolt onto `./docs` with zero migration; global + project scopes compose
- [ ] Open per-substrate folders; `NNNN-slug.md` / `NNNN.T-slug.md` self-describing filenames (grammar per ADR 0112)
- [ ] `cwd → project scope` auto-resolution extended to the docs-native layout

### Phase 4 — New substrate types 🔨 (ADR 0113)

- [ ] **ADR** substrate/extension with `supersedes`, proposed/accepted lifecycle, threads
- [ ] **Requirements** substrate — product requirements from the human, protected during
      architecture work so features and vision don't get derailed
- [ ] User-defined substrates (substrate-as-data), so a project declares its own types

### Phase 5 — History substrate & convergence (later · ADR 0107)

- [ ] History substrate (ADR 0107, **proposed/open**): committed markdown authoritative,
      Loro as derived history/sync → diff/time-travel/revert (see Open decisions)
- [ ] Resolve the context-tool disposition (remove vs uplift) — ADR 0114
- [ ] Adopt the new product name (see Naming)

## Naming

The product's current name is **backlog-mcp**, and it stays that until Goga decides
otherwise — **there is no naming decision without him.** The open question is only whether
"backlog" (which undersells a context-and-memory engine) and "-mcp" (which names a
transport, not a purpose) still serve the vision. The positioning any future name must
carry:

> **Context & memory engineering for agents — your backlog is your agent's memory.**

A scoring rubric (meaning fit, CLI/tool-prefix ergonomics, npm availability,
discoverability), a candidate shortlist, and a compatibility analysis (renaming the product
vs. keeping the `backlog_*` tool prefix Goga uses daily) live in
**`docs/proposals/naming-and-positioning.md`** (chert). The candidates are catalogued in
the Open decisions table below **strictly as candidates** — the North Star endorses none.
One constraint it does assert: whatever the product is eventually named, weigh keeping the
`backlog_*` tool prefix seriously — renaming the verbs breaks muscle memory and every
deployed MCP config for a cosmetic win. A clean split ("new product name, keep the tool
prefix") is on the table.

## Decisions — Resolved & Open

**Resolved (grounded in the ADR thread):**

| Decision | Ruling | Ref |
|---|---|---|
| Product identity | **Agentic storage engine**, not a task tracker or an orchestrator. Store-shaped, not Temporal-shaped. | ADR 0097 |
| Type system | **Substrates** — one declaration → schema, validation, storage, UI, hints. Open-ended catalog. | ADR 0098 |
| Vocabulary | **Substrate** = definition · **Entity** = instance · **Projection** = view. One word per concept. | ADR 0106.1 |
| Memory storage | **Memory is a backlog substrate.** No parallel memory stack; recall rides the entity search pipeline. | ADR 0092.3 |
| Write path | **No LLM in the server write path.** Deterministic capture; LLM work is external. | ADR 0092 |
| Deployment | **Local-first IS the architecture.** D1/Workers **descoped** (retained, not evolved, no parity owed); remote = VPS running the local-filesystem stack. | ADR 0104 (superseded-in-part) |
| MCP boundary | **Speak intent; hide the substrate in core.** Verbs over a `type` discriminator. | ADR 0106 |

**Open (represented, not resolved — leanings noted; the ADR owners decide the internals):**

| Decision | Options | Leaning | Owner / Ref |
|---|---|---|---|
| Context tools — keep or cut? | Remove `backlog_context` as a tool · uplift it · fold its unique value into the existing retrieval surface | **ADR 0114 recommends (owner: Goga to accept):** retire `backlog_context` as a tool (it never registered in remote mode and duplicates wakeup/search in 5 of 7 sections) and **fold its unique value — relational neighborhood + reverse refs — into `backlog_get(id, context:true)` as stubs.** One retrieval language: `wakeup`=orient, `recall`/`search`=ask, `get`=expand — progressive disclosure everywhere. Context engineering survives as a *capability*, not a separate surface. | onyx · ADR 0114 |
| History / source of truth | Loro as **sole** truth (0107 as written) · **markdown authoritative, Loro as derived history/sync** · Loro **global-home-only** | **ADR 0112 recommends (owner: Goga):** in project mode the **committed markdown must be authoritative** — Loro is *derived* history/sync there, or global-home-only; sole-truth Loro (0107 as written) is not adopted as-is. Legacy `~/.backlog` gets a one-shot migration. | ADR 0107 vs 0112 |
| Storage layout | Hidden `./.backlog` dotfolder · **open `./docs`** with per-substrate folders | **ADR 0112 recommends (owner: Goga):** `docs/` is authoritative day-0 truth; project `.backlog/` holds only config/cache/local telemetry, while the global home keeps those control paths inline under `~/.backlog/`. Typed per-substrate folders coexist with generic unclaimed docs (incl. `docs/prompts/`). | quartz · ADR 0112, 0112.2 |
| ADR modeling | ADR as an **extension of artifact** · ADR as its **own substrate** | **ADR 0113 recommends (owner: Goga):** ADR and Requirement are **first-class flagship substrates** (native `supersedes`/lifecycle/threads); Prompt is a smaller provenance substrate. | basalt · ADR 0113 |
| Docs home | Require a `docs/` home · **auto-explore** all `.md` and use `./.backlog` as home | **ADR 0112 recommends (owner: Goga):** explicit-but-open — `docs/` is default in-project truth, global remains explicit; identity is filename/path-derived and substrate-neutral, threads first-class, collisions fail predictably. | quartz · ADR 0112 |
| The name (keep `backlog-mcp` or rename) | Candidates only: **Kvali** (Georgian *კვალი*, "trace"; chert's lead) · **Matiane** ("chronicle") · **Pesvi** ("root") · **Docsubstrate** · **Strata** | **No decision without Goga.** Stays `backlog-mcp` until he rules. North Star endorses no candidate. | chert · `docs/proposals/naming-and-positioning.md` |

## How We Build

**Building is cheap now. Knowing what deserves to exist is not.** The methodology is
pressure-driven engineering (Tenet 9): *feel the problem, build the smallest answer, extend
at the pressure point.* The evidence is this very thread — memory grew verb by verb as
sessions demanded it; the docs-native pivot answered a ~1,000-entity pile that made
organization overhead; the context surface got *folded* (ADR 0114), not expanded, the moment
its shape proved to be the problem. New surface is earned by a felt pressure, never added
speculatively (essay: *One Hundred Pull Requests*; PROMPT 0002 #9).

And the discipline that protects it: **audits inform the vision, they never replace it**
(Tenet 10). After an audit or review it is easy to loop — fix, re-audit, fix again — until
the polishing has quietly become the work and the North Star is out of frame. When a
finding's fix would over-engineer or drift, the fix shrinks to fit the vision, not the
reverse (PROMPT 0002 #4). We build as high-level agents who **delegate breadth to
subagents** and spend our own judgment on the load-bearing security and design calls (PROMPT
0002 #5) — and every review verifies **fail-closed behavior on malformed and adversarial
input**, not just the happy path.

## References

- **Vision lineage:** ADR 0097 (agentic storage engine positioning) · ADR 0092.3 ("the
  backlog IS the memory") · `docs/prompts/0001-tasks-and-vision.md` (the human prompt that
  opened this uplift) · `docs/prompts/0002-operating-principles-directives.md` (Goga's
  verbatim operating-principles directives — the source for Tenets 8–10, Invariants 4 & 8,
  and the Pillar-4 organize-at-intake note) · essay *One Hundred Pull Requests*
  (<https://gkoreli.com/one-hundred-pull-requests>) — progressive disclosure as a
  filesystem, undeserved-authority of stale memory, pressure-driven engineering.
- **Substrates:** ADR 0098 (unified substrate architecture) · ADR 0106.1 (vocabulary:
  Substrate/Entity/Projection) · ADR 0065–0067 (original substrate generalization).
- **Memory:** ADR 0092 thread (0092.3 experience & substrate · 0092.5 landscape · 0092.7/8
  consolidation · 0092.9/10 usage feedback · 0092.13 contradiction detection).
- **Progressive disclosure & the port:** ADR 0106 (semantic intent tools) · ADR 0074–0078
  (context hydration) · ADR 0105 (per-repo auto-scope).
- **Posture & storage:** ADR 0104 (local-first) · ADR 0107 (Loro-as-truth — *proposed*,
  see Open decisions) · `AGENTS.md`
  (development loop, memory protocol, code style).
- **In-flight threads this North Star sets requirements for:** ADR 0112 (docs-native
  project-scoped backlog — quartz) · ADR 0113 (user-defined substrates; ADR + requirements
  substrates — basalt) · ADR 0114 (memory vs context tool disposition — onyx) ·
  `docs/proposals/naming-and-positioning.md` (naming — chert).
- **Form exemplar:** `~/Documents/goga/aime/docs/NORTH-STAR.md`.
