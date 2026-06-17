---
title: "0105. Per-Repo Config (.backlog-mcp/) — Auto-Scope Memory & Wakeup"
date: 2026-06-16
status: Accepted
backlog_item: TASK-0686
---

# 0105. Per-Repo Config (.backlog-mcp/) — Auto-Scope Memory & Wakeup

**Date**: 2026-06-16
**Status**: Accepted
**Backlog Item**: TASK-0686

## Problem

The backlog is a single shared store holding many projects (backlog-mcp =
`FLDR-0001`, plus SageMaker tasks, blog, immigration, …). When an agent or user
runs `wakeup` / `recall` / `remember` from a project directory, nothing maps
**cwd → that project's scope folder**. The calls default to the *entire*
backlog — a firehose — unless a human remembers to pass `--scope FLDR-0001` /
`--context FLDR-0001` every time. That's goodwill, not enforcement (the
`AGENTS.md` Memory Protocol, commit `c5ac35f`, is the interim mitigation).

We want a **per-repo config** that supplies a default scope automatically, with
room to absorb other per-repo settings later.

## Research — grounded in the code

### The scope params already exist end-to-end

The gap is *not* plumbing — it's a missing default. Confirmed:

- `WakeupParams.scope?: string` (`core/types.ts:250`) → `core/wakeup.ts` builds a
  descendant set and filters every section.
- `RecallParams.context?: string` (`core/types.ts:355`) → `BacklogMemoryStore.recall`
  filters on `parent_id === context`.
- `RememberParams.context?: string` (`core/types.ts:409`) → becomes the memory's
  `parent_id` (= recall scope).
- MCP tools (`backlog-wakeup.ts`, `backlog-recall.ts`, `backlog-remember.ts`) and
  CLI commands (`cli/commands/{wakeup,recall,remember}.ts`) already expose these.

So a default provider that fills these when absent is all that's missing.

### The decisive asymmetry: CLI vs MCP server cwd

This shapes the entire design.

- **CLI runs in-process.** `cli/runner.ts` calls `BacklogService.getInstance()`
  directly against the data dir. `process.cwd()` is the user's project dir —
  **file discovery from cwd is reliable here.**
- **The MCP server is detached, persistent, and shared.** `cli/server-manager.ts`
  spawns `node-server.mjs` with `detached: true`, `child.unref()`, persisting
  across sessions and shared by multiple MCP clients (DEVELOPMENT.md "Production
  Mode"). Its `process.cwd()` is **not** the client's project dir. Reading a
  per-project config file from the server's cwd is unreliable.
- Precedent: `BACKLOG_DATA_DIR` (`paths.ts:81`) already solves the analogous
  "which data dir" problem via **env**, because env is the one channel that
  survives the detached spawn (it's forwarded in the MCP client config and in
  `spawnServer`'s `env: { ...process.env }`).

**Conclusion:** the config *file* is the right surface for the in-process CLI;
**env (`BACKLOG_SCOPE`) is the right surface for the detached server.** A correct
design honors both, with a single precedence order.

### No existing config module

`find packages/server/src -iname "*config*"` → none. `process.cwd()` is used
nowhere in server src today. This is greenfield; we set the pattern.

## Decision

Introduce a **`.backlog-mcp/` per-repo config folder**, read by a new
transport-free core module `core/config.ts`, exposing a single resolver used by
the CLI commands (and available to any consumer) to supply a **default scope**
when none is passed explicitly.

```
.backlog-mcp/
  config.json        # committed — { "scope": "FLDR-0001" }
  config.local.json  # gitignored — per-machine overrides (future: dataDir, port)
  .gitignore         # contains: config.local.json
```

### Resolution precedence (highest wins)

```
explicit CLI flag / MCP param   (caller intent — never overridden)
  > BACKLOG_SCOPE env var        (works for the detached server)
  > .backlog-mcp/config.local.json
  > .backlog-mcp/config.json
  > undefined (whole-backlog — current behavior)
```

The config is a **default provider**, never a hard override of explicit input.

### Discovery

Walk up from `cwd` to the nearest `.backlog-mcp/` directory, stopping at
filesystem root. (Same model as `tsconfig.json` / `package.json` resolution.)
Pure function over an injected `cwd` + `readFile` so it's memfs-testable.

### Scope (this task) vs follow-ups

- **Ship now:** the config module + `scope` field + wiring into the three CLI
  commands' default + `BACKLOG_SCOPE` env support. Backward compatible: no
  config and no env → today's whole-backlog behavior, byte-for-byte.
- **Follow-ups (out of scope, noted for awareness):** migrate `dataDir`
  (`BACKLOG_DATA_DIR`) and viewer `port` (`BACKLOG_VIEWER_PORT`) into the same
  config; memory defaults (default decay `halfLifeDays`); full server-side
  per-project resolution (needs the client to forward its cwd/scope — env is the
  bridge until then). The config *file* is deliberately extensible to absorb
  these without a schema break.

## Options considered

### Option 1 — `.backlog-mcp/` folder (CHOSEN)

A directory with `config.json` (committed) + `config.local.json` (gitignored).

- **Pros:** the committed-vs-local split is a *known* requirement (scope is
  shared and belongs in git; a machine-specific dataDir does not). A folder
  expresses it natively, with `.vscode/` / `.git/` precedent. Extensible home
  for future per-repo state without cluttering the repo root.
- **Cons:** YAGNI risk if only one file ever lives there; a dotfolder is hidden
  from `ls`. Both judged acceptable — the local/committed split alone justifies
  the folder, and "hidden" matches every peer tool.

### Option 2 — single `backlog-mcp.json` file

One visible JSON file at the repo root.

- **Pros:** simplest; visible/discoverable; fine if only scope + a few defaults
  ever exist.
- **Cons:** cannot express committed-vs-local without sprouting a sibling
  `backlog-mcp.local.json` — which is a folder without the folder. Rejected for
  that reason; folded into Option 1.

### Option 3 — env var only (`BACKLOG_SCOPE`)

Mirror `BACKLOG_DATA_DIR`.

- **Pros:** trivial; the only thing that reaches the detached server.
- **Cons:** per-launch, not per-repo; easy to forget; doesn't travel with the
  repo or get code-reviewed. **Not rejected — adopted as a precedence layer**
  (it's how the server gets scope), but insufficient as the *primary* per-repo
  mechanism a human edits.

### Option 4 — folder-title match (cwd basename → folder title)

- **Pros:** zero config.
- **Cons:** fragile — rename/clone/duplicate-title all break it silently.
  Rejected; at most a last-resort fallback, not implemented.

## Critique (brutal, self-honest)

- **Does this actually help the agent?** The agent recalls via the **MCP tool**,
  served by the **detached server** — which can't read the project's config
  file. So the config *file* primarily helps the **CLI** path. For the MCP
  agent path, only `BACKLOG_SCOPE` (env, set in the MCP client config) takes
  effect today. This is an honest limitation, not a bug: it mirrors exactly how
  `BACKLOG_DATA_DIR` already works, and full server-side per-project resolution
  is a real follow-up requiring the client to forward cwd. Shipping the file +
  env now is the correct increment — it makes the CLI "just work" and gives the
  MCP path a reviewed, repo-adjacent knob (`.backlog-mcp/config.json` documents
  the scope; the operator mirrors it into the client's env block). We do **not**
  pretend the file auto-scopes the shared server.
- **Singleton trap.** `PathResolver` is a process singleton reading env at
  construction. The config resolver must read `cwd`/env *per call* (or accept
  them injected) so tests and a long-lived process behave correctly. Designed as
  a pure function, not a singleton.
- **Validation failure mode.** A malformed `config.json` must not crash
  `wakeup`. Resolver swallows parse/validation errors → logs once → falls
  through to the next precedence layer (graceful degradation, same posture as
  the embedding-service fallback).
- **Scope correctness already enforced downstream.** `core/wakeup.ts`
  `assertValidScope` rejects non-container / malformed ids. A bad config scope
  surfaces as a clear ValidationError, not silent wrong data.

## Consequences

- **Positive:** CLI auto-scopes per project with zero flags; per-repo config has
  a home and a defined precedence; fully backward compatible; sets the config
  pattern for future settings.
- **Negative / risks:** the MCP server path still needs `BACKLOG_SCOPE` env (file
  alone doesn't reach it) — documented, not hidden. One more file shape for users
  to learn.

## Implementation notes

- New `packages/server/src/core/config.ts` — `findConfigDir(cwd, exists)`,
  `loadRepoConfig(cwd, deps)`, `resolveScope({ explicit, cwd, env, deps })`.
  Pure, injectable, memfs-testable. Zod schema (`zod` already a dep) with
  `.passthrough()`-style tolerance so future keys don't break older parsers.
- Wire `resolveScope` into `cli/commands/{wakeup,recall,remember}.ts`: when the
  flag is absent, fall back to the resolved default; explicit flag always wins.
- Seed this repo's `.backlog-mcp/config.json` with `{ "scope": "FLDR-0001" }`
  plus `.gitignore`.
- Tests: discovery walk-up, precedence ordering, malformed-config degradation,
  explicit-wins, no-config no-op.
