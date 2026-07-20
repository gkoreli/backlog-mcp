---
title: "0128 — Recent Homes: self-declaration on use, observed in core, persisted in composition"
date: 2026-07-20
status: "Accepted (goga) — implementing"
author: studio-engineer
relates_to:
  - 0112.4-viewer-home-selector.md
  - 0124-resilient-daemon.md
  - 0123-authoritative-derived-evidence-boundary.md
  - 0125-consumer-agnostic-core-compose-dependencies.md
  - ../NORTH-STAR.md
---

# 0128 — Recent Homes

## Context — the header only ever shows "global"

The viewer's home selector (`viewer/components/home-selector.ts`) renders
`global` (always) plus **exactly one** project — and only when the URL already
carries `?project_root=` (`when(hasUrlProject, …)`, line 95;
`url-state.ts:56` reads `params.get('project_root')`). Its header comment
states the HARD LAW (ADR 0112 R-9): *the menu never asks the server what
workspaces exist and never triggers a disk scan.*

The consequence: open `http://localhost:3030/` with no query param and the
switcher shows only `global`, because **the system has no memory that your
projects exist.** Two facts confirmed by audit:

- **One singleton server, many homes — not "a global server" vs "a local
  server."** `createLocalNodeApp()` starts one process, binds one port, owns
  one `LocalRuntimeRegistry` (`local-node-app.ts:27,40`). The registry is
  `Map<string, Promise<LocalRuntime>>` keyed by home root
  (`local-runtime-registry.ts:9`) and spins up a runtime per home **on
  demand**. "global" and "project" are two *homes* the one server serves,
  selected per-request (`local-runtime-request-resolver.ts`).
- **No persisted registry of known homes exists.** `config.json` is
  *per-home* config (`core/config.ts:16`), never a catalog of other homes. A
  grep for a homes registry returns nothing. The `LocalRuntimeRegistry` is
  in-memory and **forgets every project on restart.**

## The idea — "recent projects," like `code .`

VS Code adds a directory to *Recent Projects* the moment you open it (`code
.`); the act of opening **is** the declaration. No scan, no manual list.

Mirror that exactly: **a project home earns a place in a durable registry the
first time an agent actually works against it** — via `wakeup`, `get`,
`search`, `list`, or any core operation. The switcher then reads that
registry and offers every known project. Switching stays a URL rewrite (ADR
0112 law: the viewer is a pure function of the URL); the singleton already
serves any registered home through its per-home registry.

This closes the exact gap ADR 0124 R1 chartered — *"a single resident daemon
serves every **registered** home/repo (global + N projects)"* — where
"registered" is a word no code implements today.

## Constraints

- **No directory scanning, ever** (ADR 0112 R-9). Registration is a
  side-effect of *use*, not a product of *search*. The selector reads a small
  declared manifest, never walks the filesystem.
- **One core, many consumers** (ADR 0125). The behavior must land **once**, in
  the shared seam both MCP tools and the CLI already funnel through — not in a
  CLI command (MCP wouldn't get it) nor an MCP tool (CLI wouldn't). Evidence:
  `tools/backlog-wakeup.ts:6` and `cli/commands/wakeup.ts:2` both import the
  same `core/wakeup.ts:338`.
- **Core stays pure** (ADR 0090/0125). Core never touches fs/git. Core may
  *observe* that a home was used; only the Node composition (the layer already
  allowed to touch disk) **persists** the manifest — same discipline as
  `buildGitRecencyMap` being injected, not called from core.
- **Derived, never a tracked doc** (ADR 0123). The manifest is engine state,
  not a committed markdown document. It lives under the global home's
  `state/` (already gitignored via `DERIVED_CONTROL_RULES = ['cache/',
  'state/']`, `local-runtime.ts:68`), never in `docs/`.
- **Fail-open.** A registry write must never break the operation that
  triggered it (mirror the usage-log discipline: `appendUsageLine` swallows
  its own errors, `local-runtime.ts:118`).

## Proposals

### Proposal A — hook `LocalRuntimeRegistry.get()` (rejected)

Register on first `get()` of a `kind:'project'` home.

- **Pros**: one line, catches every resolution.
- **Cons**: **wrong layer.** `get()` is engine plumbing below the consumer
  line; it fires for internal/system resolutions that have nothing to do with
  *an agent working in a project*. It also lives in the storage layer, which
  would then need fs-write access to a global manifest — a responsibility
  inversion. Registration is a *meaning-bearing* event ("real work happened
  here"), and this layer can't see meaning. **Rejected** — this is the mistake
  the "one core, many consumers" framing corrects.

### Proposal B — replicate in each core op (rejected)

Add a "touch home" call inside `wakeup`, `get`, `search`, `list`.

- **Pros**: precise; only real operations register.
- **Cons**: four copies of the same side-effect (DRY violation), and the set
  is arbitrary — forget one and the feature feels inconsistent. Also drags an
  fs/registry dependency into every core function, breaking core purity.
  **Rejected.**

### Proposal C — observe at the composition's request/runtime boundary (chosen)

Both consumers resolve a `BacklogHome` **before** running any core operation:
the server in `resolveRuntime()` (`local-node-app.ts:51`) and the CLI in
`createDocsNativeCliRuntime()` (`runner.ts:67`). That single boundary — above
all core ops, below the transport — is where "this home is about to be used"
is known. Record there, once per resolution, only for `kind:'project'` homes.

- **Pros**: one implementation serves MCP **and** CLI (they share the
  composition boundary just as they share core); core stays pure; the
  observation is meaning-bearing ("a consumer resolved a project home to do
  work"); no scan; idempotent bump on repeat use. Matches `code .` exactly —
  resolving the home *is* the open.
- **Cons**: fires on resolution even if the subsequent op errors — acceptable
  and correct (VS Code adds the recent entry on open, not on first successful
  edit). A raw `?project_root=/tmp/x` that *does* run an op will register;
  curation (Ruling R6) handles regret.

## Decision

**Proposal C.** It is the only option that honors one-core-many-consumers
(land once at the shared composition seam), keeps core pure, and treats
registration as the meaning-bearing "home was opened for work" event rather
than a plumbing artifact. A is the wrong layer; B duplicates and pollutes core.

### Rulings

- **R1 — Manifest.** A JSON file `homes.json` under the **global** home's
  `state/` dir (`<globalRoot>/state/homes.json`). Shape: `{ version: 1, homes:
  [{ root, label, first_seen, last_seen }] }`, `root`-keyed, `last_seen`-desc
  when read. `root` is the canonical path; `label` defaults to `basename(root)`.
  It is derived engine state, sibling to the existing `state/operations.jsonl`
  and `state/logs/` — not a tracked doc (ADR 0123). **Caveat (found in
  validation, see below):** `state/` is only auto-gitignored for *project*
  homes (`ensureProjectControlIgnores`, gated on `kind === 'project'`); the
  global home does not receive that treatment today, so in a git-versioned
  global home (like this maintainer's) `state/` already surfaces in
  `git status` — a pre-existing gap this ADR does not widen (see Adjacent
  findings).
- **R2 — Core observation seam.** A pure `RecentHomesObserver` interface
  (`recordUse(home): void`) lives in core as an *injected* dependency, default
  no-op. Core never implements persistence; it only exposes the seam. (In
  practice the record is emitted at the composition boundary, R3 — core carries
  the *contract*, not the write.)
- **R3 — Composition persists.** The Node composition wires a real observer
  that appends/bumps the manifest. It is invoked once per runtime resolution
  in **both** `resolveRuntime()` (server) and `createDocsNativeCliRuntime()`
  (CLI), only when `home.kind === 'project'`. Global is the implicit,
  always-present entry and is never recorded (VS Code doesn't list your home
  dir as a recent project).
- **R4 — Fail-open.** Manifest read/write errors are swallowed and never
  propagate to the triggering operation (mirror `appendUsageLine`). A missing
  or corrupt manifest reads as empty.
- **R5 — Read endpoint + selector.** A new `GET /api/homes` returns the
  manifest (global entry synthesized first, then recent projects). The home
  selector reads it and renders `global` + all recent projects; picking one
  rewrites the URL to `?home=project&project_root=<root>` — no disk scan, the
  law (R-9) intact. Missing endpoint (legacy server) degrades to today's
  URL-only behavior.
- **R6 — Curation & staleness.** `DELETE /api/homes/:root` (and a
  `backlog home forget <root>` CLI verb) removes an entry. The selector shows
  a recent home even if its path is currently unreachable, marking it stale on
  resolution failure rather than breaking the chrome or auto-deleting (an
  unmounted drive is not a deleted project).
- **R7 — No new "recent" trigger set.** Any core operation that resolves a
  project home counts as use; we do not enumerate a privileged subset. One
  observation point above all ops (R3) — never a per-command list that can
  drift.

## Validation plan

- Unit (core): the observer seam defaults to no-op; core ops are byte-identical
  with no observer wired.
- Unit (composition): resolving a project home appends a new entry; resolving
  it again bumps `last_seen` without duplicating; a global resolution records
  nothing; a throwing manifest write does not fail the resolution.
- Unit (viewer): `/api/homes` shape renders global + N projects; picking a
  project rewrites the URL; absent endpoint falls back to URL-only.
- Manual: `backlog wakeup` inside a repo (CLI), then reload the viewer with no
  query param — the repo now appears in the switcher and can be switched to;
  restart the server and confirm it persists (the in-memory registry forgets,
  the manifest does not).

## Validation findings (manual, real 199-task project against the global home)

Ran the real loop, not just unit tests (AGENTS.md dev-loop step 5):

- **Self-declaration works end-to-end.** `/api/homes` returned only `global`
  at boot; a single `GET /api/status?home=project&project_root=<repo>` (the
  same resolution any MCP/viewer request triggers) made the repo appear in
  `/api/homes` as `{home:'project', root, label:'backlog-mcp', first_seen,
  last_seen}`.
- **Persisted to disk** at `<globalRoot>/state/homes.json`, versioned and
  human-readable — survives restart (the in-memory `LocalRuntimeRegistry`
  forgets; the manifest does not — exactly the gap this closes).
- **Forget works.** `DELETE /api/homes/<url-encoded-root>` returned
  `{removed:true}` and `/api/homes` fell back to just `global`.
- **Gitignore gap surfaced (corrected in R1).** `state/homes.json` is NOT
  ignored in the global home because `ensureProjectControlIgnores` is
  project-only. It landed as untracked next to `state/logs/runtime/`, which
  was *already* untracked before this change — so the leak pre-exists and this
  feature only adds one more file to it. Captured as an adjacent finding, not
  silently left as a false "it's ignored" claim.

## Adjacent findings (out of scope, captured for awareness)

- **Global-home derived state is not gitignored.** `DERIVED_CONTROL_RULES`
  (`cache/`, `state/`) is only written into a `.gitignore` for project homes
  (`local-runtime.ts` `ensureProjectControlIgnores`, gated on `kind ===
  'project'`). A git-versioned global home (a user who `git init`s
  `~/.backlog` to sync their corpus) sees `cache/`, `state/logs/`, and now
  `state/homes.json` as untracked. Fix would be to also ensure the global
  home ignores its own derived dirs — a separate change with its own blast
  radius (the global home's root *is* its control dir, so the ignore file's
  placement differs). Deferred.

## Cross-references

- **ADR 0112.4 (0112.4-viewer-home-selector.md) R-9** — the "no disk scan from
  the chrome" law; this ADR satisfies it by having the selector read a
  declared manifest rather than enumerate the filesystem.
- **ADR 0124 (0124-resilient-daemon.md) R1** — "one daemon, many *registered*
  homes"; we implement the missing registration so "registered" means
  something.
- **ADR 0123 (0123-authoritative-derived-evidence-boundary.md)** — the manifest
  is derived engine state (under gitignored `state/`), never an authoritative
  committed doc; grounds R1's location choice.
- **ADR 0125 (0125-consumer-agnostic-core-compose-dependencies.md)** — one core,
  many consumers; grounds the decision to land at the shared composition seam
  (Proposal C) and reject the CLI-only / MCP-only / per-op alternatives.
- **`local-runtime.ts:68,118`** — `DERIVED_CONTROL_RULES` (where `state/` is
  gitignored) and `appendUsageLine` (the fail-open write pattern) — reused
  verbatim as the manifest's location and error discipline.
