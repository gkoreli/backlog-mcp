# Changelog

All notable changes to `backlog-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).
Version numbers refer to the published `backlog-mcp` server package; the viewer is
bumped in lockstep. This changelog begins at 0.57.0 — earlier history lives in git.

## [Unreleased]

### Added
- **Docs-native per-home runtimes (ADR 0112 Phase B).** The server resolves a
  separate local runtime per backlog *home*, selected per MCP tool call and per HTTP
  request, with isolated storage and event streams. The CLI can target a home
  explicitly and scopes direct commands to the invoking runtime; the server reports
  which home a response came from; the viewer scopes its state by the selected home.
  Adds a docs-native filesystem store.
- **User-defined substrates (ADR 0113 Phases A–B).** ADR, requirement, and prompt
  documents become data: a runtime substrate compiler and per-project substrate
  registry compile packaged substrate definitions, and writes route through the
  registry. Agents can create and edit substrate documents through the tool, and a
  project can declare its own types as a JSON definition plus a bounded JSON Schema.

### Changed
- The viewer renders Markdown through the nisli `resource()` path, retiring the
  ADR 0111 workaround (requires `@nisli/core` 0.54.0).
- Documentation distilled toward the context-and-memory-engineering positioning:
  NORTH-STAR tenets and invariants from PROMPT 0002, and a full README uplift.

### Fixed
- The runtime fails closed across claim and tool boundaries and preserves substrate
  contracts when routing across homes.
- The CLI rejects contradictory home selections; the viewer isolates home-scoped
  request state and uses canonical home cache keys.

## [0.59.0] — 2026-07-16

### Added
- **Docs-native backlog foundations (ADR 0112).** The backlog can live as documents
  on disk: document identity, discovery, and home resolution, exported docs-native
  core APIs, a docs-tree file watcher, and a built-in substrate storage catalog.
- **Richer memory recall (ADR 0115).** Recall results now carry provenance, and
  `wakeup` knowledge stubs surface `age_days` and usage counts so agents can weigh
  how fresh and how used a memory is.
- **Inline relational context in `backlog_get` (ADR 0114).** `backlog_get(context)`
  folds related items in as role-grouped stubs, and the memory protocol gains an
  explicit *expand* step.

### Changed
- Repositioned the tool as **context & memory engineering for agents** — updated
  README, npm package description, and keywords.
- North-star scope narrowed: dropped the D1/Workers path in favor of local-first as
  the architecture.

### Removed
- **The `backlog_context` tool and its hydration pipeline (ADR 0114).** Relational
  context now flows through the memory verbs and `backlog_get(context)` instead of a
  dedicated tool.

### Fixed
- Date-prefixed and date-named documents are recognized as generic documents and no
  longer collide on identity.

## [0.58.0] — 2026-06-19

### Changed
- The viewer ships a fine-grained Shiki syntax-highlighting bundle, cutting the built
  viewer from ~36 MB to ~16 MB for faster loads.

## [0.57.0] — 2026-06-19

### Changed
- The viewer renders diffs with a custom, lighter-weight renderer in place of
  diff2html.
