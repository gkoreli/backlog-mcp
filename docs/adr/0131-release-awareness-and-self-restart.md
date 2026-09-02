---
title: "0131 — Release Awareness and Self-Restart: System Information shows a stale daemon and restarts it"
date: 2026-09-01
status: "Accepted (goga) — implemented 2026-09-01, shipped 0.74.0"
author: goga + claude
relates_to:
  - 0124-resilient-daemon.md
  - 0130-clean-process-exit-onnx-abort.md
  - ../NORTH-STAR.md
---

# 0131 — Release Awareness and Self-Restart

## Context — "why is the old version still running?"

After three releases in one evening the daemon on port 3030 kept reporting
the previous version. Nothing was broken: the daemon already auto-upgrades.
The monotonic newer-wins rule (ADR 0124 R1; `server/port-collision.ts`)
replaces a running daemon when a *newer* bridge or `serve` connects, and the
ADR 0130 pre-bind probe makes that handover clean. What is missing is
visibility and a trigger: between session starts nothing connects, so a
release or rebuild that lands while the daemon keeps running is invisible
until someone opens System Information and compares numbers by hand.

The ask, scoped by the maintainer to **the locally running backlog**: System
Information should say whether the daemon is behind the install on disk, and
offer a button that restarts it onto that install. Not a registry lookup, not
a package manager, not npx: the existing auto-restart, surfaced.

## Audit

- **Version**: `paths.getVersion()` reads `package.json` next to the running
  `dist/` once, at start (`utils/paths.ts:63`). `/version` and `/api/status`
  serve that boot-time value. A release bump, a `pnpm build` on a linked
  checkout, or an in-place npx cache refresh changes the file on disk without
  the process noticing. This is exactly the fact the takeover keys on.
- **Spawn**: `cli/server-manager.ts:spawnServer` runs `process.execPath
  dist/node-server.mjs` detached, stdio appended to
  `~/.backlog/state/logs/runtime/server.log`.
- **Stop**: `POST /shutdown` → the ADR 0130 R4 drain. `/shutdown` accepted any
  origin: `app.use('*', cors())` reflects requested headers on preflight, so
  a web page could POST it. Verified live before the fix: a
  `curl -H "Origin: https://evil.example" -X POST /shutdown` stopped the
  daemon. A restart route must not widen that; it should close it.
- **Viewer**: `components/system-info-modal.ts` fetches `/api/status` on open.

## Rulings

**R1 — The fact is "install on disk vs running process".**
`core/installed-version.ts` re-reads the install's `package.json` on every
request (`readInstalledVersion`, pure over an injected reader, `null` on
failure) and `releaseStatus(running, installed)` flags `updateAvailable`
only when disk is strictly newer (`isOlderVersion`). This is the same
comparison the takeover makes, exposed on `GET /api/release` with
`canRestart` telling the viewer whether a restart seam exists (Node only;
the Worker answers "nothing known").

**R2 — Restart is the existing handover, triggered on demand.** `POST
/api/restart` → `requestRestart()` in `node-server.ts`: record a handover
(`process.execPath dist/node-server.mjs`, this install's own entry point),
answer 202, and 250 ms later run the ADR 0130 drain. Only after the listener
and every runtime are closed does `spawnDetachedServer` launch the
replacement (the spawn shape shared with the bridge, extracted from
`server-manager.ts`), so it finds the port free and no two daemons contend.
A second request while a handover is pending is a no-op.

**R3 — Mutating control routes are loopback-origin only.**
`server/loopback-origin.ts`: a request whose `Origin` header is present and
not `http(s)://localhost|127.0.0.1|[::1](:port)` gets 403. The viewer is
same-origin; curl and the CLI send no origin. Applied to `/api/restart` and
to `/shutdown`, closing the pre-existing exposure.

**R4 — The viewer waits for the new daemon, then reloads.**
`services/server-restart.ts` posts, then polls `/version` once a second for
up to 30 s. When the disk install was newer it waits for *that* version, so a
last answer from the outgoing process is never mistaken for the
replacement. Success reloads the page (new viewer assets); timeout names
`server.log`. System Information shows **Version** (running) and
**Installed** (disk, with "newer than the running server" when it is), and
one button: **Restart to X** when behind, **Restart server** otherwise.

**R5 — Out of scope, deliberately.** No npm registry check, no npx or
`npm -g` update mode, no install-kind detection. A first cut had all three;
the maintainer scoped this to the locally running backlog and they were
removed before landing. If a "fetch the latest release" action is ever
wanted, it is a separate ADR with its own install-shape story.

## Engineering

- `core/installed-version.ts` + `__tests__/installed-version.test.ts`.
- `server/loopback-origin.ts`; `server/hono-app.ts` routes `/api/release`,
  `/api/restart`, guard on `/shutdown`; deps `readReleaseStatus`,
  `requestRestart` threaded through `node-app` and `local-node-app` options.
  `__tests__/hono-release.test.ts`.
- `cli/server-manager.ts`: `spawnDetachedServer` extracted; `node-server.ts`
  composes the status reader and the handover.
- Viewer: `services/server-restart.ts` (+ test), `components/system-info-modal.ts`,
  `styles.css` release-actions block.

## Validation — findings (2026-09-01)

- Suites green; typecheck clean.
- Live on this machine (linked checkout), using the 0.74.0 bump itself as
  the stale case: with the daemon running 0.73.0, `/api/release` reported
  `installed: 0.73.0, updateAvailable: false`; after editing `package.json`
  to 0.74.0 on disk, the same route reported `installed: 0.74.0,
  updateAvailable: true` with no restart. Foreign-origin POSTs to
  `/api/restart` and `/shutdown` returned 403 and the daemon stayed up
  (before R3 the same shutdown request killed it). A `POST /api/restart`
  from `http://localhost:3030` answered 202; the structured log shows
  "Restart requested {running: 0.73.0, installed: 0.74.0}" then "Replacement
  daemon launched"; a new pid answered `/version` with 0.74.0 within 5 s and
  `/api/release` read current again. No abort on the outgoing process.
