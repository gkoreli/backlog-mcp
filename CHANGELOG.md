# Changelog

All notable changes to `backlog-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).
Version numbers refer to the published `backlog-mcp` server package; the viewer is
bumped in lockstep. Entries lead with what you can now do; the italic note under
each version says why it mattered on the road to the north star
(`docs/NORTH-STAR.md` — *your backlog is your agent's memory*). This changelog
begins at 0.57.0 — earlier history lives in git.

## [Unreleased]

*The global backlog and the project's docs start behaving like one memory: a single
question now draws on both. And wakeup begins carrying the product requirements an
agent must not derail — the line of the Cold-Open briefing that protects the vision
itself, and one of the founding asks of the vision prompt.*

### Added
- **Ask once, get answers from every backlog (ADR 0112 Phase D).** A read can now
  fan out across backlog homes — your global `~/.backlog` and the project's docs —
  with results fused deterministically (reciprocal-rank fusion over each home's own
  ranking) and a home that is degraded or not yet ready reported honestly instead of
  silently dropped. Available from both the MCP tools and the CLI; the fusion
  contract is fixed in ADR 0112.1.
- **Usage tracking follows the backlog into the repo (ADR 0112 Phase D).** Which
  memories you actually use is now tracked per home: project usage lives in a local
  overlay — committed markdown is never rewritten to store it — and merges with
  global usage behind the single store boundary ADR 0115 established, so
  usage-ranked recall keeps working when a backlog spans homes. Usage minting stays
  scoped to built-in memories.
- **Requirements now brief the agent before work starts (ADR 0113.1).** The
  `wakeup` briefing gains a bounded **constraints** section: requirement documents
  appear as budget-bounded stubs ordered worst-first (violated → at-risk →
  unchecked → recently satisfied), each carrying its compliance status and how
  stale its last check is. `backlog_get(context)` adds typed compliance relations —
  a requirement shows what it spawned and what violates it, with the violation
  visible on the stub before any hydration. Product requirements survive
  architecture work instead of getting derailed — the ask that opened the vision
  prompt (PROMPT 0001).
- **Substrate intents compile into tool contracts (ADR 0113).** A substrate
  definition can now declare the semantic write intents it supports, and the
  compiler turns those declarations into safe, validated tool contracts (an opaque
  compiled DTO — data, never executable code). This is the seam the intent write
  surface (ADR 0106.5) builds on.

### Changed
- **Layout and config rulings accepted, landing via Phase E** *(in progress via
  ADR 0112.2/0112.3)*: the control folder is renamed `.backlog-mcp` → `.backlog`
  (name the thing, not the wire protocol); the global home flattens — no nested
  control dir and one flat `config.json`, with the base-plus-local-override split
  kept for project homes only; and `BACKLOG_SCOPE` becomes `BACKLOG_CONTEXT`,
  because it selects a context *inside* a home, not the home itself.

## [0.60.0] — 2026-07-16

*The release where a repo's docs folder starts becoming a real backlog home: the
server runs one runtime per home, so a project's committed `docs/` works beside the
global backlog with nothing moved — the zero-migration bolt-on the Cold-Open Test
demands. And substrates become data, so a new knowledge type costs a declaration,
not a subsystem.*

### Added
- **Every change now says what it meant (ADR 0106.5 Phase A).** All creates and
  updates flow through one core funnel that records *which tool meant what*: the
  operations journal carries semantic mutation attribution, and the viewer's
  activity panel can tell an intent (say, a `remember`) apart from a raw edit.
- **The backlog can live inside each project's repo (ADR 0112 Phase B).** The
  server runs a separate local runtime per backlog *home* — selected per MCP tool
  call and per HTTP request, with isolated storage and event streams — so your
  global `~/.backlog` and a project's `docs/` folder work side by side. The CLI can
  target a home explicitly and scopes direct commands to the invoking runtime, the
  server reports which home each response came from, and the viewer scopes its
  state by the selected home. Ships the docs-native filesystem store.
- **A project can declare its own document types (ADR 0113 Phases A–B).** ADR,
  requirement, and prompt documents become data rather than code: a runtime
  substrate compiler and a per-project substrate registry compile the packaged
  substrate definitions, and writes route through the registry. Agents can create
  and edit substrate documents through the tool, and a project can declare a new
  type as a JSON definition plus a bounded JSON Schema — no code change.

### Changed
- The viewer renders Markdown through the nisli `resource()` path, retiring the
  ADR 0111 workaround (requires `@nisli/core` 0.54.0).
- The documentation now tells the context-and-memory-engineering story:
  NORTH-STAR tenets and invariants distilled from Goga's verbatim directives
  (PROMPT 0002), plus a full README uplift.

### Fixed
- The runtime fails closed across claim and tool boundaries and preserves
  substrate contracts when routing across homes.
- The CLI rejects contradictory home selections; the viewer isolates home-scoped
  request state and uses canonical home cache keys.

## [0.59.0] — 2026-07-16

*The groundwork release: documents on disk gain identity and discovery so a repo's
`docs/` can be read as a backlog, and recall stops asserting authority it hasn't
earned — every memory now says how old it is and how much it's used. One retrieval
language starts here: wakeup orients, recall asks, get expands.*

### Added
- **The backlog can live as documents on disk (ADR 0112).** Foundations for the
  docs-native backlog: document identity, discovery, and home resolution; exported
  docs-native core APIs; a docs-tree file watcher so edits on disk are seen live;
  and a built-in substrate storage catalog.
- **Memories now tell you whether to trust them (ADR 0115).** Recall results carry
  provenance, and `wakeup` knowledge stubs surface `age_days` and usage counts, so
  an agent can weigh how fresh and how proven a memory is before leaning on it.
- **Related items arrive inline with `backlog_get` (ADR 0114).** `backlog_get(context)`
  folds an item's relational neighborhood in as role-grouped stubs, and the memory
  protocol gains an explicit *expand* step.

### Changed
- Repositioned the product as **context & memory engineering for agents** —
  updated README, npm package description, and keywords.
- North-star scope narrowed: dropped the D1/Workers path — local-first *is* the
  architecture.

### Removed
- **The `backlog_context` tool and its hydration pipeline (ADR 0114).** Relational
  context now flows through the memory verbs and `backlog_get(context)` — one
  retrieval language instead of two overlapping surfaces.

### Fixed
- Date-prefixed and date-named documents are recognized as generic documents and
  no longer collide on identity.

## [0.58.0] — 2026-06-19

*The other half of the Cold-Open Test is a human reading the backlog with nothing
installed but a browser — this release just makes that window ~20 MB lighter.*

### Changed
- The viewer ships a fine-grained Shiki syntax-highlighting bundle, cutting the
  built viewer from ~36 MB to ~16 MB for faster loads.

## [0.57.0] — 2026-06-19

*A memory you can see includes seeing its changes: diffs stay readable in the
human's read-only window, with one heavyweight dependency gone.*

### Changed
- The viewer renders diffs with a custom, lighter-weight renderer in place of
  diff2html.
