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

### Fixed
- **`get` accepts plain paths.** `get README.md` and `get docs/adr/0116-….md`
  now resolve exactly like their `mcp://backlog/...` forms; unknown paths return
  a loud "Not found" instead of silent empty content. (Both acceptance reruns
  burned a wasted agent call on this.)
- **Document status is searchable (BUG-0003).** Search stubs carry the declared
  status, and `--status` filters match freeform values ("Accepted (goga,
  2026-07-16)") by the same leading-token rule wakeup uses — one shared
  implementation, applied everywhere.
- **`--sort recent` no longer degrades search.** Recency now reorders the same
  hybrid retrieval set deterministically instead of silently swapping engines
  and shrinking results. (Known data gap: docs-native documents without
  `updated_at` keep relevance order — recency has nothing to sort them by yet.)
- **An acknowledged write is searchable when the ack returns (ADR 0116 Phase
  1A).** Search initialization is now single-flight — concurrent first searches
  share one index build instead of racing duplicates — and every index mutation
  runs on one awaited, ordered chain, so same-entity updates can no longer
  reorder and an add-then-delete can no longer leave a searchable ghost. Full
  reconciliation runs on the same chain, closing the lost-write window the old
  pending-ops queue left between drain and ready. Ranking is untouched (ADR
  0121 freeze): fusion, scoring, and the judged-fixture behavior are unchanged.

### Added
- **The briefing teaches the memory protocol (ADR 0118.1-A + flywheel F1).**
  Wakeup's final block is now a two-line rubric: when to recall (before
  re-deriving, on unfamiliar identifiers, before contradicting a recorded
  decision) and when to remember (a lesson proven by failure, a changed
  decision, a fact that cost tokens — written at your own checkpoint, in your
  own words, never summarizing another agent's work). A README recipe wires
  Claude Code SessionStart and compaction hooks to deliver it; the briefing
  itself is the delivery vehicle because harness end-of-session hooks cannot
  reach the model.
- **The briefing enforces a hard wire ceiling.** A deterministic yield ladder
  (activity → completions → declared sections → knowledge → orientation →
  epics → tasks) trims one item at a time when a payload would exceed 3,072
  bytes, records exactly what yielded in a `truncated` ledger, and never trims
  identity, focus, constraints, vision, quarantine, or the rubric. Transport
  redundancy removed product-wide: `generated_at` dropped, zero-valued
  omission counters now absent-means-complete.
- **Agents are knowledge, and writes may carry their identity (ADR 0119
  Slice A).** The Agent substrate ships as a pure project declaration —
  `docs/substrates/agent.json`: id, title, content, role, harness, and a
  scalar namespaced `principal` (R2) — searchable via its declared
  projection, invisible in wakeup, zero substrate-specific product code.
  Writes MAY name an agent: `--as <agent>` on the CLI write commands
  (create/update/edit/delete/remember), the `BACKLOG_AGENT` env var, or the
  optional `as` field on `backlog_remember`. The identity rides the existing
  actor seam into the operation journal and memory provenance, and recall
  renders `by granite` when a source resolves to an agent doc — exact
  id/principal match only; duplicate principals fail closed. Absent identity
  is byte-identical to before: optional, modular, never forced (PROMPT
  0003). This fixes the class of bug where an orchestrator's memories read
  "by goga" — first-person memory (PROMPT 0006) now knows whose first
  person. granite is registered as the first live agent (`docs/agents/`),
  and the nine-agent fleet fixture (R8) pins compile, search, round-trip,
  fail-closed resolution, and wakeup invisibility.
- **Install by telling your agent (SKILL.md).** The whole setup is now one
  message: *"Read <repo>/SKILL.md and follow it to install backlog-mcp."* The
  agent detects its harness (Claude Code, Cursor, Codex, generic MCP, or
  CLI-only), registers the server, runs the first wakeup, and verifies git
  stayed clean and the briefing stayed under budget — with exact fallbacks and
  a report-back template. Claude Code and CLI paths live-verified.
- **`wakeup(operation=…)` — the Amnesia Test's missing argument.** A fresh agent
  handed nothing but one wakeup call with an operation ID receives that
  document's live state as the briefing's leading FOCUS centerpiece — goal,
  next action, and constraints in a single payload — with non-focal sections
  yielding budget deterministically (constraints never yield). Works for any
  substrate that declares wakeup disclosure; unknown or closed IDs error
  honestly with live candidates. The Amnesia CI gate now proves the argument
  itself (8 → 13 assertions).
- **Worktrees know their family (Lattice W1, PROMPT 0003).** A backlog home in a
  linked git worktree now resolves its *family* — the main checkout, its branch,
  and the default branch — and the briefing's meta section says so in one line:
  `worktree: <family> @ <branch>, N behind main`. A canonical read path can fetch
  a file's committed content from the family's default branch, pinned to a SHA,
  without touching any sibling checkout. Fail-open everywhere: non-git repos,
  main checkouts, and old gits behave exactly as before. Groundwork for
  canonical-fresh disclosure of law-shaped documents (W2).

## [0.64.0] — 2026-07-17

*The release whose headline is an experiment result: the corpora that graded the
first briefing 0/10, 1.0/5, and 8/10 two days ago were re-run blind against this
build and measured 10/10, 3.0/5, and 10/10-twice. The remaining aime gap is the
honest boundary of zero-setup: work tracked in conventions a repo never declared.
Orientation quality now scales with what the repo declares — which is the thesis.*

### Added
- **Wakeup's first impression of an existing repo (charter, Slices A-C).** The
  briefing gains a budgeted orientation map — repo-root README/AGENTS.md, the
  vision document (found under both NORTH-STAR and NORTH_STAR spellings), and
  existing index documents as openable pointers, never ingested bodies. A rich
  corpus no longer renders as an authoritative empty project. Disclosure is
  temporally grounded: a git-backed recency map (injected as plain data, core
  stays pure) orders decisions newest-first when frontmatter dates are absent.
  The byte-budget acceptance gate now asserts the exact pretty wire payload
  (≤3,072 bytes) instead of a token estimate.
  **Measured acceptance (reports 0006/0007/0008):** nisli first wakeup
  0/10 → **10/10** in 3.24s at 1,214 bytes, git provably untouched; erent blind
  A/B **10/10 in both tool sessions** (was 8/10), temporal-grounding and
  run-guidance questions both closed, `NORTH_STAR.md` surfaced as the vision;
  aime 1.0/5 → **3.0/5** — recency ordering, quarantine visibility, and
  git-cleanliness all passed; the remaining gap is work tracked in an undeclared
  `docs/issues/` convention, which the tool refuses to guess at (no inference by
  design). Known issues carried forward: document status is not searchable
  (BUG-0003); bare-path `get README.md` returns empty instead of resolving
  (use the `mcp://backlog/...` form).

### Fixed
- **Freeform statuses disclose correctly.** "Accepted (goga, 2026-07-16)" and
  friends now match declared substrate statuses by leading token — wakeup shows
  ~45 decisions in this repo where it previously showed one; `list --status`
  agrees.
- **Remember journals its intent exactly once**; failed writes journal nothing.
- **Quarantined documents are visible**: a malformed file in a claimed folder
  surfaces as a readable resource and wakeup says constraint disclosure is
  incomplete instead of implying completeness.
- **First read leaves git clean**: tool-owned ignores cover all derived control
  state (cache and journals).
- **CLI tags no longer swallow remember content** (comma-separated where a
  variadic positional follows).

## [0.63.0] — 2026-07-17

*The store starts noticing when it disagrees with itself: nearby memories that
might collide are surfaced for a human verdict — candidates, never verdicts —
and the dismissal is itself a durable, readable memory.*

### Added
- **Memory collision candidates (ADR 0120).** Remember receipts, consolidation,
  the existing contradictions command/tool, and a per-home viewer queue can now
  surface nearby live memories for review without declaring a contradiction or
  changing recall order. False collisions can be dismissed durably with the
  human-readable `distinct_from` Markdown field.

### Fixed
- **Docs-native migration accepts its own recommended layout.** A project whose
  control dir contains a tracked `.gitignore` (the layout the tool itself
  suggests) no longer fails the fail-closed migration; unknown files still
  refuse. Project cache directories are now kept out of git automatically,
  without rewriting any human-authored ignore rules.

## [0.62.0] — 2026-07-16

*The write surface finally matches the vision's grammar: agents don't "update a
row," they complete a task, capture a requirement, supersede a decision. Sixteen
verbs that mean something, compiled from the same substrate declarations a project
can write itself.*

### Added
- **Writes now speak substrate intent (ADR 0106.5).** The local MCP surface
  compiles sixteen narrow verbs such as `backlog_create_work`,
  `backlog_complete_task`, and `backlog_capture_requirement` from the active
  substrate registry, disclosing only the fields needed for that action. The
  low-level CLI create/update commands remain available for the rare tail.

### Removed
- **Generic MCP create/update tools.** `backlog_create` and `backlog_update`
  are no longer exposed alongside the semantic verbs; their names remain
  reserved so a project declaration cannot reclaim them with different
  behavior.

## [0.61.0] — 2026-07-16

*The flip: the repo's docs folder IS the backlog now, by default, with one explicit
migration. The global backlog and the project's docs behave like one memory — a
single question draws on both, the viewer shows which home you're in, and wakeup
carries the product requirements an agent must not derail — one of the founding
asks of the vision prompt.*

### Added
- **The viewer shows and switches homes (ADR 0112.4).** A provenance badge in the
  viewer chrome always says which backlog home you're looking at — the server's
  answer, not the URL's claim — and switching is a URL rewrite offering only the
  homes the session legitimately knows (never a workspace scan). Spotlight gains
  an opt-in "all homes" search: provenance-badged, rank-fused results that
  navigate into their home on click; browsing stays one home at a time.
- **Project-declared document types are searchable (ADR 0113 Phase C).** ADR,
  requirement, and prompt documents enter the shared search index through
  server-owned projections — a substrate is searchable only via its declared
  fields, raw entities can never be indexed directly, and memories stay excluded
  from generic search. Malformed documents in claimed folders remain visible as
  plain resources instead of vanishing.
- **Repository docs are now the production backlog (ADR 0112 Phase E).** The
  CLI, detached server, and Vite dev app all use per-home docs-native runtimes
  by default: a request from a project reads and writes that repository's
  `docs/`, while global work stays in `~/.backlog/docs/`. The explicit
  `migrate docs-native` command moves the old global layout and project control
  state once, with deterministic dry-run output, collision refusal, and
  rollback-safe writes; no dual-format runtime remains.
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
- **One backlog name and one context vocabulary (ADR 0112.2/0112.3).** The
  control folder is renamed `.backlog-mcp` → `.backlog`
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
