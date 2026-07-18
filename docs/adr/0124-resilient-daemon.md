---
title: "0124 — The Resilient Daemon: the Engine's Hand-Rolled Lifecycle Becomes Production-Grade"
date: 2026-07-18
status: "Chartered (goga, PROMPT 0016) — Phase A audit delegated; design children follow"
author: granite (architect)
relates_to:
  - ../prompts/0016-resilient-daemon-charter.md
  - ../prompts/0015-engine-absorption-license.md
  - ../NORTH-STAR.md (Invariants 7 and 9)
  - 0123-authoritative-derived-evidence-boundary.md
---

# 0124 — The Resilient Daemon

## Context — the evidence column is already full

The server's lifecycle is hand-rolled and it showed three times in one week:

1. **Stale long-runner:** Goga's viewer served v0.62.0 for days while five
   releases shipped — upgrade requires a *new instance colliding* with the
   old one (`server/port-collision.ts`: takeover-by-version on EADDRINUSE),
   so a daemon nobody restarts silently rots.
2. **Takeover killed live work:** a builder's verification probe on port
   3030 triggered exactly that policy and shut down Goga's running server
   mid-session (2026-07-18, desk-hardening report). The upgrade path and
   the denial-of-service path are currently the same code.
3. **Organ fragility is handled ad hoc:** watcher backends differ by
   environment (FSEvents unavailable in worktrees — codex fixer fell back
   to kqueue by hand), index warmth is per-process luck, and nothing
   restarts a crashed subsystem.

The lifecycle machinery — `cli/supervisor.ts`, `cli/server-manager.ts`,
detached spawn, port-based discovery — was right for the phase that built
it. PROMPT 0016 rules that phase over: *"we are mature enough that our
hand rolled server needs to become a resilient production grade daemon."*

## Scope — bounded by two invariants

**Invariant 9 licenses the ambition:** the daemon may absorb whatever it
needs (health stores, IPC, supervision trees, socket handoff) — all engine
layer, all replaceable, truth untouched. **Invariant 7 bounds it:** the
daemon supervises its **own organs**, never agents. Restarting a crashed
watcher is ours; retrying an agent's failed task is aime's, forever.

## The requirements (charter level — design children will refine)

- **R1 — One daemon, many homes.** A single resident daemon serves every
  registered home/repo (global + N projects); per-repo processes become a
  choice, not an accident of cwd.
- **R2 — Supervised organs.** Watcher, index, embedder, telemetry sinks,
  event stream, viewer — each an organ with declared health, restartable
  in isolation by an internal supervisor. An organ crash degrades honestly
  (disclosed in `status` and the briefing meta) instead of killing the
  daemon or lying.
- **R3 — Graceful upgrade replaces takeover-by-collision.** A new version
  negotiates handoff with the incumbent (drain, transfer, exit) — the
  upgrade path and the collision path stop being the same code. A
  *foreign* port holder is never killed in production (the 2026-07-18
  incident becomes structurally impossible).
- **R4 — Crash recovery IS the destruction gate.** Recovery after kill -9
  = rebuild derived state from authoritative documents (ADR 0123
  taxonomy); the D2 destruction test doubles as the recovery acceptance
  test. Evidence-class files (journal, telemetry) reopen append-only with
  torn-tail tolerance.
- **R5 — A health surface that tells the truth.** `backlog status` and
  `/health` report per-organ state, versions, homes served, index
  freshness, and last-event timestamps — the Desk HEALTH class gets a
  daemon section for free.
- **R6 — Native service integration, optional.** launchd (macOS) /
  systemd (Linux) definitions shipped as artifacts, never required —
  zero-setup bolt-on still works with nothing installed.
- **R7 — Events remain observation.** The event stream (SSE today;
  transport replaceable per Invariant 9) notifies; it never commands.
  Consumers poll truth from the store; missing an event never corrupts.

## Non-goals (recorded refusals)

Agent supervision, retries, or scheduling (Invariant 7); a remote server
mode (Invariant 4 — remote is a VPS running this same daemon); config
sprawl (the daemon must run with zero configuration exactly as the server
does today); Kubernetes-shaped anything.

## Prior art anchors

herdr (observe/control lease model over local processes — the taste
anchor); ghostty (the quality bar for a beautiful local resident program);
postgres's postmaster (one parent, supervised organ children, crash =
reinitialize shared state — the classic shape, fifty years proven); aime's
daemon (the in-house sibling; patterns shared, run-loops not).

## Phases

- **Phase A — audit (delegated on charter day):** map the hand-rolled
  lifecycle end to end (spawn, discovery, collision, shutdown, watcher
  backends, index warmup), enumerate failure modes with evidence, and
  propose the organ decomposition + upgrade-handoff design options with
  trade-offs. Read-only; produces the design dossier for Phase B.
- **Phase B — design children:** 0124.1 organ supervision model, 0124.2
  upgrade handoff protocol, 0124.3 multi-home residency. Each with its
  own acceptance tests, ruled individually.
- **Phase C — build slices,** each gated by: kill -9 recovery clean
  (R4), upgrade without killing sessions (R3), and the structural suite
  green throughout.
