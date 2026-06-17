---
title: "0106. Semantic Intent-Tools at the MCP Boundary — Hide the Substrate in Core"
date: 2026-06-17
status: Proposed
backlog_item: TASK-0688
---

# 0106. Semantic Intent-Tools at the MCP Boundary — Hide the Substrate in Core

**Date**: 2026-06-17
**Status**: Proposed (vision / north star)
**Backlog Item**: TASK-0688
**Thread**: substrate architecture → continues ADR 0098; enabled by ADR 0105 (per-repo config)
**Vocabulary**: uses the canonical terms from ADR 0106.1 (Substrate = definition, Entity = instance, Projection = response view) — verbs map to `createEntity`, never `createItem`/`createTask`
**Thread children**: 0106.1 (vocabulary glossary) · 0106.2 (Task-as-Entity rot cleanup) · 0106.3 (storage layer restructure)

## North Star

> The MCP surface should speak the **consumer's intent language** — `remember`,
> `recall`, `schedule`, `add_artifact` — not the **storage layer's** language
> (`create(type=memory)`). The `Substrate` / discriminated-union abstraction is
> an *internal core model*; the client never needs to know it exists. Embrace
> semanticness at the port so the agent operates fluidly; keep the unifying
> abstraction in core so the implementation stays DRY.

This is hexagonal architecture applied to the MCP boundary: a **port speaks the
domain's language, not the database's.** `backlog_remember` already proves the
pattern works (ADR 0092.3). This ADR generalizes it into the guiding principle
for the whole tool surface.

## Problem — the substrate leaked to the surface

The storage abstraction climbed all the way up to the tool contract:

- `backlog_create` takes a `type` enum + a **flat superset** of every type's
  fields (`schedule`, `command`, `enabled`, … alongside `title`, `description`).
  Evidence: `packages/server/src/tools/backlog-create.ts:14-29`.
- This forces the agent to think like the **persistence model** (pick a type,
  know which fields belong to it) instead of like itself ("I want to schedule a
  job", "I want to remember this").
- The flat list is **hand-maintained** and already **drifts** from the
  substrates: `backlog_create` exposes `schedule/command/enabled` but **not**
  `due_date/content_type`; `backlog_update` exposes `due_date/content_type/
  last_run/next_run` but the lists don't match. Three copies of "what fields can
  an entity have" exist — the substrate schema (truth), `CreateTaskInput`
  (`storage/schema.ts:18`), and each tool's `inputSchema`.
- Memory was special enough that the team **already abandoned** the generic path
  for it: you cannot create a valid memory via `backlog_create` (no `layer`,
  `kind`, `state_key`, `supersedes`, …). `backlog_remember` exists precisely
  because intent-shaped tools are better for rich types. We are generalizing the
  decision the team already made once.

### Why "one fat create command" is the wrong abstraction for the consumer

- Intent is higher-bandwidth than a `type` discriminator. A verb names *what the
  agent wants*; an enum names *what the database stores*.
- The fat schema pays a context cost even in sessions that create **nothing** —
  an engineering/refactor/debug session still carries every type's field prose.
- Cross-type field bleed is a constant validation and teaching hazard
  (`schedule` on a task is meaningless but must be rejected).

## Enabling shift — harnesses now defer tool loading (evidence)

The historical reason to *minimize* tool count was context bloat: every tool's
full JSON schema loaded upfront. **That constraint has materially relaxed**, which
is what makes "more, narrower, semantic tools" the right call now rather than a
token-budget sin.

- **Claude Code — MCP Tool Search (default-on).** From the Claude Code MCP docs
  (`code.claude.com/docs/en/mcp`, §"Scale with MCP Tool Search"):
  - *"Tool search keeps MCP context usage low by deferring tool definitions until
    Claude needs them. Only tool names and server instructions load at session
    start."*
  - *"Tool search is enabled by default … Only the tools Claude actually uses
    enter context."*
  - Toggles: `ENABLE_TOOL_SEARCH=false` (off), `=auto` (load upfront if within
    10% of context, defer the overflow).
  - **Server-instructions field becomes the discovery surface**: *"Server
    instructions help Claude understand when to search for your tools, similar to
    how skills work."*
- **Anthropic API — `advanced-tool-use-2025-11-20` beta** (anthropic.com
  engineering, "advanced tool use"):
  - **Tool Search Tool**: mark tools `defer_loading: true`; deferred tools stay
    out of context until searched; preserves prompt caching; reported **~85%
    token reduction** plus accuracy gains (Opus 4.5 79.5%→88.1%).
  - **Programmatic Tool Calling**: orchestrate tools in sandboxed code so
    intermediate results bypass context (~37% reduction on complex tasks).
  - **Tool Use Examples** (`input_examples`): invocation accuracy 72%→90%.

**Consequence for us:** the marginal always-on cost of adding a semantic verb is
roughly *its name + a one-line instruction*, not its full schema. So a surface of
many crisp intent verbs is **cheaper and more discoverable** than one fat generic
verb whose purpose is buried in a `type` enum.

### Honesty caveat — don't over-rotate on the token argument

- Tool Search is **Claude Code-specific** (default) and an **API beta**. "All CLI
  agents already do this" is an overstatement — clients without deferral still
  inline the full manifest. So the **durable** justification is *semantic
  clarity / correct tool selection*, which holds on every client. Deferred
  loading is a strong **tailwind**, not the load-bearing wall. We design for
  semantics first; the token win is a bonus where the harness supports it.

## Decision

1. **The MCP boundary speaks intent.** Tools are named for what the consumer
   wants to do, not for the entity type they happen to persist. Each tool's input
   schema carries **only its own fields** — no `type` discriminator, no
   cross-type superset.
2. **The substrate stays in core, hidden.** Every intent-tool is a *thin adapter*
   that maps intent → a single internal funnel
   (`createEntity` → `EntitySchema.parse`). All validation, defaulting, and
   cross-type rejection lives in core. Tools contain no business logic.
3. **Lean server instructions per tool** are first-class — they are what Tool
   Search matches against. Write them like skill descriptions: "use this when …".
4. **More tools than needed is acceptable**, because deferred loading makes the
   marginal cost a name + instruction. Prefer clarity (one intent per tool) over
   minimizing tool count.

### Enabling core change (folds in the `createTask` fossil)

`backlog_remember` works because it funnels into one core path. Generalizing
requires that funnel to be clean:

- Rename `createTask` → **`createEntity`** and `CreateTaskInput` →
  **`CreateEntityInput`** (`storage/schema.ts`). The names are pre-substrate
  fossils — the function already returns the discriminated `Entity` and builds
  folders/crons/milestones today.
- **Derive the input type from the union**: `z.input<typeof EntitySchema>`
  (minus server-stamped `created_at`/`updated_at`, with `type` optional). The
  union already *is* a fully-discriminated, per-type, validated input with
  cross-type rejection and default application — proven at runtime:
  - task without `status` → defaulted to `open`
  - task with `schedule` → **rejected** `Unrecognized key: "schedule"`
  - cron without `enabled` → defaulted to `true`
- This **deletes** the hand-maintained field list and the `if (x !== undefined)`
  ladder (the ladder only existed to strip undefined cross-type keys out of a
  flat bag before hitting `.strict()`; a per-type-shaped input has none).
- Drops dead fields (`due_date/content_type/path` on `CreateTaskInput` are
  reachable only by tests — `CreateParams` in `core/types.ts` never carries them).

Every semantic verb then leans on this one funnel — DRY is preserved, it just
moves from "one fat tool" to "one core factory."

## Options considered

### Option A — Status quo: one fat `backlog_create(type=…)`
- **Pros**: one tool; familiar CRUD; already shipped.
- **Cons**: leaks storage model to the consumer; flat superset drifts from
  substrates (already does); can't express rich types (memory already escaped to
  its own verb); pays context cost in no-create sessions.
- **Verdict**: rejected as the *primary* surface — it is the thing we are moving
  away from. Retained as a back-compat alias (see Migration).

### Option B — Lean `create` + a `describe_type` discovery tool
- **Pros**: agent pulls field specs on demand; smaller static schema.
- **Cons**: **requires agent discipline** (LLMs call `create` immediately rather
  than discovering first); *adds* round-trips for required-field types (cron:
  create blindly → fail → describe → retry); now redundant with harness-native
  Tool Search, which already does deferred discovery better and without a custom
  tool.
- **Verdict**: rejected — Tool Search supersedes the need for a bespoke discovery
  tool, and pull-based discovery fights agent behavior.

### Option C — Semantic intent-tools at the port; substrate hidden in core (**chosen**)
- **Pros**: consumer speaks intent (fluid agent operation); each schema is lean
  and self-documenting at point of use; discoverable via Tool Search server
  instructions; rich types are first-class (no escape hatch needed); core stays
  DRY behind one funnel; harness-independent on the *semantic* axis.
- **Cons**: naming taxonomy becomes a design surface requiring taste/consistency;
  N adapters must all funnel to core or re-duplicate logic; capability
  discoverability shifts onto names + instructions; migration/back-compat work
  for the shipped `backlog_create`.
- **Verdict**: chosen. It is the principled port design, it matches where the
  harnesses are going, and it generalizes a decision (`backlog_remember`) the
  team already validated.

## Brutal critique of the chosen option

1. **Naming is now load-bearing.** `remember`/`recall` are obvious; `schedule`
   vs `create_cron`, `add_artifact` vs `attach`, are not. A bad verb is worse
   than a neutral `type` field. **Mitigation**: an explicit naming rubric —
   `verb` or `verb_noun`, one intent per tool, no storage nouns
   (`substrate`/`entity`) and no `type` discriminators in the public name.
2. **DRY moves, it doesn't vanish.** N thin adapters can re-duplicate validation
   if undisciplined. **Mitigation**: tools are dumb mappers; *all* logic in
   `core/*`; the `createEntity` funnel is mandatory. CI/review guard: a tool file
   must not import Zod entity schemas directly for validation — it calls core.
3. **Capability discoverability.** A verb the agent doesn't know is invisible
   (vs. an enum that lists all types). **Mitigation**: crisp server instructions
   (Tool Search's matching surface); optionally one `backlog_help`/index tool.
4. **Token argument is harness-conditional.** On clients without Tool Search the
   manifest is still inlined. **Mitigation**: justify on semantics (universal),
   bank tokens only where deferral exists; keep per-tool schemas lean regardless.
5. **Two-phase writes vs memory ADD-only.** If any verb implies create-then-enrich
   it brushes ADR 0092.5 R-1 (memory corrections go via `supersedes`/`state_key`,
   not mutation). **Mitigation**: intent verbs write complete in one call — no
   skeleton-then-patch — sidestepping the tension entirely.

## Migration & backward compatibility

- **Additive first.** Introduce semantic verbs alongside the existing tools; do
  not break `backlog_create`/`backlog_update`.
- **`backlog_create` becomes a generic alias** (escape hatch / back-compat),
  internally calling the same `createEntity` funnel. Keep it; deprecate only if
  evidence shows it unused.
- **Start narrow, expand by evidence.** First cut: keep the common-case generic
  create, add intent verbs only where they clearly win (memory already has
  `remember`; cron → `schedule`). Avoid betting the full taxonomy up front.
- **Core cleanup is independent and safe**: `createTask`→`createEntity` +
  union-derived input can land first as a pure refactor (1 prod caller, 1
  re-export, ~50 mechanical test sites), unblocking the verb work.

## Consequences

**Positive**
- Agents reason in intent; tool selection accuracy improves (matches the
  `input_examples`/instructions-as-skills direction).
- Static field-list drift is eliminated — one substrate truth, derived inputs.
- Rich entity types are first-class without escape hatches.
- Context cost of the surface drops on Tool Search-capable harnesses.

**Negative / costs**
- A taxonomy to design and govern (naming rubric required).
- More tool files (thin adapters) to maintain — acceptable given they are dumb.
- Back-compat surface (`backlog_create` alias) lingers.

**Risks**
- Verb sprawl without governance → mitigated by the rubric + "start narrow".
- Over-reliance on Tool Search → mitigated by semantic-first justification.

## Implementation notes (when promoted from Proposed → Accepted)

1. Land core refactor: `createTask`→`createEntity`, input = `z.input<EntitySchema>`
   minus server fields, delete the if-ladder + dead fields, update callers/tests.
2. Define the naming rubric in this ADR's appendix before adding verbs.
3. Add intent verbs incrementally; each is a thin adapter → `createEntity`/core.
4. Write lean server instructions per tool (Tool Search discovery surface).
5. Keep `backlog_create` as alias; measure manifest footprint before/after as
   evidence (instrument the tool manifest token size per tool).

## Open questions

- First-cut taxonomy scope: narrow (memory + cron only) vs broad (all types)?
- Back-compat horizon for `backlog_create` — keep indefinitely vs deprecate?
- Gating (ADR 0105 config) as an *additional* lever for clients without Tool
  Search — worth it, or does deferral make it moot?
